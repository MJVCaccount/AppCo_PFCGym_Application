import "server-only";

import { type ClassProgramme, Prisma } from "@prisma/client";

import { gymDateAndTime, nextOccurrence } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import {
  cancelFutureConfirmed,
  futureConfirmedWhere,
} from "@/lib/repositories/bookingsRepository";
import type {
  AdminClass,
  AdminProgramme,
  ClassKind,
  DayKey,
} from "@/lib/types";

/**
 * Data-access layer for managing the timetable and the class catalogue.
 *
 * Every write that depends on a read takes a row lock on the class first, the
 * same lock a booking takes, so a booking and an admin change to one class
 * queue instead of racing.
 */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const SLUG_ATTEMPTS = 5;

const classSelect = {
  id: true,
  name: true,
  kind: true,
  coachId: true,
  day: true,
  startsAt: true,
  durationMinutes: true,
  capacity: true,
  programmeId: true,
  isActive: true,
  coach: { select: { user: { select: { fullName: true } } } },
  _count: { select: { bookings: true } },
} satisfies Prisma.GymClassSelect;

type ClassRow = Prisma.GymClassGetPayload<{ select: typeof classSelect }>;

function toAdminClass(
  row: ClassRow,
  booked: number,
  futureBookings: number,
): AdminClass {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    coachId: row.coachId,
    coachName: row.coach.user.fullName,
    day: row.day,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    capacity: row.capacity,
    programmeId: row.programmeId,
    isActive: row.isActive,
    booked,
    futureBookings,
    hasBookings: row._count.bookings > 0,
  };
}

function hasCode(e: unknown, code: string): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;
}

interface LockedClass {
  id: number;
  day: DayKey;
  startsAt: string;
  isActive: boolean;
  coachId: number;
}

async function lockClass(
  tx: Prisma.TransactionClient,
  id: number,
): Promise<LockedClass | undefined> {
  const [row] = await tx.$queryRaw<LockedClass[]>`
    SELECT "id", "day"::text AS "day", "startsAt", "isActive", "coachId"
    FROM "GymClass" WHERE "id" = ${id} FOR UPDATE`;

  return row;
}

/**
 * Locks the coach row and says whether they can be given a class. The lock
 * makes this queue with archiving, which counts the coach's classes under the
 * same lock, so a class cannot be added to a coach who is being archived.
 */
async function coachCanTeach(
  tx: Prisma.TransactionClient,
  coachId: number,
): Promise<boolean> {
  const [coach] = await tx.$queryRaw<{ isActive: boolean }[]>`
    SELECT "isActive" FROM "Coach" WHERE "coachId" = ${coachId} FOR UPDATE`;

  return coach?.isActive === true;
}

async function programmeExists(
  tx: Prisma.TransactionClient,
  id: number,
): Promise<boolean> {
  const row = await tx.classProgramme.findUnique({
    where: { id },
    select: { id: true },
  });

  return row !== null;
}

async function futureCount(
  tx: Prisma.TransactionClient,
  gymClassId: number,
  now: Date,
): Promise<number> {
  return tx.booking.count({
    where: { gymClassId, ...futureConfirmedWhere(now) },
  });
}

// ---------------------------------------------------------------- reads

/**
 * Every scheduled class, active or not, in timetable order, with its booked
 * figures. One query fetches the Confirmed bookings from today onwards and
 * both figures are counted from it.
 */
export async function listClasses(now: Date = new Date()): Promise<AdminClass[]> {
  const rows = await prisma.gymClass.findMany({
    orderBy: [{ day: "asc" }, { startsAt: "asc" }, { id: "asc" }],
    select: classSelect,
  });
  if (rows.length === 0) return [];

  const { date: today, time } = gymDateAndTime(now);
  const bookings = await prisma.booking.findMany({
    where: { status: "Confirmed", sessionDate: { gte: today } },
    select: { gymClassId: true, sessionDate: true },
  });

  return rows.map((row) => {
    const next = nextOccurrence(row.day, row.startsAt, now).getTime();
    let booked = 0;
    let future = 0;

    for (const booking of bookings) {
      if (booking.gymClassId !== row.id) continue;

      const session = booking.sessionDate.getTime();
      if (session === next) booked++;
      if (session > today.getTime() || row.startsAt > time) future++;
    }

    return toAdminClass(row, booked, future);
  });
}

export async function listProgrammes(): Promise<AdminProgramme[]> {
  const rows = await prisma.classProgramme.findMany({
    orderBy: { id: "asc" },
  });

  return rows.map(toProgramme);
}

// ---------------------------------------------------------------- classes

export interface ClassFields {
  name: string;
  kind: ClassKind;
  coachId: number;
  day: DayKey;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  programmeId: number | null;
}

export type CreateClassResult =
  | { ok: true; gymClass: AdminClass }
  | { ok: false; reason: "coach-not-found" | "programme-not-found" | "clash" };

/**
 * Adds a class to the timetable. A coach can teach one class at a given day
 * and time: the unique index on (coachId, day, startsAt) enforces it, so two
 * admins adding the same slot at once get one class and one clash (P2002).
 */
export async function createClass(
  input: ClassFields,
  actorId: number,
): Promise<CreateClassResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<CreateClassResult> => {
      if (!(await coachCanTeach(tx, input.coachId))) {
        return { ok: false, reason: "coach-not-found" };
      }
      if (
        input.programmeId !== null &&
        !(await programmeExists(tx, input.programmeId))
      ) {
        return { ok: false, reason: "programme-not-found" };
      }

      const row = await tx.gymClass.create({ data: input, select: classSelect });
      await audit(
        {
          actorId,
          action: "class.create",
          entity: "GymClass",
          entityId: row.id,
          detail: {
            name: row.name,
            coachId: row.coachId,
            day: row.day,
            startsAt: row.startsAt,
          },
        },
        tx,
      );

      return { ok: true, gymClass: toAdminClass(row, 0, 0) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2002")) return { ok: false, reason: "clash" };
    if (hasCode(e, "P2003")) return { ok: false, reason: "coach-not-found" };
    throw e;
  }
}

export type UpdateClassResult =
  | { ok: true; gymClass: AdminClass }
  | {
      ok: false;
      reason: "not-found" | "coach-not-found" | "programme-not-found" | "clash";
    }
  | { ok: false; reason: "capacity"; booked: number }
  | { ok: false; reason: "has-bookings"; count: number };

/**
 * Changes only the fields given.
 *
 * Under the class lock: capacity may not fall below the Confirmed bookings
 * for the next session, and the day or time may not move while any future
 * Confirmed booking exists, because those members booked that day and time.
 */
export async function updateClass(
  id: number,
  changes: Partial<ClassFields>,
  actorId: number,
  now: Date = new Date(),
): Promise<UpdateClassResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<UpdateClassResult> => {
      const existing = await lockClass(tx, id);
      if (!existing) return { ok: false, reason: "not-found" };

      if (
        changes.coachId !== undefined &&
        changes.coachId !== existing.coachId &&
        !(await coachCanTeach(tx, changes.coachId))
      ) {
        return { ok: false, reason: "coach-not-found" };
      }
      if (
        changes.programmeId !== undefined &&
        changes.programmeId !== null &&
        !(await programmeExists(tx, changes.programmeId))
      ) {
        return { ok: false, reason: "programme-not-found" };
      }

      const booked = await tx.booking.count({
        where: {
          gymClassId: id,
          status: "Confirmed",
          sessionDate: nextOccurrence(existing.day, existing.startsAt, now),
        },
      });
      const future = await futureCount(tx, id, now);

      if (changes.capacity !== undefined && changes.capacity < booked) {
        return { ok: false, reason: "capacity", booked };
      }

      const moved =
        (changes.day !== undefined && changes.day !== existing.day) ||
        (changes.startsAt !== undefined && changes.startsAt !== existing.startsAt);
      if (moved && future > 0) {
        return { ok: false, reason: "has-bookings", count: future };
      }

      const row = await tx.gymClass.update({
        where: { id },
        data: changes,
        select: classSelect,
      });
      await audit(
        {
          actorId,
          action: "class.update",
          entity: "GymClass",
          entityId: id,
          detail: { fields: Object.keys(changes).sort().join(",") },
        },
        tx,
      );

      // An unmoved class keeps its figures; a moved one had no bookings.
      return {
        ok: true,
        gymClass: toAdminClass(row, moved ? 0 : booked, future),
      };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2002")) return { ok: false, reason: "clash" };
    if (hasCode(e, "P2003")) return { ok: false, reason: "coach-not-found" };
    if (hasCode(e, "P2025")) return { ok: false, reason: "not-found" };
    throw e;
  }
}

export type DeactivateClassResult =
  | { ok: true; cancelledBookings: number }
  | { ok: false; reason: "not-found" | "already-inactive" }
  | { ok: false; reason: "has-bookings"; count: number };

/**
 * Takes a class off the timetable. With future Confirmed bookings it refuses
 * unless told to cancel them, and then cancels them in the same transaction,
 * so nobody is left booked into a class that no longer runs.
 */
export async function deactivateClass(
  id: number,
  cancelBookings: boolean,
  actorId: number,
  now: Date = new Date(),
): Promise<DeactivateClassResult> {
  return prisma.$transaction(async (tx): Promise<DeactivateClassResult> => {
    const existing = await lockClass(tx, id);
    if (!existing) return { ok: false, reason: "not-found" };
    if (!existing.isActive) return { ok: false, reason: "already-inactive" };

    const count = await futureCount(tx, id, now);
    if (count > 0 && !cancelBookings) {
      return { ok: false, reason: "has-bookings", count };
    }

    const cancelledBookings =
      count > 0 ? await cancelFutureConfirmed(tx, { gymClassId: id }, now) : 0;

    await tx.gymClass.update({ where: { id }, data: { isActive: false } });
    await audit(
      {
        actorId,
        action: "class.deactivate",
        entity: "GymClass",
        entityId: id,
        detail: { cancelledBookings },
      },
      tx,
    );

    return { ok: true, cancelledBookings };
  }, TRANSACTION_OPTIONS);
}

export type ReactivateClassResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-active" | "coach-archived" };

/** Puts a deactivated class back on the timetable, if its coach is active. */
export async function reactivateClass(
  id: number,
  actorId: number,
): Promise<ReactivateClassResult> {
  return prisma.$transaction(async (tx): Promise<ReactivateClassResult> => {
    const existing = await lockClass(tx, id);
    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.isActive) return { ok: false, reason: "already-active" };
    if (!(await coachCanTeach(tx, existing.coachId))) {
      return { ok: false, reason: "coach-archived" };
    }

    await tx.gymClass.update({ where: { id }, data: { isActive: true } });
    await audit(
      { actorId, action: "class.reactivate", entity: "GymClass", entityId: id },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}

export type DeleteClassResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "has-bookings" };

/**
 * Deletes a class that has never had a booking. A booking that lands between
 * the count and the delete breaks the foreign key (P2003) and is reported the
 * same way as one that was already there.
 */
export async function deleteClass(
  id: number,
  actorId: number,
): Promise<DeleteClassResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<DeleteClassResult> => {
      const existing = await lockClass(tx, id);
      if (!existing) return { ok: false, reason: "not-found" };

      const bookings = await tx.booking.count({ where: { gymClassId: id } });
      if (bookings > 0) return { ok: false, reason: "has-bookings" };

      await tx.gymClass.delete({ where: { id } });
      await audit(
        { actorId, action: "class.delete", entity: "GymClass", entityId: id },
        tx,
      );

      return { ok: true };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2003")) return { ok: false, reason: "has-bookings" };
    if (hasCode(e, "P2025")) return { ok: false, reason: "not-found" };
    throw e;
  }
}

// ---------------------------------------------------------------- programmes

function toProgramme(row: ClassProgramme): AdminProgramme {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    level: row.level,
    durationMinutes: row.durationMinutes,
    isActive: row.isActive,
  };
}

export interface ProgrammeFields {
  name: string;
  description: string;
  level: string;
  durationMinutes: number;
}

export type CreateProgrammeResult =
  | { ok: true; programme: AdminProgramme }
  | { ok: false; reason: "slug-taken" };

/**
 * Adds a programme under the first free slug: `base`, then `base-2`, `base-3`
 * and so on. Two admins adding the same name at once both pick the same slug;
 * the unique index stops the second (P2002), which then looks again and takes
 * the next one.
 */
export async function createProgramme(
  input: ProgrammeFields,
  baseSlug: string,
  actorId: number,
): Promise<CreateProgrammeResult> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<CreateProgrammeResult> => {
          const taken = new Set(
            (
              await tx.classProgramme.findMany({
                where: { slug: { startsWith: baseSlug } },
                select: { slug: true },
              })
            ).map((row) => row.slug),
          );

          let slug = baseSlug;
          for (let n = 2; taken.has(slug); n++) slug = `${baseSlug}-${n}`;

          const row = await tx.classProgramme.create({
            data: { ...input, slug },
          });
          await audit(
            {
              actorId,
              action: "programme.create",
              entity: "ClassProgramme",
              entityId: row.id,
              detail: { name: row.name, slug: row.slug },
            },
            tx,
          );

          return { ok: true, programme: toProgramme(row) };
        },
        TRANSACTION_OPTIONS,
      );
    } catch (e) {
      if (!hasCode(e, "P2002")) throw e;
    }
  }

  return { ok: false, reason: "slug-taken" };
}

export type UpdateProgrammeResult =
  | { ok: true; programme: AdminProgramme }
  | { ok: false; reason: "not-found" };

/** Changes only the fields given. The slug never changes once created. */
export async function updateProgramme(
  id: number,
  changes: Partial<ProgrammeFields>,
  actorId: number,
): Promise<UpdateProgrammeResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<UpdateProgrammeResult> => {
        const row = await tx.classProgramme.update({
          where: { id },
          data: changes,
        });
        await audit(
          {
            actorId,
            action: "programme.update",
            entity: "ClassProgramme",
            entityId: id,
            detail: { fields: Object.keys(changes).sort().join(",") },
          },
          tx,
        );

        return { ok: true, programme: toProgramme(row) };
      },
      TRANSACTION_OPTIONS,
    );
  } catch (e) {
    if (hasCode(e, "P2025")) return { ok: false, reason: "not-found" };
    throw e;
  }
}

export type DeactivateProgrammeResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-inactive" };

/**
 * Hides a programme from the public catalogue. The row and the classes that
 * point at it are kept. The active flag is in the update's filter, so of two
 * admins acting at once only one changes the row.
 */
export async function deactivateProgramme(
  id: number,
  actorId: number,
): Promise<DeactivateProgrammeResult> {
  return prisma.$transaction(async (tx): Promise<DeactivateProgrammeResult> => {
    const { count } = await tx.classProgramme.updateMany({
      where: { id, isActive: true },
      data: { isActive: false },
    });

    if (count === 0) {
      return (await programmeExists(tx, id))
        ? { ok: false, reason: "already-inactive" }
        : { ok: false, reason: "not-found" };
    }

    await audit(
      {
        actorId,
        action: "programme.deactivate",
        entity: "ClassProgramme",
        entityId: id,
      },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}
