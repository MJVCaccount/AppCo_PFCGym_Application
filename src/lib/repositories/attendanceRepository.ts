import "server-only";

import type { Prisma } from "@prisma/client";

import { addDays, gymDateAndTime, startOfGymMonth } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import { futureConfirmedWhere } from "@/lib/repositories/bookingsRepository";
import type {
  AttendanceStatus,
  BookingStatus,
  DayKey,
  MemberStats,
  RosterEntry,
} from "@/lib/types";

/** Data-access layer for class rosters and attendance. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_ROSTER = 500;

/** A place that was held: not a refused (Failed) or half-made (Pending) one. */
const ROSTER_STATUSES: BookingStatus[] = [
  "Confirmed",
  "Completed",
  "NoShow",
  "Cancelled",
];

/** Attendance can be recorded, and corrected, from these states only. */
const MARKABLE: BookingStatus[] = ["Confirmed", "Completed", "NoShow"];

export interface ClassOwner {
  id: number;
  name: string;
  coachId: number;
  coachName: string;
  day: DayKey;
  startsAt: string;
}

/** The class and who teaches it, active or not: past rosters stay readable. */
export async function getClassOwner(
  classId: number,
): Promise<ClassOwner | undefined> {
  const row = await prisma.gymClass.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      coachId: true,
      day: true,
      startsAt: true,
      coach: { select: { user: { select: { fullName: true } } } },
    },
  });
  if (!row) return undefined;

  return {
    id: row.id,
    name: row.name,
    coachId: row.coachId,
    coachName: row.coach.user.fullName,
    day: row.day,
    startsAt: row.startsAt,
  };
}

/** Who held a place on one dated session, by name. */
export async function listRoster(
  classId: number,
  sessionDate: Date,
): Promise<RosterEntry[]> {
  const rows = await prisma.booking.findMany({
    where: {
      gymClassId: classId,
      sessionDate,
      status: { in: ROSTER_STATUSES },
    },
    orderBy: [{ member: { user: { fullName: "asc" } } }, { id: "asc" }],
    take: MAX_ROSTER,
    select: {
      id: true,
      status: true,
      member: { select: { user: { select: { fullName: true } } } },
    },
  });

  return rows.map((row) => ({
    bookingId: row.id,
    memberName: row.member.user.fullName,
    status: row.status,
  }));
}

export type MarkAttendanceResult =
  | { ok: true; entry: RosterEntry; classId: number; sessionDate: Date }
  | { ok: false; reason: "not-found" | "not-happened" | "not-markable" };

/**
 * Records whether a member turned up.
 *
 * `coachId` limits the write to that coach's classes: a booking for someone
 * else's class is reported as not found, exactly like one that does not
 * exist. The booking row is locked first, so a mark racing a cancellation or
 * a second mark sees the other's result rather than overwriting it blind.
 */
export async function markAttendance(
  bookingId: number,
  status: AttendanceStatus,
  coachId: number | null,
  actorId: number,
  now: Date = new Date(),
): Promise<MarkAttendanceResult> {
  return prisma.$transaction(async (tx): Promise<MarkAttendanceResult> => {
    const [locked] = await tx.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    if (!locked) return { ok: false, reason: "not-found" };

    const existing = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        status: true,
        sessionDate: true,
        gymClassId: true,
        gymClass: { select: { coachId: true } },
      },
    });

    if (coachId !== null && existing.gymClass.coachId !== coachId) {
      return { ok: false, reason: "not-found" };
    }
    if (existing.sessionDate > gymDateAndTime(now).date) {
      return { ok: false, reason: "not-happened" };
    }
    if (!MARKABLE.includes(existing.status)) {
      return { ok: false, reason: "not-markable" };
    }

    const row = await tx.booking.update({
      where: { id: bookingId },
      data: { status, completedAt: status === "Completed" ? now : null },
      select: {
        id: true,
        status: true,
        member: { select: { user: { select: { fullName: true } } } },
      },
    });
    await audit(
      {
        actorId,
        action: "attendance.mark",
        entity: "Booking",
        entityId: bookingId,
        detail: { from: existing.status, to: status },
      },
      tx,
    );

    return {
      ok: true,
      entry: {
        bookingId: row.id,
        memberName: row.member.user.fullName,
        status: row.status,
      },
      classId: existing.gymClassId,
      sessionDate: existing.sessionDate,
    };
  }, TRANSACTION_OPTIONS);
}

/**
 * Recorded attendance over the `days` up to and including today, for one
 * coach's classes or, with `coachId` null, for every class.
 */
export async function countAttendance(
  coachId: number | null,
  days: number,
  now: Date = new Date(),
): Promise<{ attended: number; noShow: number }> {
  const today = gymDateAndTime(now).date;
  const scope: Prisma.BookingWhereInput = {
    sessionDate: { gt: addDays(today, -days), lte: today },
    ...(coachId === null ? {} : { gymClass: { coachId } }),
  };

  const [attended, noShow] = await Promise.all([
    prisma.booking.count({ where: { ...scope, status: "Completed" } }),
    prisma.booking.count({ where: { ...scope, status: "NoShow" } }),
  ]);

  return { attended, noShow };
}

/**
 * A member's month so far and what they have coming up, or undefined when the
 * id is not a member.
 *
 * "Attended" follows the bookings page: a Completed booking, or a Confirmed
 * one whose date has passed without the coach marking a no-show.
 */
export async function getMemberStats(
  memberId: number,
  now: Date = new Date(),
): Promise<MemberStats | undefined> {
  const member = await prisma.member.findUnique({
    where: { membershipId: memberId },
    select: {
      planId: true,
      planChangedAt: true,
      user: { select: { createdAt: true } },
    },
  });
  if (!member) return undefined;

  const today = gymDateAndTime(now).date;
  const monthStart = startOfGymMonth(now);

  const [attendedThisMonth, upcoming] = await Promise.all([
    prisma.booking.count({
      where: {
        memberId,
        OR: [
          { status: "Completed", sessionDate: { gte: monthStart, lte: today } },
          { status: "Confirmed", sessionDate: { gte: monthStart, lt: today } },
        ],
      },
    }),
    prisma.booking.count({
      where: { memberId, ...futureConfirmedWhere(now) },
    }),
  ]);

  // A plan chosen at sign-up has no change date: it started with the account.
  const started = member.planChangedAt ?? member.user.createdAt;

  return {
    attendedThisMonth,
    upcoming,
    planStartedAt: member.planId === null ? null : started.toISOString(),
  };
}
