import "server-only";

import { hasSessionStarted } from "@/lib/dates";
import {
  cancelBooking as cancelRow,
  createBooking as insertBooking,
  listForMember,
} from "@/lib/repositories/bookingsRepository";
import { getSlot } from "@/lib/repositories/timetableRepository";
import { notifyBookingConfirmed } from "@/lib/services/notificationService";
import {
  fail,
  failure,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import {
  type Booking,
  isMemberRole,
  type ServiceResult,
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
export interface BookedClass {
  /** The class as it stands after the booking; undefined if it was removed in between. */
  slot: TimetableSlot | undefined;
  booking: Booking;
}

export interface MyBookings {
  /** Confirmed sessions that have not started yet. */
  upcoming: Booking[];
  /** Everything else: completed, cancelled, failed and missed. */
  past: Booking[];
}

const NOT_FOUND_CLASS = "That class could not be found.";
const NOT_FOUND_BOOKING = "That booking could not be found.";

export async function createBooking(
  session: SessionUser,
  classId: number,
  now: Date = new Date(),
): Promise<ServiceResult<BookedClass>> {
  // A booking belongs to a Member row, which coaches and admins do not have.
  if (!isMemberRole(session.role)) {
    return fail(403, "Only members can book classes.");
  }

  if (!isValidId(classId)) {
    return fail(400, "slotId must be a positive integer.");
  }

  try {
    const result = await insertBooking(session.id, classId, now);

    if (!result.ok) {
      switch (result.reason) {
        case "class-not-found":
          return fail(404, NOT_FOUND_CLASS);
        case "no-plan":
          return fail(403, "An active membership plan is required to book a class.");
        case "duplicate":
          return fail(409, "You are already booked into this class.");
        case "full":
          return fail(409, `${result.className} at ${result.startsAt} is fully booked.`);
      }
    }

    // Told after the response, and only once the booking is committed.
    notifyBookingConfirmed(session, result.booking);

    return succeed(
      { slot: await getSlot(classId, now), booking: result.booking },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

export async function cancelBooking(
  session: SessionUser,
  bookingId: number,
  now: Date = new Date(),
): Promise<ServiceResult<Booking>> {
  if (!isValidId(bookingId)) {
    return fail(400, "bookingId must be a positive integer.");
  }

  // Staff hold no bookings, so for them every id is "not found" — the same
  // answer a member gets for someone else's booking.
  if (!isMemberRole(session.role)) return fail(404, NOT_FOUND_BOOKING);

  try {
    const result = await cancelRow(session.id, bookingId, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_BOOKING);
        case "not-confirmed":
          return fail(409, "Only a confirmed booking can be cancelled.");
        case "started":
          return fail(409, "This class has already started.");
      }
    }

    return succeed(result.booking);
  } catch (e) {
    return failure(e);
  }
}

/** listMyBookings as a result: staff hold no bookings, so for them it is a 403. */
export async function getMyBookings(
  session: SessionUser,
  now: Date = new Date(),
): Promise<ServiceResult<MyBookings>> {
  if (!isMemberRole(session.role)) return fail(403, "Only members have bookings.");

  try {
    return succeed(await listMyBookings(session, now));
  } catch (e) {
    return failure(e);
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
