import "server-only";

import { Prisma } from "@prisma/client";
import type { MembershipPlan as PlanRow } from "@prisma/client";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import type { AdminPlan, MembershipPlan } from "@/lib/types";

/** Data-access layer for membership plans. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

function toPlan(row: PlanRow): MembershipPlan {
  return {
    id: row.id,
    pricePerMonth: row.pricePerMonth,
    isMostPopular: row.isMostPopular,
    features: [...row.features],
  };
}

const adminPlanSelect = {
  id: true,
  pricePerMonth: true,
  isMostPopular: true,
  features: true,
  isActive: true,
  _count: { select: { members: { where: { user: { isActive: true } } } } },
} satisfies Prisma.MembershipPlanSelect;

type AdminPlanRow = Prisma.MembershipPlanGetPayload<{
  select: typeof adminPlanSelect;
}>;

function toAdminPlan(row: AdminPlanRow): AdminPlan {
  return {
    id: row.id,
    pricePerMonth: row.pricePerMonth,
    isMostPopular: row.isMostPopular,
    features: [...row.features],
    isActive: row.isActive,
    activeMembers: row._count.members,
  };
}

/**
 * Locks every plan row, in id order. Plan writes all start here, so they run
 * one at a time: two admins each marking a different plan "most popular"
 * cannot both win, and cannot deadlock by unsetting each other's rows.
 */
async function lockPlans(tx: Prisma.TransactionClient): Promise<number[]> {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "MembershipPlan" ORDER BY "id" FOR UPDATE`;

  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------- reads

/**
 * Active plans in display order. Wrapped in React's cache so the page, the
 * plan cards and the sticky bar share one query per request.
 */
export const getPlans = cache(async (): Promise<MembershipPlan[]> => {
  const rows = await prisma.membershipPlan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  return rows.map(toPlan);
});

/**
 * One plan by id. Only active plans by default, which is what choosing a plan
 * needs; pass `includeInactive` to show a member the retired plan they are
 * still on.
 */
export async function getPlan(
  id: number,
  options: { includeInactive?: boolean } = {},
): Promise<MembershipPlan | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;

  const row = await prisma.membershipPlan.findFirst({
    where: options.includeInactive ? { id } : { id, isActive: true },
  });

  return row ? toPlan(row) : undefined;
}

/** The lowest monthly price among active plans, or 0 when there are none. */
export async function getCheapestPlanPrice(): Promise<number> {
  const plans = await getPlans();
  if (plans.length === 0) return 0;

  return Math.min(...plans.map((plan) => plan.pricePerMonth));
}

/** Every plan, retired or not, in display order, for the admin screens. */
export async function listAllPlans(): Promise<AdminPlan[]> {
  const rows = await prisma.membershipPlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: adminPlanSelect,
  });

  return rows.map(toAdminPlan);
}

// ---------------------------------------------------------------- writes

export interface PlanFields {
  pricePerMonth: number;
  features: string[];
  isMostPopular: boolean;
}

/** Only one plan is "most popular": unset it on every other plan. */
async function unsetOtherPopular(
  tx: Prisma.TransactionClient,
  keepId: number,
): Promise<void> {
  await tx.membershipPlan.updateMany({
    where: { id: { not: keepId }, isMostPopular: true },
    data: { isMostPopular: false },
  });
}

export async function createPlan(
  input: PlanFields,
  actorId: number,
): Promise<AdminPlan> {
  return prisma.$transaction(async (tx) => {
    await lockPlans(tx);

    const last = await tx.membershipPlan.aggregate({ _max: { sortOrder: true } });
    const row = await tx.membershipPlan.create({
      data: { ...input, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: adminPlanSelect,
    });
    if (input.isMostPopular) await unsetOtherPopular(tx, row.id);

    await audit(
      {
        actorId,
        action: "plan.create",
        entity: "MembershipPlan",
        entityId: row.id,
        detail: {
          pricePerMonth: row.pricePerMonth,
          isMostPopular: row.isMostPopular,
        },
      },
      tx,
    );

    return toAdminPlan(row);
  }, TRANSACTION_OPTIONS);
}

export type UpdatePlanResult =
  | { ok: true; plan: AdminPlan }
  | { ok: false; reason: "not-found" };

/** Changes only the fields given. */
export async function updatePlan(
  id: number,
  changes: Partial<PlanFields>,
  actorId: number,
): Promise<UpdatePlanResult> {
  return prisma.$transaction(async (tx): Promise<UpdatePlanResult> => {
    if (!(await lockPlans(tx)).includes(id)) {
      return { ok: false, reason: "not-found" };
    }

    const row = await tx.membershipPlan.update({
      where: { id },
      data: changes,
      select: adminPlanSelect,
    });
    if (changes.isMostPopular) await unsetOtherPopular(tx, id);

    await audit(
      {
        actorId,
        action: "plan.update",
        entity: "MembershipPlan",
        entityId: id,
        detail: { fields: Object.keys(changes).sort().join(",") },
      },
      tx,
    );

    return { ok: true, plan: toAdminPlan(row) };
  }, TRANSACTION_OPTIONS);
}

export type DeactivatePlanResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-inactive" }
  | { ok: false; reason: "has-members"; count: number };

/**
 * Retires a plan nobody active is on. Joining a plan share-locks its row (see
 * usersRepository.setPlan), so a member cannot join between the count and the
 * update.
 */
export async function deactivatePlan(
  id: number,
  actorId: number,
): Promise<DeactivatePlanResult> {
  return prisma.$transaction(async (tx): Promise<DeactivatePlanResult> => {
    if (!(await lockPlans(tx)).includes(id)) {
      return { ok: false, reason: "not-found" };
    }

    const existing = await tx.membershipPlan.findUniqueOrThrow({
      where: { id },
      select: { isActive: true },
    });
    if (!existing.isActive) return { ok: false, reason: "already-inactive" };

    const count = await tx.member.count({
      where: { planId: id, user: { isActive: true } },
    });
    if (count > 0) return { ok: false, reason: "has-members", count };

    await tx.membershipPlan.update({
      where: { id },
      data: { isActive: false, isMostPopular: false },
    });
    await audit(
      {
        actorId,
        action: "plan.deactivate",
        entity: "MembershipPlan",
        entityId: id,
      },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
}
