import "server-only";

import { mapPrismaError } from "@/lib/errors";
import { ROLES, type ServiceResult, type SessionUser } from "@/lib/types";

/** Small shared pieces for services that return a ServiceResult. */

const MAX_ID = 2_147_483_647; // Postgres INTEGER

export const ADMIN_ONLY = "Only an administrator can do that.";

export function succeed<T>(data: T, status = 200): ServiceResult<T> {
  return { ok: true, status, data };
}

export function fail<T>(status: number, error: string): ServiceResult<T> {
  return { ok: false, status, error };
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
