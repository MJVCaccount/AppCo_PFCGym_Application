/**
 * Layering rules, checked against the source text. No database.
 *
 *   page / action / route / component  ->  service  ->  repository  ->  prisma
 *
 *  - Only src/lib/services, src/lib/repositories and the two narrow
 *    exceptions src/lib/session.ts and src/lib/rateLimit.ts may import a
 *    repository.
 *  - Only src/lib/repositories may import src/lib/prisma.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..", "src");

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

/** Every module specifier a file imports, re-exports, requires or loads dynamically. */
export function specifiersOf(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

/** The path a specifier points at, relative to src, or null for a package. */
export function resolveSpecifier(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  return base === null ? null : path.relative(SRC, base).split(path.sep).join("/");
}

const isInside = (target: string, dir: string) =>
  target === dir || target.startsWith(dir + "/");

const MAY_IMPORT_REPOSITORIES = (file: string) =>
  isInside(file, "lib/services") ||
  isInside(file, "lib/repositories") ||
  // Narrow, deliberate uses: the session check reads one row, the limiter its buckets.
  file === "lib/session.ts" ||
  file === "lib/rateLimit.ts";

const MAY_IMPORT_PRISMA = (file: string) => isInside(file, "lib/repositories");

export function violations(file: string, code: string): string[] {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  const problems: string[] = [];

  for (const specifier of specifiersOf(code)) {
    const target = resolveSpecifier(file, specifier);
    if (target === null) continue;

    if (isInside(target, "lib/repositories") && !MAY_IMPORT_REPOSITORIES(rel)) {
      problems.push(`${rel} imports a repository (${specifier})`);
    }
    if (
      (target === "lib/prisma" || isInside(target, "lib/prisma")) &&
      !MAY_IMPORT_PRISMA(rel)
    ) {
      problems.push(`${rel} imports prisma (${specifier})`);
    }
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

console.log("\nARCHITECTURE");

check("the scanner sees alias, relative, dynamic and re-export imports", () => {
  const code = [
    `import { a } from "@/lib/repositories/x";`,
    `export { b } from "../lib/repositories/y";`,
    `const c = await import("@/lib/prisma");`,
    `import "./repositories/z";`,
  ].join("\n");
  assert.equal(specifiersOf(code).length, 4);
});

check("a page, action, route or component importing a repository is a violation", () => {
  for (const where of ["app/page.tsx", "actions/auth.ts", "app/api/x/route.ts", "components/Header.tsx", "lib/api.ts"]) {
    const file = path.join(SRC, where);
    assert.equal(violations(file, `import { f } from "@/lib/repositories/usersRepository";`).length, 1, where);
  }
});

check("a relative path into a repository is caught too", () => {
  const file = path.join(SRC, "lib/env.ts");
  assert.equal(violations(file, `import { f } from "./repositories/usersRepository";`).length, 1);
});

check("services, session.ts and rateLimit.ts may import a repository", () => {
  for (const where of ["lib/services/x.ts", "lib/session.ts", "lib/rateLimit.ts"]) {
    const file = path.join(SRC, where);
    assert.deepEqual(violations(file, `import { f } from "@/lib/repositories/usersRepository";`), [], where);
  }
});

check("only repositories may import prisma", () => {
  const code = `import { prisma } from "@/lib/prisma";`;
  assert.deepEqual(violations(path.join(SRC, "lib/repositories/a.ts"), code), []);
  for (const where of ["lib/services/a.ts", "lib/session.ts", "lib/rateLimit.ts", "app/page.tsx", "instrumentation.ts"]) {
    assert.equal(violations(path.join(SRC, where), code).length, 1, where);
  }
});

check("no file under src breaks the layering", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, "the scan found the source tree");

  const problems = files.flatMap((file) =>
    violations(file, fs.readFileSync(file, "utf8")),
  );
  assert.deepEqual(problems, []);
});

console.log(`\n${passed} checks passed`);
