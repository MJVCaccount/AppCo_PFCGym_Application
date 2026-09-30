/**
 * Domain types for the PFC site.
 *
 * These mirror the shape the database will take in Part 2, so swapping the
 * in-memory data module for Prisma or Drizzle queries means changing
 * `gym-data.ts` and `users.ts` only — nothing in a page or component.
 */

export type Role = "Member" | "Coach" | "Admin";

export const ROLES = {
  Member: "Member",
  Coach: "Coach",
  Admin: "Admin",
} as const;

/** Monday = 1 … Sunday = 7, matching ISO-8601 so sorting is natural. */
export type DayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export const DAY_ORDER: DayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const DAY_NAMES: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** A training class offered by the gym. */
export interface GymClass {
  id: number;
  name: string;
  /** Doubles as the image filename: `/images/class-{slug}.jpg`. */
  slug: string;
  description: string;
  level: string;
  durationMinutes: number;
}

/** A member of the coaching team. */
export interface Coach {
  id: number;
  name: string;
  role: string;
  bio: string;
}

/** A monthly membership tier. */
export interface MembershipPlan {
  id: number;
  pricePerMonth: number;
  isMostPopular: boolean;
  features: string[];
}

/** A single scheduled class on the weekly timetable. */
export interface TimetableSlot {
  id: number;
  day: DayKey;
  /** 24-hour "HH:mm". */
  startsAt: string;
  durationMinutes: number;
  className: string;
  coachName: string;
  capacity: number;
  booked: number;
}

/** A published member review. */
export interface Review {
  id: number;
  memberName: string;
  body: string;
  rating: number;
  /** ISO date, "YYYY-MM-DD". */
  postedOn: string;
}

/** One day's opening hours. */
export interface OpeningHours {
  day: DayKey;
  /** Hour of the day, 0–23. */
  opens: number;
  closes: number;
}

/** An account. `passwordHash`/`passwordSalt` never leave the server. */
export interface AppUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  /** Null for coaches and admins — they are staff, not members. */
  planId: number | null;
  passwordHash: string;
  passwordSalt: string;
}

/** What the signed session cookie carries. Deliberately small. */
export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

// ---------------------------------------------------------------- helpers

export function isFull(slot: TimetableSlot): boolean {
  return slot.booked >= slot.capacity;
}

export function spacesLeft(slot: TimetableSlot): number {
  return Math.max(0, slot.capacity - slot.booked);
}

/** "Marcus Thompson" -> "MT". Used where no photograph exists. */
export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function formatHours(hours: OpeningHours): string {
  const pad = (h: number) => String(h).padStart(2, "0");
  return `${pad(hours.opens)}:00 – ${pad(hours.closes)}:00`;
}

/**
 * Rands, no decimals and no thousands separator: 1050 -> "1050".
 *
 * Deliberately not toLocaleString: en-ZA groups with a space ("1 050"), and
 * because prices render in client components too, any difference between the
 * server's ICU data and the browser's would surface as a hydration mismatch.
 * A plain integer is identical everywhere and matches the original design.
 */
export function formatPrice(amount: number): string {
  return String(Math.round(amount));
}

/** "2 years ago" from an ISO date. */
export function timeAgo(isoDate: string, now = new Date()): string {
  const then = new Date(isoDate);
  const months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    (now.getMonth() - then.getMonth());

  if (months < 1) return "This month";
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** JS getDay() is Sunday-first; the site is Monday-first. */
export function todayKey(now = new Date()): DayKey {
  const map: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[now.getDay()];
}

/**
 * Next hands search params as `string | string[] | undefined`, because a URL
 * may repeat a key (`?day=mon&day=tue`). Pages want one value, so take the
 * first and treat anything else as absent.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
