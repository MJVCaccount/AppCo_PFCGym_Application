import "server-only";

import { hasSessionStarted } from "@/lib/dates";
import { mapPrismaError } from "@/lib/errors";
import {
  cancelBooking as cancelRow,
  createBooking as insertBooking,
  listForMember,
} from "@/lib/repositories/bookingsRepository";
import { getSlot } from "@/lib/repositories/timetableRepository";
import { notifyBookingConfirmed } from "@/lib/services/notificationService";
import {
  type Booking,
  isMemberRole,
  type SessionUser,
  type TimetableSlot,
} from "@/lib/types";

/**
 * Business rules for reserving a class (Task 1 §7.1.1, "Booking Service").
 *
 * Every function takes the session as a parameter rather than reading it
 * itself, so there is no dependency on `next/headers` and the rules can be
 * tested directly (see tests/api.test.ts) — only the API routes and the
 * server actions need a real request to resolve the session.
 */
export interface BookingResult {
  ok: boolean;
  status: number;
  error?: string;
  slot?: TimetableSlot;
  booking?: Booking;
}

export interface MyBookings {
  /** Confirmed sessions that have not started yet. */
  upcoming: Booking[];
  /** Everything else: completed, cancelled, failed and missed. */
  past: Booking[];
}

const MAX_ID = 2_147_483_647; // Postgres INTEGER

function isValidId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id <= MAX_ID;
}

const NOT_FOUND_CLASS = "That class could not be found.";
const NOT_FOUND_BOOKING = "That booking could not be found.";

export async function createBooking(
  session: SessionUser,
  classId: number,
  now: Date = new Date(),
): Promise<BookingResult> {
  // A booking belongs to a Member row, which coaches and admins do not have.
  if (!isMemberRole(session.role)) {
    return { ok: false, status: 403, error: "Only members can book classes." };
  }

  if (!isValidId(classId)) {
    return { ok: false, status: 400, error: "slotId must be a positive integer." };
  }

  try {
    const result = await insertBooking(session.id, classId, now);

    if (!result.ok) {
      switch (result.reason) {
        case "class-not-found":
          return { ok: false, status: 404, error: NOT_FOUND_CLASS };
        case "no-plan":
          return {
            ok: false,
            status: 403,
            error: "An active membership plan is required to book a class.",
          };
        case "duplicate":
          return {
            ok: false,
            status: 409,
            error: "You are already booked into this class.",
          };
        case "full":
          return {
            ok: false,
            status: 409,
            error: `${result.className} at ${result.startsAt} is fully booked.`,
          };
      }
    }

    // Told after the response, and only once the booking is committed.
    notifyBookingConfirmed(session, result.booking);

    return {
      ok: true,
      status: 201,
      slot: await getSlot(classId, now),
      booking: result.booking,
    };
  } catch (e) {
    const error = mapPrismaError(e);
    return { ok: false, status: error.status, error: error.message };
  }
}

export async function cancelBooking(
  session: SessionUser,
  bookingId: number,
  now: Date = new Date(),
): Promise<BookingResult> {
  if (!isValidId(bookingId)) {
    return {
      ok: false,
      status: 400,
      error: "bookingId must be a positive integer.",
    };
  }

  // Staff hold no bookings, so for them every id is "not found" — the same
  // answer a member gets for someone else's booking.
  if (!isMemberRole(session.role)) {
    return { ok: false, status: 404, error: NOT_FOUND_BOOKING };
  }

  try {
    const result = await cancelRow(session.id, bookingId, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return { ok: false, status: 404, error: NOT_FOUND_BOOKING };
        case "not-confirmed":
          return {
            ok: false,
            status: 409,
            error: "Only a confirmed booking can be cancelled.",
          };
        case "started":
          return {
            ok: false,
            status: 409,
            error: "This class has already started.",
          };
      }
    }

    return { ok: true, status: 200, booking: result.booking };
  } catch (e) {
    const error = mapPrismaError(e);
    return { ok: false, status: error.status, error: error.message };
  }
}

/**
 * The signed-in member's bookings: upcoming soonest first, past newest first.
 *
 * A Confirmed booking whose session date has passed is shown as Completed.
 * That is worked out here on every read; the stored row is left alone, so a
 * coach can still mark it NoShow afterwards.
 */
export async function listMyBookings(
  session: SessionUser,
  now: Date = new Date(),
): Promise<MyBookings> {
  if (!isMemberRole(session.role)) return { upcoming: [], past: [] };

  const upcoming: Booking[] = [];
  const past: Booking[] = [];

  for (const booking of await listForMember(session.id)) {
    const sessionDate = new Date(`${booking.sessionDate}T00:00:00.000Z`);
    const started = hasSessionStarted(sessionDate, booking.startsAt, now);
    const datePassed = hasSessionStarted(sessionDate, "24:00", now);

    if (booking.status === "Confirmed" && !started) {
      upcoming.push(booking);
    } else if (booking.status === "Confirmed" && datePassed) {
      past.push({ ...booking, status: "Completed" });
    } else {
      past.push(booking);
    }
  }

  // The repository returns newest first, which suits the past list. Upcoming
  // reads the other way: the class you are going to next comes first.
  upcoming.sort(
    (a, b) =>
      a.sessionDate.localeCompare(b.sessionDate) ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.id - b.id,
  );

  return { upcoming, past };
}
