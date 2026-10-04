import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { hashPassword } from "@/lib/password";
import {
  consumeToken,
  isTokenUsable,
  replaceToken,
} from "@/lib/repositories/passwordResetRepository";
import { findByEmail } from "@/lib/repositories/usersRepository";
import {
  notifyCoachInvite,
  notifyPasswordReset,
} from "@/lib/services/notificationService";
import {
  fail,
  failure,
  INVALID_INPUT,
  succeed,
} from "@/lib/services/serviceResult";
import type { ServiceResult, UserAccount } from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * Forgotten passwords and first-time passwords for invited coaches.
 *
 * A token is 32 random bytes, sent as base64url in a link. The database keeps
 * only its sha256 hash, so a leaked table cannot be used to reset anyone.
 *
 * Rate limiting is deliberately not here yet. requestReset and resetPassword
 * are single entry points, so a limiter can wrap each call where the action
 * makes it (as it can wrap login).
 */

export const RESET_TOKEN_MINUTES = 60;
export const INVITE_TOKEN_DAYS = 7;

export const RESET_REQUESTED =
  "If that email is registered, a reset link is on its way.";
export const RESET_INVALID = "This reset link is invalid or has expired.";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/**
 * Asks for a reset link. Whatever the email is, the answer is the same: a
 * response that said "no such account" would tell anyone which addresses are
 * registered. For an unknown address the same amount of hashing is done on a
 * random token, so the response time does not give it away either.
 */
export async function requestReset(
  email: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ message: string }>> {
  const generic = succeed({ message: RESET_REQUESTED });

  if (typeof email !== "string" || RULES.email(email) !== null) return generic;

  try {
    const user = await findByEmail(email);

    if (!user || !user.isActive) {
      newToken(); // comparable work; the result is thrown away
      return generic;
    }

    const { token, tokenHash } = newToken();
    await replaceToken({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * MINUTE),
    });
    notifyPasswordReset(user, token, RESET_TOKEN_MINUTES);
  } catch (e) {
    // Even a failure answers the same way, and is only logged by the mapper.
    failure(e);
  }

  return generic;
}

/** Whether a link from an email can still be used. */
export async function checkResetToken(
  token: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) {
    return false;
  }

  try {
    return await isTokenUsable(hashToken(token), now);
  } catch (e) {
    failure(e);
    return false;
  }
}

/**
 * Sets a new password from a reset link. An unknown, used or expired token all
 * get the one message, RESET_INVALID. On success every session of the account
 * is signed out.
 */
export async function resetPassword(
  token: unknown,
  newPassword: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ userId: number }>> {
  if (typeof token !== "string" || typeof newPassword !== "string") {
    return fail(400, INVALID_INPUT);
  }
  if (token.length === 0 || token.length > 200) return fail(400, RESET_INVALID);

  const tooWeak = RULES.password(newPassword);
  if (tooWeak) return fail(400, tooWeak, "password");

  try {
    const { hash, salt } = hashPassword(newPassword);
    const result = await consumeToken({
      tokenHash: hashToken(token),
      passwordHash: hash,
      passwordSalt: salt,
      now,
    });

    return result.ok
      ? succeed({ userId: result.userId })
      : fail(400, RESET_INVALID);
  } catch (e) {
    return failure(e);
  }
}

/**
 * Creates a token for an account and emails the link, for a coach an admin
 * has invited. `actorId` has the issue audited. The link opens the same page
 * as a password reset.
 */
export async function sendInvite(
  user: Pick<UserAccount, "id" | "fullName" | "email">,
  actorId: number,
  now: Date = new Date(),
): Promise<void> {
  const { token, tokenHash } = newToken();

  await replaceToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(now.getTime() + INVITE_TOKEN_DAYS * DAY),
    audit: { actorId, action: "coach.invite" },
  });
  notifyCoachInvite(user, token, INVITE_TOKEN_DAYS);
}
