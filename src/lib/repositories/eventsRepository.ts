import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import type { CompetitionEvent } from "@/lib/types";

/** Data-access layer for competition events. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_LISTED = 200;

const eventSelect = {
  id: true,
  name: true,
  eventDate: true,
  venue: true,
  description: true,
  imageUrl: true,
  status: true,
} satisfies Prisma.CompetitionEventSelect;

type EventRow = Prisma.CompetitionEventGetPayload<{
  select: typeof eventSelect;
}>;

function toEvent(row: EventRow): CompetitionEvent {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate.toISOString(),
    venue: row.venue,
    description: row.description,
    imageUrl: row.imageUrl,
    status: row.status,
  };
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025"
  );
}

/** Scheduled and not yet started: the events the public and offers can use. */
function upcomingWhere(now: Date): Prisma.CompetitionEventWhereInput {
  return { status: "Scheduled", eventDate: { gte: now } };
}

// ---------------------------------------------------------------- reads

export async function getEvent(
  id: number,
): Promise<CompetitionEvent | undefined> {
  const row = await prisma.competitionEvent.findUnique({
    where: { id },
    select: eventSelect,
  });

  return row ? toEvent(row) : undefined;
}

/** Scheduled events from `now` onwards, soonest first. */
export async function listUpcoming(
  now: Date = new Date(),
): Promise<CompetitionEvent[]> {
  const rows = await prisma.competitionEvent.findMany({
    where: upcomingWhere(now),
    orderBy: [{ eventDate: "asc" }, { id: "asc" }],
    take: MAX_LISTED,
    select: eventSelect,
  });

  return rows.map(toEvent);
}

/** Every event whatever its status, newest first. */
export async function listAll(): Promise<CompetitionEvent[]> {
  const rows = await prisma.competitionEvent.findMany({
    orderBy: [{ eventDate: "desc" }, { id: "desc" }],
    take: MAX_LISTED,
    select: eventSelect,
  });

  return rows.map(toEvent);
}

export async function countUpcoming(now: Date = new Date()): Promise<number> {
  return prisma.competitionEvent.count({ where: upcomingWhere(now) });
}

// ---------------------------------------------------------------- writes

export interface EventFields {
  name: string;
  eventDate: Date;
  venue: string;
  description: string;
  imageUrl: string | null;
}

export async function createEvent(
  input: EventFields,
  actorId: number,
): Promise<CompetitionEvent> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.competitionEvent.create({
      data: input,
      select: eventSelect,
    });
    await audit(
      {
        actorId,
        action: "event.create",
        entity: "CompetitionEvent",
        entityId: row.id,
        detail: { name: row.name, eventDate: row.eventDate.toISOString() },
      },
      tx,
    );

    return toEvent(row);
  }, TRANSACTION_OPTIONS);
}

export type UpdateEventResult =
  | { ok: true; event: CompetitionEvent }
  | { ok: false; reason: "not-found" };

/** Changes only the fields given. A missing event (P2025) is "not-found". */
export async function updateEvent(
  id: number,
  changes: Partial<EventFields>,
  actorId: number,
): Promise<UpdateEventResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<UpdateEventResult> => {
      const row = await tx.competitionEvent.update({
        where: { id },
        data: changes,
        select: eventSelect,
      });
      await audit(
        {
          actorId,
          action: "event.update",
          entity: "CompetitionEvent",
          entityId: id,
          detail: { fields: Object.keys(changes).sort().join(",") },
        },
        tx,
      );

      return { ok: true, event: toEvent(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (isNotFound(e)) return { ok: false, reason: "not-found" };
    throw e;
  }
}

export type SetStatusResult =
  | { ok: true; event: CompetitionEvent }
  | { ok: false; reason: "not-found" | "not-scheduled" | "not-happened" };

/**
 * Moves a Scheduled event to Cancelled or Completed. The row is kept either
 * way: cancelling never deletes, so offers and results stay on record.
 *
 * Completing also needs the event date to have passed. The status is in the
 * update's filter, so of two admins acting at once only one changes the row
 * and the other is told it is no longer scheduled.
 */
export async function setStatus(
  id: number,
  status: "Cancelled" | "Completed",
  actorId: number,
  now: Date = new Date(),
): Promise<SetStatusResult> {
  return prisma.$transaction(async (tx): Promise<SetStatusResult> => {
    const existing = await tx.competitionEvent.findUnique({
      where: { id },
      select: { status: true, eventDate: true },
    });

    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.status !== "Scheduled") {
      return { ok: false, reason: "not-scheduled" };
    }
    if (status === "Completed" && existing.eventDate >= now) {
      return { ok: false, reason: "not-happened" };
    }

    const { count } = await tx.competitionEvent.updateMany({
      where: { id, status: "Scheduled" },
      data: { status },
    });
    if (count === 0) return { ok: false, reason: "not-scheduled" };

    await audit(
      {
        actorId,
        action: status === "Cancelled" ? "event.cancel" : "event.complete",
        entity: "CompetitionEvent",
        entityId: id,
      },
      tx,
    );

    const row = await tx.competitionEvent.findUniqueOrThrow({
      where: { id },
      select: eventSelect,
    });

    return { ok: true, event: toEvent(row) };
  }, TRANSACTION_OPTIONS);
}
