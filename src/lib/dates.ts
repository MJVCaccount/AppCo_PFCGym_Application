import type { DayKey } from "./types";
import { DAY_ORDER } from "./types";

/**
 * Date helpers that always think in gym-local time.
 *
 * The gym is in South Africa but the server is not: Vercel runs in UTC, so
 * `getDay()` / `getHours()` on the server clock would put a Monday 00:30 class
 * on Sunday. Everything here reads the wall clock through Intl with an
 * explicit time zone instead.
 */

export const GYM_TIME_ZONE = "Africa/Johannesburg";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const gymClock = new Intl.DateTimeFormat("en-US", {
  timeZone: GYM_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface GymMoment {
  day: DayKey;
  /** UTC midnight of the gym-local calendar date. */
  date: Date;
  /** 24-hour "HH:mm". */
  time: string;
}

function gymMoment(now: Date): GymMoment {
  const parts: Record<string, string> = {};
  for (const part of gymClock.formatToParts(now)) {
    parts[part.type] = part.value;
  }

  return {
    day: parts.weekday.toLowerCase() as DayKey,
    date: new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
    ),
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** The gym-local weekday and hour (0–23) at `now`. */
export function currentDayAndHour(now: Date): { day: DayKey; hour: number } {
  const current = gymMoment(now);
  return { day: current.day, hour: Number(current.time.slice(0, 2)) };
}

/**
 * The gym-local calendar date (as UTC midnight, which is how a DATE column
 * reads) and the 24-hour "HH:mm" time at `now`.
 */
export function gymDateAndTime(now: Date): { date: Date; time: string } {
  const current = gymMoment(now);
  return { date: current.date, time: current.time };
}

/** UTC midnight of the first day of the gym-local month `now` falls in. */
export function startOfGymMonth(now: Date): Date {
  const { date } = gymMoment(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** "YYYY-MM-DD" for a date-only value (UTC midnight, as a DATE column reads). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A "YYYY-MM-DD" string as a date-only Date (UTC midnight), or null when it is
 * not text, not in that shape, or not a real calendar day (2026-02-30).
 */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) return null;

  return date;
}

/** The weekday of a date-only value (UTC midnight), as the gym's day key. */
export function dayOfDate(date: Date): DayKey {
  // getUTCDay: Sunday is 0; DAY_ORDER starts on Monday.
  return DAY_ORDER[(date.getUTCDay() + 6) % 7];
}

/** A date-only value moved by a number of days. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

const dateOnlyClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** "Mon 5 Oct 2026" from an ISO date, or an empty string if unreadable. */
export function formatSessionDate(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return "";

  const parts: Record<string, string> = {};
  for (const part of dateOnlyClock.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

// South Africa has no daylight saving, so the gym's offset never changes.
const GYM_UTC_OFFSET = "+02:00";
const GYM_OFFSET_MS = 2 * 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The value of a datetime-local input, read as gym time, as an ISO string
 * with the gym's offset: "2026-11-28T19:00" -> "2026-11-28T19:00:00+02:00".
 * Anything in another shape is returned unchanged for the service to reject.
 */
export function gymLocalToIso(value: string): string {
  const trimmed = value.trim();
  return LOCAL_DATE_TIME.test(trimmed)
    ? `${trimmed}:00${GYM_UTC_OFFSET}`
    : trimmed;
}

/** The reverse: a stored instant as a datetime-local value on the gym's clock. */
export function isoToGymLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Date(date.getTime() + GYM_OFFSET_MS).toISOString().slice(0, 16);
}

const eventClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: GYM_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "Sat 3 Oct 2026, 19:00" on the gym's clock, from a stored UTC instant.
 *
 * Built from parts rather than format(), so the punctuation is the same on
 * every ICU version. An unreadable value comes back as an empty string.
 */
export function formatEventDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const parts: Record<string, string> = {};
  for (const part of eventClock.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** "3 Oct 2026" on the gym's clock, from a stored UTC instant. */
export function formatGymDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const parts: Record<string, string> = {};
  for (const part of eventClock.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return `${parts.day} ${parts.month} ${parts.year}`;
}

/**
 * Whether a dated session has started, on the gym's clock. `sessionDate` is a
 * date-only value as nextOccurrence returns it. A class starting this very
 * minute counts as started, matching nextOccurrence.
 */
export function hasSessionStarted(
  sessionDate: Date,
  startsAt: string,
  now: Date,
): boolean {
  const current = gymMoment(now);
  const today = current.date.getTime();
  const session = sessionDate.getTime();

  if (session !== today) return session < today;
  return current.time >= startsAt;
}

/**
 * The date of the next session of a weekly class, as a date-only Date (UTC
 * midnight of the gym-local calendar day, which is what a Postgres DATE column
 * round-trips through Prisma).
 *
 * A class later today counts as today; one that has already started rolls on
 * to the same day next week.
 */
export function nextOccurrence(day: DayKey, startsAt: string, now: Date): Date {
  const current = gymMoment(now);

  let daysAhead =
    (DAY_ORDER.indexOf(day) - DAY_ORDER.indexOf(current.day) + 7) % 7;
  if (daysAhead === 0 && current.time >= startsAt) daysAhead = 7;

  return new Date(current.date.getTime() + daysAhead * MS_PER_DAY);
}
