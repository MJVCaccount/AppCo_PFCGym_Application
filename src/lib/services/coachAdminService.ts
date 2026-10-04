import "server-only";

import { logger } from "@/lib/logger";
import {
  archiveCoach as archiveRow,
  type CoachFields,
  createCoach as insertCoach,
  listAllCoaches,
  restoreCoach as restoreRow,
  updateCoach as updateRow,
} from "@/lib/repositories/coachesRepository";
import { inviteService } from "@/lib/services/inviteService";
import {
  ADMIN_ONLY,
  fail,
  failure,
  invalid,
  INVALID_INPUT,
  isAdmin,
  isOptionalString,
  isRecord,
  isValidId,
  type Parsed,
  succeed,
} from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";
import type { AdminCoach, ServiceResult, SessionUser } from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * Business rules for managing the coaching team. Admin only.
 *
 * Archiving hides a coach from the public Coaches page and from the class
 * form; their account, classes and attendance history are all kept.
 */

const NOT_FOUND_COACH = "That coach could not be found.";
const EMAIL_TAKEN = "That email is already registered.";
const MAX_EMAIL = 254;

const RULE = {
  fullName: RULES.text(2, 80, "Full name"),
  title: RULES.text(2, 80, "Title"),
  bio: RULES.text(10, 1000, "Bio"),
};

export interface CoachInput {
  fullName?: unknown;
  email?: unknown;
  title?: unknown;
  bio?: unknown;
  imageUrl?: unknown;
}

function parseCoachFields(
  input: CoachInput,
  partial: boolean,
): Parsed<Partial<CoachFields>> {
  const fields: Partial<CoachFields> = {};
  const sent = (value: unknown) => !partial || value !== undefined;

  if (sent(input.fullName)) {
    const error = RULE.fullName(input.fullName);
    if (error) return { error, field: "fullName" };
    fields.fullName = (input.fullName as string).trim();
  }

  if (sent(input.email)) {
    const email = typeof input.email === "string" ? input.email.trim() : "";
    const error = email.length > MAX_EMAIL ? "That email is too long." : RULES.email(email);
    if (error) return { error, field: "email" };
    fields.email = email.toLowerCase();
  }

  if (sent(input.title)) {
    const error = RULE.title(input.title);
    if (error) return { error, field: "title" };
    fields.title = (input.title as string).trim();
  }

  if (sent(input.bio)) {
    const error = RULE.bio(input.bio);
    if (error) return { error, field: "bio" };
    fields.bio = (input.bio as string).trim();
  }

  // Optional: left out, null and "" all mean "no image".
  if (input.imageUrl !== undefined || !partial) {
    const error = isOptionalString(input.imageUrl)
      ? RULES.url(input.imageUrl ?? "")
      : "Image URL must be text.";
    if (error) return { error, field: "imageUrl" };
    fields.imageUrl = optionalText(input.imageUrl);
  }

  return { value: fields };
}

export async function listCoaches(
  session: SessionUser,
): Promise<ServiceResult<AdminCoach[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listAllCoaches());
  } catch (e) {
    return failure(e);
  }
}

/**
 * Creates a Coach account with a password nobody knows, then hands the new
 * user to the invite service. A failed invite is logged and does not undo the
 * account: the coach exists and can be invited again.
 */
export async function createCoach(
  session: SessionUser,
  input: unknown,
): Promise<ServiceResult<AdminCoach>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(input)) return fail(400, INVALID_INPUT);

  const parsed = parseCoachFields(input, false);
  if ("error" in parsed) return invalid(parsed);

  let coach: AdminCoach;
  try {
    const result = await insertCoach(parsed.value as CoachFields, session.id);
    if (!result.ok) return fail(409, EMAIL_TAKEN, "email");
    coach = result.coach;
  } catch (e) {
    return failure(e);
  }

  try {
    await inviteService.sendCoachInvite(coach.id);
  } catch (e) {
    logger.warn("Coach invite failed", { coachId: coach.id, error: e });
  }

  return succeed(coach, 201);
}

export async function updateCoach(
  session: SessionUser,
  id: unknown,
  patch: unknown,
): Promise<ServiceResult<AdminCoach>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (!isRecord(patch)) return fail(400, INVALID_INPUT);

  const parsed = parseCoachFields(patch, true);
  if ("error" in parsed) return invalid(parsed);
  if (Object.keys(parsed.value).length === 0) {
    return fail(400, "Send at least one field to change.");
  }

  try {
    const result = await updateRow(id, parsed.value, session.id);

    if (!result.ok) {
      return result.reason === "email-taken"
        ? fail(409, EMAIL_TAKEN, "email")
        : fail(404, NOT_FOUND_COACH);
    }

    return succeed(result.coach);
  } catch (e) {
    return failure(e);
  }
}

export async function archiveCoach(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await archiveRow(id, session.id);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_COACH);
        case "already-archived":
          return fail(409, "That coach is already archived.");
        case "has-classes":
          return fail(
            409,
            `This coach still teaches ${result.count} active ${result.count === 1 ? "class" : "classes"}. Reassign or deactivate ${result.count === 1 ? "it" : "them"} first.`,
          );
      }
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}

export async function restoreCoach(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await restoreRow(id, session.id);

    if (!result.ok) {
      return result.reason === "already-active"
        ? fail(409, "That coach is already active.")
        : fail(404, NOT_FOUND_COACH);
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}
