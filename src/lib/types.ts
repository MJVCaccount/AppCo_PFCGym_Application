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

export type Availability = "Pending" | "Accepted" | "Declined";

export type BoutResult = "Win" | "Loss" | "Draw" | "NoContest";

export const BOUT_RESULTS: readonly BoutResult[] = [
  "Win",
  "Loss",
  "Draw",
  "NoContest",
];

export type EventStatus = "Scheduled" | "Completed" | "Cancelled";

/** A member who competes. The id is the member's (and the user's) id. */
export interface Fighter {
  id: number;
  fullName: string;
  weightClass: string;
  wins: number;
  losses: number;
  draws: number;
  imageUrl: string | null;
}

/** A competition the gym's fighters can be offered bouts at. */
export interface CompetitionEvent {
  id: number;
  name: string;
  /** ISO-8601 UTC instant. Show it with formatEventDate. */
  eventDate: string;
  venue: string;
  description: string;
  imageUrl: string | null;
  status: EventStatus;
}

/** One fighter's bout offer for one event, with the answer and the result. */
export interface BoutOffer {
  id: number;
  fighterId: number;
  fighterName: string;
  eventId: number;
  eventName: string;
  /** ISO-8601 UTC instant. */
  eventDate: string;
  venue: string;
  eventStatus: EventStatus;
  availability: Availability;
  opponentName: string | null;
  boutWeightClass: string | null;
  boutNotes: string | null;
  result: BoutResult | null;
  resultNotes: string | null;
  /** ISO-8601 UTC instant. */
  offeredAt: string;
  respondedAt: string | null;
}

/** A fighter's offers, grouped the way the dashboard shows them. */
export interface FighterOffers {
  fighter: Fighter;
  /** Unanswered, for an event that is still to come. */
  pending: BoutOffer[];
  /** Accepted, for an event that is still to come. */
  accepted: BoutOffer[];
  /** Declined, for an event that is still to come, so it can be changed. */
  declined: BoutOffer[];
  /** Every offer whose event has happened or was cancelled, newest first. */
  past: BoutOffer[];
}

/**
 * What every fighter and event service function returns: `status` is the HTTP
 * status the result maps to, and `error` is safe to show to the user. `field`
 * names the input the error is about, when there is one, so a form can show
 * the message next to it.
 */
export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  field?: string;
  data?: T;
}

// ---------------------------------------------------------------- admin

export const CLASS_KINDS: readonly ClassKind[] = [
  "Group",
  "Private",
  "Kids",
  "Fighters",
];

/** A scheduled class as the admin screens see it, active or not. */
export interface AdminClass {
  id: number;
  name: string;
  kind: ClassKind;
  coachId: number;
  coachName: string;
  day: DayKey;
  /** 24-hour "HH:mm". */
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  programmeId: number | null;
  isActive: boolean;
  /** Confirmed bookings for the next session. */
  booked: number;
  /** Confirmed bookings for every session that has not started yet. */
  futureBookings: number;
  /** Whether any booking, of any status, was ever made for this class. */
  hasBookings: boolean;
}

/** A catalogue programme as the admin screens see it, active or not. */
export interface AdminProgramme extends GymClass {
  isActive: boolean;
}

/** A coach as the admin screens see them, archived or not. */
export interface AdminCoach {
  id: number;
  name: string;
  email: string;
  title: string;
  bio: string;
  imageUrl: string | null;
  isActive: boolean;
  /** Active classes this coach teaches. */
  activeClasses: number;
}

export interface AdminPlan extends MembershipPlan {
  isActive: boolean;
  /** Active accounts currently on this plan. */
  activeMembers: number;
}

/** One row of the admin account list. Never carries a password hash or salt. */
export interface MemberListItem {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  planId: number | null;
}

export interface MemberPage {
  items: MemberListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** A member who can be promoted, for a dropdown. */
export interface MemberOption {
  id: number;
  fullName: string;
  email: string;
}

export interface AdminFighter extends Fighter {
  /** False while the fighter has bout offers or documents. */
  canDemote: boolean;
}

export interface EventDetail {
  event: CompetitionEvent;
  offers: BoutOffer[];
}

export interface AuditLogRow {
  id: number;
  /** ISO-8601 UTC instant. */
  createdAt: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: number | null;
}

// ---------------------------------------------------------------- coach

export type AttendanceStatus = "Completed" | "NoShow";

/** One of a coach's classes, with the date its roster link should open. */
export interface CoachClass extends TimetableSlot {
  /** ISO date: today when the class runs today, otherwise its next session. */
  rosterDate: string;
}

export interface RosterEntry {
  bookingId: number;
  memberName: string;
  status: BookingStatus;
}

export interface Roster {
  classId: number;
  className: string;
  coachName: string;
  day: DayKey;
  startsAt: string;
  /** ISO date, "YYYY-MM-DD". */
  sessionDate: string;
  /** False for a date that is still to come on the gym's calendar. */
  canMark: boolean;
  entries: RosterEntry[];
}

export interface AttendanceStats {
  attended: number;
  noShow: number;
  /** attended / (attended + noShow), or null when nothing is recorded. */
  rate: number | null;
}

export interface MemberStats {
  attendedThisMonth: number;
  upcoming: number;
  /** ISO-8601 UTC instant the current plan started, or null with no plan. */
  planStartedAt: string | null;
}

// ---------------------------------------------------------------- helpers

/** "3-1-0": wins, losses, draws. */
export function formatRecord(fighter: {
  wins: number;
  losses: number;
  draws: number;
}): string {
  return `${fighter.wins}-${fighter.losses}-${fighter.draws}`;
}

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
