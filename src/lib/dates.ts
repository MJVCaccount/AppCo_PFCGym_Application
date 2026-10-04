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

/** "YYYY-MM-DD" for a date-only value (UTC midnight, as a DATE column reads). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
