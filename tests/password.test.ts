/**
 * Password reset and coach invite tests, run against the seeded test database
 * (see tests/helpers/db.ts). Emails go to the in-memory Resend stub, so the
 * test reads the reset link out of the "sent" message exactly as a person
 * would out of their inbox.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { resetDatabase, testDb } from "./helpers/db";

import { requestPasswordReset, submitPasswordReset } from "../src/actions/auth";
import { flushEmails } from "../src/lib/email/queue";
import { findByEmail, toSessionUser, validateCredentials } from "../src/lib/repositories/usersRepository";
import { createCoach, resendInvite } from "../src/lib/services/coachAdminService";
import {
  checkResetToken,
  RESET_INVALID,
  RESET_REQUESTED,
  requestReset,
  resetPassword,
} from "../src/lib/services/passwordService";
import { createSession, destroySession, getSession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";
import { EMPTY_FORM_STATE, MAX_PASSWORD } from "../src/lib/validation";

interface Sent {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}
const stub = (globalThis as unknown as { __resend: { outbox: Sent[] } }).__resend;

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

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The token in the reset link of the last email sent to `address`. */
function tokenSentTo(address: string): string {
  const mail = [...stub.outbox].reverse().find((m) => m.to === address);
  assert.ok(mail, `an email went to ${address}`);
  const match = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(mail.text ?? "");
  assert.ok(match, "the email holds a reset link");
  return match[1];
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function main() {
  await resetDatabase();

  process.env.APP_URL = "https://pfc.test.invalid";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "PFC <no-reply@test.pfc.invalid>";

  const admin = await sessionFor("admin@pfc.co.za");
  const member = await sessionFor("member@pfc.co.za");
  const MEMBER_OLD_PASSWORD = "Member123!";
  const NEW_PASSWORD = "Br4ndNewPassw0rd";

  console.log("\nREQUESTING A RESET");

  await check("an unknown email gets the same result as a known one", async () => {
    stub.outbox.length = 0;
    const known = await requestReset(member.email);
    const unknown = await requestReset("nobody@example.co.za");
    const malformed = await requestReset("not-an-email");
    const notText = await requestReset(42);
    await flushEmails();

    assert.deepEqual(unknown, known);
    assert.deepEqual(malformed, known);
    assert.deepEqual(notText, known);
    assert.equal(known.ok, true);
    assert.equal(known.status, 200);
    assert.equal(known.data?.message, RESET_REQUESTED);

    assert.equal(stub.outbox.length, 1, "only the real account is emailed");
    assert.equal(stub.outbox[0].to, member.email);
    assert.equal(
      await testDb.passwordResetToken.count({ where: { user: { email: "nobody@example.co.za" } } }),
      0,
    );
  });

  await check("the form action answers the same way too", async () => {
    const a = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: member.email }));
    const b = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "ghost@example.co.za" }));
    await flushEmails();
    assert.deepEqual(a, b);
    assert.equal(a.ok, true);
    assert.equal(a.message, RESET_REQUESTED);
  });

  await check("the token is stored hashed, expires in 60 minutes, and the raw token is nowhere", async () => {
    stub.outbox.length = 0;
    const before = Date.now();
    await requestReset(member.email);
    await flushEmails();

    const token = tokenSentTo(member.email);
    assert.ok(token.length >= 43, "32 random bytes as base64url");

    const rows = await testDb.passwordResetToken.findMany({ where: { userId: member.id } });
    assert.equal(rows.length, 1, "older unused tokens were deleted");
    assert.equal(rows[0].tokenHash, sha256(token));
    assert.notEqual(rows[0].tokenHash, token);
    assert.equal(rows[0].usedAt, null);

    const minutes = (rows[0].expiresAt.getTime() - before) / 60_000;
    assert.ok(minutes > 59 && minutes <= 60.5, `expires in ~60 minutes, got ${minutes}`);

    const everything = JSON.stringify(await testDb.passwordResetToken.findMany());
    assert.ok(!everything.includes(token), "the raw token is not in the table");
    const audit = JSON.stringify(await testDb.auditLog.findMany());
    assert.ok(!audit.includes(token));
  });

  await check("asking again replaces the earlier link", async () => {
    const first = tokenSentTo(member.email);
    stub.outbox.length = 0;
    await requestReset(member.email);
    await flushEmails();
    const second = tokenSentTo(member.email);

    assert.notEqual(first, second);
    assert.equal(await checkResetToken(first), false);
    assert.equal(await checkResetToken(second), true);
    assert.equal(await testDb.passwordResetToken.count({ where: { userId: member.id } }), 1);
  });

  await check("a deactivated account is told the same and emailed nothing", async () => {
    const dormant = await testDb.user.create({
      data: {
        email: "dormant@example.co.za",
        fullName: "Dormant Person",
        role: "Member",
        passwordHash: "x",
        passwordSalt: "y",
        isActive: false,
        member: { create: {} },
      },
    });
    stub.outbox.length = 0;
    const result = await requestReset(dormant.email);
    await flushEmails();

    assert.equal(result.data?.message, RESET_REQUESTED);
    assert.equal(stub.outbox.length, 0);
    assert.equal(await testDb.passwordResetToken.count({ where: { userId: dormant.id } }), 0);
  });

  console.log("\nUSING A TOKEN");

  await check("an unknown token and a weak password are refused with the right messages", async () => {
    const unknown = await resetPassword("a".repeat(43), NEW_PASSWORD);
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error, RESET_INVALID);

    stub.outbox.length = 0;
    await requestReset(member.email);
    await flushEmails();
    const live = tokenSentTo(member.email);
    const short = await resetPassword(live, "short");
    assert.equal(short.ok, false);
    assert.equal(short.field, "password");

    const huge = await resetPassword(live, "x".repeat(MAX_PASSWORD + 1));
    assert.equal(huge.ok, false);
    assert.match(huge.error ?? "", /at most 128/);

    assert.equal(await checkResetToken(live), true, "a refused password does not use the token");
    assert.equal((await resetPassword(null, NEW_PASSWORD)).status, 400);
    assert.equal((await resetPassword(live, 12345678)).status, 400);
  });

  await check("an expired token fails with the generic message", async () => {
    const token = tokenSentTo(member.email);
    await testDb.passwordResetToken.updateMany({
      where: { userId: member.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    assert.equal(await checkResetToken(token), false);
    const result = await resetPassword(token, NEW_PASSWORD);
    assert.equal(result.ok, false);
    assert.equal(result.error, RESET_INVALID);
    assert.equal(
      (await validateCredentials(member.email, MEMBER_OLD_PASSWORD))?.id,
      member.id,
      "the password did not change",
    );
  });

  await check("a successful reset: new password works, old does not, old sessions die, token is single-use", async () => {
    stub.outbox.length = 0;
    await requestReset(member.email);
    await flushEmails();
    const token = tokenSentTo(member.email);

    await createSession(member);
    assert.deepEqual(await getSession(), member, "signed in before the reset");
    const versionBefore = (await testDb.user.findUniqueOrThrow({ where: { id: member.id } })).sessionVersion;

    const result = await resetPassword(token, NEW_PASSWORD);
    assert.equal(result.ok, true, result.error);

    assert.equal(await getSession(), null, "the pre-reset session cookie no longer works");
    const after = await testDb.user.findUniqueOrThrow({ where: { id: member.id } });
    assert.equal(after.sessionVersion, versionBefore + 1);

    assert.equal((await validateCredentials(member.email, NEW_PASSWORD))?.id, member.id);
    assert.equal(await validateCredentials(member.email, MEMBER_OLD_PASSWORD), null);

    const row = await testDb.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    assert.ok(row.usedAt, "marked used");
    assert.equal(await testDb.passwordResetToken.count({ where: { userId: member.id } }), 1, "other tokens deleted");

    const again = await resetPassword(token, "An0therPassword!");
    assert.equal(again.ok, false);
    assert.equal(again.error, RESET_INVALID);
    assert.equal(await validateCredentials(member.email, "An0therPassword!"), null);

    await destroySession();
    await createSession(member);
    assert.deepEqual(await getSession(), member, "a fresh sign-in works");

    assert.equal(
      await testDb.auditLog.count({ where: { action: "password.reset", entityId: member.id } }),
      1,
    );
  });

  await check("two concurrent resets with one token: exactly one succeeds", async () => {
    stub.outbox.length = 0;
    await requestReset(member.email);
    await flushEmails();
    const token = tokenSentTo(member.email);

    const results = await Promise.all([
      resetPassword(token, "Concurrent-One-1"),
      resetPassword(token, "Concurrent-Two-2"),
      resetPassword(token, "Concurrent-Three-3"),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.error === RESET_INVALID));

    const winner = ["Concurrent-One-1", "Concurrent-Two-2", "Concurrent-Three-3"][
      results.findIndex((r) => r.ok)
    ];
    assert.equal((await validateCredentials(member.email, winner))?.id, member.id);
  });

  await check("the form action redirects to the sign-in page on success", async () => {
    stub.outbox.length = 0;
    await requestReset(member.email);
    await flushEmails();
    const token = tokenSentTo(member.email);

    const failed = await submitPasswordReset(
      EMPTY_FORM_STATE,
      form({ token: "wrong", password: NEW_PASSWORD }),
    );
    assert.equal(failed.ok, false);
    assert.equal(failed.message, RESET_INVALID);

    const weak = await submitPasswordReset(EMPTY_FORM_STATE, form({ token, password: "abc" }));
    assert.equal(weak.ok, false);
    assert.ok(weak.errors?.password);

    await assert.rejects(
      submitPasswordReset(EMPTY_FORM_STATE, form({ token, password: NEW_PASSWORD })),
      (e: unknown) =>
        (e as { digest?: string }).digest === "NEXT_REDIRECT;replace;/login?notice=Password+updated;307;",
    );
  });

  await check("the reset page is sent with Referrer-Policy: no-referrer", async () => {
    const config = (await import("../next.config.mjs")).default as {
      headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
    };
    const rules = await config.headers();
    const rule = rules.find((r) => r.source.startsWith("/reset-password"));
    assert.ok(rule, "a header rule covers /reset-password");
    assert.ok(
      rule.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"),
    );
  });

  console.log("\nCOACH INVITES");

  await check("creating a coach emails a 7-day set-password link, and that link works", async () => {
    stub.outbox.length = 0;
    const before = Date.now();
    const created = await createCoach(admin, {
      fullName: "Nandi Dlamini",
      email: "nandi@pfc.co.za",
      title: "Strength coach",
      bio: "Strength and conditioning coach for the fighters.",
      imageUrl: "",
    });
    await flushEmails();
    assert.equal(created.ok, true, created.error);

    const mail = stub.outbox.find((m) => m.to === "nandi@pfc.co.za");
    assert.ok(mail);
    assert.match(mail.subject, /invited/i);

    const token = tokenSentTo("nandi@pfc.co.za");
    const row = await testDb.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    const days = (row.expiresAt.getTime() - before) / 86_400_000;
    assert.ok(days > 6.99 && days <= 7.01, `valid for 7 days, got ${days}`);

    const set = await resetPassword(token, "Coach-Chosen-Pass1");
    assert.equal(set.ok, true, set.error);
    assert.equal((await validateCredentials("nandi@pfc.co.za", "Coach-Chosen-Pass1"))?.role, "Coach");
    assert.equal(await testDb.auditLog.count({ where: { action: "coach.invite" } }), 1);
  });

  await check("Resend invite is admin only, replaces the old link, and refuses archived coaches", async () => {
    const coach = await testDb.user.findUniqueOrThrow({ where: { email: "jake@pfc.co.za" } });

    assert.equal((await resendInvite(member, coach.id)).status, 403);
    assert.equal((await resendInvite(await sessionFor("sofia@pfc.co.za"), coach.id)).status, 403);
    assert.equal((await resendInvite(admin, "x")).status, 400);
    assert.equal((await resendInvite(admin, 999_999)).status, 404);

    stub.outbox.length = 0;
    assert.equal((await resendInvite(admin, coach.id)).ok, true);
    await flushEmails();
    const first = tokenSentTo("jake@pfc.co.za");

    assert.equal((await resendInvite(admin, coach.id)).ok, true);
    await flushEmails();
    const second = tokenSentTo("jake@pfc.co.za");

    assert.notEqual(first, second);
    assert.equal(await checkResetToken(first), false, "the earlier link stopped working");
    assert.equal(await checkResetToken(second), true);

    await testDb.coach.update({ where: { coachId: coach.id }, data: { isActive: false } });
    assert.equal((await resendInvite(admin, coach.id)).status, 409);
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
