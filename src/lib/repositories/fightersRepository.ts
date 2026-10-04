import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import type { AdminFighter, BoutResult, Fighter } from "@/lib/types";

/** Data-access layer for fighters. A fighter's id is their member/user id. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

const fighterSelect = {
  fighterId: true,
  weightClass: true,
  wins: true,
  losses: true,
  draws: true,
  imageUrl: true,
  member: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.FighterSelect;

type FighterRow = Prisma.FighterGetPayload<{ select: typeof fighterSelect }>;

function toFighter(row: FighterRow): Fighter {
  return {
    id: row.fighterId,
    fullName: row.member.user.fullName,
    weightClass: row.weightClass,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    imageUrl: row.imageUrl,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

// ---------------------------------------------------------------- reads

export async function getFighter(id: number): Promise<Fighter | undefined> {
  const row = await prisma.fighter.findUnique({
    where: { fighterId: id },
    select: fighterSelect,
  });

  return row ? toFighter(row) : undefined;
}

export async function listFighters(): Promise<Fighter[]> {
  const rows = await prisma.fighter.findMany({
    orderBy: { fighterId: "asc" },
    select: fighterSelect,
  });

  return rows.map(toFighter);
}

/** Every fighter, with whether the demote rule would let them go. */
export async function listAdminFighters(): Promise<AdminFighter[]> {
  const rows = await prisma.fighter.findMany({
    orderBy: { fighterId: "asc" },
    select: {
      ...fighterSelect,
      _count: { select: { participations: true, documents: true } },
    },
  });

  return rows.map((row) => ({
    ...toFighter(row),
    canDemote: row._count.participations === 0 && row._count.documents === 0,
  }));
}

export async function countFighters(): Promise<number> {
  return prisma.fighter.count();
}

// ---------------------------------------------------------------- writes

export type PromoteResult =
  | { ok: true; fighter: Fighter }
  | { ok: false; reason: "not-found" | "already-fighter" };

/**
 * Turns a member into a fighter: the Fighter row, the role change and the
 * audit record commit together or not at all.
 *
 * Two admins promoting the same member at once both pass the read; the second
 * insert then breaks the primary key (P2002) and is reported as already a
 * fighter, the same answer it would have had a moment later.
 */
export async function promote(
  memberId: number,
  weightClass: string,
  actorId: number,
): Promise<PromoteResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<PromoteResult> => {
      const user = await tx.user.findUnique({
        where: { id: memberId },
        select: {
          role: true,
          isActive: true,
          member: { select: { fighter: { select: { fighterId: true } } } },
        },
      });

      if (!user || !user.isActive || !user.member) {
        return { ok: false, reason: "not-found" };
      }
      if (user.role === "Fighter" || user.member.fighter) {
        return { ok: false, reason: "already-fighter" };
      }
      if (user.role !== "Member") return { ok: false, reason: "not-found" };

      const row = await tx.fighter.create({
        data: { fighterId: memberId, weightClass },
        select: fighterSelect,
      });
      await tx.user.update({
        where: { id: memberId },
        data: { role: "Fighter" },
      });
      await audit(
        {
          actorId,
          action: "fighter.promote",
          entity: "Fighter",
          entityId: memberId,
          detail: { weightClass },
        },
        tx,
      );

      return { ok: true, fighter: toFighter(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: "already-fighter" };
    throw e;
  }
}

export type DemoteResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "has-history" };

/**
 * Removes a fighter who has no offers and no documents, and puts the account
 * back to Member.
 *
 * The fighter row is locked first. Deleting it would cascade to its offers,
 * so an offer being created at the same moment has to wait: it either lands
 * before the count below and blocks the demotion, or fails afterwards because
 * the fighter is gone. It can never be silently deleted.
 */
export async function demote(
  fighterId: number,
  actorId: number,
): Promise<DemoteResult> {
  return prisma.$transaction(async (tx): Promise<DemoteResult> => {
    const [locked] = await tx.$queryRaw<{ fighterId: number }[]>`
      SELECT "fighterId" FROM "Fighter"
      WHERE "fighterId" = ${fighterId} FOR UPDATE`;
    if (!locked) return { ok: false, reason: "not-found" };

    const offers = await tx.eventParticipation.count({ where: { fighterId } });
    const documents = await tx.fighterDocument.count({ where: { fighterId } });
    if (offers > 0 || documents > 0) {
      return { ok: false, reason: "has-history" };
    }

    await tx.fighter.delete({ where: { fighterId } });
    await tx.user.update({ where: { id: fighterId }, data: { role: "Member" } });
    await audit(
      {
        actorId,
        action: "fighter.demote",
        entity: "Fighter",
        entityId: fighterId,
      },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}

const COUNTER: Record<BoutResult, "wins" | "losses" | "draws" | null> = {
  Win: "wins",
  Loss: "losses",
  Draw: "draws",
  NoContest: null,
};

/**
 * Moves a fighter's record from one bout result to another: the old result's
 * counter goes down by one and the new one's up by one. A no contest and "no
 * result" touch no counter, and an unchanged result is left alone.
 *
 * Always called inside the transaction that changes the result itself.
 */
export async function updateRecord(
  tx: Prisma.TransactionClient,
  fighterId: number,
  previous: BoutResult | null,
  next: BoutResult | null,
): Promise<void> {
  const down = previous ? COUNTER[previous] : null;
  const up = next ? COUNTER[next] : null;
  if (down === up) return;

  await tx.fighter.update({
    where: { fighterId },
    data: {
      ...(down ? { [down]: { decrement: 1 } } : {}),
      ...(up ? { [up]: { increment: 1 } } : {}),
    },
  });
}
