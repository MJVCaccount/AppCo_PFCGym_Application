/**
 * Test database bootstrap.
 *
 * Import this file BEFORE anything from src/ in a test. Loading it points
 * DATABASE_URL (and DIRECT_URL) at TEST_DATABASE_URL, so every Prisma client
 * created afterwards — including the app's own in src/lib/prisma.ts — talks
 * to the test database and nothing else.
 *
 * It refuses to load unless TEST_DATABASE_URL is set and names a different
 * database from DATABASE_URL and DIRECT_URL, because resetDatabase() empties
 * every table.
 */
import { execSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { hostOf } from "../../prisma/seedGuard";

const ROOT = path.resolve(__dirname, "..", "..");

try {
  // Does not override variables that are already set (CI sets them directly).
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // No .env file: rely on the environment.
}

// The developer's .env may hold real vendor credentials. Tests never use them:
// they are blanked here, and tests that need email or storage configured set
// their own values (against the stubs in tests/support).
for (const name of [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "CONTACT_INBOX",
  "PUBLIC_BLOB_STORE_ID",
  "PRIVATE_BLOB_STORE_ID",
  "PUBLIC_BLOB_READ_WRITE_TOKEN",
  "PRIVATE_BLOB_READ_WRITE_TOKEN",
  "VERCEL_OIDC_TOKEN",
]) {
  process.env[name] = "";
}

/**
 * Host, port and database name, with Neon's "-pooler" suffix removed, so the
 * pooled and direct strings of one database compare as the same database.
 */
function databaseIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace("-pooler.", ".");
    return `${host}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function resolveTestUrl(): string {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();

  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. The tests empty every table, so they " +
        "only run against a dedicated test database. See .env.example.",
    );
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const other = process.env[name]?.trim();
    if (other && databaseIdentity(other) === databaseIdentity(testUrl)) {
      throw new Error(
        `TEST_DATABASE_URL points at the same database as ${name}. ` +
          "Refusing to run: the tests would wipe it.",
      );
    }
  }

  return testUrl;
}

const testUrl = resolveTestUrl();
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
// The seed refuses databases it does not know; the test database is one it
// should seed, and it is the only one this file ever points it at.
process.env.SEED_CONFIRM_HOST = hostOf(testUrl) ?? "";

/** Direct access for fixtures and for asserting on stored rows. */
export const testDb = new PrismaClient({ datasourceUrl: testUrl });

function run(command: string): void {
  try {
    execSync(command, { cwd: ROOT, env: process.env, stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`"${command}" failed.\n${stderr}`);
  }
}

let migrated = false;

/** Applies migrations (once per process), empties every table, then seeds. */
export async function resetDatabase(): Promise<void> {
  if (!migrated) {
    run("npx prisma migrate deploy");
    migrated = true;
  }

  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length > 0) {
    const names = tables.map((t) => `"${t.tablename}"`).join(", ");
    await testDb.$executeRawUnsafe(
      `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`,
    );
  }

  run("npx prisma db seed");
}
