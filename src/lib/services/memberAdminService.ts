import "server-only";

import {
  deactivateUser as deactivateRow,
  listPromotable,
  listUsers,
  reactivateUser as reactivateRow,
  setPlan,
} from "@/lib/repositories/usersRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  INVALID_INPUT,
  isAdmin,
  isOptionalString,
  isRecord,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";
import type {
  MemberOption,
  MemberPage,
  ServiceResult,
  SessionUser,
} from "@/lib/types";

/**
 * Business rules for managing accounts. Admin only.
 *
 * Nothing here ever reads or returns a password hash or salt: the repository
 * selects the listed columns by name.
 */

export const MEMBERS_PAGE_SIZE = 25;
const MAX_SEARCH = 100;
const MAX_PAGE = 100_000;

const NOT_FOUND_USER = "That account could not be found.";

/**
 * One page of accounts, 25 at a time, with the total that match. `search`
 * matches part of a name or email in any letter case; blank lists everyone.
 */
export async function listMembers(
  session: SessionUser,
  query: unknown = {},
): Promise<ServiceResult<MemberPage>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(query)) return fail(400, INVALID_INPUT);

  if (!isOptionalString(query.search)) {
    return fail(400, "Search must be text.", "search");
  }
  const search = optionalText(query.search);
  if (search !== null && search.length > MAX_SEARCH) {
    return fail(400, `Search must be at most ${MAX_SEARCH} characters.`, "search");
  }

  const page = query.page ?? 1;
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_PAGE
  ) {
    return fail(400, "Page must be a positive whole number.", "page");
  }

  try {
    const { items, total } = await listUsers({
      search,
      page,
      pageSize: MEMBERS_PAGE_SIZE,
    });

    return succeed({
      items,
      total,
      page,
      pageSize: MEMBERS_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE)),
    });
  } catch (e) {
    return failure(e);
  }
}

/** Active members who could be promoted to Fighter, for a dropdown. */
export async function listPromotableMembers(
  session: SessionUser,
): Promise<ServiceResult<MemberOption[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listPromotable());
  } catch (e) {
    return failure(e);
  }
}

/** Moves a member onto a plan, or off every plan with null. */
export async function setMemberPlan(
  session: SessionUser,
  memberId: unknown,
  planId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ memberId: number; planId: number | null }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(memberId)) {
    return fail(400, "memberId must be a positive integer.");
  }
  if (planId !== null && !isValidId(planId)) {
    return fail(400, "planId must be a positive integer or null.", "planId");
  }

  try {
    const outcome = await setPlan(memberId, planId, {
      actorId: session.id,
      now,
    });

    if (outcome === "no-plan") {
      return fail(404, "That plan could not be found, or is retired.", "planId");
    }
    if (outcome === "no-member") {
      return fail(404, "That account does not hold a membership.");
    }

    return succeed({ memberId, planId });
  } catch (e) {
    return failure(e);
  }
}

/**
 * Deactivates an account: it can no longer sign in, any session it holds
 * stops working on its next request, and its future bookings are cancelled.
 *
 * An admin cannot deactivate themselves, and the last active admin cannot be
 * deactivated at all, so the gym can never be locked out of its own system.
 */
export async function deactivateUser(
  session: SessionUser,
  userId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ id: number; cancelledBookings: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(userId)) return fail(400, "userId must be a positive integer.");
  if (userId === session.id) {
    return fail(409, "You cannot deactivate your own account.");
  }

  try {
    const result = await deactivateRow(userId, session.id, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_USER);
        case "already-inactive":
          return fail(409, "That account is already deactivated.");
        case "last-admin":
          return fail(409, "The last active administrator cannot be deactivated.");
        case "actor-inactive":
          return fail(403, ADMIN_ONLY);
      }
    }

    return succeed({ id: userId, cancelledBookings: result.cancelledBookings });
  } catch (e) {
    return failure(e);
  }
}

export async function reactivateUser(
  session: SessionUser,
  userId: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(userId)) return fail(400, "userId must be a positive integer.");

  try {
    const result = await reactivateRow(userId, session.id);

    if (!result.ok) {
      return result.reason === "already-active"
        ? fail(409, "That account is already active.")
        : fail(404, NOT_FOUND_USER);
    }

    return succeed({ id: userId });
  } catch (e) {
    return failure(e);
  }
}
