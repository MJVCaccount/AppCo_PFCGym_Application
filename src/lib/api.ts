import "server-only";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getSession } from "@/lib/session";
import type { ServiceResult, SessionUser } from "@/lib/types";

/**
 * Shared plumbing for the JSON route handlers: every response is either
 * `{ data }` or `{ error: { message } }`, and nothing thrown ever reaches the
 * client as more than a generic sentence.
 */

export type JsonObject = Record<string, unknown>;

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: { message } }, { status });
}

/** A service result as a response: `{ data }` on success, the error otherwise. */
export function jsonResult<T>(result: ServiceResult<T>): NextResponse {
  if (!result.ok) {
    return jsonError(result.error ?? "The request failed.", result.status);
  }

  return NextResponse.json({ data: result.data }, { status: result.status });
}

/**
 * The request body as a plain JSON object. Invalid JSON, an array, a string
 * or a number all come back as null, for the caller to answer with a 400.
 */
export async function readJsonObject(
  request: Request,
): Promise<JsonObject | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as JsonObject)
    : null;
}

export const INVALID_BODY = "Request body must be a JSON object.";

/**
 * A path segment as an id. Number("") is 0 and Number("1e2") is 100, so only
 * plain digits count; anything else is NaN, which the services reject.
 */
export function pathId(segment: string): number {
  return /^\d+$/.test(segment) ? Number(segment) : NaN;
}

/**
 * Runs a route handler for a signed-in user. No session is a 401; the role is
 * left to the service, which answers 403. Anything thrown is logged in full
 * on the server and replaced with `failureMessage`.
 */
export async function withSession(
  label: string,
  failureMessage: string,
  handler: (session: SessionUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to continue.", 401);

    return await handler(session);
  } catch (e) {
    logger.error(`${label} failed`, { error: e });
    return jsonError(failureMessage, 500);
  }
}
