import "server-only";

import { getPlan } from "@/lib/repositories/plansRepository";
import {
  cancelMembership as clearPlan,
  findById,
  setPlan,
} from "@/lib/repositories/usersRepository";
import { fail, failure, succeed } from "@/lib/services/serviceResult";
import {
  isMemberRole,
  type MembershipPlan,
  type ServiceResult,
  type SessionUser,
  type UserAccount,
} from "@/lib/types";

/**
 * Business rules for changing or cancelling a membership.
 *
 * Like the booking service, this takes the session as a parameter so it can
 * be tested without a request. Only the account's own member may change it:
 * the id always comes from the session, never from the form.
 */
const STAFF_ERROR = "Staff accounts do not hold a membership.";
const NO_PLAN_ERROR = "That plan could not be found.";
const NO_MEMBER_ERROR = "That membership could not be found.";

export async function changePlan(
  session: SessionUser,
  planId: number,
): Promise<ServiceResult<MembershipPlan>> {
  if (!isMemberRole(session.role)) return fail(403, STAFF_ERROR);

  try {
    const plan = await getPlan(planId);
    if (!plan) return fail(404, NO_PLAN_ERROR);

    const outcome = await setPlan(session.id, planId);
    if (outcome === "no-plan") return fail(404, NO_PLAN_ERROR);
    if (outcome === "no-member") return fail(404, NO_MEMBER_ERROR);

    return succeed(plan);
  } catch (e) {
    return failure(e);
  }
}

export async function cancelMembership(
  session: SessionUser,
): Promise<ServiceResult<null>> {
  if (!isMemberRole(session.role)) return fail(403, STAFF_ERROR);

  try {
    const cancelled = await clearPlan(session.id);
    if (!cancelled) return fail(404, NO_MEMBER_ERROR);

    return succeed(null);
  } catch (e) {
    return failure(e);
  }
}

/**
 * The account and the plan it is on, for the pages that show "your plan". A
 * plan since retired is still returned, so a member sees what they hold.
 */
export async function getMembership(
  userId: number,
): Promise<{ user: UserAccount | undefined; plan: MembershipPlan | undefined }> {
  const user = await findById(userId);
  const planId = user?.planId;
  const plan =
    planId === undefined || planId === null
      ? undefined
      : await getPlan(planId, { includeInactive: true });

  return { user, plan };
}
