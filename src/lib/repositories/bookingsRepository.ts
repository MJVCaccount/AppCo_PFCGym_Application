import "server-only";

import type { Prisma } from "@prisma/client";

import {
  gymDateAndTime,
  hasSessionStarted,
  isoDate,
  nextOccurrence,
} from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { Booking, DayKey } from "@/lib/types";

/** Data-access layer for class bookings (Task 1 §7.1.2). */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_LISTED = 200;

export const CLASS_FULL_REASON = "Class full";

const bookingSelect = {
  id: true,
  gymClassId: true,
  sessionDate: true,
  status: true,
  gymClass: {
    select: {
      name: true,
      day: true,
      startsAt: true,
      coach: { select: { user: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    classId: row.gymClassId,
    className: row.gymClass.name,
    coachName: row.gymClass.coach.user.fullName,
    day: row.gymClass.day,
    startsAt: row.gymClass.startsAt,
    sessionDate: isoDate(row.sessionDate),
    status: row.status,
  };
}

/**
 * Confirmed bookings for sessions that have not started on the gym's clock:
 * a later date, or today with a later start time. The mirror image of
 * hasSessionStarted.
 */
export function futureConfirmedWhere(now: Date): Prisma.BookingWhereInput {
  const { date, time } = gymDateAndTime(now);

  return {
    status: "Confirmed",
    OR: [
      { sessionDate: { gt: date } },
      { sessionDate: date, gymClass: { startsAt: { gt: time } } },
    ],
  };
}

/**
 * Cancels every future Confirmed booking of one member or one class and
 * returns how many there were. Always called inside the transaction that
 * makes them impossible to honour (a deactivated account or class).
 */
export async function cancelFutureConfirmed(
  tx: Prisma.TransactionClient,
  scope: { memberId: number } | { gymClassId: number },
  now: Date,
): Promise<number> {
  const { count } = await tx.booking.updateMany({
    where: { ...scope, ...futureConfirmedWhere(now) },
    data: { status: "Cancelled", cancelledAt: now },
  });

  return count;
}

interface LockedClass {
  id: number;
  name: string;
  day: DayKey;
  startsAt: string;
  capacity: number;
  isActive: boolean;
}

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "class-not-found" | "no-plan" | "duplicate" }
  | { ok: false; reason: "full"; className: string; startsAt: string };

/**
 * Reserve a place on the next session of a class.
 *
 * One transaction, and its first act on the class is a row lock. Two members
 * going for the last place therefore queue: the second waits for the first to
 * commit, then counts again and finds the class full.
 *
 * A refusal for a full class is itself written, as a Failed row, and the
 * transaction returns normally so that row is committed. A Cancelled or
 * Failed row for the same session is reused, because the table allows one row
 * per member, class and date.
 */
export async function createBooking(
  memberId: number,
  gymClassId: number,
  now: Date = new Date(),
): Promise<CreateBookingResult> {
  return prisma.$transaction(async (tx): Promise<CreateBookingResult> => {
    // Read before taking the lock, so the lock is held for as short a time as
    // possible.
    const member = await tx.member.findUnique({
      where: { membershipId: memberId },
      select: { planId: true },
    });

    const [gymClass] = await tx.$queryRaw<LockedClass[]>`
      SELECT "id", "name", "day"::text AS "day", "startsAt", "capacity", "isActive"
      FROM "GymClass" WHERE "id" = ${gymClassId} FOR UPDATE`;

    if (!gymClass || !gymClass.isActive) {
      return { ok: false, reason: "class-not-found" };
    }
    if (!member?.planId) return { ok: false, reason: "no-plan" };

    const sessionDate = nextOccurrence(gymClass.day, gymClass.startsAt, now);

    const confirmed = await tx.booking.count({
      where: { gymClassId, sessionDate, status: "Confirmed" },
    });

    const existing = await tx.booking.findUnique({
      where: {
        memberId_gymClassId_sessionDate: { memberId, gymClassId, sessionDate },
      },
      select: { id: true, status: true },
    });
    const reusable =
      existing?.status === "Cancelled" || existing?.status === "Failed";
    if (existing && !reusable) return { ok: false, reason: "duplicate" };

    if (confirmed >= gymClass.capacity) {
      const failed = { status: "Failed", failureReason: CLASS_FULL_REASON } as const;

      if (existing) {
        await tx.booking.update({ where: { id: existing.id }, data: failed });
      } else {
        await tx.booking.create({
          data: { memberId, gymClassId, sessionDate, ...failed },
        });
      }

      return {
        ok: false,
        reason: "full",
        className: gymClass.name,
        startsAt: gymClass.startsAt,
      };
    }

    // Pending first, then Confirmed: the lifecycle the booking table documents.
    const pending = existing
      ? await tx.booking.update({
          where: { id: existing.id },
          data: { status: "Pending", failureReason: null, cancelledAt: null },
          select: { id: true },
        })
      : await tx.booking.create({
          data: { memberId, gymClassId, sessionDate, status: "Pending" },
          select: { id: true },
        });

    const row = await tx.booking.update({
      where: { id: pending.id },
      data: { status: "Confirmed" },
      select: bookingSelect,
    });

    return { ok: true, booking: toBooking(row) };
  }, TRANSACTION_OPTIONS);
}

export type CancelBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not-found" | "not-confirmed" | "started" };

/**
 * Cancel a member's own Confirmed booking before the class starts.
 *
 * A booking that belongs to someone else is reported as not found, exactly
 * like one that does not exist, so ids cannot be probed.
 */
export async function cancelBooking(
  memberId: number,
  bookingId: number,
  now: Date = new Date(),
): Promise<CancelBookingResult> {
  return prisma.$transaction(async (tx): Promise<CancelBookingResult> => {
    const existing = await tx.booking.findFirst({
      where: { id: bookingId, memberId },
      select: {
        status: true,
        sessionDate: true,
        gymClass: { select: { startsAt: true } },
      },
    });

    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.status !== "Confirmed") {
      return { ok: false, reason: "not-confirmed" };
    }
    if (hasSessionStarted(existing.sessionDate, existing.gymClass.startsAt, now)) {
      return { ok: false, reason: "started" };
    }

    // The status is in the filter, so a second cancel racing this one matches
    // no row instead of stamping cancelledAt twice.
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, memberId, status: "Confirmed" },
      data: { status: "Cancelled", cancelledAt: now },
    });
    if (count === 0) return { ok: false, reason: "not-confirmed" };

    const row = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: bookingSelect,
    });

    return { ok: true, booking: toBooking(row) };
  }, TRANSACTION_OPTIONS);
}

/** A member's bookings as stored, newest session first. */
export async function listForMember(memberId: number): Promise<Booking[]> {
  const rows = await prisma.booking.findMany({
    where: { memberId },
    orderBy: [
      { sessionDate: "desc" },
      { gymClass: { startsAt: "desc" } },
      { id: "desc" },
    ],
    take: MAX_LISTED,
    select: bookingSelect,
  });

  return rows.map(toBooking);
}
