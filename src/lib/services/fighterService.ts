import "server-only";

import {
  demote,
  getFighter,
  listAdminFighters,
  promote,
} from "@/lib/repositories/fightersRepository";
import { listForFighter } from "@/lib/repositories/participationsRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  isAdmin,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import {
  type AdminFighter,
  type BoutOffer,
  type Fighter,
  type FighterOffers,
  ROLES,
  type ServiceResult,
  type SessionUser,
} from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * Business rules for who is a fighter.
 *
 * Like the booking service, every function takes the session as a parameter
 * and checks the role itself, so the rules hold whichever page, action or
 * route calls them and can be tested without a request.
 */

const NOT_FOUND_MEMBER = "That member could not be found.";
const NOT_FOUND_FIGHTER = "That fighter could not be found.";

/** Every fighter, with whether each can be demoted. Admin only. */
export async function listFightersForAdmin(
  session: SessionUser,
): Promise<ServiceResult<AdminFighter[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listAdminFighters());
  } catch (e) {
    return failure(e);
  }
}

export async function promoteToFighter(
  session: SessionUser,
  memberId: unknown,
  weightClass: unknown,
): Promise<ServiceResult<Fighter>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(memberId)) {
    return fail(400, "memberId must be a positive integer.");
  }
  const weightError = RULES.weightClass(
    typeof weightClass === "string" ? weightClass : "",
  );
  if (weightError) return fail(400, weightError);

  try {
    const result = await promote(
      memberId,
      (weightClass as string).trim(),
      session.id,
    );

    if (!result.ok) {
      return result.reason === "already-fighter"
        ? fail(409, "That member is already a fighter.")
        : fail(404, NOT_FOUND_MEMBER);
    }

    return succeed(result.fighter, 201);
  } catch (e) {
    return failure(e);
  }
}

export async function demoteFighter(
  session: SessionUser,
  fighterId: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(fighterId)) {
    return fail(400, "fighterId must be a positive integer.");
  }

  try {
    const result = await demote(fighterId, session.id);

    if (!result.ok) {
      return result.reason === "has-history"
        ? fail(
            409,
            "A fighter with bout offers or documents cannot be demoted.",
          )
        : fail(404, NOT_FOUND_FIGHTER);
    }

    return succeed({ id: fighterId });
  } catch (e) {
    return failure(e);
  }
}

/**
 * The signed-in fighter's profile and offers, grouped for the dashboard.
 *
 * An offer is "past" once its event has started or stopped being Scheduled,
 * whatever the answer was. Before that, a declined offer stays visible so the
 * fighter can still change their mind.
 */
export async function listMyOffers(
  session: SessionUser,
  now: Date = new Date(),
): Promise<ServiceResult<FighterOffers>> {
  if (session.role !== ROLES.Fighter) {
    return fail(403, "Only fighters have bout offers.");
  }

  try {
    const [fighter, offers] = await Promise.all([
      getFighter(session.id),
      listForFighter(session.id),
    ]);
    if (!fighter) return fail(404, NOT_FOUND_FIGHTER);

    const pending: BoutOffer[] = [];
    const accepted: BoutOffer[] = [];
    const declined: BoutOffer[] = [];
    const past: BoutOffer[] = [];

    for (const offer of offers) {
      const open =
        offer.eventStatus === "Scheduled" && new Date(offer.eventDate) > now;

      if (!open) past.push(offer);
      else if (offer.availability === "Accepted") accepted.push(offer);
      else if (offer.availability === "Declined") declined.push(offer);
      else pending.push(offer);
    }

    // The repository returns soonest first, which suits what is still to
    // come. History reads the other way: the latest bout first.
    past.reverse();

    return succeed({ fighter, pending, accepted, declined, past });
  } catch (e) {
    return failure(e);
  }
}
