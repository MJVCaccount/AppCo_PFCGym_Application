import "server-only";

import { prisma } from "@/lib/prisma";

/** Resolves when the database answers a trivial query; rejects otherwise. */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** Bytes the whole database occupies. */
export async function databaseSizeBytes(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database()) AS "size"`;
  return Number(row?.size ?? 0);
}

/** Names of the migrations Prisma has finished applying. */
export async function appliedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY migration_name`;
  return rows.map((r) => r.migration_name);
}

export async function rowCounts(): Promise<Record<string, number>> {
  const [users, bookings, classes, fighters, documents, offers, enquiries, auditRows, resetTokens] =
    await Promise.all([
      prisma.user.count(),
      prisma.booking.count(),
      prisma.gymClass.count(),
      prisma.fighter.count(),
      prisma.fighterDocument.count(),
      prisma.eventParticipation.count(),
      prisma.contactEnquiry.count(),
      prisma.auditLog.count(),
      prisma.passwordResetToken.count(),
    ]);

  return { users, bookings, classes, fighters, documents, offers, enquiries, auditRows, resetTokens };
}

export async function rateLimitBucketCount(): Promise<number> {
  return prisma.rateLimitBucket.count();
}

/** When the maintenance job last finished, from its audit row. */
export async function lastMaintenanceAt(): Promise<Date | null> {
  const row = await prisma.auditLog.findFirst({
    where: { action: "maintenance.run" },
    orderBy: { id: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
