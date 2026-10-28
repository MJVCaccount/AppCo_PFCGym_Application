import "server-only";

import { record as audit } from "@/lib/repositories/auditRepository";
import { deleteExpiredOrUsedTokens } from "@/lib/repositories/passwordResetRepository";
import { deleteExpiredBuckets } from "@/lib/repositories/rateLimitRepository";
import { drainOutbox, purgeOutbox } from "@/lib/services/outboxService";

/**
 * The daily housekeeping, run by GET /api/cron/maintenance:
 *
 *  - password-reset tokens that expired or were used are deleted
 *  - rate-limit counters whose window ended are deleted
 *  - the email outbox is drained (whatever is due, including what the daily
 *    cap held back yesterday) and old finished rows are purged
 *
 * Every step is independent: one failing does not stop the others, and the
 * report says which failed. The run leaves an audit row, which the health
 * detail route reads as "the job last ran at".
 */

export interface MaintenanceReport {
  resetTokensDeleted: number;
  bucketsDeleted: number;
  outbox: { claimed: number; sent: number; retry: number; dead: number; skipped: number; deferred: number };
  outboxPurged: number;
  failed: string[];
}

const BUCKET_BATCH = 500;
const MAX_BUCKET_BATCHES = 40;

export async function runMaintenance(now: Date = new Date()): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    resetTokensDeleted: 0,
    bucketsDeleted: 0,
    outbox: { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0, deferred: 0 },
    outboxPurged: 0,
    failed: [],
  };

  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      report.failed.push(name);
    }
  };

  await step("resetTokens", async () => {
    report.resetTokensDeleted = await deleteExpiredOrUsedTokens(now);
  });

  await step("rateLimitBuckets", async () => {
    for (let i = 0; i < MAX_BUCKET_BATCHES; i++) {
      const deleted = await deleteExpiredBuckets(BUCKET_BATCH);
      report.bucketsDeleted += deleted;
      if (deleted < BUCKET_BATCH) break;
    }
  });

  await step("outbox", async () => {
    report.outbox = await drainOutbox({ limit: 100, now });
  });

  await step("outboxPurge", async () => {
    report.outboxPurged = await purgeOutbox(now);
  });

  await audit({
    actorId: null,
    action: "maintenance.run",
    entity: "System",
    entityId: null,
    detail: {
      resetTokensDeleted: report.resetTokensDeleted,
      bucketsDeleted: report.bucketsDeleted,
      outboxSent: report.outbox.sent,
      outboxDead: report.outbox.dead,
      outboxPurged: report.outboxPurged,
      failedSteps: report.failed.length,
    },
  });

  return report;
}

export interface OutboxRunReport {
  claimed: number;
  sent: number;
  retry: number;
  dead: number;
  skipped: number;
  deferred: number;
}

/**
 * Only the outbox drain, for the hourly workflow (GET /api/cron/outbox). An
 * audit row is written only when the run sent something or parked something as
 * dead, so a quiet hour leaves no trace and the audit page stays readable.
 */
export async function runOutboxDrain(now: Date = new Date()): Promise<OutboxRunReport> {
  const report = await drainOutbox({ limit: 100, now });

  if (report.sent > 0 || report.dead > 0) {
    await audit({
      actorId: null,
      action: "outbox.drain",
      entity: "System",
      entityId: null,
      detail: { claimed: report.claimed, sent: report.sent, dead: report.dead, retry: report.retry },
    });
  }

  return report;
}
