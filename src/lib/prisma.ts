import "server-only";

import { PrismaClient } from "@prisma/client";

import { logger } from "@/lib/logger";

/**
 * A query that takes longer than this is logged as a warning, with the model,
 * the operation and the request id (the logger adds it) but never the
 * arguments, which hold people's data. SLOW_QUERY_MS overrides the default.
 */
export const DEFAULT_SLOW_QUERY_MS = 500;

export function slowQueryThreshold(value: string | undefined = process.env.SLOW_QUERY_MS): number {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_QUERY_MS;
}

/** Wraps a client so every operation, in or out of a transaction, is timed. */
export function withSlowQueryLog<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: "slow-query-log",
    query: {
      async $allOperations({ model, operation, args, query }) {
        const started = performance.now();
        try {
          return await query(args);
        } finally {
          const ms = Math.round(performance.now() - started);
          if (ms >= slowQueryThreshold()) {
            logger.warn("Slow query", { model: model ?? "raw", operation, ms });
          }
        }
      },
    },
  });
}

// The extended client behaves exactly like the plain one, so it is typed as
// the plain one: Prisma's extended-client types are not assignable to
// Prisma.TransactionClient, which the repositories use for their helpers.
function createClient(): PrismaClient {
  return withSlowQueryLog(new PrismaClient()) as unknown as PrismaClient;
}

// Reuse one client across hot reloads in dev so we don't exhaust Neon's
// connection limit. Only src/lib/repositories may import this file: pages,
// actions and services go through a repository.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
