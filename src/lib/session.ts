import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { ROLES } from "./types";
import type { Role, SessionUser } from "./types";

/**
 * Cookie-based sessions, signed with HMAC-SHA256.
 *
 * The cookie holds the payload and a signature. A tampered payload fails the
 * signature check, so nobody can promote themselves to Admin by editing it.
 * It is httpOnly (JavaScript cannot read it), sameSite=lax (not sent on
 * cross-site POSTs, which blocks CSRF), and secure outside development.
 *
 * It is NOT encrypted — the payload is readable by anyone holding the cookie,
 * so only non-sensitive identity fields go in it.
 */

const COOKIE_NAME = "pfc_session";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours
const ALLOWED_ROLES: readonly string[] = Object.values(ROLES);

function secret(): string {
  const fromEnv = process.env.SESSION_SECRET;

  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }

  // Development only. Restarting the server invalidates existing sessions,
  // which is fine locally and never reaches a deployed environment.
  return "pfc-development-only-secret-do-not-use-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string): SessionUser | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SessionUser;

    if (
      typeof parsed?.id !== "number" ||
      typeof parsed?.email !== "string" ||
      typeof parsed?.fullName !== "string" ||
      !ALLOWED_ROLES.includes(parsed?.role)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- API

export async function createSession(user: SessionUser): Promise<void> {
  const store = await cookies();

  store.set(COOKIE_NAME, encode(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  return token ? decode(token) : null;
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function hasRole(...roles: Role[]): Promise<boolean> {
  const session = await getSession();
  return session !== null && roles.includes(session.role);
}
