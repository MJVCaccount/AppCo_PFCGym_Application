// Writes the names of the migrations in prisma/migrations to
// src/lib/migrations.generated.json. The health-detail route compares it with
// what the database has applied, so an operator can see a release that is
// running ahead of its migrations. Runs before every build (npm "prebuild");
// tests/health.test.ts fails when the committed copy is stale.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "prisma", "migrations");

const names = readdirSync(dir)
  .filter((name) => statSync(join(dir, name)).isDirectory())
  .sort();

writeFileSync(join(root, "src", "lib", "migrations.generated.json"), JSON.stringify(names, null, 2) + "\n");
console.log(`Wrote src/lib/migrations.generated.json (${names.length} migrations)`);
