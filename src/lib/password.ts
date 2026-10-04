import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing, shared by the app and the database seed.
 *
 * scrypt is deliberately slow and memory-hard, so a stolen hash list resists
 * offline brute force. Each account gets its own random salt, so two people
 * choosing the same password still store different hashes.
 *
 * No "server-only" import here: the seed script runs outside the Next runtime
 * and must be able to load this file. `node:crypto` already keeps it out of
 * any client bundle.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface PasswordHash {
  hash: string;
  salt: string;
}

/** Hashes with a fresh random salt unless one is supplied. Both are hex. */
export function hashPassword(
  password: string,
  salt: string = randomBytes(SALT_BYTES).toString("hex"),
): PasswordHash {
  return {
    hash: scryptSync(password, salt, KEY_LENGTH).toString("hex"),
    salt,
  };
}

/**
 * Fixed-time comparison, so the response can't leak how much of the hash
 * matched.
 */
export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): boolean {
  const attempt = Buffer.from(hashPassword(password, salt).hash, "hex");
  const stored = Buffer.from(expectedHash, "hex");

  if (attempt.length !== stored.length) return false;
  return timingSafeEqual(attempt, stored);
}
