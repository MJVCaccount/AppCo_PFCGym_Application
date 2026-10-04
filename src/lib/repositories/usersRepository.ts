import "server-only";

import { Prisma } from "@prisma/client";

import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import { cancelFutureConfirmed } from "@/lib/repositories/bookingsRepository";
import { optionalText } from "@/lib/text";
import type {
  MemberListItem,
  MemberOption,
  Role,
  SessionUser,
  UserAccount,
} from "@/lib/types";

/**
 * Data-access layer for accounts (Task 1 §7.1.2).
 *
 * Emails are stored lowercased and every lookup lowercases its input, so
 * "Member@PFC.co.za" and "member@pfc.co.za" are the same account. The password
 * hash and salt are read only inside validateCredentials and never returned.
 */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_OPTIONS = 200;

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

/**
 * Accounts by id. Pass `limit` for anything a person reads: the dashboard
 * shows the first few and /admin/members pages through the rest.
 */
export async function getAll(limit?: number): Promise<UserAccount[]> {
  const rows = await prisma.user.findMany({
    orderBy: { id: "asc" },
    take: limit,
    select: accountSelect,
  });

  return rows.map(toAccount);
}

export async function countByRole(role: Role): Promise<number> {
  return prisma.user.count({ where: { role } });
}

/** What a session needs to know about its account on every request. */
export interface SessionState {
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  /** Bumped by a password reset; a cookie issued under an older value is dead. */
  sessionVersion: number;
}

export async function getSessionState(
  id: number,
): Promise<SessionState | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;

  const row = await prisma.user.findUnique({
    where: { id },
    select: {
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      sessionVersion: true,
    },
  });

  return row ?? undefined;
}

const listSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  member: { select: { planId: true } },
} satisfies Prisma.UserSelect;

/**
 * One page of accounts, by name, with the total that match. `search` matches
 * part of a name or an email, whatever the letter case. Prisma sends it as a
 * bound parameter, so it is only ever data.
 */
export async function listUsers(options: {
  search: string | null;
  page: number;
  pageSize: number;
}): Promise<{ items: MemberListItem[]; total: number }> {
  const where: Prisma.UserWhereInput = options.search
    ? {
        OR: [
          { fullName: { contains: options.search, mode: "insensitive" } },
          { email: { contains: options.search, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: listSelect,
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      isActive: row.isActive,
      planId: row.member?.planId ?? null,
    })),
  };
}

/** Active members who are not fighters yet, for the promote dropdown. */
export async function listPromotable(): Promise<MemberOption[]> {
  return prisma.user.findMany({
    where: { role: "Member", isActive: true, member: { isNot: null } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: MAX_OPTIONS,
    select: { id: true, fullName: true, email: true },
  });
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
 * The plan row is share-locked while the member is moved onto it, and
 * retiring a plan locks the same row, so a plan retired in between cannot be
 * taken up. Pass `actorId` when an admin makes the change for someone else:
 * the audit record is then written in the same transaction.
 */
export async function setPlan(
  userId: number,
  planId: number | null,
  options: { actorId?: number; now?: Date } = {},
): Promise<SetPlanResult> {
  const now = options.now ?? new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      if (planId !== null) {
        const [plan] = await tx.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "MembershipPlan"
          WHERE "id" = ${planId} AND "isActive" = true FOR SHARE`;
        if (!plan) return "no-plan";
      }

      await tx.member.update({
        where: { membershipId: userId },
        data: {
          planId,
          planChangedAt: now,
          ...(planId === null ? {} : { cancelledAt: null }),
        },
      });

      if (options.actorId !== undefined) {
        await audit(
          {
            actorId: options.actorId,
            action: "member.setPlan",
            entity: "Member",
            entityId: userId,
            detail: { planId },
          },
          tx,
        );
      }

      return "ok";
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (isNotFound(e)) return "no-member";
    throw e;
  }
}

interface LockedUser {
  id: number;
  role: Role;
  isActive: boolean;
}

async function lockUser(
  tx: Prisma.TransactionClient,
  id: number,
): Promise<LockedUser | undefined> {
  const [row] = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "role"::text AS "role", "isActive"
    FROM "User" WHERE "id" = ${id} FOR UPDATE`;

  return row;
}

export type DeactivateUserResult =
  | { ok: true; cancelledBookings: number }
  | {
      ok: false;
      reason: "not-found" | "already-inactive" | "last-admin" | "actor-inactive";
    };

/**
 * Deactivates an account and cancels its future Confirmed bookings together.
 *
 * The first statement locks every active admin row, in id order. That is the
 * queue all deactivations pass through: if the last two admins deactivate each
 * other at the same moment, the second waits for the first to commit, then
 * reads the admin list again, finds one admin left and is refused. The same
 * lock means the caller is checked too: an admin deactivated a moment ago
 * cannot go on to deactivate someone else.
 */
export async function deactivateUser(
  targetId: number,
  actorId: number,
  now: Date = new Date(),
): Promise<DeactivateUserResult> {
  return prisma.$transaction(async (tx): Promise<DeactivateUserResult> => {
    const admins = await tx.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "User"
      WHERE "role" = 'Admin' AND "isActive" = true
      ORDER BY "id" FOR UPDATE`;

    const target = await lockUser(tx, targetId);
    if (!target) return { ok: false, reason: "not-found" };
    if (!target.isActive) return { ok: false, reason: "already-inactive" };
    if (target.role === "Admin" && admins.length <= 1) {
      return { ok: false, reason: "last-admin" };
    }
    if (!admins.some((admin) => admin.id === actorId)) {
      return { ok: false, reason: "actor-inactive" };
    }

    await tx.user.update({ where: { id: targetId }, data: { isActive: false } });
    const cancelledBookings = await cancelFutureConfirmed(
      tx,
      { memberId: targetId },
      now,
    );
    await audit(
      {
        actorId,
        action: "user.deactivate",
        entity: "User",
        entityId: targetId,
        detail: { cancelledBookings },
      },
      tx,
    );

    return { ok: true, cancelledBookings };
  }, TRANSACTION_OPTIONS);
}

export type ReactivateUserResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-active" };

export async function reactivateUser(
  targetId: number,
  actorId: number,
): Promise<ReactivateUserResult> {
  return prisma.$transaction(async (tx): Promise<ReactivateUserResult> => {
    const target = await lockUser(tx, targetId);
    if (!target) return { ok: false, reason: "not-found" };
    if (target.isActive) return { ok: false, reason: "already-active" };

    await tx.user.update({ where: { id: targetId }, data: { isActive: true } });
    await audit(
      {
        actorId,
        action: "user.reactivate",
        entity: "User",
        entityId: targetId,
      },
      tx,
    );

    return { ok: true };
  }, TRANSACTION_OPTIONS);
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
