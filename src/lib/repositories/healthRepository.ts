import "server-only";

import { prisma } from "@/lib/prisma";

/** Resolves when the database answers a trivial query; rejects otherwise. */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
