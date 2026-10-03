import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in dev so we don't exhaust Neon's
// connection limit. Not used yet — gym-data.ts and users.ts still hold the
// seeded data; Phase 2 replaces them with Prisma queries through this client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
