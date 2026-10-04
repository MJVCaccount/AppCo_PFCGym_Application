/**
 * Security hardening tests, run against the seeded test database (see
 * tests/helpers/db.ts): the Postgres rate limiter and where it is applied,
 * the same-origin check, the JSON body reader, the middleware gate, the
 * security headers and the Content-Security-Policy.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resetDatabase, testDb } from "./helpers/db";

import { NextRequest } from "next/server";

import { login, requestPasswordReset, submitPasswordReset } from "../src/actions/auth";
import { sendEnquiry } from "../src/actions/gym";
import { buildCsp, cspHeaderName, newNonce } from "../src/lib/csp";
import { readJson } from "../src/lib/json";
import { readJsonObject } from "../src/lib/api";
import { assertSameOrigin } from "../src/lib/origin";
import { prisma } from "../src/lib/prisma";
import {
  checkLimit,
  clearLimit,
  clientIp,
  firstDenied,
  limitKey,
  POLICIES,
  rateLimit,
  tooManyAttempts,
} from "../src/lib/rateLimit";
import { deleteExpiredBuckets } from "../src/lib/repositories/rateLimitRepository";
import { createSession, destroySession } from "../src/lib/session";
import { COOKIE_NAME, encodeSession } from "../src/lib/sessionToken";
import * as bookingsRoute from "../src/app/api/bookings/route";
import * as liveRoute from "../src/app/api/health/route";
import * as readyRoute from "../src/app/api/health/ready/route";
import { config, middleware } from "../src/middleware";
import { cookies } from "next/headers";
import type { SessionUser } from "../src/lib/types";
import { EMPTY_FORM_STATE } from "../src/lib/validation";

import { setTestRequestHeaders } from "./support/next-headers";
import { RedirectError } from "./support/next-navigation";

const APP = "https://pfc.test.invalid";
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const row = await testDb.user.findUniqueOrThrow({ where: { email } });
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const loggedErrors: string[] = [];

/** Makes every raw query fail for the duration of `fn`, as if Postgres were down. */
async function withDatabaseDown<T>(fn: () => Promise<T>): Promise<T> {
  const original = prisma.$queryRaw;
  // The logger writes the failure to stderr; keep the test output readable and
  // check below that it was logged.
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    loggedErrors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async () => {
    throw new Error("connection refused");
  };
  try {
    return await fn();
  } finally {
    process.stderr.write = write;
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : /\.(ts|tsx)$/.test(name)
        ? [full]
        : [];
  });
}

async function main() {
  await resetDatabase();

  process.env.APP_URL = APP;

  const member = await sessionFor("member@pfc.co.za");
  const coach = await sessionFor("coach@pfc.co.za").catch(() => null);
  const admin = await sessionFor("admin@pfc.co.za");

  // ------------------------------------------------------------ limiter

  console.log("\nRATE LIMITER");

  await check("allows exactly N calls in a window, then denies", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await rateLimit("t:exact", 5, 600));

    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, true, true, false, false],
    );
    assert.deepEqual(
      results.slice(0, 5).map((r) => r.remaining),
      [4, 3, 2, 1, 0],
    );
    assert.equal(results[5].remaining, 0);
    assert.ok(
      results[5].retryAfterSeconds >= 1 && results[5].retryAfterSeconds <= 600,
      `retry-after ${results[5].retryAfterSeconds}`,
    );
  });

  await check("the window ends and counting starts again", async () => {
    for (let i = 0; i < 4; i++) await rateLimit("t:reset", 3, 600);
    assert.equal((await rateLimit("t:reset", 3, 600)).allowed, false);

    await testDb.rateLimitBucket.update({
      where: { key: "t:reset" },
      data: { resetAt: new Date(Date.now() - 1000) },
    });

    const fresh = await rateLimit("t:reset", 3, 600);
    assert.equal(fresh.allowed, true);
    assert.equal(fresh.remaining, 2);
    assert.equal((await testDb.rateLimitBucket.findUniqueOrThrow({ where: { key: "t:reset" } })).count, 1);
  });

  await check("20 parallel calls never let more than N through", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit("t:parallel", 5, 600)),
    );

    assert.equal(results.filter((r) => r.allowed).length, 5);
    assert.equal(results.filter((r) => !r.allowed).length, 15);
    assert.equal((await testDb.rateLimitBucket.findUniqueOrThrow({ where: { key: "t:parallel" } })).count, 20);
  });

  await check("separate keys do not share a count", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("t:a", 2, 600);
    assert.equal((await rateLimit("t:b", 2, 600)).allowed, true);
  });

  await check("a database failure fails open by default and closed when asked", async () => {
    const open = await withDatabaseDown(() => rateLimit("t:down", 1, 60));
    assert.equal(open.allowed, true);

    const closed = await withDatabaseDown(() =>
      rateLimit("t:down", 1, 60, { onError: "closed" }),
    );
    assert.equal(closed.allowed, false);
    assert.ok(closed.retryAfterSeconds >= 1);
  });

  await check("the failure is logged through the logger, without leaking to the caller", () => {
    const line = loggedErrors.find((l) => l.includes("Rate limiter database call failed"));
    assert.ok(line, "logged");
    assert.equal(JSON.parse(line).level, "error");
  });

  await check("sign-in and password policies fail closed, public ones open", async () => {
    for (const name of ["loginIpEmail", "loginIp", "register", "forgotIp", "forgotEmail", "resetIp"] as const) {
      assert.equal(POLICIES[name].failClosed, true, name);
      assert.equal((await withDatabaseDown(() => checkLimit(name, "x"))).allowed, false, name);
    }
    for (const name of ["contact", "booking", "upload"] as const) {
      assert.equal(POLICIES[name].failClosed, false, name);
      assert.equal((await withDatabaseDown(() => checkLimit(name, "x"))).allowed, true, name);
    }
  });

  await check("the policies are the ones specified", () => {
    const flat = Object.fromEntries(
      Object.entries(POLICIES).map(([k, v]) => [k, `${v.limit}/${v.windowSeconds}`]),
    );
    assert.deepEqual(flat, {
      loginIpEmail: "5/900",
      loginIp: "30/900",
      register: "5/3600",
      forgotIp: "3/3600",
      forgotEmail: "3/3600",
      resetIp: "10/3600",
      contact: "5/3600",
      booking: "30/600",
      upload: "20/3600",
    });
  });

  await check("keys hold a hash, never the email or address", async () => {
    await checkLimit("loginIpEmail", "198.51.100.7|someone@example.co.za");
    const keys = (await testDb.rateLimitBucket.findMany()).map((b) => b.key).join("\n");

    assert.ok(!keys.includes("someone@example.co.za"));
    assert.ok(!keys.includes("198.51.100.7"));
    assert.match(limitKey("loginIp", "x"), /^loginIp:[0-9a-f]{64}$/);
  });

  await check("expired buckets are deleted, live ones stay, in bounded batches", async () => {
    await testDb.rateLimitBucket.deleteMany();
    await testDb.rateLimitBucket.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, i) => ({ key: `old:${i}`, count: 1, resetAt: new Date(Date.now() - 60_000) })),
        { key: "live", count: 1, resetAt: new Date(Date.now() + 60_000) },
      ],
    });

    assert.equal(await deleteExpiredBuckets(3), 3, "the batch is bounded");
    assert.equal(await deleteExpiredBuckets(500), 2);
    assert.deepEqual((await testDb.rateLimitBucket.findMany()).map((b) => b.key), ["live"]);
  });

  await check("clientIp prefers x-real-ip, then the first x-forwarded-for, then unknown", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "  4.4.4.4  " })), "4.4.4.4");
    assert.equal(clientIp(new Headers()), "unknown");
  });

  await check("the message names the wait in minutes", () => {
    assert.equal(tooManyAttempts(1), "Too many attempts. Try again in 1 minute.");
    assert.equal(tooManyAttempts(61), "Too many attempts. Try again in 2 minutes.");
    assert.equal(tooManyAttempts(900), "Too many attempts. Try again in 15 minutes.");
    assert.equal(
      firstDenied(
        { allowed: false, remaining: 0, retryAfterSeconds: 30 },
        { allowed: false, remaining: 0, retryAfterSeconds: 90 },
        { allowed: true, remaining: 1, retryAfterSeconds: 5 },
      )?.retryAfterSeconds,
      90,
    );
    assert.equal(firstDenied({ allowed: true, remaining: 1, retryAfterSeconds: 5 }), null);
  });

  // ------------------------------------------------------------ forms

  console.log("\nLIMITS ON THE FORMS");

  const loginForm = (password: string) =>
    form({ email: "member@pfc.co.za", password, returnUrl: "/dashboard" });

  async function loginResult(password: string): Promise<string> {
    try {
      const state = await login(EMPTY_FORM_STATE, loginForm(password));
      return state.message ?? "no message";
    } catch (e) {
      if (e instanceof RedirectError) return `redirect ${e.url}`;
      throw e;
    }
  }

  await check("login: five wrong passwords, then the sixth try is refused", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.10" });
    for (let i = 0; i < 5; i++) {
      assert.equal(await loginResult("wrong-password"), "Email or password is incorrect.");
    }

    const blocked = await loginResult("wrong-password");
    assert.match(blocked, /^Too many attempts\. Try again in \d+ minutes?\.$/);

    // Even the right password is refused while the bucket is full.
    assert.match(await loginResult("Member123!"), /^Too many attempts/);
  });

  await check("login: a different address is not affected by that lock", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.11" });
    assert.equal(await loginResult("Member123!"), "redirect /dashboard");
    await destroySession();
  });

  await check("login: a successful sign-in clears the ip+email bucket", async () => {
    const ip = "203.0.113.12";
    setTestRequestHeaders({ "x-real-ip": ip });

    for (let i = 0; i < 4; i++) await loginResult("wrong-password");
    const key = limitKey("loginIpEmail", `${ip}|member@pfc.co.za`);
    assert.equal((await testDb.rateLimitBucket.findUniqueOrThrow({ where: { key } })).count, 4);

    assert.equal(await loginResult("Member123!"), "redirect /dashboard");
    assert.equal(await testDb.rateLimitBucket.findUnique({ where: { key } }), null);
    await destroySession();

    // A fresh allowance: five more wrong tries are answered normally.
    for (let i = 0; i < 5; i++) {
      assert.equal(await loginResult("wrong-password"), "Email or password is incorrect.");
    }
    assert.match(await loginResult("wrong-password"), /^Too many attempts/);
  });

  await check("login: the email is normalised, so case does not dodge the limit", async () => {
    const ip = "203.0.113.13";
    setTestRequestHeaders({ "x-real-ip": ip });
    for (let i = 0; i < 5; i++) {
      await login(EMPTY_FORM_STATE, form({ email: i % 2 ? "MEMBER@pfc.co.za" : " member@pfc.co.za ", password: "nope-nope" }));
    }
    const state = await login(EMPTY_FORM_STATE, form({ email: "Member@PFC.co.za", password: "nope-nope" }));
    assert.match(state.message ?? "", /^Too many attempts/);
  });

  await check("login: thirty tries per address across different emails", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.14" });
    for (let i = 0; i < 30; i++) {
      const state = await login(EMPTY_FORM_STATE, form({ email: `user${i}@example.co.za`, password: "nope-nope" }));
      assert.equal(state.message, "Email or password is incorrect.", `try ${i + 1}`);
    }
    const state = await login(EMPTY_FORM_STATE, form({ email: "user31@example.co.za", password: "nope-nope" }));
    assert.match(state.message ?? "", /^Too many attempts/);
  });

  await check("login: the database being down denies the attempt", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.15" });
    const state = await withDatabaseDown(() => login(EMPTY_FORM_STATE, loginForm("Member123!")));
    assert.match(state.message ?? "", /^Too many attempts/);
  });

  await check("forgot password: three per address, and three per email from anywhere", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.20" });
    for (let i = 0; i < 3; i++) {
      const state = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: `n${i}@example.co.za` }));
      assert.equal(state.ok, true);
    }
    const fourth = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "n9@example.co.za" }));
    assert.equal(fourth.ok, false);
    assert.match(fourth.message ?? "", /^Too many attempts/);

    // The same email from three other addresses, then a fourth.
    for (let i = 0; i < 3; i++) {
      setTestRequestHeaders({ "x-real-ip": `203.0.113.${30 + i}` });
      assert.equal((await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "Target@example.co.za" }))).ok, true);
    }
    setTestRequestHeaders({ "x-real-ip": "203.0.113.40" });
    const byEmail = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "target@example.co.za" }));
    assert.equal(byEmail.ok, false);
  });

  await check("reset password: ten per address per hour", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.50" });
    for (let i = 0; i < 10; i++) {
      const state = await submitPasswordReset(EMPTY_FORM_STATE, form({ token: "bad-token", password: "Sup3rSecretPass" }));
      assert.doesNotMatch(state.message ?? "", /Too many/, `try ${i + 1}`);
    }
    const state = await submitPasswordReset(EMPTY_FORM_STATE, form({ token: "bad-token", password: "Sup3rSecretPass" }));
    assert.match(state.message ?? "", /^Too many attempts/);
  });

  await check("contact form: five per address per hour", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.60" });
    const message = () =>
      form({ fullName: "Test Person", email: "test@example.co.za", phone: "", message: "Hello there, I would like to know more about classes." });

    for (let i = 0; i < 5; i++) {
      assert.equal((await sendEnquiry(EMPTY_FORM_STATE, message())).ok, true, `try ${i + 1}`);
    }
    const sixth = await sendEnquiry(EMPTY_FORM_STATE, message());
    assert.equal(sixth.ok, false);
    assert.match(sixth.message ?? "", /^Too many attempts/);
    assert.equal(sixth.values?.fullName, "Test Person", "the visitor keeps what they typed");
  });

  await check("clearLimit forgets a bucket", async () => {
    await checkLimit("contact", "to-clear");
    await clearLimit("contact", "to-clear");
    assert.equal(await testDb.rateLimitBucket.findUnique({ where: { key: limitKey("contact", "to-clear") } }), null);
  });

  // ------------------------------------------------------------ origin

  console.log("\nSAME-ORIGIN CHECK");

  const withHeaders = (headers: Record<string, string>) =>
    new Request(`${APP}/api/x`, { method: "POST", headers });

  await check("a foreign Origin is refused with 403", async () => {
    const blocked = assertSameOrigin(withHeaders({ origin: "https://evil.example" }));
    assert.ok(blocked);
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: { message: "Cross-origin requests are not allowed." } });
  });

  await check("the APP_URL origin is accepted", () => {
    assert.equal(assertSameOrigin(withHeaders({ origin: APP })), null);
  });

  await check("Referer is used when Origin is missing", () => {
    assert.equal(assertSameOrigin(withHeaders({ referer: `${APP}/admin/events` })), null);
    assert.equal(assertSameOrigin(withHeaders({ referer: "https://evil.example/page" }))?.status, 403);
  });

  await check("neither Origin nor Referer is refused", () => {
    assert.equal(assertSameOrigin(withHeaders({}))?.status, 403);
  });

  await check("look-alike, port and scheme-less origins are refused", () => {
    for (const origin of [
      "https://pfc.test.invalid.evil.example",
      "https://evilpfc.test.invalid",
      "https://pfc.test.invalid:8443",
      "null",
      "not a url",
    ]) {
      assert.equal(assertSameOrigin(withHeaders({ origin }))?.status, 403, origin);
    }
  });

  await check("a foreign Origin wins over a matching Referer", () => {
    assert.equal(assertSameOrigin(withHeaders({ origin: "https://evil.example", referer: `${APP}/` }))?.status, 403);
  });

  // ------------------------------------------------------------ json

  console.log("\nJSON BODY READER");

  await check("valid JSON is returned, charset parameter allowed", async () => {
    const read = await readJson(jsonRequest('{"a":1}', { "content-type": "application/json; charset=utf-8" }));
    assert.deepEqual(read, { ok: true, data: { a: 1 } });
  });

  await check("a wrong or missing Content-Type is 415", async () => {
    for (const headers of [{ "content-type": "text/plain" }, { "content-type": "multipart/form-data" }, {}] as Record<string, string>[]) {
      const read = await readJson(new Request(`${APP}/api/x`, { method: "POST", headers, body: "{}" }));
      assert.equal(read.ok, false);
      if (!read.ok) {
        // A string body makes fetch add text/plain; strip nothing, the answer is 415 either way.
        assert.equal(read.response.status, 415);
        assert.ok((await read.response.json()).error.message);
      }
    }
  });

  await check("a body over the limit is 413, by declared length and by counting", async () => {
    const big = JSON.stringify({ text: "x".repeat(200) });

    const declared = await readJson(jsonRequest(big), 100);
    assert.ok(!declared.ok && declared.response.status === 413);

    // No Content-Length: a chunked stream that grows past the limit.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(60));
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = await readJson(
      new Request(`${APP}/api/x`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      100,
    );
    assert.ok(!streamed.ok && streamed.response.status === 413);

    const fits = await readJson(jsonRequest('{"ok":true}'), 100);
    assert.equal(fits.ok, true);
  });

  await check("the default limit is 100,000 bytes", async () => {
    const under = await readJson(jsonRequest(JSON.stringify({ t: "x".repeat(99_000) })));
    assert.equal(under.ok, true);
    const over = await readJson(jsonRequest(JSON.stringify({ t: "x".repeat(100_100) })));
    assert.ok(!over.ok && over.response.status === 413);
  });

  await check("invalid JSON and an unreadable encoding are 400", async () => {
    for (const body of ["{not json", "", "{\"a\":"]) {
      const read = await readJson(jsonRequest(body));
      assert.ok(!read.ok && read.response.status === 400, JSON.stringify(body));
    }

    const bad = new Request(`${APP}/api/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    });
    const read = await readJson(bad);
    assert.ok(!read.ok && read.response.status === 400);
  });

  await check("readJsonObject also turns arrays and scalars into 400", async () => {
    for (const body of ["[1,2]", '"text"', "42", "null"]) {
      const read = await readJsonObject(jsonRequest(body));
      assert.ok(!read.ok && read.response.status === 400, body);
    }
    const ok = await readJsonObject(jsonRequest('{"a":1}'));
    assert.ok(ok.ok && ok.body.a === 1);
  });

  // ------------------------------------------------------------ routes

  console.log("\nSTATE-CHANGING ROUTES");

  const routes: { file: string; method: "POST" | "PATCH" | "DELETE" }[] = [
    { file: "admin/events/route", method: "POST" },
    { file: "admin/events/[id]/route", method: "PATCH" },
    { file: "admin/events/[id]/offers/route", method: "POST" },
    { file: "admin/fighters/route", method: "POST" },
    { file: "admin/fighters/[id]/route", method: "DELETE" },
    { file: "admin/participations/[id]/result/route", method: "PATCH" },
    { file: "admin/uploads/image/route", method: "POST" },
    { file: "bookings/route", method: "POST" },
    { file: "bookings/[id]/cancel/route", method: "POST" },
    { file: "fighter/documents/route", method: "POST" },
    { file: "fighter/documents/[id]/route", method: "DELETE" },
    { file: "fighter/offers/[id]/respond/route", method: "POST" },
  ];

  await check("every state-changing route file is in this list", () => {
    const found = sourceFiles(path.join(ROOT, "src", "app", "api"))
      .filter((f) => /export (async )?function (POST|PATCH|DELETE|PUT)\b/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(path.join(ROOT, "src", "app", "api"), f).replace(/\\/g, "/").replace(/\.ts$/, ""))
      .sort();

    assert.deepEqual(found, routes.map((r) => r.file).sort());
  });

  type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

  async function call(file: string, method: string, headers: Record<string, string>): Promise<Response> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require(`../src/app/api/${file}`) as Record<string, Handler>;
    return module[method](
      new Request(`${APP}/api/${file}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "DELETE" ? undefined : "{}" }),
      { params: Promise.resolve({ id: "1" }) },
    );
  }

  await destroySession();

  for (const { file, method } of routes) {
    await check(`${method} /api/${file} refuses a foreign Origin with 403`, async () => {
      for (const headers of [{ origin: "https://evil.example" }, {}] as Record<string, string>[]) {
        const response = await call(file, method, headers);
        assert.equal(response.status, 403, JSON.stringify(headers));
        assert.deepEqual(await response.json(), { error: { message: "Cross-origin requests are not allowed." } });
      }
    });

    await check(`${method} /api/${file} passes the check for APP_URL (then wants a session)`, async () => {
      const response = await call(file, method, { origin: APP });
      assert.equal(response.status, 401);
    });
  }

  await check("POST /api/bookings answers 429 with Retry-After once the user's 30 are used", async () => {
    await createSession(member);
    for (let i = 0; i < 30; i++) assert.equal((await checkLimit("booking", String(member.id))).allowed, true);

    const response = await call("bookings/route", "POST", { origin: APP });
    assert.equal(response.status, 429);
    const retry = Number(response.headers.get("retry-after"));
    assert.ok(retry >= 1 && retry <= 600, `Retry-After ${retry}`);
    assert.ok((await response.json()).error.message);
    await destroySession();
  });

  await check("the upload routes answer 429 once the user's 20 are used", async () => {
    await createSession(admin);
    for (let i = 0; i < 20; i++) await checkLimit("upload", String(admin.id));

    const response = await call("admin/uploads/image/route", "POST", { origin: APP });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    await destroySession();
  });

  await check("POST /api/bookings reads its body with readJson (wrong type is 415)", async () => {
    await createSession(await sessionFor("fighter@pfc.co.za"));
    const module = bookingsRoute as unknown as Record<string, Handler>;
    const response = await module.POST(
      new Request(`${APP}/api/bookings`, { method: "POST", headers: { origin: APP, "content-type": "text/plain" }, body: "{}" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    assert.equal(response.status, 415);
    await destroySession();
  });

  // ------------------------------------------------------------ health

  console.log("\nHEALTH");

  await check("/api/health is shallow and /api/health/ready checks the database", async () => {
    const live = liveRoute;
    const ready = readyRoute;
    assert.equal(live.dynamic, "force-dynamic");
    assert.equal(ready.dynamic, "force-dynamic");

    // With the database down the shallow check still answers.
    const liveDown = await withDatabaseDown(async () => live.GET());
    assert.equal(liveDown.status, 200);
    assert.deepEqual(await liveDown.json(), { status: "ok" });

    const up = await ready.GET();
    assert.equal(up.status, 200);
    assert.deepEqual(await up.json(), { status: "ok" });

    const down = await withDatabaseDown(() => ready.GET());
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { status: "unavailable" });
  });

  // ------------------------------------------------------------ middleware

  console.log("\nMIDDLEWARE");

  async function cookieFor(user: SessionUser): Promise<string> {
    await createSession(user);
        const value = (await cookies()).get(COOKIE_NAME)?.value ?? "";
    await destroySession();
    return value;
  }

  function visit(pathname: string, cookie?: string): ReturnType<typeof middleware> {
    return middleware(
      new NextRequest(`${APP}${pathname}`, { headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {} }),
    );
  }

  const location = (response: Response) => {
    const header = response.headers.get("location");
    return header ? header.replace(APP, "") : null;
  };

  const memberCookie = await cookieFor(member);
  const adminCookie = await cookieFor(admin);
  const coachSession: SessionUser = coach ?? { id: 99, email: "c@pfc.co.za", fullName: "Coach", role: "Coach" };
  const coachCookie = encodeSession(coachSession, 0);

  await check("no cookie on a gated path redirects to login with the way back", () => {
    for (const p of ["/dashboard", "/bookings", "/admin", "/admin/events/3", "/coach/classes/2"]) {
      const response = visit(p);
      assert.equal(response.status, 307, p);
      assert.equal(location(response), `/login?returnUrl=${encodeURIComponent(p)}`, p);
    }
    assert.equal(location(visit("/admin/events?page=2")), `/login?returnUrl=${encodeURIComponent("/admin/events?page=2")}`);
  });

  await check("a forged, tampered or empty cookie is treated as no cookie", () => {
    const [payload] = memberCookie.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ id: 1, email: "x@y.z", fullName: "X", role: "Admin", sv: 0 })).toString("base64url");
    for (const bad of ["garbage", `${payload}.AAAA`, `${forgedPayload}.${memberCookie.split(".")[1]}`, ""]) {
      assert.equal(location(visit("/dashboard", bad)), `/login?returnUrl=${encodeURIComponent("/dashboard")}`, bad);
    }
  });

  await check("a signed-in member reaches /dashboard and /bookings, not /admin or /coach", () => {
    assert.equal(location(visit("/dashboard", memberCookie)), null);
    assert.equal(location(visit("/bookings", memberCookie)), null);
    assert.equal(location(visit("/admin", memberCookie)), "/denied");
    assert.equal(location(visit("/admin/members", memberCookie)), "/denied");
    assert.equal(location(visit("/coach/classes/1", memberCookie)), "/denied");
  });

  await check("admin reaches /admin and /coach; coach reaches /coach but not /admin", () => {
    assert.equal(location(visit("/admin/audit", adminCookie)), null);
    assert.equal(location(visit("/coach/classes/1", adminCookie)), null);
    assert.equal(location(visit("/coach/classes/1", coachCookie)), null);
    assert.equal(location(visit("/admin", coachCookie)), "/denied");
  });

  await check("a prefix match is not a path match (/administer is public)", () => {
    assert.equal(location(visit("/administer")), null);
    assert.equal(location(visit("/dashboards")), null);
  });

  await check("public pages pass through with no redirect", () => {
    for (const p of ["/", "/classes", "/login", "/contact", "/timetable"]) {
      assert.equal(location(visit(p)), null, p);
    }
  });

  await check("every response carries a policy with a fresh nonce, and x-nonce goes to the app", () => {
    const a = visit("/classes");
    const b = visit("/classes");
    const policyA = a.headers.get(cspHeaderName()) ?? "";
    const policyB = b.headers.get(cspHeaderName()) ?? "";

    const nonceA = /'nonce-([^']+)'/.exec(policyA)?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(policyB)?.[1];
    assert.ok(nonceA && nonceB && nonceA !== nonceB, "a new nonce per request");
    assert.equal(a.headers.get("x-middleware-request-x-nonce"), nonceA);
    assert.equal(a.headers.get(`x-middleware-request-${cspHeaderName().toLowerCase()}`), policyA);

    // A redirect carries the policy too.
    assert.ok(visit("/admin").headers.get(cspHeaderName()));
  });

  await check("the middleware config runs on Node.js and skips assets and the API", async () => {
        assert.equal(config.runtime, "nodejs");
    const source = (config.matcher[0] as { source: string }).source;
    const matches = (p: string) => new RegExp(`^${source}$`).test(p);

    assert.equal(matches("/classes"), true);
    assert.equal(matches("/admin/events/1"), true);
    assert.equal(matches("/api/bookings"), false);
    assert.equal(matches("/_next/static/chunks/a.js"), false);
    assert.equal(matches("/_next/image"), false);
  });

  // ------------------------------------------------------------ csp

  console.log("\nCONTENT-SECURITY-POLICY AND HEADERS");

  await check("production policy has no unsafe-eval, always frame-ancestors 'none'", () => {
    const production = buildCsp("abc", { nodeEnv: "production" });
    assert.ok(!production.includes("unsafe-eval"));
    assert.ok(production.includes("frame-ancestors 'none'"));
    assert.ok(production.includes("upgrade-insecure-requests"));

    for (const nodeEnv of ["development", "test", undefined, "production"]) {
      assert.ok(buildCsp("abc", { nodeEnv }).includes("frame-ancestors 'none'"), String(nodeEnv));
    }

    const development = buildCsp("abc", { nodeEnv: "development" });
    assert.ok(development.includes("'unsafe-eval'"));
    assert.ok(!development.includes("upgrade-insecure-requests"));
  });

  await check("the policy has every directive that was asked for", () => {
    const directives = buildCsp("NONCE123", { nodeEnv: "production" }).split("; ");
    assert.deepEqual(directives, [
      "default-src 'self'",
      "script-src 'self' 'nonce-NONCE123' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]);
  });

  await check("the script policy never allows inline scripts without the nonce", () => {
    const script = buildCsp("n", { nodeEnv: "production" }).split("; ").find((d) => d.startsWith("script-src")) ?? "";
    assert.ok(!script.includes("'unsafe-inline'"));
    assert.ok(!script.includes("*"));
    assert.ok(!script.includes("http"));
  });

  await check("nonces are base64 and unique", () => {
    const seen = new Set(Array.from({ length: 50 }, newNonce));
    assert.equal(seen.size, 50);
    for (const nonce of seen) assert.match(nonce, /^[A-Za-z0-9+/]+=*$/);
  });

  await check("CSP_REPORT_ONLY=1 switches the header name, nothing else does", () => {
    assert.equal(cspHeaderName(undefined), "Content-Security-Policy");
    assert.equal(cspHeaderName("0"), "Content-Security-Policy");
    assert.equal(cspHeaderName("1"), "Content-Security-Policy-Report-Only");
  });

  await check("next.config headers() carries every static security header", async () => {
    const config = (await import(pathToFileURL(path.join(ROOT, "next.config.mjs")).href)) as {
      default: { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    };
    const rules = await config.default.headers();
    const everywhere = rules.find((r) => r.source === "/:path*");
    assert.ok(everywhere, "a rule for every path");

    const byKey = Object.fromEntries(everywhere.headers.map((h) => [h.key, h.value]));
    assert.deepEqual(byKey, {
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    });

    const reset = rules.find((r) => r.source.startsWith("/reset-password"));
    assert.ok(reset, "the reset-link rule is still there");
    assert.ok(reset.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"));
  });

  // ------------------------------------------------------------ source

  console.log("\nSOURCE RULES");

  await check("no console statement anywhere in src/ (the logger is the only writer)", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).filter((f) => /\bconsole\./.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  await check("every API route file and the layout export force-dynamic", () => {
    const files = [
      ...sourceFiles(path.join(ROOT, "src", "app", "api")).filter((f) => f.endsWith("route.ts")),
      path.join(ROOT, "src", "app", "layout.tsx"),
    ];
    const missing = files.filter((f) => !/export const dynamic = "force-dynamic"/.test(readFileSync(f, "utf8")));
    assert.deepEqual(missing.map((f) => path.relative(ROOT, f)), []);
  });

  console.log(`\n${passed} checks passed\n`);
}

main()
  .then(() => testDb.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
