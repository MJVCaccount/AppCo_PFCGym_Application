import "server-only";

import { mapPrismaError } from "@/lib/errors";
import { ROLES, type ServiceResult, type SessionUser } from "@/lib/types";

/** Small shared pieces for services that return a ServiceResult. */

const MAX_ID = 2_147_483_647; // Postgres INTEGER

export const ADMIN_ONLY = "Only an administrator can do that.";

export function succeed<T>(data: T, status = 200): ServiceResult<T> {
  return { ok: true, status, data };
}

/** `field` names the input the error is about, so a form can show it there. */
export function fail<T>(
  status: number,
  error: string,
  field?: string,
): ServiceResult<T> {
  return field ? { ok: false, status, error, field } : { ok: false, status, error };
}

export const INVALID_INPUT = "The details sent were not in the expected shape.";

/** A JSON object or a form's fields: not null, not an array, not a string. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The outcome of reading one input: the clean value, or what was wrong. */
export type Parsed<T> = { value: T } | { error: string; field: string };

export function invalid<T>(parsed: { error: string; field: string }): ServiceResult<T> {
  return fail(400, parsed.error, parsed.field);
}

/** Anything thrown by a repository, as a result that is safe to show. */
export function failure<T>(e: unknown): ServiceResult<T> {
  const error = mapPrismaError(e);
  return { ok: false, status: error.status, error: error.message };
}

export function isAdmin(session: SessionUser): boolean {
  return session.role === ROLES.Admin;
}

export function isValidId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0 && id <= MAX_ID;
}

/**
 * An optional text field may be left out, null or a string (including an
 * empty one). Anything else, such as a number or an object, is a mistake by
 * the caller rather than "no value".
 */
export function isOptionalString(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}
