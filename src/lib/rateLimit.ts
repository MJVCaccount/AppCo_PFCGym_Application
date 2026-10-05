import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { logger } from "@/lib/logger";
import {
  clearBucket,
  deleteExpiredBuckets,
  hitBucket,
} from "@/lib/repositories/rateLimitRepository";

/**
 * Rate limiting kept in Postgres, so it holds across serverless instances
 * without Redis. Each key is a fixed window: the first hit opens it, later
 * hits count up, and once it ends the next hit starts a new one. The count
 * is one atomic upsert (see rateLimitRepository.hitBucket).
 *
 * Keys are `<policy>:<sha256 of the identifier>`, so an email address or an
 * IP address never sits in the table in plain text.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /**
   * What to do when the database cannot be reached. Public pages fail open
   * (a database blip must not take them down). Sign-in and password flows
   * fail closed (an attacker must not gain from forcing a database error).
   */
  onError?: "open" | "closed";
}

/** About 1 call in this many also clears expired buckets. */
const CLEANUP_ONE_IN = 100;
const CLEANUP_BATCH = 500;
/** How long a fail-closed denial asks the caller to wait. */
const FAIL_CLOSED_RETRY_SECONDS = 60;

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  try {
    const state = await hitBucket(key, windowSeconds);

    if (Math.random() * CLEANUP_ONE_IN < 1) {
      // Housekeeping only: never let it fail or slow the request it rides on.
      void deleteExpiredBuckets(CLEANUP_BATCH).catch((e: unknown) => {
        logger.warn("Rate limit cleanup failed", { error: e });
      });
    }

    return {
      allowed: state.count <= limit,
      remaining: Math.max(0, limit - state.count),
      retryAfterSeconds: state.retryAfterSeconds,
    };
  } catch (e) {
    const closed = options.onError === "closed";
    logger.error("Rate limiter database call failed", {
      error: e,
      failMode: closed ? "closed" : "open",
    });

    return closed
      ? {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: FAIL_CLOSED_RETRY_SECONDS,
        }
      : { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

// ---------------------------------------------------------------- policies

interface Policy {
  limit: number;
  windowSeconds: number;
  /** Sign-in and password flows deny when the limiter itself is down. */
  failClosed: boolean;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Every limit the app applies. The login window is fixed at 15 minutes and a
 * successful sign-in clears the ip+email bucket, so the real owner of an
 * account is never locked out for long by someone else's guesses.
 */
export const POLICIES = {
  loginIpEmail: { limit: 5, windowSeconds: 15 * MINUTE, failClosed: true },
  loginIp: { limit: 30, windowSeconds: 15 * MINUTE, failClosed: true },
  register: { limit: 5, windowSeconds: HOUR, failClosed: true },
  forgotIp: { limit: 3, windowSeconds: HOUR, failClosed: true },
  forgotEmail: { limit: 3, windowSeconds: HOUR, failClosed: true },
  resetIp: { limit: 10, windowSeconds: HOUR, failClosed: true },
  contact: { limit: 5, windowSeconds: HOUR, failClosed: false },
  booking: { limit: 30, windowSeconds: 10 * MINUTE, failClosed: false },
  upload: { limit: 20, windowSeconds: HOUR, failClosed: false },
} as const satisfies Record<string, Policy>;

export type PolicyName = keyof typeof POLICIES;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** The bucket key for a policy and an identifier, with the identifier hashed. */
export function limitKey(policy: PolicyName, identifier: string): string {
  return `${policy}:${sha256(identifier)}`;
}

const MAX_MULTIPLIER = 20;

/**
 * RATE_LIMIT_MULTIPLIER scales every limit in POLICIES, so a busy day (a crowd
 * on one venue network shares one address) can be relaxed from the Vercel
 * dashboard without a deploy. Only a whole number from 1 to 20
 * counts: anything else (blank, 0, 2.5, -3, "lots", 21) is ignored and the
 * limits stay as written. Windows are never changed, only the counts.
 */
export function rateLimitMultiplier(
  value: string | undefined = process.env.RATE_LIMIT_MULTIPLIER,
): number {
  const text = value?.trim() ?? "";
  if (!/^[0-9]{1,2}$/.test(text)) return 1;

  const multiplier = Number(text);
  return multiplier >= 1 && multiplier <= MAX_MULTIPLIER ? multiplier : 1;
}

/** The limit of a policy after RATE_LIMIT_MULTIPLIER. */
export function effectiveLimit(policy: PolicyName): number {
  return POLICIES[policy].limit * rateLimitMultiplier();
}

/** Counts one hit for `identifier` under a named policy. */
export function checkLimit(
  policy: PolicyName,
  identifier: string,
): Promise<RateLimitResult> {
  const { windowSeconds, failClosed } = POLICIES[policy];

  return rateLimit(limitKey(policy, identifier), effectiveLimit(policy), windowSeconds, {
    onError: failClosed ? "closed" : "open",
  });
}

/** Forgets the bucket for `identifier` under a named policy. */
export async function clearLimit(
  policy: PolicyName,
  identifier: string,
): Promise<void> {
  try {
    await clearBucket(limitKey(policy, identifier));
  } catch (e) {
    // The bucket expires on its own; a failed clear only costs the owner time.
    logger.warn("Rate limit clear failed", { error: e });
  }
}

/** The denial with the longest wait, or null when every result allowed. */
export function firstDenied(
  ...results: RateLimitResult[]
): RateLimitResult | null {
  const denied = results.filter((r) => !r.allowed);
  if (denied.length === 0) return null;

  return denied.reduce((a, b) =>
    b.retryAfterSeconds > a.retryAfterSeconds ? b : a,
  );
}

/** The inline form error: "Too many attempts. Try again in N minutes." */
export function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`;
}

// ---------------------------------------------------------------- caller

/**
 * The caller's address. Vercel sets x-real-ip; behind another proxy the first
 * entry of x-forwarded-for is the original client. Without either the answer
 * is "unknown", which every such caller shares.
 */
export function clientIp(requestHeaders: Pick<Headers, "get">): string {
  const real = requestHeaders.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** clientIp() for the current request, for server actions and pages. */
export async function currentClientIp(): Promise<string> {
  return clientIp(await headers());
}
