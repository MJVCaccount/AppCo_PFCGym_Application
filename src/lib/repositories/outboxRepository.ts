import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Data access for the email outbox (see services/outboxService.ts).
 * Time comparisons use the application clock passed in, so tests can move it.
 */

export interface OutboxRow {
  id: number;
  kind: string;
  toAddress: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  attempts: number;
  enquiryId: number | null;
}

const rowSelect = {
  id: true,
  kind: true,
  toAddress: true,
  replyTo: true,
  subject: true,
  html: true,
  text: true,
  attempts: true,
  enquiryId: true,
} as const;

export async function insertPending(input: {
  kind: string;
  toAddress: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  enquiryId?: number | null;
  nextAttemptAt: Date;
}): Promise<OutboxRow> {
  return prisma.emailOutbox.create({
    data: {
      kind: input.kind,
      toAddress: input.toAddress,
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      html: input.html,
      text: input.text,
      enquiryId: input.enquiryId ?? null,
      nextAttemptAt: input.nextAttemptAt,
    },
    select: rowSelect,
  });
}

/** A mail sent straight away (it carries a secret): no body, only a count. */
export async function insertDirectSent(kind: string, at: Date): Promise<void> {
  await prisma.emailOutbox.create({
    data: { kind, toAddress: "", subject: "", status: "Sent", sentAt: at, nextAttemptAt: at },
  });
}

/**
 * Takes up to `limit` due rows (Pending, or Sending whose lease ran out) for this worker. Each is leased for
 * `leaseSeconds` by pushing its next attempt into the future, so two workers
 * never take the same row and a worker that dies lets it come back.
 */
export async function claimDue(
  limit: number,
  now: Date,
  leaseSeconds: number,
): Promise<OutboxRow[]> {
  const lease = new Date(now.getTime() + leaseSeconds * 1000);

  return prisma.$queryRaw<OutboxRow[]>`
    UPDATE "EmailOutbox" SET "nextAttemptAt" = ${lease}
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox"
      WHERE "status" IN ('Pending', 'Sending') AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "kind", "toAddress", "replyTo", "subject", "html", "text", "attempts", "enquiryId"`;
}

/**
 * Reserves one of today's sending slots for a claimed row, or says there is
 * none. The check and the reservation happen under one database lock, so a
 * burst of parallel sends (an event cancelled for forty fighters) cannot all
 * see "one place left" and overshoot the cap. A reserved row is Sending until
 * it finishes; a Sending row counts against the cap while its lease holds.
 */
export async function reserveSlot(
  id: number,
  cap: number,
  dayStart: Date,
  now: Date,
  leaseSeconds: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(54020)`;

    // One statement, so one snapshot: a row finishing at this moment is seen
    // as Sending or as Sent, never as neither.
    const [used] = await tx.$queryRaw<{ n: number }[]>`
      SELECT (
        COUNT(*) FILTER (WHERE "status" = 'Sent' AND "sentAt" >= ${dayStart})
        + COUNT(*) FILTER (WHERE "status" = 'Sending' AND "nextAttemptAt" > ${now} AND "id" <> ${id})
      )::int AS "n" FROM "EmailOutbox"`;
    const taken = used?.n ?? 0;
    if (taken >= cap) return false;

    await tx.emailOutbox.update({
      where: { id },
      data: { status: "Sending", nextAttemptAt: new Date(now.getTime() + leaseSeconds * 1000) },
    });
    return true;
  });
}

/** Claims one specific row (the one just inserted) for an immediate attempt. */
export async function claimOne(id: number, now: Date, leaseSeconds: number): Promise<boolean> {
  const lease = new Date(now.getTime() + leaseSeconds * 1000);
  const { count } = await prisma.emailOutbox.updateMany({
    where: { id, status: { in: ["Pending", "Sending"] }, nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: lease },
  });
  return count === 1;
}

export async function markSent(id: number, at: Date): Promise<void> {
  await prisma.emailOutbox.update({
    where: { id },
    data: { status: "Sent", sentAt: at, attempts: { increment: 1 }, lastError: null, html: "", text: "" },
  });
}

export async function markSkipped(id: number, reason: string): Promise<void> {
  await prisma.emailOutbox.update({
    where: { id },
    data: { status: "Skipped", html: "", text: "", lastError: reason },
  });
}

/**
 * After a failed attempt: try again at `retryAt`, or give up (Dead) when it is
 * null. For a Dead row `nextAttemptAt` is set to `at`, the moment it was
 * parked: nothing reads it for a dead row, and it lets the health detail count
 * "dead in the last 24 hours" without another column.
 */
export async function markFailed(
  id: number,
  error: string,
  retryAt: Date | null,
  at: Date,
): Promise<void> {
  await prisma.emailOutbox.update({
    where: { id },
    data: retryAt
      ? { status: "Pending", attempts: { increment: 1 }, lastError: error, nextAttemptAt: retryAt }
      : { attempts: { increment: 1 }, lastError: error, status: "Dead", nextAttemptAt: at },
  });
}

/** Puts a row back to be tried later without counting an attempt (the daily cap). */
export async function defer(id: number, retryAt: Date): Promise<void> {
  await prisma.emailOutbox.update({ where: { id }, data: { status: "Pending", nextAttemptAt: retryAt } });
}

export async function countSentSince(since: Date): Promise<number> {
  return prisma.emailOutbox.count({ where: { status: "Sent", sentAt: { gte: since } } });
}

/** Deletes finished rows that are old enough that nobody needs the body. */
export async function purge(before: { sent: Date; dead: Date; skipped: Date }): Promise<number> {
  const result = await prisma.emailOutbox.deleteMany({
    where: {
      OR: [
        { status: "Sent", sentAt: { lt: before.sent } },
        { status: "Dead", createdAt: { lt: before.dead } },
        { status: "Skipped", createdAt: { lt: before.skipped } },
      ],
    },
  });
  return result.count;
}

export interface OutboxStats {
  pending: number;
  dead: number;
  /** Dead letters parked in the last 24 hours. */
  deadLast24h: number;
  skipped: number;
  sentLast24h: number;
  oldestPendingAt: string | null;
}

export async function stats(now: Date): Promise<OutboxStats> {
  const [pending, dead, deadLast24h, skipped, sentLast24h, oldest] = await Promise.all([
    prisma.emailOutbox.count({ where: { status: { in: ["Pending", "Sending"] } } }),
    prisma.emailOutbox.count({ where: { status: "Dead" } }),
    prisma.emailOutbox.count({
      where: { status: "Dead", nextAttemptAt: { gte: new Date(now.getTime() - 86_400_000) } },
    }),
    prisma.emailOutbox.count({ where: { status: "Skipped" } }),
    prisma.emailOutbox.count({
      where: { status: "Sent", sentAt: { gte: new Date(now.getTime() - 86_400_000) } },
    }),
    prisma.emailOutbox.findFirst({
      where: { status: "Pending" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  return { pending, dead, deadLast24h, skipped, sentLast24h, oldestPendingAt: oldest?.createdAt.toISOString() ?? null };
}
