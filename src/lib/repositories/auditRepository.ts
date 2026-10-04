import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { AuditLogRow } from "@/lib/types";

/**
 * Data-access layer for the audit trail: who did what to which row.
 *
 * `detail` is a small JSON object of plain values. As a last line of defence,
 * any key that looks like a credential is dropped before the row is written,
 * so a careless caller cannot put a password, token or hash in the log.
 */

export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  actorId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  detail?: AuditDetail;
}

const FORBIDDEN_KEY = /password|passwd|hash|salt|token|secret|cookie/i;

function safeDetail(detail: AuditDetail | undefined): AuditDetail | undefined {
  if (!detail) return undefined;

  const clean: AuditDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!FORBIDDEN_KEY.test(key)) clean[key] = value;
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** The most recent audit rows, newest first, with the actor's name. */
export async function listLatest(limit = 100): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { id: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      action: true,
      entity: true,
      entityId: true,
      actor: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorName: row.actor?.fullName ?? null,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
  }));
}

/**
 * Writes one audit row. Pass the transaction client when the audited change
 * runs in a transaction, so the change and its record commit together.
 */
export async function record(
  entry: AuditEntry,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      detail: safeDetail(entry.detail),
    },
  });
}
