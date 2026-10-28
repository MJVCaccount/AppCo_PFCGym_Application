// Converts docs/openapi.yaml into src/lib/openapi.json, the copy the app serves
// at GET /api/openapi.json (the app has no YAML parser at runtime).
//
// Run with: npm run openapi:build   (tests/openapi.test.ts fails when the two differ)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = parse(readFileSync(join(root, "docs", "openapi.yaml"), "utf8"));

writeFileSync(join(root, "src", "lib", "openapi.json"), JSON.stringify(spec, null, 2) + "\n");
console.log("Wrote src/lib/openapi.json");
