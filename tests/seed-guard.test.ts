/**
 * The seed guard: the seed upserts demo accounts with known passwords, so it
 * must only run against localhost, an allow-listed host or a host confirmed
 * for the one command. Pure logic, no database.
 */
import assert from "node:assert/strict";

import {
  checkSeedPasswords,
  checkSeedTarget,
  hostOf,
  isPrivateTarget,
  normaliseHost,
  PUBLISHED_DEMO_PASSWORDS,
} from "../prisma/seedGuard";

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

// ---------------------------------------------------------------- passwords

console.log("\nSEED PASSWORDS");

const PRIVATE = { DIRECT_URL: OTHER, SEED_CONFIRM_HOST: "ep-prod-999999.c-2.eu-west-2.aws.neon.tech" };
const GOOD_ADMIN = "correct-horse-battery-1";
const GOOD_DEMO = "another-long-passphrase-2";
const LOCAL = { DIRECT_URL: "postgresql://u:p@localhost:5432/db" };
const LISTED = {
  DIRECT_URL: NEON_DIRECT,
  SEED_ALLOWED_HOSTS: "ep-quiet-sun-123456.c-2.eu-west-2.aws.neon.tech",
};

function refusal(env: Record<string, string | undefined>): string {
  const result = checkSeedPasswords(env);
  assert.equal(result.ok, false, JSON.stringify(env));
  return result.ok ? "" : result.message;
}

check("a private target is one that only SEED_CONFIRM_HOST let through", () => {
  assert.equal(isPrivateTarget(PRIVATE), true);
  assert.equal(isPrivateTarget(LOCAL), false);
  assert.equal(isPrivateTarget(LISTED), false);
  assert.equal(isPrivateTarget({}), true, "an unreadable host is private");
});

check("a private target needs both passwords", () => {
  assert.match(refusal(PRIVATE), /SEED_ADMIN_PASSWORD is required/);
  assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN }), /SEED_DEMO_PASSWORD is required/);
  assert.match(refusal({ ...PRIVATE, SEED_DEMO_PASSWORD: GOOD_DEMO }), /SEED_ADMIN_PASSWORD is required/);
  assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: "", SEED_DEMO_PASSWORD: "" }), /SEED_ADMIN_PASSWORD is required/, "blank is missing");
});

check("a private target with both good, different passwords is allowed and uses them", () => {
  const result = checkSeedPasswords({ ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: GOOD_DEMO });
  assert.deepEqual(result, { ok: true, adminPassword: GOOD_ADMIN, demoPassword: GOOD_DEMO });
});

check("a short password is refused, naming the variable and the rule", () => {
  const eleven = "a".repeat(11);
  assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: eleven, SEED_DEMO_PASSWORD: GOOD_DEMO }), /SEED_ADMIN_PASSWORD must be at least 12 characters/);
  assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: eleven }), /SEED_DEMO_PASSWORD must be at least 12 characters/);
  assert.equal(checkSeedPasswords({ ...PRIVATE, SEED_ADMIN_PASSWORD: "a".repeat(12), SEED_DEMO_PASSWORD: "b".repeat(12) }).ok, true, "12 is enough");
});

check("passwords that are equal to each other are refused", () => {
  assert.match(
    refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: GOOD_ADMIN }),
    /must be different from each other/,
  );
});

check("every published demo password is refused, in either variable", () => {
  for (const published of PUBLISHED_DEMO_PASSWORDS) {
    assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: published, SEED_DEMO_PASSWORD: GOOD_DEMO }), /SEED_ADMIN_PASSWORD must not be one of the demo passwords/);
    assert.match(refusal({ ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: published }), /SEED_DEMO_PASSWORD must not be one of the demo passwords/);
  }
  assert.deepEqual([...PUBLISHED_DEMO_PASSWORDS].sort(), ["Admin123!", "Coach123!", "Fighter123!", "Member123!"]);
});

check("localhost and listed hosts are unaffected: no variables means the published passwords", () => {
  for (const env of [LOCAL, LISTED]) {
    assert.deepEqual(checkSeedPasswords(env), { ok: true, adminPassword: null, demoPassword: null });
  }
});

check("on localhost the variables are optional, and validated the same way when set", () => {
  assert.deepEqual(
    checkSeedPasswords({ ...LOCAL, SEED_ADMIN_PASSWORD: GOOD_ADMIN }),
    { ok: true, adminPassword: GOOD_ADMIN, demoPassword: null },
  );
  assert.deepEqual(
    checkSeedPasswords({ ...LISTED, SEED_DEMO_PASSWORD: GOOD_DEMO }),
    { ok: true, adminPassword: null, demoPassword: GOOD_DEMO },
  );
  assert.match(refusal({ ...LOCAL, SEED_ADMIN_PASSWORD: "short" }), /SEED_ADMIN_PASSWORD must be at least 12/);
  assert.match(refusal({ ...LOCAL, SEED_DEMO_PASSWORD: "Coach123!" }), /SEED_DEMO_PASSWORD must not be one of/);
  assert.match(refusal({ ...LISTED, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: GOOD_ADMIN }), /different from each other/);
});

check("no refusal message ever contains a password", () => {
  const secrets = [GOOD_ADMIN, GOOD_DEMO, "tooShort1!", "Admin123!", "Member123!"];
  const cases = [
    { ...PRIVATE, SEED_ADMIN_PASSWORD: "tooShort1!", SEED_DEMO_PASSWORD: GOOD_DEMO },
    { ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: GOOD_ADMIN },
    { ...PRIVATE, SEED_ADMIN_PASSWORD: "Admin123!", SEED_DEMO_PASSWORD: GOOD_DEMO },
    { ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN, SEED_DEMO_PASSWORD: "Member123!" },
    { ...PRIVATE, SEED_ADMIN_PASSWORD: GOOD_ADMIN },
    { ...LOCAL, SEED_ADMIN_PASSWORD: "tooShort1!" },
    PRIVATE,
  ];
  for (const env of cases) {
    const text = refusal(env);
    for (const secret of secrets) assert.ok(!text.includes(secret), `${text} holds ${secret}`);
  }
});

console.log(`\n${passed} checks passed\n`);
