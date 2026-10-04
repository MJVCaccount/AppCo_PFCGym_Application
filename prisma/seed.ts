/**
 * Database seed. Safe to run repeatedly: every row is upserted on a natural
 * key (email, slug, day, coach + day + time) or a fixed id, so a second run
 * updates in place and never duplicates.
 *
 * This file is the source of the demo content: the catalogue, the demo
 * accounts and the timetable with its booked counts.
 *
 * Run with: npx prisma db seed
 */
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import type { Day, Role } from "@prisma/client";

import {
  addDays,
  gymDateAndTime,
  isoDate,
  nextOccurrence,
} from "../src/lib/dates";
import { hashPassword } from "../src/lib/password";
import { checkSeedTarget } from "./seedGuard";

const prisma = new PrismaClient();

// ---------------------------------------------------------------- data

const plans = [
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

const programmes = [
  {
    name: "Boxing",
    slug: "boxing",
    level: "All levels",
    durationMinutes: 60,
    description:
      "Championship level boxing training focusing on technique, power combinations and ring strategy.",
  },
  {
    name: "MMA Fundamentals",
    slug: "mma",
    level: "Beginner",
    durationMinutes: 60,
    description:
      "Introduction to mixed martial arts covering striking, takedowns and ground control.",
  },
  {
    name: "Strength & Power",
    slug: "strength",
    level: "Intermediate",
    durationMinutes: 45,
    description:
      "Performance focused strength training designed for combat sports athletes.",
  },
  {
    name: "Muay Thai",
    slug: "muaythai",
    level: "All levels",
    durationMinutes: 60,
    description:
      "Traditional Thai boxing with all eight limbs: fists, elbows, knees and shins.",
  },
  {
    name: "Core Conditioning",
    slug: "core",
    level: "All levels",
    durationMinutes: 45,
    description:
      "High-intensity core and conditioning circuits built for combat sport performance.",
  },
  {
    name: "Submission Grappling",
    slug: "grappling",
    level: "Advanced",
    durationMinutes: 90,
    description:
      "Advanced submission wrestling and Brazilian Jiu-Jitsu ground game mastery.",
  },
];

const openingHours: { day: Day; opens: number; closes: number }[] = [
  { day: "mon", opens: 8, closes: 21 },
  { day: "tue", opens: 8, closes: 21 },
  { day: "wed", opens: 8, closes: 21 },
  { day: "thu", opens: 8, closes: 21 },
  { day: "fri", opens: 8, closes: 20 },
  { day: "sat", opens: 9, closes: 20 },
  { day: "sun", opens: 10, closes: 19 },
];

const reviews = [
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

/** `password: null` means a random one nobody knows: reset to log in. */
const coaches: {
  email: string;
  name: string;
  title: string;
  bio: string;
  password: string | null;
}[] = [
  {
    email: "marcus@pfc.co.za",
    name: "Marcus Thompson",
    title: "Head boxing coach",
    bio: "Former professional boxer with 3 championship titles. Has trained over 50 amateur champions.",
    password: "Coach123!",
  },
  {
    email: "sofia@pfc.co.za",
    name: "Sofia Erasmus",
    title: "Muay Thai & MMA",
    bio: "Two-time national Muay Thai champion and certified MMA instructor with international fight experience.",
    password: "Coach123!",
  },
  {
    email: "jake@pfc.co.za",
    name: "Jake Morrison",
    title: "Strength & conditioning",
    bio: "Former Olympic athlete. Has helped hundreds of fighters reach peak physical condition.",
    password: null,
  },
  {
    email: "priya@pfc.co.za",
    name: "Priya Nakamura",
    title: "Recovery & mobility",
    bio: "500-hour RYT with expertise in athletic recovery protocols and movement optimisation.",
    password: null,
  },
  {
    email: "leon@pfc.co.za",
    name: "Leon Baptiste",
    title: "Brazilian Jiu-Jitsu",
    bio: "Black belt under Roger Gracie. Multiple Worlds and Pan-American championship titles.",
    password: null,
  },
  {
    email: "maurice@pfc.co.za",
    name: "Maurice Joseph",
    title: "Nutrition",
    bio: "Registered dietitian specialising in combat sports nutrition and body composition.",
    password: null,
  },
];

const timetable: {
  day: Day;
  startsAt: string;
  durationMinutes: number;
  className: string;
  coachName: string;
  capacity: number;
  booked: number;
}[] = [
  { day: "mon", startsAt: "06:30", durationMinutes: 60, className: "Elite Boxing",         coachName: "Marcus Thompson", capacity: 20, booked: 12 },
  { day: "mon", startsAt: "12:00", durationMinutes: 45, className: "Core Conditioning",    coachName: "Jake Morrison",   capacity: 24, booked: 9 },
  { day: "mon", startsAt: "17:30", durationMinutes: 60, className: "MMA Fundamentals",     coachName: "Sofia Erasmus",   capacity: 18, booked: 15 },
  { day: "mon", startsAt: "19:00", durationMinutes: 90, className: "Submission Grappling", coachName: "Leon Baptiste",   capacity: 16, booked: 16 },
  { day: "tue", startsAt: "09:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 7 },
  { day: "tue", startsAt: "13:00", durationMinutes: 45, className: "Strength & Power",     coachName: "Jake Morrison",   capacity: 16, booked: 10 },
  { day: "tue", startsAt: "18:00", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 14 },
  { day: "wed", startsAt: "09:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 6 },
  { day: "wed", startsAt: "12:00", durationMinutes: 45, className: "Core Conditioning",    coachName: "Jake Morrison",   capacity: 24, booked: 11 },
  { day: "wed", startsAt: "17:30", durationMinutes: 90, className: "BJJ Open Mat",         coachName: "Leon Baptiste",   capacity: 16, booked: 8 },
  { day: "wed", startsAt: "20:00", durationMinutes: 60, className: "Elite Boxing",         coachName: "Marcus Thompson", capacity: 20, booked: 13 },
  { day: "thu", startsAt: "06:30", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 9 },
  { day: "thu", startsAt: "17:00", durationMinutes: 45, className: "Mobility & Recovery",  coachName: "Priya Nakamura",  capacity: 22, booked: 5 },
  { day: "thu", startsAt: "18:30", durationMinutes: 60, className: "MMA Fundamentals",     coachName: "Sofia Erasmus",   capacity: 18, booked: 12 },
  { day: "fri", startsAt: "12:00", durationMinutes: 45, className: "Strength & Power",     coachName: "Jake Morrison",   capacity: 16, booked: 8 },
  { day: "fri", startsAt: "17:30", durationMinutes: 60, className: "Muay Thai",            coachName: "Sofia Erasmus",   capacity: 20, booked: 16 },
  { day: "fri", startsAt: "19:00", durationMinutes: 90, className: "Submission Grappling", coachName: "Leon Baptiste",   capacity: 16, booked: 7 },
  { day: "sat", startsAt: "09:00", durationMinutes: 90, className: "Open Mat",             coachName: "Leon Baptiste",   capacity: 24, booked: 10 },
  { day: "sat", startsAt: "11:00", durationMinutes: 60, className: "Boxing",               coachName: "Marcus Thompson", capacity: 20, booked: 6 },
  { day: "sun", startsAt: "10:30", durationMinutes: 45, className: "Mobility & Recovery",  coachName: "Priya Nakamura",  capacity: 22, booked: 4 },
];

const FILLER_COUNT = 24;
/**
 * 19:00 Johannesburg time, `days` calendar days from today on the gym's clock.
 * Built from the gym's date, not the clock time of the seed run, so the demo
 * events always show a sensible evening start. South Africa has no daylight
 * saving, so +02:00 is always right.
 */
function eveningEvent(now: Date, days: number): Date {
  const day = addDays(gymDateAndTime(now).date, days);
  return new Date(`${isoDate(day)}T19:00:00+02:00`);
}

// ---------------------------------------------------------------- helpers

/**
 * Creates or refreshes an account and returns its id.
 *
 * A known demo password is re-applied on every run so the demo logins always
 * work. A null password gets a random 32-byte secret on first creation only
 * and is left alone afterwards, so a later re-seed cannot undo a reset the
 * account's owner has done.
 */
async function upsertUser(input: {
  email: string;
  fullName: string;
  role: Role;
  password: string | null;
}): Promise<number> {
  const { email, fullName, role } = input;
  const { hash, salt } = hashPassword(
    input.password ?? randomBytes(32).toString("base64url"),
  );
  const credentials = { passwordHash: hash, passwordSalt: salt };

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, fullName, role, ...credentials },
    update: {
      fullName,
      role,
      ...(input.password === null ? {} : credentials),
    },
    select: { id: true },
  });

  return user.id;
}

async function upsertMember(userId: number, planId: number): Promise<void> {
  await prisma.member.upsert({
    where: { membershipId: userId },
    create: { membershipId: userId, planId },
    update: { planId },
  });
}

/**
 * Rows inserted with an explicit id do not advance the table's sequence, so
 * the first insert from the app would collide with id 1. Move it past them.
 */
async function syncIdSequence(table: "MembershipPlan" | "Review") {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), (SELECT MAX(id) FROM "${table}"))`,
  );
}

async function upsertEvent(input: {
  name: string;
  eventDate: Date;
  venue: string;
  description: string;
}): Promise<number> {
  // No natural unique key on events, so match on the name.
  const existing = await prisma.competitionEvent.findFirst({
    where: { name: input.name },
    select: { id: true },
  });

  const data = { ...input, status: "Scheduled" as const };
  const event = existing
    ? await prisma.competitionEvent.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      })
    : await prisma.competitionEvent.create({ data, select: { id: true } });

  return event.id;
}

// ---------------------------------------------------------------- seed

async function main() {
  // Before anything connects: refuse a database that is not on the allow-list.
  const target = checkSeedTarget(process.env);
  if (!target.ok) throw new Error(target.message);
  console.log(`Seeding ${target.host}`);

  const now = new Date();

  // Catalogue
  for (const [sortOrder, plan] of plans.entries()) {
    const data = { ...plan, sortOrder, isActive: true };
    await prisma.membershipPlan.upsert({
      where: { id: plan.id },
      create: data,
      update: data,
    });
  }
  await syncIdSequence("MembershipPlan");

  const programmeIdByName = new Map<string, number>();
  for (const programme of programmes) {
    const row = await prisma.classProgramme.upsert({
      where: { slug: programme.slug },
      create: programme,
      update: programme,
      select: { id: true },
    });
    programmeIdByName.set(programme.name, row.id);
  }

  for (const hours of openingHours) {
    await prisma.openingHours.upsert({
      where: { day: hours.day },
      create: hours,
      update: hours,
    });
  }

  for (const review of reviews) {
    const data = { ...review, postedOn: new Date(review.postedOn) };
    await prisma.review.upsert({
      where: { id: review.id },
      create: data,
      update: data,
    });
  }
  await syncIdSequence("Review");

  const basePlanId = plans[0].id;
  const popularPlanId = plans.find((p) => p.pricePerMonth === 900)!.id;
  const topPlanId = plans.reduce((a, b) =>
    b.pricePerMonth > a.pricePerMonth ? b : a,
  ).id;

  // Accounts
  const memberId = await upsertUser({
    email: "member@pfc.co.za",
    fullName: "John Wick",
    role: "Member",
    password: "Member123!",
  });
  await upsertMember(memberId, popularPlanId);

  const adminId = await upsertUser({
    email: "admin@pfc.co.za",
    fullName: "Ruan Cupido",
    role: "Admin",
    password: "Admin123!",
  });
  await prisma.admin.upsert({
    where: { adminId },
    create: { adminId },
    update: {},
  });

  const coachIdByName = new Map<string, number>();
  for (const coach of coaches) {
    const coachId = await upsertUser({
      email: coach.email,
      fullName: coach.name,
      role: "Coach",
      password: coach.password,
    });
    const profile = { title: coach.title, bio: coach.bio };
    await prisma.coach.upsert({
      where: { coachId },
      create: { coachId, ...profile },
      update: profile,
    });
    coachIdByName.set(coach.name, coachId);
  }

  const fighterId = await upsertUser({
    email: "fighter@pfc.co.za",
    fullName: "Demo Fighter",
    role: "Fighter",
    password: "Fighter123!",
  });
  await upsertMember(fighterId, topPlanId);
  const record = { weightClass: "Welterweight", wins: 3, losses: 1, draws: 0 };
  await prisma.fighter.upsert({
    where: { fighterId },
    create: { fighterId, ...record },
    update: record,
  });

  // Filler members exist only so the timetable shows realistic booked counts.
  // The .invalid domain can never receive mail and the password is random.
  const fillerIds: number[] = [];
  for (let n = 1; n <= FILLER_COUNT; n++) {
    const nn = String(n).padStart(2, "0");
    const id = await upsertUser({
      email: `filler${nn}@demo.pfc.invalid`,
      fullName: `Demo Member ${nn}`,
      role: "Member",
      password: null,
    });
    await upsertMember(id, basePlanId);
    fillerIds.push(id);
  }

  // Timetable, with Confirmed bookings on each class's next session
  for (const slot of timetable) {
    const coachId = coachIdByName.get(slot.coachName);
    if (coachId === undefined) {
      throw new Error(`No coach named ${slot.coachName} for ${slot.className}`);
    }

    const data = {
      name: slot.className,
      kind: "Group" as const,
      programmeId: programmeIdByName.get(slot.className) ?? null,
      durationMinutes: slot.durationMinutes,
      capacity: slot.capacity,
      isActive: true,
    };
    const gymClass = await prisma.gymClass.upsert({
      where: {
        coachId_day_startsAt: {
          coachId,
          day: slot.day,
          startsAt: slot.startsAt,
        },
      },
      create: { coachId, day: slot.day, startsAt: slot.startsAt, ...data },
      update: data,
      select: { id: true },
    });

    const sessionDate = nextOccurrence(slot.day, slot.startsAt, now);
    await prisma.booking.createMany({
      data: fillerIds.slice(0, slot.booked).map((fillerId) => ({
        memberId: fillerId,
        gymClassId: gymClass.id,
        sessionDate,
        status: "Confirmed" as const,
      })),
      skipDuplicates: true,
    });
  }

  // Competition events
  const firstEventId = await upsertEvent({
    name: "PFC Fight Night",
    eventDate: eveningEvent(now, 30),
    venue: "PFC Gym, main arena",
    description:
      "An evening of amateur boxing, Muay Thai and MMA bouts featuring PFC fighters.",
  });
  await upsertEvent({
    name: "PFC Regional Championship",
    eventDate: eveningEvent(now, 75),
    venue: "City Sports Centre",
    description:
      "Regional championship card with title bouts across the weight classes.",
  });

  const bout = { opponentName: "Thabo Nkosi", boutWeightClass: "Welterweight" };
  await prisma.eventParticipation.upsert({
    where: { fighterId_eventId: { fighterId, eventId: firstEventId } },
    create: { fighterId, eventId: firstEventId, availability: "Pending", ...bout },
    update: bout,
  });

  console.log(
    `Seeded ${plans.length} plans, ${programmes.length} programmes, ` +
      `${coaches.length} coaches, ${timetable.length} classes, ` +
      `${FILLER_COUNT} filler members and 2 events.`,
  );
}

main()
  .catch((error) => {
    // Message only: a raw Prisma error can echo row values.
    console.error(
      "Seed failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
