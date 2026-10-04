import "server-only";

import {
  currentDayAndHour,
  dayOfDate,
  gymDateAndTime,
  isoDate,
  nextOccurrence,
  parseIsoDate,
} from "@/lib/dates";
import {
  countAttendance,
  getClassOwner,
  getMemberStats,
  listRoster,
  markAttendance as markRow,
} from "@/lib/repositories/attendanceRepository";
import {
  getSlotsForCoach,
  getTimetable,
} from "@/lib/repositories/timetableRepository";
import {
  fail,
  failure,
  isAdmin,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import {
  type AttendanceStats,
  type CoachClass,
  DAY_NAMES,
  type MemberStats,
  ROLES,
  type Roster,
  type RosterEntry,
  type ServiceResult,
  type SessionUser,
} from "@/lib/types";

/**
 * Business rules for a coach's classes, rosters and attendance.
 *
 * A coach works with their own classes only: someone else's class or booking
 * answers 404, never 403, so ids cannot be probed. An admin sees every class.
 * A coach's user id is their coach id.
 */

const STAFF_ONLY = "Only coaches and administrators can do that.";
const NOT_FOUND_CLASS = "That class could not be found.";
const NOT_FOUND_BOOKING = "That booking could not be found.";
const STATS_DAYS = 30;

function isStaff(session: SessionUser): boolean {
  return session.role === ROLES.Coach || isAdmin(session);
}

/** The coach id a session is limited to, or null for an admin (no limit). */
function coachScope(session: SessionUser): number | null {
  return isAdmin(session) ? null : session.id;
}

/** A coach's own active classes; every active class for an admin. */
export async function getMyClasses(
  session: SessionUser,
  now: Date = new Date(),
): Promise<ServiceResult<CoachClass[]>> {
  if (!isStaff(session)) return fail(403, STAFF_ONLY);

  try {
    const slots = isAdmin(session)
      ? await getTimetable(now)
      : await getSlotsForCoach(session.id, now);

    const today = currentDayAndHour(now).day;
    const todayDate = gymDateAndTime(now).date;

    return succeed(
      slots.map((slot) => ({
        ...slot,
        // Today's class links to today's roster even once it has started,
        // which is exactly when attendance is taken.
        rosterDate: isoDate(
          slot.day === today
            ? todayDate
            : nextOccurrence(slot.day, slot.startsAt, now),
        ),
      })),
    );
  } catch (e) {
    return failure(e);
  }
}

/** Who holds a place on one dated session of a class. */
export async function getRoster(
  session: SessionUser,
  classId: unknown,
  sessionDate: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<Roster>> {
  if (!isStaff(session)) return fail(403, STAFF_ONLY);
  if (!isValidId(classId)) {
    return fail(400, "classId must be a positive integer.");
  }

  const date = parseIsoDate(sessionDate);
  if (!date) return fail(400, "Date must be a real date as YYYY-MM-DD.");

  try {
    const gymClass = await getClassOwner(classId);
    const scope = coachScope(session);

    if (!gymClass || (scope !== null && gymClass.coachId !== scope)) {
      return fail(404, NOT_FOUND_CLASS);
    }

    // After the ownership check, so a date cannot be used to probe class ids.
    if (dayOfDate(date) !== gymClass.day) {
      return fail(
        400,
        `That class meets on ${DAY_NAMES[gymClass.day]}s, so ${isoDate(date)} is not a session date.`,
        "date",
      );
    }

    return succeed({
      classId: gymClass.id,
      className: gymClass.name,
      coachName: gymClass.coachName,
      day: gymClass.day,
      startsAt: gymClass.startsAt,
      sessionDate: isoDate(date),
      canMark: date <= gymDateAndTime(now).date,
      entries: await listRoster(classId, date),
    });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Records that a member attended or did not show.
 *
 * Allowed from Confirmed, Completed or NoShow, so a coach can correct a
 * mistake, and only once the session's date has arrived on the gym's clock.
 */
export async function markAttendance(
  session: SessionUser,
  bookingId: unknown,
  status: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<RosterEntry & { classId: number; sessionDate: string }>> {
  if (!isStaff(session)) return fail(403, STAFF_ONLY);
  if (!isValidId(bookingId)) {
    return fail(400, "bookingId must be a positive integer.");
  }
  if (status !== "Completed" && status !== "NoShow") {
    return fail(400, 'status must be "Completed" or "NoShow".');
  }

  try {
    const result = await markRow(
      bookingId,
      status,
      coachScope(session),
      session.id,
      now,
    );

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_BOOKING);
        case "not-happened":
          return fail(409, "That class has not happened yet.");
        case "not-markable":
          return fail(
            409,
            "Attendance cannot be recorded for a cancelled or failed booking.",
          );
      }
    }

    return succeed({
      ...result.entry,
      classId: result.classId,
      sessionDate: isoDate(result.sessionDate),
    });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Recorded attendance for the last 30 days: the coach's own classes, or every
 * class for an admin. `rate` is null when nothing has been recorded, so the
 * screen can say so instead of showing a made-up figure.
 */
export async function coachStats(
  session: SessionUser,
  now: Date = new Date(),
): Promise<ServiceResult<AttendanceStats>> {
  if (!isStaff(session)) return fail(403, STAFF_ONLY);

  try {
    const { attended, noShow } = await countAttendance(
      coachScope(session),
      STATS_DAYS,
      now,
    );
    const total = attended + noShow;

    return succeed({
      attended,
      noShow,
      rate: total === 0 ? null : attended / total,
    });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Classes attended this calendar month, upcoming bookings and when the plan
 * started. A member may read their own; an admin may read anyone's. Anyone
 * else's id answers 404.
 */
export async function memberStats(
  session: SessionUser,
  memberId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<MemberStats>> {
  if (!isValidId(memberId)) {
    return fail(400, "memberId must be a positive integer.");
  }

  const notFound = fail<MemberStats>(404, "That member could not be found.");
  if (memberId !== session.id && !isAdmin(session)) return notFound;

  try {
    const stats = await getMemberStats(memberId, now);
    return stats ? succeed(stats) : notFound;
  } catch (e) {
    return failure(e);
  }
}
