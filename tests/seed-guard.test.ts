/**
 * The seed guard: the seed upserts demo accounts with known passwords, so it
 * must only run against localhost, an allow-listed host or a host confirmed
 * for the one command. Pure logic, no database.
 */
import assert from "node:assert/strict";

import { checkSeedTarget, hostOf, normaliseHost } from "../prisma/seedGuard";

const PASSWORD = "S3cretPassw0rdDoNotLeak";
const NEON_DIRECT = `postgresql://owner:${PASSWORD}@ep-quiet-sun-123456.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require`;
const NEON_POOLED = `postgresql://owner:${PASSWORD}@ep-quiet-sun-123456-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require`;
const OTHER = `postgresql://owner:${PASSWORD}@ep-prod-999999.c-2.eu-west-2.aws.neon.tech/neondb`;

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

console.log("\nSEED GUARD");

check("localhost, 127.0.0.1 and ::1 are allowed", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const result = checkSeedTarget({ DIRECT_URL: `postgresql://u:${PASSWORD}@${host}:5432/db` });
    assert.equal(result.ok, true, host);
  }
});

check("a listed host is allowed, in any case and with several entries", () => {
  const result = checkSeedTarget({
    DIRECT_URL: NEON_DIRECT,
    DATABASE_URL: NEON_POOLED,
    SEED_ALLOWED_HOSTS: "other.example, EP-QUIET-SUN-123456.c-2.eu-west-2.aws.neon.tech",
  });
  assert.deepEqual(result, { ok: true, host: "ep-quiet-sun-123456.c-2.eu-west-2.aws.neon.tech" });
});

check("a confirmed host is allowed", () => {
  const result = checkSeedTarget({
    DIRECT_URL: OTHER,
    SEED_CONFIRM_HOST: "ep-prod-999999.c-2.eu-west-2.aws.neon.tech",
  });
  assert.equal(result.ok, true);
});

check("an unlisted host is refused, naming the host and the way out", () => {
  const result = checkSeedTarget({ DIRECT_URL: OTHER, SEED_ALLOWED_HOSTS: "ep-quiet-sun-123456.c-2.eu-west-2.aws.neon.tech" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /ep-prod-999999\.c-2\.eu-west-2\.aws\.neon\.tech/);
    assert.match(result.message, /SEED_CONFIRM_HOST/);
  }
});

check("a confirmation for a different host does not help", () => {
  const result = checkSeedTarget({ DIRECT_URL: OTHER, SEED_CONFIRM_HOST: "ep-quiet-sun-123456.c-2.eu-west-2.aws.neon.tech" });
  assert.equal(result.ok, false);
});

check("the pooler and direct strings of one host are the same host", () => {
  assert.equal(hostOf(NEON_POOLED), hostOf(NEON_DIRECT));
  assert.equal(normaliseHost("EP-X-pooler.c-2.aws.neon.tech"), "ep-x.c-2.aws.neon.tech");

  const viaPooler = checkSeedTarget({
    DIRECT_URL: NEON_POOLED,
    SEED_ALLOWED_HOSTS: "ep-quiet-sun-123456-pooler.c-2.eu-west-2.aws.neon.tech",
  });
  assert.equal(viaPooler.ok, true);
});

check("DATABASE_URL is the fallback when DIRECT_URL is unset", () => {
  assert.equal(checkSeedTarget({ DATABASE_URL: OTHER }).ok, false);
  assert.equal(checkSeedTarget({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" }).ok, true);
});

check("DIRECT_URL and DATABASE_URL naming different hosts is refused, even for localhost", () => {
  const result = checkSeedTarget({ DIRECT_URL: "postgresql://u:p@localhost:5432/db", DATABASE_URL: OTHER });
  assert.equal(result.ok, false);
});

check("a missing or invalid connection string is refused", () => {
  assert.equal(checkSeedTarget({}).ok, false);
  assert.equal(checkSeedTarget({ DIRECT_URL: "not a url" }).ok, false);
});

check("no message ever contains the password or a connection string", () => {
  const cases = [
    checkSeedTarget({ DIRECT_URL: OTHER }),
    checkSeedTarget({ DIRECT_URL: NEON_DIRECT, DATABASE_URL: OTHER }),
    checkSeedTarget({ DIRECT_URL: `x://owner:${PASSWORD}@` }),
    checkSeedTarget({ DIRECT_URL: OTHER, SEED_CONFIRM_HOST: "nope" }),
  ];
  for (const result of cases) {
    const text = JSON.stringify(result);
    assert.ok(!text.includes(PASSWORD), text);
    assert.ok(!text.includes("postgresql://"), text);
    assert.ok(!text.includes("owner"), text);
  }
});

console.log(`\n${passed} checks passed\n`);
