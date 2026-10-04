import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import { updateRecord } from "@/lib/repositories/fightersRepository";
import type { BoutOffer, BoutResult } from "@/lib/types";

/** Data-access layer for bout offers (EventParticipation rows). */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_LISTED = 200;

const offerSelect = {
  id: true,
  fighterId: true,
  eventId: true,
  availability: true,
  opponentName: true,
  boutWeightClass: true,
  boutNotes: true,
  result: true,
  resultNotes: true,
  offeredAt: true,
  respondedAt: true,
  fighter: {
    select: { member: { select: { user: { select: { fullName: true } } } } },
  },
  event: {
    select: { name: true, eventDate: true, venue: true, status: true },
  },
} satisfies Prisma.EventParticipationSelect;

type OfferRow = Prisma.EventParticipationGetPayload<{
  select: typeof offerSelect;
}>;

function toOffer(row: OfferRow): BoutOffer {
  return {
    id: row.id,
    fighterId: row.fighterId,
    fighterName: row.fighter.member.user.fullName,
    eventId: row.eventId,
    eventName: row.event.name,
    eventDate: row.event.eventDate.toISOString(),
    venue: row.event.venue,
    eventStatus: row.event.status,
    availability: row.availability,
    opponentName: row.opponentName,
    boutWeightClass: row.boutWeightClass,
    boutNotes: row.boutNotes,
    result: row.result,
    resultNotes: row.resultNotes,
    offeredAt: row.offeredAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
  };
}

function hasCode(e: unknown, code: string): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;
}

/** Whether an event can still take offers and answers. */
function isOpen(event: { status: string; eventDate: Date }, now: Date): boolean {
  return event.status === "Scheduled" && event.eventDate > now;
}

// ---------------------------------------------------------------- reads

export async function getOffer(id: number): Promise<BoutOffer | undefined> {
  const row = await prisma.eventParticipation.findUnique({
    where: { id },
    select: offerSelect,
  });

  return row ? toOffer(row) : undefined;
}

/** One fighter's offers, soonest event first. */
export async function listForFighter(fighterId: number): Promise<BoutOffer[]> {
  const rows = await prisma.eventParticipation.findMany({
    where: { fighterId },
    orderBy: [{ event: { eventDate: "asc" } }, { id: "asc" }],
    take: MAX_LISTED,
    select: offerSelect,
  });

  return rows.map(toOffer);
}

/** Every offer made for one event, in the order they were made. */
export async function listForEvent(eventId: number): Promise<BoutOffer[]> {
  const rows = await prisma.eventParticipation.findMany({
    where: { eventId },
    orderBy: { id: "asc" },
    take: MAX_LISTED,
    select: offerSelect,
  });

  return rows.map(toOffer);
}

/** Unanswered offers for events that are still to come. */
export async function countPending(now: Date = new Date()): Promise<number> {
  return prisma.eventParticipation.count({
    where: {
      availability: "Pending",
      event: { status: "Scheduled", eventDate: { gte: now } },
    },
  });
}

// ---------------------------------------------------------------- writes

export interface OfferFields {
  fighterId: number;
  eventId: number;
  opponentName: string | null;
  boutWeightClass: string | null;
  boutNotes: string | null;
}

export type CreateOfferResult =
  | { ok: true; offer: BoutOffer }
  | {
      ok: false;
      reason: "event-not-found" | "event-closed" | "fighter-not-found" | "duplicate";
    };

/**
 * Offers a fighter a bout at an event.
 *
 * The pair (fighter, event) is unique, so a second offer breaks the unique
 * index (P2002) and is reported as a duplicate; that also settles two admins
 * offering the same bout at once. A fighter removed mid-request breaks the
 * foreign key (P2003) and is reported as not found.
 */
export async function createOffer(
  input: OfferFields,
  actorId: number,
  now: Date = new Date(),
): Promise<CreateOfferResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<CreateOfferResult> => {
      const event = await tx.competitionEvent.findUnique({
        where: { id: input.eventId },
        select: { status: true, eventDate: true },
      });
      if (!event) return { ok: false, reason: "event-not-found" };
      if (!isOpen(event, now)) return { ok: false, reason: "event-closed" };

      const fighter = await tx.fighter.findUnique({
        where: { fighterId: input.fighterId },
        select: { fighterId: true },
      });
      if (!fighter) return { ok: false, reason: "fighter-not-found" };

      const row = await tx.eventParticipation.create({
        data: input,
        select: offerSelect,
      });
      await audit(
        {
          actorId,
          action: "offer.create",
          entity: "EventParticipation",
          entityId: row.id,
          detail: { fighterId: input.fighterId, eventId: input.eventId },
        },
        tx,
      );

      return { ok: true, offer: toOffer(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2002")) return { ok: false, reason: "duplicate" };
    if (hasCode(e, "P2003")) return { ok: false, reason: "fighter-not-found" };
    throw e;
  }
}

export type SetAvailabilityResult =
  | { ok: true; offer: BoutOffer }
  | { ok: false; reason: "not-found" | "event-closed" };

/**
 * Records a fighter's answer to their own offer. An offer that belongs to
 * someone else is reported as not found, exactly like one that does not
 * exist, so ids cannot be probed. The answer can be changed any number of
 * times until the event starts.
 */
export async function setAvailability(
  id: number,
  fighterId: number,
  availability: "Accepted" | "Declined",
  now: Date = new Date(),
): Promise<SetAvailabilityResult> {
  return prisma.$transaction(async (tx): Promise<SetAvailabilityResult> => {
    const existing = await tx.eventParticipation.findFirst({
      where: { id, fighterId },
      select: { event: { select: { status: true, eventDate: true } } },
    });

    if (!existing) return { ok: false, reason: "not-found" };
    if (!isOpen(existing.event, now)) {
      return { ok: false, reason: "event-closed" };
    }

    // The owner is in the filter again, so the write cannot touch another
    // fighter's row whatever happened since the read.
    const { count } = await tx.eventParticipation.updateMany({
      where: { id, fighterId },
      data: { availability, respondedAt: now },
    });
    if (count === 0) return { ok: false, reason: "not-found" };

    const row = await tx.eventParticipation.findUniqueOrThrow({
      where: { id },
      select: offerSelect,
    });

    return { ok: true, offer: toOffer(row) };
  }, TRANSACTION_OPTIONS);
}

export type SetResultResult =
  | { ok: true; offer: BoutOffer }
  | {
      ok: false;
      reason: "not-found" | "event-cancelled" | "not-happened" | "not-accepted";
    };

/**
 * Sets, changes or clears (null) the result of a bout and keeps the fighter's
 * record in step, in one transaction.
 *
 * The offer row is locked before the old result is read. Without the lock two
 * admins recording "Win" together would both see "no result yet" and both add
 * a win; with it the second waits, sees Win already stored and adds nothing.
 */
export async function setResult(
  id: number,
  result: BoutResult | null,
  resultNotes: string | null,
  actorId: number,
  now: Date = new Date(),
): Promise<SetResultResult> {
  return prisma.$transaction(async (tx): Promise<SetResultResult> => {
    const [locked] = await tx.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "EventParticipation" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked) return { ok: false, reason: "not-found" };

    const existing = await tx.eventParticipation.findUniqueOrThrow({
      where: { id },
      select: {
        fighterId: true,
        availability: true,
        result: true,
        event: { select: { status: true, eventDate: true } },
      },
    });

    if (existing.event.status === "Cancelled") {
      return { ok: false, reason: "event-cancelled" };
    }
    if (existing.event.eventDate >= now) {
      return { ok: false, reason: "not-happened" };
    }
    if (existing.availability !== "Accepted") {
      return { ok: false, reason: "not-accepted" };
    }

    await updateRecord(tx, existing.fighterId, existing.result, result);

    const row = await tx.eventParticipation.update({
      where: { id },
      data: { result, resultNotes },
      select: offerSelect,
    });
    await audit(
      {
        actorId,
        action: "result.record",
        entity: "EventParticipation",
        entityId: id,
        detail: { from: existing.result, to: result },
      },
      tx,
    );

    return { ok: true, offer: toOffer(row) };
  }, TRANSACTION_OPTIONS);
}
