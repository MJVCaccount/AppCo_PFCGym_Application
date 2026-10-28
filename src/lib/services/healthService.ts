import "server-only";

import expectedMigrations from "@/lib/migrations.generated.json";
import { isEmailConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  appliedMigrations,
  databaseSizeBytes,
  lastMaintenanceAt,
  pingDatabase,
  rateLimitBucketCount,
  rowCounts,
} from "@/lib/repositories/healthRepository";
import { outboxStats } from "@/lib/services/outboxService";

/**
 * Whether the server can reach its database. The reason for a failure goes to
 * the log, never to the caller: the readiness route is public.
 */
export async function isReady(): Promise<boolean> {
  try {
    await pingDatabase();
    return true;
  } catch (e) {
    logger.error("Readiness check failed", { error: e });
    return false;
  }
}

/** More than this many dead letters in 24 hours is a problem; one bad address is not. */
export const DEAD_LETTER_ALARM = 3;

export interface HealthDetail {
  status: "ok" | "degraded";
  checkedAt: string;
  release: string | null;
  database: {
    latencyMs: number;
    sizeBytes: number;
    migrations: { expected: number; applied: number; pending: string[]; newerThanThisRelease: string[] };
    rowCounts: Record<string, number>;
  };
  rateLimit: { buckets: number };
  outbox: Awaited<ReturnType<typeof outboxStats>>;
  maintenance: { lastRunAt: string | null };
  configured: { email: boolean; publicBlob: boolean; privateBlob: boolean };
}

/**
 * Everything an operator wants on one page, for the token-protected route.
 * Booleans say whether something is configured; no value, key or connection
 * string is ever included. "degraded" means a migration this release expects
 * has not been applied, or more than three emails were parked as dead in the last 24 hours.
 */
export async function getHealthDetail(now: Date = new Date()): Promise<HealthDetail> {
  const started = performance.now();
  await pingDatabase();
  const latencyMs = Math.round(performance.now() - started);

  const [sizeBytes, applied, counts, buckets, outbox, lastRun] = await Promise.all([
    databaseSizeBytes(),
    appliedMigrations(),
    rowCounts(),
    rateLimitBucketCount(),
    outboxStats(now),
    lastMaintenanceAt(),
  ]);

  const expected: string[] = expectedMigrations;
  const pending = expected.filter((name) => !applied.includes(name));
  const newer = applied.filter((name) => !expected.includes(name));

  return {
    status: pending.length > 0 || outbox.deadLast24h > DEAD_LETTER_ALARM ? "degraded" : "ok",
    checkedAt: now.toISOString(),
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    database: {
      latencyMs,
      sizeBytes,
      migrations: { expected: expected.length, applied: applied.length, pending, newerThanThisRelease: newer },
      rowCounts: counts,
    },
    rateLimit: { buckets },
    outbox,
    maintenance: { lastRunAt: lastRun?.toISOString() ?? null },
    configured: {
      email: isEmailConfigured(),
      publicBlob: Boolean(process.env.PUBLIC_BLOB_STORE_ID?.trim()),
      privateBlob: Boolean(process.env.PRIVATE_BLOB_STORE_ID?.trim()),
    },
  };
}
