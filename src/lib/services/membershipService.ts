import "server-only";

import { mapPrismaError } from "@/lib/errors";
import { getPlan } from "@/lib/repositories/plansRepository";
import {
  cancelMembership as clearPlan,
  setPlan,
} from "@/lib/repositories/usersRepository";
import {
  isMemberRole,
  type MembershipPlan,
  type SessionUser,
} from "@/lib/types";

/**
 * Business rules for changing or cancelling a membership.
 *
 * Like the booking service, this takes the session as a parameter so it can
 * be tested without a request. Only the account's own member may change it:
 * the id always comes from the session, never from the form.
 */
export interface MembershipResult {
  ok: boolean;
  status: number;
  error?: string;
  plan?: MembershipPlan;
}

const STAFF_ERROR = "Staff accounts do not hold a membership.";
const NO_PLAN_ERROR = "That plan could not be found.";
const NO_MEMBER_ERROR = "That membership could not be found.";

export async function changePlan(
  session: SessionUser,
  planId: number,
): Promise<MembershipResult> {
  if (!isMemberRole(session.role)) {
    return { ok: false, status: 403, error: STAFF_ERROR };
  }

  try {
    const plan = await getPlan(planId);
    if (!plan) return { ok: false, status: 404, error: NO_PLAN_ERROR };

    const outcome = await setPlan(session.id, planId);
    if (outcome === "no-plan") {
      return { ok: false, status: 404, error: NO_PLAN_ERROR };
    }
    if (outcome === "no-member") {
      return { ok: false, status: 404, error: NO_MEMBER_ERROR };
    }

    return { ok: true, status: 200, plan };
  } catch (e) {
    const error = mapPrismaError(e);
    return { ok: false, status: error.status, error: error.message };
  }
}

export async function cancelMembership(
  session: SessionUser,
): Promise<MembershipResult> {
  if (!isMemberRole(session.role)) {
    return { ok: false, status: 403, error: STAFF_ERROR };
  }

  try {
    const cancelled = await clearPlan(session.id);
    if (!cancelled) return { ok: false, status: 404, error: NO_MEMBER_ERROR };

    return { ok: true, status: 200 };
  } catch (e) {
    const error = mapPrismaError(e);
    return { ok: false, status: error.status, error: error.message };
  }
}
