import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getSessionState } from "./repositories/usersRepository";
import {
  COOKIE_NAME,
  decodeSession,
  encodeSession,
  MAX_AGE_SECONDS,
} from "./sessionToken";
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
 *
 * The role in the cookie is never trusted for a decision: getSession() reads
 * the account's current role and active flag from the database each request.
 *
 * The payload also carries `sv`, the account's sessionVersion when the cookie
 * was issued. A password reset bumps the stored version, which kills every
 * cookie issued before it. A cookie with no `sv` is invalid.
 */

// ---------------------------------------------------------------- API

export async function createSession(user: SessionUser): Promise<void> {
  const store = await cookies();
  // Read fresh, not through the per-request cache: this is the value the new
  // cookie is tied to.
  const state = await getSessionState(user.id);

  store.set(COOKIE_NAME, encodeSession(user, state?.sessionVersion ?? 0), {
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

/**
 * The account behind a session id, read once per request: React's cache keeps
 * the answer for the rest of the render, so the header, the page and a guard
 * calling getSession() share one query. Outside a request (the tests) there is
 * nothing to cache in and every call reads the database.
 */
const loadSessionState = cache(getSessionState);

/**
 * The signed-in user, or null. Safe to call from any server component.
 *
 * The cookie only proves who the visitor is. Their role, name and whether the
 * account is still active come from the database on every request, so a
 * promotion, a demotion or a deactivation applies on the very next request
 * instead of when the 8-hour cookie runs out.
 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const claimed = token ? decodeSession(token) : null;
  if (!claimed) return null;

  const state = await loadSessionState(claimed.id);
  if (!state || !state.isActive) return null;
  if (state.sessionVersion !== claimed.sv) return null;

  return {
    id: claimed.id,
    email: state.email,
    fullName: state.fullName,
    role: state.role,
  };
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function hasRole(...roles: Role[]): Promise<boolean> {
  const session = await getSession();
  return session !== null && roles.includes(session.role);
}
