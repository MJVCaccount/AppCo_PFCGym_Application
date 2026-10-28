/**
 * The email outbox, the token-protected health detail and
 * maintenance routes, and the slow-query warning. Email goes to the Resend
 * stub in tests/support, never to a network.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { resetDatabase, testDb } from "./helpers/db";

import { GET as cronGet } from "../src/app/api/cron/maintenance/route";
import { GET as outboxCronGet } from "../src/app/api/cron/outbox/route";
import { GET as healthDetailGet } from "../src/app/api/health/detail/route";
import expectedMigrations from "../src/lib/migrations.generated.json";
import { flushEmails } from "../src/lib/email/queue";
import { prisma } from "../src/lib/prisma";
import { runWithRequest } from "../src/lib/requestContext";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { eraseAccount } from "../src/lib/services/erasureService";
import {
  backoffUntil,
  dailyCap,
  drainOutbox,
  MAX_ATTEMPTS,
  nextAllowance,
  purgeOutbox,
  recordDirectSend,
  startOfUtcDay,
} from "../src/lib/services/outboxService";
import {
  notifyBookingConfirmed,
} from "../src/lib/services/notificationService";
import { requestReset } from "../src/lib/services/passwordService";
import type { SessionUser } from "../src/lib/types";

interface ResendStub {
  outbox: { to: string | string[]; subject: string; html?: string; text?: string }[];
  failNext: boolean;
  failStatus: number | null;
  throwNext: boolean;
  calls: number;
}
const resend = (globalThis as unknown as { __resend: ResendStub }).__resend;

const ORIGIN = "https://pfc.test.invalid";
process.env.APP_URL = ORIGIN;
const ROOT = path.resolve(__dirname, "..");
const HEALTH_TOKEN = "health-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const CRON_SECRET = "cron-secret-0123456789-abcdefghijklmnopqrstuvwxyz-x";

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

const configureEmail = (on: boolean) => {
  process.env.RESEND_API_KEY = on ? "re_test_key" : "";
  process.env.EMAIL_FROM = on ? "PFC <no-reply@test.pfc.invalid>" : "";
  process.env.CONTACT_INBOX = on ? "inbox@test.pfc.example" : "";
};

const booking = {
  className: "Elite Boxing",
  coachName: "Marcus Thompson",
  day: "mon" as const,
  startsAt: "18:00",
  sessionDate: "2027-01-04",
};

const rows = () => testDb.emailOutbox.findMany({ orderBy: { id: "asc" } });
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/test", { headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function clearOutbox() {
  await testDb.emailOutbox.deleteMany();
  resend.outbox.length = 0;
  resend.failNext = false;
  resend.failStatus = 500;
  resend.throwNext = false;
  resend.calls = 0;
}

async function main() {
  await resetDatabase();
  process.env.API_ACCESS_LOG = "0";
  const member = await sessionFor("member@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");

  console.log("\nOUTBOX: SEND");

  await check("an email is stored, sent straight away, and its body is dropped once sent", async () => {
    configureEmail(true);
    await clearOutbox();
    notifyBookingConfirmed(member, booking);
    await flushEmails();

    const [row] = await rows();
    assert.equal(row!.kind, "booking.confirmed");
    assert.equal(row!.status, "Sent");
    assert.equal(row!.attempts, 1);
    assert.ok(row!.sentAt);
    assert.equal(row!.html, "", "a sent mail keeps no copy of its body");
    assert.equal(resend.outbox.length, 1);
    assert.equal(resend.outbox[0]!.to, member.email);
  });

  await check("password-reset and invite mail never go through the outbox; they are only counted", async () => {
    await clearOutbox();
    const issued = await requestReset("sofia@pfc.co.za");
    assert.equal(issued.ok, true);
    await flushEmails();

    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(resend.outbox[0]!.text ?? "")![1]!;
    const stored = JSON.stringify(await rows());
    assert.ok(!stored.includes(token), "the raw token is nowhere in the outbox table");

    const [row] = await rows();
    assert.equal(row!.kind, "password.reset");
    assert.equal(row!.status, "Sent");
    assert.equal(row!.toAddress, "");
    assert.equal(row!.subject, "");
    assert.equal(row!.html, "");
  });

  console.log("\nOUTBOX: RETRY AND DEAD LETTER");

  await check("a failed send is kept and retried after 5, 30, 120 and 360 minutes, then parked as Dead", async () => {
    await clearOutbox();
    resend.failNext = true;
    notifyBookingConfirmed(member, booking);
    await flushEmails();

    let [row] = await rows();
    assert.equal(row!.status, "Pending");
    assert.equal(row!.attempts, 1);
    assert.ok(row!.lastError, "the reason is kept");
    assert.ok(!row!.lastError!.includes("@"), "the reason holds no address");
    assert.ok(row!.html.length > 0, "the body is kept for the retry");
    const waits = [5, 30, 120, 360];
    assert.ok(Math.abs(row!.nextAttemptAt.getTime() - (Date.now() + 5 * 60_000)) < 60_000);

    let clock = Date.now();
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      clock = row!.nextAttemptAt.getTime() + 1000;
      resend.failNext = true;
      const report = await drainOutbox({ now: new Date(clock) });
      assert.equal(report.claimed, 1, `attempt ${attempt}`);

      [row] = await rows();
      assert.equal(row!.attempts, attempt);
      if (attempt < MAX_ATTEMPTS) {
        assert.equal(row!.status, "Pending");
        const wait = waits[attempt - 1]!;
        assert.ok(Math.abs(row!.nextAttemptAt.getTime() - (clock + wait * 60_000)) < 1000, `wait ${wait} min`);
      }
    }
    assert.equal(row!.status, "Dead");

    const again = await drainOutbox({ now: new Date(clock + 7 * 86_400_000) });
    assert.equal(again.claimed, 0, "a dead letter is not retried");
    assert.equal(resend.outbox.length, 0);
  });

  await check("a retry that works sends the mail and sets the enquiry's emailSentAt", async () => {
    await clearOutbox();
    await testDb.contactEnquiry.deleteMany();
    const enquiry = await testDb.contactEnquiry.create({
      data: { fullName: "Retry Visitor", email: "retry@example.co.za", message: "Please tell me about fight night." },
    });

    // Written as notifyEnquiry writes it, so that exactly this mail is the one that fails.
    await testDb.emailOutbox.create({
      data: { kind: "enquiry.gym", enquiryId: enquiry.id, toAddress: "inbox@test.pfc.example", replyTo: "retry@example.co.za", subject: "New enquiry", html: "<p>x</p>", text: "x", nextAttemptAt: new Date(Date.now() - 1000) },
    });
    resend.failNext = true;
    await drainOutbox();

    assert.equal((await testDb.contactEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).emailSentAt, null, "the gym copy failed");
    const gym = (await rows()).find((r) => r.kind === "enquiry.gym")!;
    assert.equal(gym.status, "Pending");

    await drainOutbox({ now: new Date(gym.nextAttemptAt.getTime() + 1000) });
    assert.ok((await testDb.contactEnquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).emailSentAt, "set by the retry");
    assert.equal((await rows()).find((r) => r.kind === "enquiry.gym")!.status, "Sent");
  });

  console.log("\nOUTBOX: FAILURE CLASSES");

  const queueOne = async (to = "someone@example.co.za") => {
    await clearOutbox();
    const row = await testDb.emailOutbox.create({
      data: { kind: "booking.confirmed", toAddress: to, subject: "s", html: "<p>x</p>", text: "x", nextAttemptAt: new Date(Date.now() - 1000) },
    });
    return row;
  };

  await check("an HTTP 4xx from the provider (other than 408 and 429) is permanent: Dead at once, with the reason, no retries", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const row = await queueOne();
      resend.failNext = true;
      resend.failStatus = status;
      const report = await drainOutbox();

      const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(report.dead, 1, String(status));
      assert.equal(after.status, "Dead", String(status));
      assert.equal(after.attempts, 1, "no second attempt");
      assert.match(after.lastError ?? "", new RegExp("^" + status + " "), "the reason starts with the status");
      assert.ok(after.nextAttemptAt.getTime() > Date.now() - 60_000 && after.nextAttemptAt.getTime() < Date.now() + 60_000, "the time it was parked");
      assert.equal((await drainOutbox({ now: new Date(Date.now() + 7 * 86_400_000) })).claimed, 0, "never retried");
    }
  });

  await check("408, 429, 5xx, a missing status and a network error keep the backoff", async () => {
    for (const status of [408, 429, 500, 502, 503, 504, null]) {
      const row = await queueOne();
      resend.failNext = true;
      resend.failStatus = status;
      const before = Date.now();
      const report = await drainOutbox();

      const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(report.retry, 1, String(status));
      assert.equal(after.status, "Pending", String(status));
      assert.equal(after.attempts, 1);
      assert.ok(Math.abs(after.nextAttemptAt.getTime() - (before + 5 * 60_000)) < 30_000, "5 minutes");
    }

    const row = await queueOne();
    resend.throwNext = true;
    assert.equal((await drainOutbox()).retry, 1);
    const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "Pending");
    assert.match(after.lastError ?? "", /network failure/);
  });

  await check("the reason kept for a refusal reads properly and holds no address", async () => {
    const row = await queueOne("private.person@example.co.za");
    resend.failNext = true;
    resend.failStatus = 422;
    await drainOutbox();
    const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.lastError, "422 stub_error: stub failure");
    assert.ok(!after.lastError!.includes("private.person"));
  });

  await check("an address ending .invalid is Skipped without calling the provider, even when email is configured", async () => {
    const row = await queueOne("filler@demo.pfc.invalid");
    const report = await drainOutbox();

    const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(report.skipped, 1);
    assert.equal(after.status, "Skipped");
    assert.match(after.lastError ?? "", /\.invalid/);
    assert.equal(after.html, "", "the body is dropped");
    assert.equal(resend.calls, 0, "the provider was never called");
    assert.equal((await drainOutbox({ now: new Date(Date.now() + 86_400_000) })).claimed, 0);

    // Upper case and surrounding space are still .invalid; a lookalike is not.
    const mixed = await queueOne("Someone@Demo.PFC.INVALID");
    await drainOutbox();
    assert.equal((await testDb.emailOutbox.findUniqueOrThrow({ where: { id: mixed.id } })).status, "Skipped");
    const lookalike = await queueOne("someone@invalid.example");
    await drainOutbox();
    assert.equal((await testDb.emailOutbox.findUniqueOrThrow({ where: { id: lookalike.id } })).status, "Sent");
    assert.equal(resend.calls, 1);
  });

  await check("a permanent refusal does not stop the other mail in the same drain", async () => {
    await clearOutbox();
    const due = new Date(Date.now() - 1000);
    for (const to of ["one@example.co.za", "two@example.co.za", "three@example.co.za"]) {
      await testDb.emailOutbox.create({ data: { kind: "k", toAddress: to, subject: to, html: "x", text: "x", nextAttemptAt: due } });
    }
    resend.failNext = true;
    resend.failStatus = 422;
    const report = await drainOutbox();
    assert.equal(report.dead, 1);
    assert.equal(report.sent, 2);
    assert.equal(resend.outbox.length, 2);
  });

  await check("backoff and the cap day are what the policy says", () => {
    const t = new Date("2027-03-10T15:30:00Z");
    assert.equal(backoffUntil(1, t)!.getTime() - t.getTime(), 5 * 60_000);
    assert.equal(backoffUntil(4, t)!.getTime() - t.getTime(), 360 * 60_000);
    assert.equal(backoffUntil(5, t), null);
    assert.equal(startOfUtcDay(t).toISOString(), "2027-03-10T00:00:00.000Z");
    assert.equal(nextAllowance(t).toISOString(), "2027-03-11T00:01:00.000Z");
    assert.equal(dailyCap(undefined), 90);
    assert.equal(dailyCap("5"), 5);
    assert.equal(dailyCap("500"), 90);
    assert.equal(dailyCap("abc"), 90);
  });

  console.log("\nOUTBOX: DAILY CAP");

  await check("sending stops at the cap, direct mail counts toward it, and the rest goes out the next day", async () => {
    await clearOutbox();
    process.env.EMAIL_DAILY_CAP = "4";
    try {
      await recordDirectSend("password.reset"); // 1 of 4 used by a mail that bypasses the outbox
      for (let i = 0; i < 5; i++) notifyBookingConfirmed(member, booking);
      await flushEmails();

      assert.equal(resend.outbox.length, 3, "3 sent: the cap of 4 minus the direct mail");
      const all = await rows();
      const waiting = all.filter((r) => r.status === "Pending");
      assert.equal(waiting.length, 2);
      for (const r of waiting) {
        assert.equal(r.attempts, 0, "held back, not failed");
        assert.equal(r.nextAttemptAt.toISOString(), nextAllowance(new Date()).toISOString());
      }

      const sameDay = await drainOutbox({ now: new Date(Date.now() + 3600_000) });
      assert.equal(sameDay.claimed, 0, "nothing is due until tomorrow");

      const tomorrow = await drainOutbox({ now: new Date(nextAllowance(new Date()).getTime() + 1000) });
      assert.equal(tomorrow.sent, 2);
      assert.equal(resend.outbox.length, 5);
    } finally {
      delete process.env.EMAIL_DAILY_CAP;
    }
  });

  console.log("\nOUTBOX: SAFETY");

  await check("two workers draining at once never send the same mail twice", async () => {
    await clearOutbox();
    const due = new Date(Date.now() - 1000);
    for (let i = 0; i < 12; i++) {
      await testDb.emailOutbox.create({
        data: { kind: "booking.confirmed", toAddress: `p${i}@example.co.za`, subject: `s${i}`, html: "<p>x</p>", text: "x", nextAttemptAt: due },
      });
    }
    const [a, b, c] = await Promise.all([drainOutbox({ limit: 12 }), drainOutbox({ limit: 12 }), drainOutbox({ limit: 12 })]);
    assert.equal(a.sent + b.sent + c.sent, 12);
    assert.equal(resend.outbox.length, 12);
    assert.equal(new Set(resend.outbox.map((m) => m.subject)).size, 12);
    assert.equal(await testDb.emailOutbox.count({ where: { status: "Sent" } }), 12);
  });

  await check("with email not configured, mail is marked Skipped, not retried forever", async () => {
    await clearOutbox();
    configureEmail(false);
    notifyBookingConfirmed(member, booking);
    await flushEmails();
    const [row] = await rows();
    assert.equal(row!.status, "Skipped");
    assert.equal(row!.html, "");
    assert.equal((await drainOutbox({ now: new Date(Date.now() + 86_400_000) })).claimed, 0);
    configureEmail(true);
  });

  await check("finished rows are purged: sent after 30 days, skipped after 7, dead after 90", async () => {
    await clearOutbox();
    const old = (days: number) => new Date(Date.now() - days * 86_400_000);
    const make = (status: "Sent" | "Skipped" | "Dead" | "Pending", days: number) =>
      testDb.emailOutbox.create({
        data: { kind: "k", toAddress: "a@example.co.za", subject: "s", status, createdAt: old(days), sentAt: status === "Sent" ? old(days) : null },
      });
    await make("Sent", 31); await make("Sent", 29);
    await make("Skipped", 8); await make("Skipped", 6);
    await make("Dead", 91); await make("Dead", 89);
    await make("Pending", 200);

    assert.equal(await purgeOutbox(), 3);
    assert.deepEqual((await rows()).map((r) => `${r.status}`).sort(), ["Dead", "Pending", "Sent", "Skipped"]);
  });

  await check("erasing an account removes queued mail addressed to them or sent on their behalf", async () => {
    await clearOutbox();
    const target = await sessionFor("filler11@demo.pfc.invalid");
    await testDb.emailOutbox.create({ data: { kind: "k", toAddress: target.email.toUpperCase(), subject: "s", html: "Dear person", text: "x" } });
    await testDb.emailOutbox.create({ data: { kind: "enquiry.gym", toAddress: "inbox@test.pfc.example", replyTo: target.email, subject: "s", html: "message", text: "x" } });
    await testDb.emailOutbox.create({ data: { kind: "k", toAddress: "someone-else@example.co.za", subject: "s" } });

    const done = await eraseAccount(admin, target.id);
    assert.equal(done.ok, true, done.error);
    assert.deepEqual((await rows()).map((r) => r.toAddress), ["someone-else@example.co.za"]);
  });

  console.log("\nHEALTH DETAIL");

  await check("the route does not exist without a token configured, and needs the right one with it", async () => {
    delete process.env.HEALTH_TOKEN;
    assert.equal((await healthDetailGet(request(bearer(HEALTH_TOKEN)))).status, 404);

    process.env.HEALTH_TOKEN = "short";
    assert.equal((await healthDetailGet(request(bearer("short")))).status, 404, "too short counts as unset");

    process.env.HEALTH_TOKEN = HEALTH_TOKEN;
    for (const headers of [{}, bearer("wrong-token"), bearer(HEALTH_TOKEN + "x"), { authorization: HEALTH_TOKEN }, { authorization: `Basic ${HEALTH_TOKEN}` }]) {
      const res = await healthDetailGet(request(headers));
      assert.equal(res.status, 401, JSON.stringify(headers).slice(0, 40));
      assert.equal(res.headers.get("www-authenticate"), "Bearer");
    }
  });

  await check("the detail reports latency, size, migrations, counts, outbox and configuration, and no secret", async () => {
    await clearOutbox();
    const res = await healthDetailGet(request(bearer(HEALTH_TOKEN)));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    const { data } = JSON.parse(text);

    assert.equal(data.status, "ok");
    assert.ok(data.database.latencyMs >= 0);
    assert.ok(data.database.sizeBytes > 1_000_000);
    assert.deepEqual(data.database.migrations.pending, []);
    assert.deepEqual(data.database.migrations.newerThanThisRelease, []);
    assert.equal(data.database.migrations.expected, expectedMigrations.length);
    assert.ok(data.database.rowCounts.users > 20);
    assert.equal(data.outbox.dailyCap, 90);
    assert.equal(data.configured.email, true);
    assert.equal(data.configured.privateBlob, Boolean(process.env.PRIVATE_BLOB_STORE_ID));

    for (const secret of [HEALTH_TOKEN, process.env.SESSION_SECRET!, process.env.TEST_DATABASE_URL!, "re_test_key"]) {
      assert.ok(!text.includes(secret), "no secret in the answer");
    }
    assert.ok(!/postgres(ql)?:\/\//.test(text), "no connection string");
  });

  await check("up to three dead letters a day are normal; a fourth, or an unapplied migration, makes the status degraded", async () => {
    const dead = (hoursAgo: number) =>
      testDb.emailOutbox.create({
        data: { kind: "k", toAddress: "a@example.co.za", subject: "s", status: "Dead", nextAttemptAt: new Date(Date.now() - hoursAgo * 3_600_000) },
      });
    const detail = async () => JSON.parse(await (await healthDetailGet(request(bearer(HEALTH_TOKEN)))).text()).data;

    await dead(1); await dead(2); await dead(3); await dead(30); await dead(72);
    let now = await detail();
    assert.equal(now.outbox.dead, 5, "all five are still there");
    assert.equal(now.outbox.deadLast24h, 3, "only three were parked in the last day");
    assert.equal(now.status, "ok");

    await dead(4);
    now = await detail();
    assert.equal(now.outbox.deadLast24h, 4);
    assert.equal(now.status, "degraded");
    await testDb.emailOutbox.deleteMany();

    const { _max } = await testDb.$queryRaw<{ _max: string }[]>`SELECT max(migration_name) AS "_max" FROM "_prisma_migrations"`.then((r) => ({ _max: r[0]!._max }));
    await testDb.$executeRaw`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = ${_max}`;
    try {
      const behind = JSON.parse(await (await healthDetailGet(request(bearer(HEALTH_TOKEN)))).text()).data;
      assert.equal(behind.status, "degraded");
      assert.deepEqual(behind.database.migrations.pending, [_max]);
    } finally {
      await testDb.$executeRaw`UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE migration_name = ${_max}`;
    }
  });

  await check("the committed list of migrations matches the folder", () => {
    const dir = path.join(ROOT, "prisma", "migrations");
    const names = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort();
    assert.deepEqual(expectedMigrations, names, "run `node scripts/list-migrations.mjs`");
  });

  console.log("\nMAINTENANCE JOB");

  await check("it does not exist without CRON_SECRET and refuses a wrong or missing one", async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await cronGet(request(bearer(CRON_SECRET)))).status, 404);
    process.env.CRON_SECRET = CRON_SECRET;
    assert.equal((await cronGet(request())).status, 401);
    assert.equal((await cronGet(request(bearer(HEALTH_TOKEN)))).status, 401, "the other token is not accepted");
    assert.equal(await testDb.auditLog.count({ where: { action: "maintenance.run" } }), 0, "nothing ran");
  });

  await check("it clears expired and used reset tokens and expired counters, drains the outbox, and is safe to repeat", async () => {
    await clearOutbox();
    const user = await sessionFor("filler12@demo.pfc.invalid");
    const hour = 3_600_000;
    const token = (n: string, expiresIn: number, used: boolean) =>
      testDb.passwordResetToken.create({
        data: { userId: user.id, tokenHash: `maint-${n}`, createdAt: new Date(Date.now() - 3 * hour), expiresAt: new Date(Date.now() + expiresIn), usedAt: used ? new Date() : null },
      });
    await token("expired", -hour, false);
    await token("used", hour, true);
    await token("live", hour, false);
    await testDb.rateLimitBucket.deleteMany();
    await testDb.rateLimitBucket.createMany({
      data: [
        { key: "old1", count: 3, resetAt: new Date(Date.now() - hour) },
        { key: "old2", count: 3, resetAt: new Date(Date.now() - 1000) },
        { key: "live", count: 3, resetAt: new Date(Date.now() + hour) },
      ],
    });
    await testDb.emailOutbox.create({ data: { kind: "booking.confirmed", toAddress: "due@example.co.za", subject: "due", html: "<p>x</p>", text: "x", nextAttemptAt: new Date(Date.now() - 1000) } });

    const res = await cronGet(request(bearer(CRON_SECRET)));
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.resetTokensDeleted, 2);
    assert.equal(data.bucketsDeleted, 2);
    assert.equal(data.outbox.sent, 1);
    assert.deepEqual(data.failed, []);

    assert.deepEqual((await testDb.passwordResetToken.findMany({ where: { tokenHash: { startsWith: "maint-" } } })).map((t) => t.tokenHash), ["maint-live"]);
    assert.deepEqual((await testDb.rateLimitBucket.findMany()).map((b) => b.key).filter((k) => k === "live"), ["live"]);
    assert.equal(resend.outbox.at(-1)!.subject, "due");

    const second = await (await cronGet(request(bearer(CRON_SECRET)))).json();
    assert.equal(second.data.resetTokensDeleted, 0);
    assert.equal(second.data.outbox.claimed, 0);
    assert.equal(await testDb.auditLog.count({ where: { action: "maintenance.run" } }), 2);
  });

  console.log("\nOUTBOX DRAIN JOB");

  await check("GET /api/cron/outbox needs CRON_SECRET: absent without it, 401 with the wrong one", async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await outboxCronGet(request(bearer(CRON_SECRET)))).status, 404);
    process.env.CRON_SECRET = CRON_SECRET;
    assert.equal((await outboxCronGet(request())).status, 401);
    assert.equal((await outboxCronGet(request(bearer("wrong-secret-wrong-secret-wrong-secret-xx")))).status, 401);
    assert.equal((await outboxCronGet(request(bearer(HEALTH_TOKEN)))).status, 401, "the other token is not accepted");
  });

  await check("it drains and nothing else, and leaves no audit row when it had nothing to do", async () => {
    await clearOutbox();
    await testDb.auditLog.deleteMany({ where: { action: { in: ["outbox.drain", "maintenance.run"] } } });

    // Things the maintenance job would delete must survive this route.
    const user = await sessionFor("filler13@demo.pfc.invalid");
    await testDb.passwordResetToken.create({
      data: { userId: user.id, tokenHash: "drain-keep", createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) },
    });
    await testDb.rateLimitBucket.create({ data: { key: "drain-keep", count: 1, resetAt: new Date(Date.now() - 1000) } });

    const quiet = await outboxCronGet(request(bearer(CRON_SECRET)));
    assert.equal(quiet.status, 200);
    assert.deepEqual((await quiet.json()).data, { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0, deferred: 0 });
    assert.equal(await testDb.auditLog.count({ where: { action: "outbox.drain" } }), 0, "a quiet run leaves no row");
    assert.equal(await testDb.passwordResetToken.count({ where: { tokenHash: "drain-keep" } }), 1, "no deletions");
    assert.equal(await testDb.rateLimitBucket.count({ where: { key: "drain-keep" } }), 1);
    assert.equal(await testDb.auditLog.count({ where: { action: "maintenance.run" } }), 0, "it is not the maintenance job");
  });

  await check("it writes one audit row when it sent mail, and one when it parked mail; a retry alone writes none", async () => {
    await clearOutbox();
    await testDb.auditLog.deleteMany({ where: { action: "outbox.drain" } });
    const due = () => new Date(Date.now() - 1000);
    const make = (to: string) => testDb.emailOutbox.create({ data: { kind: "k", toAddress: to, subject: to, html: "x", text: "x", nextAttemptAt: due() } });

    await make("a@example.co.za");
    await make("b@example.co.za");
    const sent = (await (await outboxCronGet(request(bearer(CRON_SECRET)))).json()).data;
    assert.equal(sent.sent, 2);
    let rows = await testDb.auditLog.findMany({ where: { action: "outbox.drain" } });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.detail, { claimed: 2, sent: 2, dead: 0, retry: 0 });

    await clearOutbox();
    await make("c@example.co.za");
    resend.failNext = true;
    resend.failStatus = 422;
    const parked = (await (await outboxCronGet(request(bearer(CRON_SECRET)))).json()).data;
    assert.equal(parked.dead, 1);
    rows = await testDb.auditLog.findMany({ where: { action: "outbox.drain" }, orderBy: { id: "asc" } });
    assert.equal(rows.length, 2);
    assert.equal((rows[1]!.detail as { dead: number }).dead, 1);

    await clearOutbox();
    await make("d@example.co.za");
    resend.failNext = true;
    resend.failStatus = 503;
    const retried = (await (await outboxCronGet(request(bearer(CRON_SECRET)))).json()).data;
    assert.equal(retried.retry, 1);
    assert.equal(await testDb.auditLog.count({ where: { action: "outbox.drain" } }), 2, "a mail that only goes back to waiting is not news");
  });

  console.log("\nSLOW QUERIES");

  await check("a query over the threshold is logged with model, operation, time and request id, and no arguments", async () => {
    process.env.SLOW_QUERY_MS = "30";
    const lines: Record<string, unknown>[] = [];
    const out = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      for (const line of String(chunk).split("\n")) if (line.startsWith("{")) lines.push(JSON.parse(line));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runWithRequest({ requestId: "slow-query-trace-1" }, async () => {
        await prisma.$queryRaw`SELECT pg_sleep(0.08)::text`;
        await prisma.user.findFirst({ where: { email: "secret-value@example.co.za" } });
      });
      await prisma.$queryRaw`SELECT pg_sleep(0.08)::text`;
    } finally {
      process.stderr.write = out;
      delete process.env.SLOW_QUERY_MS;
    }

    const slow = lines.filter((l) => l.message === "Slow query");
    assert.equal(slow.length, 2, "the fast user lookup is not logged");
    assert.equal(slow[0]!.requestId, "slow-query-trace-1");
    assert.equal(slow[1]!.requestId, undefined, "outside a request there is none");
    const meta = slow[0]!.meta as { ms: number; model: string; operation: string };
    assert.ok(meta.ms >= 30);
    assert.equal(meta.model, "raw");
    assert.ok(!JSON.stringify(slow).includes("secret-value"), "arguments are never logged");
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
