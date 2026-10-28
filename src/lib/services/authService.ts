import "server-only";

import { ERROR_CODES, mapPrismaError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { checkPassword, isPasswordLengthAcceptable } from "@/lib/passwordPolicy";
import { getPlan } from "@/lib/repositories/plansRepository";
import { createHash } from "node:crypto";

import { record as audit } from "@/lib/repositories/auditRepository";
import {
  bumpSessionVersion,
  createMember,
  findByEmail,
  toSessionUser,
  validateCredentials,
} from "@/lib/repositories/usersRepository";
import { notifyWelcome } from "@/lib/services/notificationService";
import { fail, failure, succeed } from "@/lib/services/serviceResult";
import type { ServiceResult, SessionUser } from "@/lib/types";

/**
 * Sign-in and sign-up rules. The actions parse the form, apply the rate
 * limits and set the session cookie; everything between is here. Both
 * functions return the SessionUser to put in the cookie.
 */

export const BAD_CREDENTIALS = "Email or password is incorrect.";
export const EMAIL_TAKEN = "That email is already registered.";
export const UNKNOWN_PLAN = "Choose one of the listed plans.";

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  /** The raw form value: empty for "no plan yet". */
  planId: string;
}

/**
 * Checks an email and password. A wrong password, an unknown email and a
 * deactivated account give the same answer, so the response tells an attacker
 * nothing about which addresses have accounts.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<ServiceResult<SessionUser>> {
  // An enormous password is refused before scrypt sees it, and answered like
  // any other wrong password.
  if (!isPasswordLengthAcceptable(password)) return fail(401, BAD_CREDENTIALS);

  try {
    const user = await validateCredentials(email, password);
    if (!user) return fail(401, BAD_CREDENTIALS);

    return succeed(toSessionUser(user));
  } catch (e) {
    return failure(e);
  }
}

/** Creates a member account and sends the welcome email once it is saved. */
export async function register(
  input: RegisterInput,
): Promise<ServiceResult<SessionUser>> {
  const emailTaken = () => fail<SessionUser>(409, EMAIL_TAKEN, "email");

  const weak = checkPassword(input.password);
  if (weak) return fail(400, weak, "password");

  try {
    if (await findByEmail(input.email)) return emailTaken();

    const planId = input.planId ? Number(input.planId) : null;

    if (planId !== null && !(await getPlan(planId))) {
      return fail(400, UNKNOWN_PLAN, "planId");
    }

    const user = await createMember({
      email: input.email,
      fullName: input.fullName,
      phone: input.phone,
      password: input.password,
      planId,
    });

    notifyWelcome(user);

    return succeed(toSessionUser(user), 201);
  } catch (e) {
    const error = mapPrismaError(e);

    // Two sign-ups with the same address can both pass the check above. The
    // unique index stops the second one, and it gets the same field error.
    if (error.code === ERROR_CODES.conflict) return emailTaken();

    return fail(error.status, error.message);
  }
}

/**
 * Signs the caller out of every device, this one included: the account's
 * sessionVersion goes up and each cookie issued before now stops working. The
 * caller clears their own cookie as well (the route does).
 */
export async function signOutEverywhere(
  session: SessionUser,
): Promise<ServiceResult<{ signedOut: true }>> {
  try {
    const done = await bumpSessionVersion(session.id, session.id, "session.revoke_all");
    return done ? succeed({ signedOut: true }) : fail(404, "That account could not be found.");
  } catch (e) {
    return failure(e);
  }
}

/**
 * Writes an audit row when sign-in attempts first hit a limit, so a burst of
 * guesses shows up in the admin audit page. One row per lockout, not one per
 * refused attempt. The address is stored as a short hash, never in clear.
 */
export async function recordLoginLockout(input: {
  policy: "loginIpEmail" | "loginIp";
  email: string;
  ip: string;
}): Promise<void> {
  try {
    const user = input.policy === "loginIpEmail" ? await findByEmail(input.email) : undefined;
    await audit({
      actorId: null,
      action: "login.lockout",
      entity: "User",
      entityId: user?.id ?? null,
      detail: {
        policy: input.policy,
        client: createHash("sha256").update(input.ip).digest("hex").slice(0, 12),
      },
    });
  } catch (e) {
    // The lockout itself already happened; a failed audit row must not turn
    // a refusal into a crash.
    logger.warn("Could not record a sign-in lockout", { error: e });
  }
}
