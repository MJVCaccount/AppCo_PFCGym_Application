/**
 * Domain types for the PFC site.
 *
 * These are the plain shapes the repositories hand to pages and components:
 * strings, numbers, booleans and arrays only, so every one of them can cross
 * to a client component. Dates travel as ISO strings.
 */

export type Role = "Member" | "Fighter" | "Coach" | "Admin";

export const ROLES = {
  Member: "Member",
  Fighter: "Fighter",
  Coach: "Coach",
  Admin: "Admin",
} as const;

/** A fighter is a member with a fight record, so both hold a membership. */
export function isMemberRole(role: Role): boolean {
  return role === ROLES.Member || role === ROLES.Fighter;
}

export type ClassKind = "Group" | "Private" | "Kids" | "Fighters";

export type BookingStatus =
  | "Pending"
  | "Confirmed"
  | "Failed"
  | "Completed"
  | "Cancelled"
  | "NoShow";

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
  /** Confirmed bookings for the class's next session. */
  booked: number;
  coachId?: number;
  kind?: ClassKind;
}

/** A member's reservation for one dated session of a class. */
export interface Booking {
  id: number;
  classId: number;
  className: string;
  coachName: string;
  day: DayKey;
  /** 24-hour "HH:mm". */
  startsAt: string;
  /** ISO date, "YYYY-MM-DD". */
  sessionDate: string;
  status: BookingStatus;
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

/** An account as the repositories return it: no password hash or salt. */
export interface UserAccount {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  /** Null for staff, and for a member with no current plan. */
  planId: number | null;
  isActive: boolean;
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
