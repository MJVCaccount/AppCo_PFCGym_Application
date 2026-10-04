import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Data access for rate-limit counters (see src/lib/rateLimit.ts).
 *
 * All time comparisons use the database clock, so every serverless instance
 * agrees on when a window ends. The column holds UTC without a zone, hence
 * `now() AT TIME ZONE 'utc'`.
 */

export interface BucketState {
  count: number;
  /** Whole seconds until the window ends, never below 1. */
  retryAfterSeconds: number;
}

interface BucketRow {
  count: number;
  secondsLeft: number;
}

/**
 * Counts one hit against `key` in ONE statement. A new key starts at 1. An
 * existing key whose window has passed restarts at 1 with a fresh window;
 * otherwise its count goes up by one. There is no read followed by a write,
 * so parallel callers can never both see "one place left".
 */
export async function hitBucket(
  key: string,
  windowSeconds: number,
): Promise<BucketState> {
  const rows = await prisma.$queryRaw<BucketRow[]>`
    INSERT INTO "RateLimitBucket" AS b ("key", "count", "resetAt")
    VALUES (
      ${key},
      1,
      (now() AT TIME ZONE 'utc') + make_interval(secs => ${windowSeconds}::double precision)
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN b."resetAt" <= (now() AT TIME ZONE 'utc') THEN 1
        ELSE b."count" + 1
      END,
      "resetAt" = CASE
        WHEN b."resetAt" <= (now() AT TIME ZONE 'utc')
          THEN (now() AT TIME ZONE 'utc') + make_interval(secs => ${windowSeconds}::double precision)
        ELSE b."resetAt"
      END
    RETURNING
      "count",
      EXTRACT(EPOCH FROM (b."resetAt" - (now() AT TIME ZONE 'utc')))::double precision AS "secondsLeft"`;

  const row = rows[0];
  return {
    count: row.count,
    retryAfterSeconds: Math.max(1, Math.ceil(row.secondsLeft)),
  };
}

/** Removes up to `limit` buckets whose window has ended. */
export async function deleteExpiredBuckets(limit: number): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "RateLimitBucket"
    WHERE "key" IN (
      SELECT "key" FROM "RateLimitBucket"
      WHERE "resetAt" < (now() AT TIME ZONE 'utc')
      LIMIT ${limit}
    )`;
}

/** Forgets one bucket, such as a login bucket after a successful sign-in. */
export async function clearBucket(key: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
