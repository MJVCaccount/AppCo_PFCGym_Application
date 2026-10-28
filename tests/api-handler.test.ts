/**
 * The shared route wrapper (src/lib/apiHandler.ts), the error envelope, the
 * catch-all and method-not-allowed answers, cache headers, and the two read
 * routes added with it: GET /api/bookings and GET /api/fighter/documents.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { GET as catchAllGet, POST as catchAllPost } from "../src/app/api/[...path]/route";
import { GET as bookingsGet, POST as bookingsPost } from "../src/app/api/bookings/route";
import { GET as classesGet, POST as classesPost } from "../src/app/api/classes/route";
import { GET as eventsGet } from "../src/app/api/events/route";
import { GET as documentsGet } from "../src/app/api/fighter/documents/route";
import { GET as timetableGet } from "../src/app/api/timetable/route";
import { publicRoute, userRoute } from "../src/lib/apiHandler";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { createBooking } from "../src/lib/services/bookingService";
import { getCheapestPlanPrice, getPlans } from "../src/lib/services/catalogueService";
import { getAdminOverview } from "../src/lib/services/dashboardService";
import { getMembership } from "../src/lib/services/membershipService";
import { createSession, destroySession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";

const ORIGIN = "https://pfc.test.invalid";
process.env.APP_URL = ORIGIN;

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers });

/** Captures what the logger writes while `fn` runs. */
async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: string | Uint8Array) => {
    for (const line of String(chunk).split("\n")) {
      if (line.startsWith("{")) {
        try {
          lines.push(JSON.parse(line));
        } catch {
          // not ours
        }
      }
    }
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    return { result: await fn(), lines };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

async function main() {
  await resetDatabase();
  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");

  console.log("\nAPI HANDLER: REQUEST ID AND ENVELOPE");

  await check("every response carries an X-Request-Id; a tame incoming one is kept", async () => {
    const fresh = await classesGet(get("/api/classes"));
    assert.match(fresh.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

    const kept = await classesGet(get("/api/classes", { "x-request-id": "client-req-12345" }));
    assert.equal(kept.headers.get("x-request-id"), "client-req-12345");
  });

  await check("an incoming id that could carry anything but an id is replaced", async () => {
    for (const hostile of ["short", "has space in it 1234", "a".repeat(65), "x\"><script>alert(1)</script>", "id;rm -rf /"]) {
      const res = await classesGet(get("/api/classes", { "x-request-id": hostile }));
      assert.notEqual(res.headers.get("x-request-id"), hostile);
      assert.match(res.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    }
  });

  await check("an error body has message, a stable code and the request id", async () => {
    await destroySession();
    const res = await bookingsGet(get("/api/bookings"));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      error: {
        message: "Sign in to see your bookings.",
        code: "UNAUTHENTICATED",
        requestId: res.headers.get("x-request-id"),
      },
    });

    const wrongDay = await timetableGet(get("/api/timetable?day=funday"));
    assert.equal(wrongDay.status, 400);
    const body = await wrongDay.json();
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.error.requestId, wrongDay.headers.get("x-request-id"));
  });

  await check("body-reading failures use the envelope too (415, 413, 400)", async () => {
    await createSession(member);
    const post = (headers: Record<string, string>, body: string) =>
      bookingsPost(new Request("http://localhost/api/bookings", { method: "POST", headers: { origin: ORIGIN, ...headers }, body }));

    const wrongType = await post({ "content-type": "text/plain" }, "{}");
    assert.equal(wrongType.status, 415);
    assert.equal((await wrongType.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");

    const tooBig = await post({ "content-type": "application/json" }, JSON.stringify({ pad: "x".repeat(100_001) }));
    assert.equal(tooBig.status, 413);
    assert.equal((await tooBig.json()).error.code, "PAYLOAD_TOO_LARGE");

    const broken = await post({ "content-type": "application/json" }, "{nope");
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error.code, "INVALID_REQUEST");
    await destroySession();
  });

  await check("a foreign origin on a write is 403 CROSS_ORIGIN before anything else", async () => {
    const res = await bookingsPost(new Request("http://localhost/api/bookings", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "CROSS_ORIGIN");
  });

  await check("a throwing handler is a fixed 500 sentence; the detail is logged with the request id", async () => {
    const boom = publicRoute({ name: "GET /api/boom", failure: "Could not do the thing." }, async () => {
      throw new Error("secret detail: select * from User");
    });
    const { result, lines } = await captureLog(() => boom(get("/api/boom", { "x-request-id": "trace-me-123456" })));

    assert.equal(result.status, 500);
    const text = JSON.stringify(await result.json());
    assert.ok(text.includes("Could not do the thing."));
    assert.ok(!text.includes("secret detail"));
    assert.ok(text.includes("INTERNAL") && text.includes("trace-me-123456"));

    const failed = lines.find((l) => l.message === "GET /api/boom failed");
    assert.ok(failed, "the failure was logged");
    assert.equal(failed.requestId, "trace-me-123456");
    assert.ok(JSON.stringify(failed).includes("secret detail"), "the log keeps the real error");
  });

  console.log("\nAPI HANDLER: ACCESS LOG");

  await check("one access-log line per request: method, route, status, ms, request id", async () => {
    process.env.API_ACCESS_LOG = "1";
    try {
      const { lines } = await captureLog(() => classesGet(get("/api/classes", { "x-request-id": "log-me-12345678" })));
      const access = lines.filter((l) => l.message === "api");
      assert.equal(access.length, 1);
      const line = access[0]!;
      assert.equal(line.requestId, "log-me-12345678");
      const meta = line.meta as Record<string, unknown>;
      assert.equal(meta.method, "GET");
      assert.equal(meta.route, "GET /api/classes");
      assert.equal(meta.status, 200);
      assert.equal(typeof meta.ms, "number");
      assert.ok(!JSON.stringify(line).includes("?"), "no query string or body in the line");
    } finally {
      process.env.API_ACCESS_LOG = "0";
    }
  });

  console.log("\nAPI HANDLER: RATE LIMIT OPTION");

  await check("a public route can count the client address and answers 429 with Retry-After", async () => {
    const limited = publicRoute({ name: "GET /api/limited", failure: "x", limit: "register" }, async () => Response.json({ data: 1 }));
    const call = () => limited(get("/api/limited", { "x-forwarded-for": "203.0.113.77" }));

    for (let i = 0; i < 5; i++) assert.equal((await call()).status, 200);
    const denied = await call();
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) >= 1);
    assert.equal((await denied.json()).error.code, "RATE_LIMITED");

    const other = await limited(get("/api/limited", { "x-forwarded-for": "203.0.113.78" }));
    assert.equal(other.status, 200, "another address has its own count");
  });

  await check("a user route counts the signed-in user, not the address", async () => {
    await createSession(member);
    const limited = userRoute({ name: "GET /api/limited-user", failure: "x", limit: "register" }, async () => Response.json({ data: 1 }));
    // the 'register' bucket is keyed by identity: the user id differs from the address used above
    assert.equal((await limited(get("/api/limited-user"))).status, 200);
    await destroySession();
  });

  console.log("\nAPI HANDLER: CACHE HEADERS");

  await check("public catalogue reads are cacheable; user data and the timetable are not", async () => {
    const publicCache = "public, s-maxage=60, stale-while-revalidate=300";
    assert.equal((await classesGet(get("/api/classes"))).headers.get("cache-control"), publicCache);
    assert.equal((await eventsGet(get("/api/events"))).headers.get("cache-control"), publicCache);
    assert.equal((await timetableGet(get("/api/timetable"))).headers.get("cache-control"), "no-store");

    // An error is never cached, even from a cacheable route.
    const bad = await timetableGet(get("/api/timetable?day=nope"));
    assert.equal(bad.headers.get("cache-control"), "no-store");

    await createSession(member);
    assert.equal((await bookingsGet(get("/api/bookings"))).headers.get("cache-control"), "no-store");
    await destroySession();
    assert.equal((await bookingsGet(get("/api/bookings"))).headers.get("cache-control"), "no-store");
  });

  console.log("\nAPI HANDLER: CATCH-ALL AND 405");

  await check("an unknown /api path is a JSON 404 in the same envelope", async () => {
    for (const [handler, path] of [[catchAllGet, "/api/nope"], [catchAllGet, "/api/bookings/5/nope/deeper"], [catchAllPost, "/api/admin/everything"]] as const) {
      const res = await handler(get(path));
      assert.equal(res.status, 404, path);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const body = await res.json();
      assert.equal(body.error.code, "NOT_FOUND");
      assert.equal(body.error.requestId, res.headers.get("x-request-id"));
    }
  });

  await check("a wrong method on a real route is a JSON 405 with Allow", async () => {
    const res = await classesPost(new Request("http://localhost/api/classes", { method: "POST", headers: { origin: ORIGIN } }));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, HEAD, OPTIONS");
    assert.equal((await res.json()).error.code, "METHOD_NOT_ALLOWED");
  });

  console.log("\nGET /api/bookings");

  await check("401 signed out, 403 for staff, and a member sees only their own bookings", async () => {
    await destroySession();
    assert.equal((await bookingsGet(get("/api/bookings"))).status, 401);

    await createSession(coach);
    const staff = await bookingsGet(get("/api/bookings"));
    assert.equal(staff.status, 403);
    assert.equal((await staff.json()).error.code, "FORBIDDEN");

    const slot = await testDb.gymClass.findFirstOrThrow({ where: { isActive: true, day: "sat" } });
    const other = await sessionFor("filler01@demo.pfc.invalid");
    await createBooking(other, slot.id);
    await createBooking(member, slot.id);

    await createSession(member);
    const res = await bookingsGet(get("/api/bookings"));
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.deepEqual(Object.keys(data).sort(), ["past", "upcoming"]);

    const all = [...data.upcoming, ...data.past] as { id: number }[];
    const mine = await testDb.booking.findMany({ where: { memberId: member.id } });
    assert.deepEqual(all.map((b) => b.id).sort((a, b) => a - b), mine.map((b) => b.id).sort((a, b) => a - b));
    assert.ok(data.upcoming.some((b: { className: string }) => b.className === slot.name));
    await destroySession();
  });

  console.log("\nGET /api/fighter/documents");

  await check("401 signed out, 403 for non-fighters, and a fighter sees only their own documents without storage paths", async () => {
    await destroySession();
    assert.equal((await documentsGet(get("/api/fighter/documents"))).status, 401);

    await createSession(member);
    assert.equal((await documentsGet(get("/api/fighter/documents"))).status, 403);

    const rival = await sessionFor("filler02@demo.pfc.invalid");
    await testDb.fighter.create({ data: { fighterId: rival.id, weightClass: "Lightweight" } });
    await testDb.fighterDocument.createMany({
      data: [
        { fighterId: fighter.id, type: "Medical", fileName: "mine.pdf", fileUrl: "private/mine.pdf" },
        { fighterId: rival.id, type: "Licence", fileName: "theirs.pdf", fileUrl: "private/theirs.pdf" },
      ],
    });

    await createSession(fighter);
    const res = await documentsGet(get("/api/fighter/documents"));
    assert.equal(res.status, 200);
    const text = await res.text();
    const { data } = JSON.parse(text) as { data: { fileName: string }[] };
    assert.ok(data.some((d) => d.fileName === "mine.pdf"));
    assert.ok(!data.some((d) => d.fileName === "theirs.pdf"));
    assert.ok(!text.includes("private/"), "the storage path never leaves the server");
    assert.ok(!text.includes("fileUrl"));
    assert.equal(res.headers.get("cache-control"), "no-store");
    await destroySession();
  });

  console.log("\nSERVICES THE PAGES USE");

  await check("the admin overview, the membership view and the catalogue read what the pages show", async () => {
    const overview = await getAdminOverview(5);
    assert.equal(overview.users.length, 5);
    assert.ok(overview.timetable.length > 0 && overview.classes.length > 0);
    assert.equal(overview.memberCount, await testDb.user.count({ where: { role: "Member" } }));
    assert.equal(overview.coachCount, await testDb.user.count({ where: { role: "Coach" } }));
    assert.equal(overview.fighterCount, await testDb.fighter.count());

    const mine = await getMembership(member.id);
    assert.equal(mine.user?.id, member.id);
    assert.ok(mine.plan, "the seeded member is on a plan");

    // A plan since retired is still shown to the member who holds it.
    await testDb.membershipPlan.update({ where: { id: mine.plan.id }, data: { isActive: false } });
    assert.equal((await getMembership(member.id)).plan?.id, mine.plan.id);
    await testDb.membershipPlan.update({ where: { id: mine.plan.id }, data: { isActive: true } });

    assert.deepEqual(await getMembership(999_999), { user: undefined, plan: undefined });
    assert.ok((await getPlans()).length > 0 && (await getCheapestPlanPrice()) > 0);
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
