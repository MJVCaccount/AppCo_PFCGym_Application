import "server-only";

import type { MembershipPlan as PlanRow } from "@prisma/client";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import type { MembershipPlan } from "@/lib/types";

/** Data-access layer for membership plans. */

function toPlan(row: PlanRow): MembershipPlan {
  return {
    id: row.id,
    pricePerMonth: row.pricePerMonth,
    isMostPopular: row.isMostPopular,
    features: [...row.features],
  };
}

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
