import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { AppUser, Role, SessionUser } from "./types";

/**
 * Accounts for the front-end deliverable.
 *
 * Passwords are hashed with scrypt, which is deliberately slow and memory-hard,
 * so a stolen hash list resists offline brute force. Each account gets its own
 * random salt, so two people choosing the same password still store different
 * hashes. Part 2 moves this table to the database; the hashing stays.
 */

const KEY_LENGTH = 64;

function hash(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LENGTH).toString("hex");
}

function seed(
  id: number,
  email: string,
  fullName: string,
  role: Role,
  password: string,
  planId: number | null = null,
): AppUser {
  const salt = randomBytes(16).toString("hex");
  return {
    id,
    email,
    fullName,
    role,
    planId,
    passwordSalt: salt,
    passwordHash: hash(password, salt),
  };
}

const users: AppUser[] = [
  seed(1, "member@pfc.co.za", "John Wick", "Member", "Member123!", 2),
  seed(2, "sofia@pfc.co.za", "Sofia Erasmus", "Coach", "Coach123!"),
  seed(3, "marcus@pfc.co.za", "Marcus Thompson", "Coach", "Coach123!"),
  seed(4, "admin@pfc.co.za", "Ruan Cupido", "Admin", "Admin123!"),
];

let nextId = users.length + 1;

// ---------------------------------------------------------------- reads

export function findByEmail(email: string): AppUser | undefined {
  return users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
}

export function findById(id: number): AppUser | undefined {
  return users.find((u) => u.id === id);
}

export function getAll(): AppUser[] {
  return users;
}

export function countByRole(role: Role): number {
  return users.filter((u) => u.role === role).length;
}

/** Strips the hash and salt so a user object can cross to the client safely. */
export function toSessionUser(user: AppUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

// ---------------------------------------------------------------- auth

/**
 * Check an email and password pair.
 *
 * The comparison is fixed-time, so the response can't leak how much of the
 * hash matched. When the email is unknown we still run one hash before
 * returning, so a missing account takes as long as a wrong password — without
 * that, response timing alone reveals which addresses are registered.
 */
export function validateCredentials(
  email: string,
  password: string,
): AppUser | null {
  const user = findByEmail(email);

  if (!user) {
    hash(password, "no-such-account");
    return null;
  }

  const attempt = Buffer.from(hash(password, user.passwordSalt), "hex");
  const stored = Buffer.from(user.passwordHash, "hex");

  if (attempt.length !== stored.length) return null;
  return timingSafeEqual(attempt, stored) ? user : null;
}

// ---------------------------------------------------------------- writes

export function createUser(input: {
  email: string;
  fullName: string;
  password: string;
  planId: number | null;
}): AppUser {
  const salt = randomBytes(16).toString("hex");

  const user: AppUser = {
    id: nextId++,
    email: input.email.trim().toLowerCase(),
    fullName: input.fullName.trim(),
    role: "Member",
    planId: input.planId,
    passwordSalt: salt,
    passwordHash: hash(input.password, salt),
  };

  users.push(user);
  return user;
}

/** Sets or clears a member's plan. Returns false if the user is gone. */
export function setPlan(userId: number, planId: number | null): boolean {
  const user = findById(userId);
  if (!user) return false;

  user.planId = planId;
  return true;
}
