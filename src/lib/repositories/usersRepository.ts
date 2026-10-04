import "server-only";

import { Prisma } from "@prisma/client";

import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { optionalText } from "@/lib/text";
import type { Role, SessionUser, UserAccount } from "@/lib/types";

/**
 * Data-access layer for accounts (Task 1 §7.1.2).
 *
 * Emails are stored lowercased and every lookup lowercases its input, so
 * "Member@PFC.co.za" and "member@pfc.co.za" are the same account. The password
 * hash and salt are read only inside validateCredentials and never returned.
 */

const accountSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  member: { select: { planId: true } },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

function toAccount(row: AccountRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    role: row.role,
    planId: row.member?.planId ?? null,
    isActive: row.isActive,
  };
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025"
  );
}

/** The small identity a session cookie carries. */
export function toSessionUser(user: UserAccount): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

// ---------------------------------------------------------------- reads

export async function findByEmail(
  email: string,
): Promise<UserAccount | undefined> {
  const row = await prisma.user.findUnique({
    where: { email: normaliseEmail(email) },
    select: accountSelect,
  });

  return row ? toAccount(row) : undefined;
}

export async function findById(id: number): Promise<UserAccount | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;

  const row = await prisma.user.findUnique({
    where: { id },
    select: accountSelect,
  });

  return row ? toAccount(row) : undefined;
}

export async function getAll(): Promise<UserAccount[]> {
  const rows = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: accountSelect,
  });

  return rows.map(toAccount);
}

export async function countByRole(role: Role): Promise<number> {
  return prisma.user.count({ where: { role } });
}

// ---------------------------------------------------------------- auth

/**
 * Check an email and password pair.
 *
 * The comparison is fixed-time, so the response can't leak how much of the
 * hash matched. When the email is unknown we still run one hash before
 * returning, so a missing account takes as long as a wrong password — without
 * that, response timing alone reveals which addresses are registered. A
 * deactivated account is verified in full and then refused the same way.
 */
export async function validateCredentials(
  email: string,
  password: string,
): Promise<UserAccount | null> {
  const row = await prisma.user.findUnique({
    where: { email: normaliseEmail(email) },
    select: { ...accountSelect, passwordHash: true, passwordSalt: true },
  });

  if (!row) {
    hashPassword(password, "no-such-account");
    return null;
  }

  const matches = verifyPassword(password, row.passwordSalt, row.passwordHash);
  return matches && row.isActive ? toAccount(row) : null;
}

// ---------------------------------------------------------------- writes

/**
 * Creates the User and its Member row in one nested write, so an account can
 * never exist without its membership record. A duplicate email is rejected by
 * the unique index and surfaces as Prisma error P2002 for the caller to map.
 */
export async function createMember(input: {
  email: string;
  fullName: string;
  phone?: string | null;
  password: string;
  planId: number | null;
}): Promise<UserAccount> {
  const { hash, salt } = hashPassword(input.password);

  const row = await prisma.user.create({
    data: {
      email: normaliseEmail(input.email),
      fullName: input.fullName.trim(),
      phone: optionalText(input.phone),
      role: "Member",
      passwordHash: hash,
      passwordSalt: salt,
      member: {
        create: {
          planId: input.planId,
          planChangedAt: input.planId === null ? null : new Date(),
        },
      },
    },
    select: accountSelect,
  });

  return toAccount(row);
}

export type SetPlanResult = "ok" | "no-member" | "no-plan";

/**
 * Sets or clears a member's plan and stamps planChangedAt.
 *
 * The check that the plan is still on sale and the update share a
 * transaction, so a plan retired in between cannot be taken up.
 */
export async function setPlan(
  userId: number,
  planId: number | null,
): Promise<SetPlanResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (planId !== null) {
        const plan = await tx.membershipPlan.findFirst({
          where: { id: planId, isActive: true },
          select: { id: true },
        });
        if (!plan) return "no-plan";
      }

      await tx.member.update({
        where: { membershipId: userId },
        data: {
          planId,
          planChangedAt: new Date(),
          ...(planId === null ? {} : { cancelledAt: null }),
        },
      });

      return "ok";
    });
  } catch (e) {
    if (isNotFound(e)) return "no-member";
    throw e;
  }
}

/** Clears the plan and records when. Returns false if there is no member. */
export async function cancelMembership(userId: number): Promise<boolean> {
  try {
    await prisma.member.update({
      where: { membershipId: userId },
      data: { planId: null, cancelledAt: new Date() },
    });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}
