import "server-only";

import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import type { AdminCoach, Coach } from "@/lib/types";

/** Data-access layer for the coaching team. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

const coachSelect = {
  coachId: true,
  title: true,
  bio: true,
  imageUrl: true,
  user: { select: { fullName: true } },
} satisfies Prisma.CoachSelect;

type CoachRow = Prisma.CoachGetPayload<{ select: typeof coachSelect }>;

function toCoach(row: CoachRow): Coach {
  return {
    id: row.coachId,
    name: row.user.fullName,
    role: row.title,
    bio: row.bio,
    imageUrl: row.imageUrl,
  };
}

const adminCoachSelect = {
  coachId: true,
  title: true,
  bio: true,
  imageUrl: true,
  isActive: true,
  user: { select: { fullName: true, email: true } },
  _count: { select: { classes: { where: { isActive: true } } } },
} satisfies Prisma.CoachSelect;

type AdminCoachRow = Prisma.CoachGetPayload<{ select: typeof adminCoachSelect }>;

function toAdminCoach(row: AdminCoachRow): AdminCoach {
  return {
    id: row.coachId,
    name: row.user.fullName,
    email: row.user.email,
    title: row.title,
    bio: row.bio,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    activeClasses: row._count.classes,
  };
}

function hasCode(e: unknown, code: string): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;
}

async function lockCoach(
  tx: Prisma.TransactionClient,
  id: number,
): Promise<{ isActive: boolean } | undefined> {
  const [row] = await tx.$queryRaw<{ isActive: boolean }[]>`
    SELECT "isActive" FROM "Coach" WHERE "coachId" = ${id} FOR UPDATE`;

  return row;
}

// ---------------------------------------------------------------- reads

/** Active coaches only: what the public Coaches page shows. */
export async function getCoaches(): Promise<Coach[]> {
  const rows = await prisma.coach.findMany({
    where: { isActive: true },
    orderBy: { coachId: "asc" },
    select: coachSelect,
  });

  return rows.map(toCoach);
}

export async function getCoachByName(name: string): Promise<Coach | undefined> {
  const row = await prisma.coach.findFirst({
    where: { isActive: true, user: { fullName: name.trim() } },
    orderBy: { coachId: "asc" },
    select: coachSelect,
  });

  return row ? toCoach(row) : undefined;
}

/** Every coach, archived or not, for the admin screens. */
export async function listAllCoaches(): Promise<AdminCoach[]> {
  const rows = await prisma.coach.findMany({
    orderBy: { coachId: "asc" },
    select: adminCoachSelect,
  });

  return rows.map(toAdminCoach);
}

// ---------------------------------------------------------------- writes

export interface CoachFields {
  fullName: string;
  /** Already trimmed and lowercased. */
  email: string;
  title: string;
  bio: string;
  imageUrl: string | null;
}

export type CreateCoachResult =
  | { ok: true; coach: AdminCoach }
  | { ok: false; reason: "email-taken" };

/**
 * Creates the account and the coach profile together, so neither can exist
 * without the other. The password is 32 random bytes that are hashed and then
 * discarded: nobody knows it, and the coach gets in through an invite.
 */
export async function createCoach(
  input: CoachFields,
  actorId: number,
): Promise<CreateCoachResult> {
  const { hash, salt } = hashPassword(randomBytes(32).toString("base64url"));

  try {
    return await prisma.$transaction(async (tx): Promise<CreateCoachResult> => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          role: "Coach",
          passwordHash: hash,
          passwordSalt: salt,
          coach: {
            create: {
              title: input.title,
              bio: input.bio,
              imageUrl: input.imageUrl,
            },
          },
        },
        select: { id: true },
      });
      await audit(
        {
          actorId,
          action: "coach.create",
          entity: "Coach",
          entityId: user.id,
          detail: { email: input.email },
        },
        tx,
      );

      const row = await tx.coach.findUniqueOrThrow({
        where: { coachId: user.id },
        select: adminCoachSelect,
      });

      return { ok: true, coach: toAdminCoach(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2002")) return { ok: false, reason: "email-taken" };
    throw e;
  }
}

export type UpdateCoachResult =
  | { ok: true; coach: AdminCoach }
  | { ok: false; reason: "not-found" | "email-taken" };

/** Changes only the fields given, on the account and the profile together. */
export async function updateCoach(
  id: number,
  changes: Partial<CoachFields>,
  actorId: number,
): Promise<UpdateCoachResult> {
  const { fullName, email, ...profile } = changes;

  try {
    return await prisma.$transaction(async (tx): Promise<UpdateCoachResult> => {
      if (!(await lockCoach(tx, id))) return { ok: false, reason: "not-found" };

      if (fullName !== undefined || email !== undefined) {
        await tx.user.update({ where: { id }, data: { fullName, email } });
      }
      const row = await tx.coach.update({
        where: { coachId: id },
        data: profile,
        select: adminCoachSelect,
      });
      await audit(
        {
          actorId,
          action: "coach.update",
          entity: "Coach",
          entityId: id,
          detail: { fields: Object.keys(changes).sort().join(",") },
        },
        tx,
      );

      return { ok: true, coach: toAdminCoach(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2002")) return { ok: false, reason: "email-taken" };
    if (hasCode(e, "P2025")) return { ok: false, reason: "not-found" };
    throw e;
  }
}

export type ArchiveCoachResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-archived" }
  | { ok: false; reason: "has-classes"; count: number };

/**
 * Archives a coach who teaches no active class. The coach row is locked
 * before the count, and adding a class locks the same row, so a class cannot
 * be given to the coach between the count and the update.
 */
export async function archiveCoach(
  id: number,
  actorId: number,
): Promise<ArchiveCoachResult> {
  return prisma.$transaction(async (tx): Promise<ArchiveCoachResult> => {
    const existing = await lockCoach(tx, id);
    if (!existing) return { ok: false, reason: "not-found" };
    if (!existing.isActive) return { ok: false, reason: "already-archived" };

    const count = await tx.gymClass.count({
      where: { coachId: id, isActive: true },
    });
    if (count > 0) return { ok: false, reason: "has-classes", count };

    await tx.coach.update({ where: { coachId: id }, data: { isActive: false } });
    await audit(
      { actorId, action: "coach.archive", entity: "Coach", entityId: id },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}

export type RestoreCoachResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-active" };

export async function restoreCoach(
  id: number,
  actorId: number,
): Promise<RestoreCoachResult> {
  return prisma.$transaction(async (tx): Promise<RestoreCoachResult> => {
    const existing = await lockCoach(tx, id);
    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.isActive) return { ok: false, reason: "already-active" };

    await tx.coach.update({ where: { coachId: id }, data: { isActive: true } });
    await audit(
      { actorId, action: "coach.restore", entity: "Coach", entityId: id },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}
