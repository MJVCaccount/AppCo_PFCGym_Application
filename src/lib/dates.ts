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
