import "server-only";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";

/**
 * Data-access layer for password reset tokens.
 *
 * Only the sha256 hash of a token is ever stored: a leaked database cannot be
 * turned into working reset links. The raw token exists in the email and in
 * the link the user clicks, nowhere else.
 */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

/**
 * Stores a new token for a user and deletes their older unused ones, so only
 * the latest link works. Pass `actorId` when an admin triggers it (a coach
 * invite) to have the change audited in the same transaction.
 */
export async function replaceToken(input: {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  audit?: { actorId: number; action: string };
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId: input.userId, usedAt: null },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });

    if (input.audit) {
      await audit(
        {
          actorId: input.audit.actorId,
          action: input.audit.action,
          entity: "User",
          entityId: input.userId,
        },
        tx,
      );
    }
  }, TRANSACTION_OPTIONS);
}

/** Whether a token hash belongs to a token that is unused and not expired. */
export async function isTokenUsable(
  tokenHash: string,
  now: Date,
): Promise<boolean> {
  const count = await prisma.passwordResetToken.count({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
      user: { isActive: true },
    },
  });

  return count > 0;
}

export type ConsumeResult = { ok: true; userId: number } | { ok: false };

/**
 * Uses a token to set a new password, in one transaction: the token is marked
 * used, the password and salt change, the user's other tokens are deleted and
 * sessionVersion goes up (which signs out every existing session).
 *
 * The first statement is a conditional update. When two requests arrive with
 * the same token, Postgres lets one update the row; the other waits, then
 * re-checks "usedAt is null", matches nothing and gets `{ ok: false }`. So
 * exactly one of them wins.
 */
export async function consumeToken(input: {
  tokenHash: string;
  passwordHash: string;
  passwordSalt: string;
  now: Date;
}): Promise<ConsumeResult> {
  return prisma.$transaction(async (tx): Promise<ConsumeResult> => {
    const { count } = await tx.passwordResetToken.updateMany({
      where: {
        tokenHash: input.tokenHash,
        usedAt: null,
        expiresAt: { gt: input.now },
        user: { isActive: true },
      },
      data: { usedAt: input.now },
    });
    if (count === 0) return { ok: false };

    const token = await tx.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: input.tokenHash },
      select: { id: true, userId: true },
    });

    await tx.user.update({
      where: { id: token.userId },
      data: {
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.passwordResetToken.deleteMany({
      where: { userId: token.userId, id: { not: token.id } },
    });
    await audit(
      {
        actorId: token.userId,
        action: "password.reset",
        entity: "User",
        entityId: token.userId,
      },
      tx,
    );

    return { ok: true, userId: token.userId };
  }, TRANSACTION_OPTIONS);
}
