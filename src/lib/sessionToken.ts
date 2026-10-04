import { createHmac, timingSafeEqual } from "node:crypto";

import { ROLES } from "./types";
import type { SessionUser } from "./types";

/**
 * The signed session cookie: its name, how it is signed, how it is checked.
 *
 * This file has no database, no `next/headers` and no `server-only` import,
 * so both src/lib/session.ts and src/middleware.ts use the same signing code.
 * It runs on the Node.js runtime only (it uses node:crypto).
 *
 * Checking the signature proves the payload was issued by this server and
 * not edited. It does NOT prove the account is still active or still holds
 * that role: getSession() checks that against the database.
 */

export const COOKIE_NAME = "pfc_session";
export const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

const ALLOWED_ROLES: readonly string[] = Object.values(ROLES);

function secret(): string {
  const fromEnv = process.env.SESSION_SECRET;

  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters in production. " +
        "Generate one with: openssl rand -base64 48",
    );
  }

  // Development only. Restarting the server invalidates existing sessions,
  // which is fine locally and never reaches a deployed environment.
  return "pfc-development-only-secret-do-not-use-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface SessionPayload extends SessionUser {
  sv: number;
}

export function encodeSession(user: SessionUser, sv: number): string {
  const payload = Buffer.from(JSON.stringify({ ...user, sv })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

/** The payload of a cookie value whose signature checks out, else null. */
export function decodeSession(token: string): SessionPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SessionPayload;

    if (
      typeof parsed?.id !== "number" ||
      typeof parsed?.email !== "string" ||
      typeof parsed?.fullName !== "string" ||
      !Number.isInteger(parsed?.sv) ||
      !ALLOWED_ROLES.includes(parsed?.role)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
