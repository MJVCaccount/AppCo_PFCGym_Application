import "server-only";

import type {
  Coach,
  DayKey,
  GymClass,
  MembershipPlan,
  OpeningHours,
  Review,
  TimetableSlot,
} from "./types";
import { DAY_ORDER, isFull, todayKey } from "./types";

/**
 * Seeded content for the front-end deliverable.
 *
 * Every export here is the seam the database will replace in Part 2: turn each
 * function async and query instead of returning the array. Pages already
 * `await` them, so no caller changes.
 */

const classes: GymClass[] = [
  {
    id: 1,
    name: "Boxing",
    slug: "boxing",
    level: "All levels",
    durationMinutes: 60,
    description:
      "Championship level boxing training focusing on technique, power combinations and ring strategy.",
  },
  {
    id: 2,
    name: "MMA Fundamentals",
    slug: "mma",
    level: "Beginner",
    durationMinutes: 60,
    description:
      "Introduction to mixed martial arts covering striking, takedowns and ground control.",
  },
  {
    id: 3,
    name: "Strength & Power",
    slug: "strength",
    level: "Intermediate",
    durationMinutes: 45,
    description:
      "Performance focused strength training designed for combat sports athletes.",
  },
  {
    id: 4,
    name: "Muay Thai",
    slug: "muaythai",
    level: "All levels",
    durationMinutes: 60,
    description:
      "Traditional Thai boxing with all eight limbs: fists, elbows, knees and shins.",
  },
  {
    id: 5,
    name: "Core Conditioning",
    slug: "core",
    level: "All levels",
    durationMinutes: 45,
    description:
      "High-intensity core and conditioning circuits built for combat sport performance.",
  },
  {
    id: 6,
    name: "Submission Grappling",
    slug: "grappling",
    level: "Advanced",
    durationMinutes: 90,
    description:
      "Advanced submission wrestling and Brazilian Jiu-Jitsu ground game mastery.",
  },
];

const coaches: Coach[] = [
  {
    id: 1,
    name: "Marcus Thompson",
    role: "Head boxing coach",
    bio: "Former professional boxer with 3 championship titles. Has trained over 50 amateur champions.",
  },
  {
    id: 2,
    name: "Sofia Erasmus",
    role: "Muay Thai & MMA",
    bio: "Two-time national Muay Thai champion and certified MMA instructor with international fight experience.",
  },
  {
    id: 3,
    name: "Jake Morrison",
    role: "Strength & conditioning",
    bio: "Former Olympic athlete. Has helped hundreds of fighters reach peak physical condition.",
  },
  {
    id: 4,
    name: "Priya Nakamura",
    role: "Recovery & mobility",
    bio: "500-hour RYT with expertise in athletic recovery protocols and movement optimisation.",
  },
  {
    id: 5,
    name: "Leon Baptiste",
    role: "Brazilian Jiu-Jitsu",
    bio: "Black belt under Roger Gracie. Multiple Worlds and Pan-American championship titles.",
  },
  {
    id: 6,
    name: "Maurice Joseph",
    role: "Nutrition",
    bio: "Registered dietitian specialising in combat sports nutrition and body composition.",
  },
];

const plans: MembershipPlan[] = [
  {
    id: 1,
    pricePerMonth: 750,
    isMostPopular: false,
    features: ["All group classes", "Locker room & showers"],
  },
  {
    id: 2,
    pricePerMonth: 900,
    isMostPopular: true,
    features: [
      "All group classes",
      "Locker room & showers",
      "Priority class booking",
      "Nutrition consultation",
    ],
  },
  {
    id: 3,
    pricePerMonth: 1050,
    isMostPopular: false,
    features: [
      "All group classes",
      "Locker room & showers",
      "Priority class booking",
      "Nutrition consultation",
      "Monthly body composition analysis",
    ],
  },
];

const reviews: Review[] = [
  {
    id: 1,
    memberName: "Ryan O'Brian",
    postedOn: "2024-09-01",
    rating: 5,
    body: "PFC completely transformed my fitness. The boxing programme under Marcus is world-class. I went from zero experience to competing in my first amateur bout in 8 months.",
  },
  {
    id: 2,
    memberName: "Keisha Williams",
    postedOn: "2023-09-01",
    rating: 5,
    body: "The coaches here are exceptional. Sofia's Muay Thai classes are intense, technical and incredibly rewarding. The community keeps you accountable every single day.",
  },
  {
    id: 3,
    memberName: "Daniel Park",
    postedOn: "2025-09-01",
    rating: 5,
    body: "Best investment I've ever made. The facility is pristine, the equipment is top-tier and the atmosphere is electric. Leon's BJJ coaching alone is worth the membership price.",
  },
  {
    id: 4,
    memberName: "Amara Santos",
    postedOn: "2025-10-01",
    rating: 5,
    body: "I lost 24kg and gained confidence I never knew I had. Nutrition coaching alongside the training programme changed my life.",
  },
];

const openingHours: OpeningHours[] = [
  { day: "mon", opens: 8, closes: 21 },
  { day: "tue", opens: 8, closes: 21 },
  { day: "wed", opens: 8, closes: 21 },
  { day: "thu", opens: 8, closes: 21 },
  { day: "fri", opens: 8, closes: 20 },
  { day: "sat", opens: 9, closes: 20 },
  { day: "sun", opens: 10, closes: 19 },
];

const timetable: TimetableSlot[] = [
  { id: 1,  day: "mon", startsAt: "06:30", durationMinutes: 60, className: "Elite Boxing",         coachName: "Marcus Thompson", capacity: 20, booked: 12 },
  { id: 2,  day: "mon", startsAt: "12:00", durationMinutes: 45, className: "Core Conditioning",    coachName: "Jake Morrison",   capacity: 24, booked: 9 },
  { id: 3,  day: "mon", startsAt: "17:30", durationMinutes: 60, className: "MMA Fundamentals",     coachName: "Sofia Erasmus",   capacity: 18, booked: 15 },
  { id: 4,  day: "mon", startsAt: "19:00", durationMinutes: 90, className: "Submission Grappling", coachName: "Leon Baptiste",   capacity: 16, booked: 16 },
  { id: 5,  day: "tue", startsAt: "09:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 7 },
  { id: 6,  day: "tue", startsAt: "13:00", durationMinutes: 45, className: "Strength & Power",     coachName: "Jake Morrison",   capacity: 16, booked: 10 },
  { id: 7,  day: "tue", startsAt: "18:00", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 14 },
  { id: 8,  day: "wed", startsAt: "09:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 6 },
  { id: 9,  day: "wed", startsAt: "12:00", durationMinutes: 45, className: "Core Conditioning",    coachName: "Jake Morrison",   capacity: 24, booked: 11 },
  { id: 10, day: "wed", startsAt: "17:30", durationMinutes: 90, className: "BJJ Open Mat",         coachName: "Leon Baptiste",   capacity: 16, booked: 8 },
  { id: 11, day: "wed", startsAt: "20:00", durationMinutes: 60, className: "Elite Boxing",         coachName: "Marcus Thompson", capacity: 20, booked: 13 },
  { id: 12, day: "thu", startsAt: "06:30", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 9 },
  { id: 13, day: "thu", startsAt: "17:00", durationMinutes: 45, className: "Mobility & Recovery",  coachName: "Priya Nakamura",  capacity: 22, booked: 5 },
  { id: 14, day: "thu", startsAt: "18:30", durationMinutes: 60, className: "MMA Fundamentals",     coachName: "Sofia Erasmus",   capacity: 18, booked: 12 },
  { id: 15, day: "fri", startsAt: "12:00", durationMinutes: 45, className: "Strength & Power",     coachName: "Jake Morrison",   capacity: 16, booked: 8 },
  { id: 16, day: "fri", startsAt: "17:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 16 },
  { id: 17, day: "fri", startsAt: "19:00", durationMinutes: 90, className: "Submission Grappling", coachName: "Leon Baptiste",   capacity: 16, booked: 7 },
  { id: 18, day: "sat", startsAt: "09:00", durationMinutes: 90, className: "Open Mat",             coachName: "Leon Baptiste",   capacity: 24, booked: 10 },
  { id: 19, day: "sat", startsAt: "11:00", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 6 },
  { id: 20, day: "sun", startsAt: "10:30", durationMinutes: 45, className: "Mobility & Recovery",  coachName: "Priya Nakamura",  capacity: 22, booked: 4 },
];

// ---------------------------------------------------------------- reads

export function getClasses(): GymClass[] {
  return classes;
}

export function getClass(slug: string): GymClass | undefined {
  return classes.find((c) => c.slug === slug.toLowerCase());
}

export function getCoaches(): Coach[] {
  return coaches;
}

export function getCoachByName(name: string): Coach | undefined {
  return coaches.find((c) => c.name === name);
}

export function getPlans(): MembershipPlan[] {
  return plans;
}

export function getPlan(id: number): MembershipPlan | undefined {
  return plans.find((p) => p.id === id);
}

export function getCheapestPlanPrice(): number {
  return Math.min(...plans.map((p) => p.pricePerMonth));
}

export function getReviews(): Review[] {
  return reviews;
}

export function getOpeningHours(): OpeningHours[] {
  return openingHours;
}

export function getHoursFor(day: DayKey): OpeningHours {
  return openingHours.find((h) => h.day === day)!;
}

export function isOpenAt(moment = new Date()): boolean {
  const hours = getHoursFor(todayKey(moment));
  const hour = moment.getHours();
  return hour >= hours.opens && hour < hours.closes;
}

export function getTimetable(): TimetableSlot[] {
  return timetable;
}

export function getSlotsFor(day: DayKey): TimetableSlot[] {
  return timetable
    .filter((s) => s.day === day)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function getSlot(id: number): TimetableSlot | undefined {
  return timetable.find((s) => s.id === id);
}

export function getSlotsForCoach(coachName: string): TimetableSlot[] {
  return timetable
    .filter((s) => s.coachName === coachName)
    .sort(
      (a, b) =>
        DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
        a.startsAt.localeCompare(b.startsAt),
    );
}

/** The next class with a free place, searching forward from today. */
export function getNextAvailableSlot(now = new Date()): TimetableSlot | undefined {
  const today = DAY_ORDER.indexOf(todayKey(now));

  return timetable
    .filter((s) => !isFull(s))
    .sort((a, b) => {
      const aDays = (DAY_ORDER.indexOf(a.day) - today + 7) % 7;
      const bDays = (DAY_ORDER.indexOf(b.day) - today + 7) % 7;
      return aDays - bDays || a.startsAt.localeCompare(b.startsAt);
    })[0];
}

// ---------------------------------------------------------------- writes

/**
 * Reserve a place. Returns why it failed, or null on success.
 *
 * This mutates the module-level array, so a booking survives navigation but
 * not a server restart. Part 2 replaces it with a transaction that re-checks
 * capacity inside the write, which is what stops two members taking the last
 * place at the same moment.
 */
export function bookSlot(id: number): string | null {
  const slot = getSlot(id);

  if (!slot) return "That class could not be found.";
  if (isFull(slot)) {
    return `${slot.className} at ${slot.startsAt} is fully booked.`;
  }

  slot.booked += 1;
  return null;
}
