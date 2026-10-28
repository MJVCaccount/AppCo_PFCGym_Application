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

/**
 * In production the cookie carries the __Host- prefix: the browser then only
 * accepts it when it is Secure, has Path=/ and names no Domain, so a sibling
 * subdomain or a plain-http response cannot plant or overwrite it. Outside
 * production (http on localhost, the tests) the plain name is used because a
 * Secure cookie would not be stored there.
 */
export function sessionCookieName(env: string | undefined): string {
  return env === "production" ? "__Host-pfc_session" : "pfc_session";
}

export const COOKIE_NAME = sessionCookieName(process.env.NODE_ENV);
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
  /** Expiry, in seconds since 1970. The cookie's own Max-Age is only a request to the browser. */
  exp: number;
}

export function encodeSession(
  user: SessionUser,
  sv: number,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + MAX_AGE_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...user, sv, exp })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

/** The payload of a cookie value whose signature checks out, else null. */
export function decodeSession(
  token: string,
  nowMs: number = Date.now(),
): SessionPayload | null {
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
      // Expiry is enforced here, on the server. A copied cookie stops working
      // when it runs out, whatever the browser does with Max-Age. A signed
      // cookie with no expiry is refused.
      !Number.isInteger(parsed?.exp) ||
      parsed.exp * 1000 <= nowMs ||
      parsed.exp * 1000 > nowMs + (MAX_AGE_SECONDS + 60) * 1000 ||
      !ALLOWED_ROLES.includes(parsed?.role)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
