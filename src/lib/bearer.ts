import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for the two routes that are not for people (health
 * detail, the maintenance job). A secret shorter than 32 characters counts as
 * "not configured": the route then pretends not to exist, so a missing or
 * weak setting never leaves a guessable door open.
 */

export const MIN_SECRET_LENGTH = 32;

export function secretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= MIN_SECRET_LENGTH;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether the request carries `Authorization: Bearer <secret>`, compared in constant time. */
export function bearerMatches(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  return timingSafeEqual(digest(match[1]!), digest(secret.trim()));
}
