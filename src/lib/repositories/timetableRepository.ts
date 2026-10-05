import "server-only";

import type { Prisma } from "@prisma/client";

import { isoDate, nextOccurrence } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { type DayKey, isFull, type TimetableSlot } from "@/lib/types";

/**
 * Data-access layer for the weekly timetable (Task 1 §7.1.2).
 *
 * A slot's `booked` figure is the number of Confirmed bookings for that
 * class's next session, so it resets by itself once a session has started.
 */

const slotSelect = {
  id: true,
  name: true,
  kind: true,
  coachId: true,
  day: true,
  startsAt: true,
  durationMinutes: true,
  capacity: true,
  coach: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.GymClassSelect;

type SlotRow = Prisma.GymClassGetPayload<{ select: typeof slotSelect }>;

const weekOrder = [
  { day: "asc" },
  { startsAt: "asc" },
  { id: "asc" },
] satisfies Prisma.GymClassOrderByWithRelationInput[];

function toSlot(row: SlotRow, booked: number): TimetableSlot {
  return {
    id: row.id,
    day: row.day,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    className: row.name,
    coachName: row.coach.user.fullName,
    capacity: row.capacity,
    booked,
    coachId: row.coachId,
    kind: row.kind,
  };
}

/**
 * Adds the booked count to each class using one grouped query for the whole
 * set, however many classes there are. Each class is matched on its own next
 * session date, because a class that has already started today has rolled on
 * to next week while a later one the same day has not.
 */
async function withBookedCounts(
  rows: SlotRow[],
  now: Date,
): Promise<TimetableSlot[]> {
  if (rows.length === 0) return [];

  const sessions = rows.map((row) => nextOccurrence(row.day, row.startsAt, now));
  const dates = [...new Set(sessions.map((date) => date.getTime()))].map(
    (time) => new Date(time),
  );

  const counts = await prisma.booking.groupBy({
    by: ["gymClassId", "sessionDate"],
    where: {
      status: "Confirmed",
      gymClassId: { in: rows.map((row) => row.id) },
      sessionDate: { in: dates },
    },
    _count: { _all: true },
  });

  const key = (classId: number, date: Date) => `${classId}|${isoDate(date)}`;
  const booked = new Map(
    counts.map((c) => [key(c.gymClassId, c.sessionDate), c._count._all]),
  );

  return rows.map((row, i) =>
    toSlot(row, booked.get(key(row.id, sessions[i])) ?? 0),
  );
}

export async function getTimetable(
  now: Date = new Date(),
): Promise<TimetableSlot[]> {
  const rows = await prisma.gymClass.findMany({
    where: { isActive: true },
    orderBy: weekOrder,
    select: slotSelect,
  });

  return withBookedCounts(rows, now);
}

export async function getSlotsFor(
  day: DayKey,
  now: Date = new Date(),
): Promise<TimetableSlot[]> {
  const rows = await prisma.gymClass.findMany({
    where: { isActive: true, day },
    orderBy: weekOrder,
    select: slotSelect,
  });

  return withBookedCounts(rows, now);
}

export async function getSlot(
  id: number,
  now: Date = new Date(),
): Promise<TimetableSlot | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;

  const row = await prisma.gymClass.findFirst({
    where: { id, isActive: true },
    select: slotSelect,
  });
  if (!row) return undefined;

  return (await withBookedCounts([row], now))[0];
}

export async function getSlotsForCoach(
  coachId: number,
  now: Date = new Date(),
): Promise<TimetableSlot[]> {
  const rows = await prisma.gymClass.findMany({
    where: { isActive: true, coachId },
    orderBy: weekOrder,
    select: slotSelect,
  });

  return withBookedCounts(rows, now);
}

/** The soonest upcoming session that still has a free place. */
export async function getNextAvailableSlot(
  now: Date = new Date(),
): Promise<TimetableSlot | undefined> {
  const slots = await getTimetable(now);
  const when = (slot: TimetableSlot) =>
    nextOccurrence(slot.day, slot.startsAt, now).getTime();

  return slots
    .filter((slot) => !isFull(slot))
    .sort(
      (a, b) => when(a) - when(b) || a.startsAt.localeCompare(b.startsAt),
    )[0];
}
