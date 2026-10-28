import "server-only";

import { deferWork } from "@/lib/email/queue";
import { type OutgoingEmail, deliver } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { markEmailSent } from "@/lib/repositories/contactRepository";
import {
  type OutboxRow,
  type OutboxStats,
  claimDue,
  claimOne,
  defer,
  insertDirectSent,
  insertPending,
  markFailed,
  markSent,
  markSkipped,
  purge,
  reserveSlot,
  stats,
} from "@/lib/repositories/outboxRepository";

/**
 * The email outbox.
 *
 * An email that carries no secret is written to the table first and sent
 * second. A provider outage, a crash between the two, or the provider's daily
 * cap therefore delays the email instead of losing it:
 *
 *  - the first attempt happens straight away, after the response
 *  - a failure the provider says is permanent (HTTP 4xx other than 408 and 429)
 *    is parked as Dead at once with its reason; any other failure (429, 408,
 *    5xx, no answer) is retried with a growing wait (5 min, 30 min, 2 h, 6 h)
 *    and, after the fifth, parked as Dead for a person to look at
 *  - an address that can never receive mail (.invalid) is Skipped without
 *    calling the provider
 *  - the day's sends are counted (this table plus the secret-bearing mails,
 *    which are recorded without a body) and sending stops at the cap; the rest
 *    wait for the next UTC day, when Resend's free allowance resets
 *  - what is due is drained at the next email the app sends, hourly by the Outbox drain
 *    workflow (GitHub may delay it, and disables schedules after 60 days without
 *    repository activity) and at least daily by the Vercel cron. The wait is the earliest
 *    a retry may happen, not the time it will
 *
 * Password-reset and invite emails do NOT go through here: their links hold the
 * raw token, and a stored copy would be a usable password reset. They are sent
 * directly and only counted (recordDirectSend).
 */

/** Resend's free plan allows 100 a day; stop short of it so direct mails still fit. */
export const DEFAULT_DAILY_CAP = 90;
export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [5, 30, 120, 360];
const LEASE_SECONDS = 600;

export function dailyCap(value: string | undefined = process.env.EMAIL_DAILY_CAP): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_DAILY_CAP;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A minute after the next UTC midnight, when the day's count starts again. */
export function nextAllowance(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 86_400_000 + 60_000);
}

export function backoffUntil(failures: number, now: Date): Date | null {
  if (failures >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(failures, BACKOFF_MINUTES.length) - 1] ?? 360;
  return new Date(now.getTime() + minutes * 60_000);
}

export type Outcome = "sent" | "retry" | "dead" | "skipped" | "deferred" | "taken";

/** One attempt at one claimed row. */
async function attempt(row: OutboxRow, now: Date): Promise<Outcome> {
  if (!(await reserveSlot(row.id, dailyCap(), startOfUtcDay(now), now, LEASE_SECONDS))) {
    await defer(row.id, nextAllowance(now));
    return "deferred";
  }

  const email: OutgoingEmail = {
    to: row.toAddress,
    subject: row.subject,
    html: row.html,
    text: row.text,
    ...(row.replyTo ? { replyTo: row.replyTo } : {}),
  };
  const result = await deliver(email);

  if (result.status === "sent") {
    await markSent(row.id, now);
    if (row.kind === "enquiry.gym" && row.enquiryId !== null) {
      await markEmailSent(row.enquiryId, now);
    }
    return "sent";
  }

  if (result.status === "skipped") {
    await markSkipped(row.id, result.reason);
    return "skipped";
  }

  // A refusal a retry cannot change (a bad address, an unverified domain, a
  // wrong key) is parked at once with its reason. Everything else backs off.
  const failures = row.attempts + 1;
  const retryAt = result.permanent ? null : backoffUntil(failures, now);
  await markFailed(row.id, result.error, retryAt, now);
  if (!retryAt) {
    logger.error(
      result.permanent
        ? "Email parked as dead: the provider refused it for good"
        : "Email parked as dead after repeated failures",
      { id: row.id, kind: row.kind, statusCode: result.statusCode },
    );
  }
  return retryAt ? "retry" : "dead";
}

/**
 * Stores an email and tries to send it once the response has gone out. `build`
 * runs in the deferred work, so a template error never reaches the caller;
 * returning null means there is nothing to send.
 */
export function queueOutboxEmail(
  kind: string,
  build: () => OutgoingEmail | null | Promise<OutgoingEmail | null>,
  options: { enquiryId?: number } = {},
): void {
  deferWork(async () => {
    const email = await build();
    if (!email) return;

    const now = new Date();
    const row = await insertPending({
      kind,
      toAddress: email.to,
      replyTo: email.replyTo ?? null,
      subject: email.subject,
      html: email.html,
      text: email.text,
      enquiryId: options.enquiryId ?? null,
      nextAttemptAt: now,
    });

    if (await claimOne(row.id, now, LEASE_SECONDS)) await attempt(row, now);

    // A little housekeeping on the way past: anything older that is now due.
    await drainOutbox({ limit: 2 });
  });
}

export interface DrainReport {
  claimed: number;
  sent: number;
  retry: number;
  dead: number;
  skipped: number;
  deferred: number;
}

/** Attempts every due row, up to `limit`. Safe to run from several places at once. */
export async function drainOutbox(
  options: { limit?: number; now?: Date } = {},
): Promise<DrainReport> {
  const now = options.now ?? new Date();
  const rows = await claimDue(options.limit ?? 50, now, LEASE_SECONDS);
  const report: DrainReport = { claimed: rows.length, sent: 0, retry: 0, dead: 0, skipped: 0, deferred: 0 };

  for (const row of rows) {
    const outcome = await attempt(row, now);
    if (outcome === "sent") report.sent++;
    else if (outcome === "retry") report.retry++;
    else if (outcome === "dead") report.dead++;
    else if (outcome === "skipped") report.skipped++;
    else if (outcome === "deferred") report.deferred++;
  }

  return report;
}

/** Counts a secret-bearing email that was sent directly, so the daily cap sees it. */
export async function recordDirectSend(kind: string, now: Date = new Date()): Promise<void> {
  await insertDirectSent(kind, now);
}

/** Deletes finished rows: sent after 30 days, skipped after 7, dead after 90. */
export async function purgeOutbox(now: Date = new Date()): Promise<number> {
  const day = 86_400_000;
  return purge({
    sent: new Date(now.getTime() - 30 * day),
    skipped: new Date(now.getTime() - 7 * day),
    dead: new Date(now.getTime() - 90 * day),
  });
}

export async function outboxStats(now: Date = new Date()): Promise<OutboxStats & { dailyCap: number }> {
  return { ...(await stats(now)), dailyCap: dailyCap() };
}
