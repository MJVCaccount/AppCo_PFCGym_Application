/**
 * RATE_LIMIT_MULTIPLIER against the real limiter and the test database: the
 * same policy allows N, then 2N, then 20N hits as the variable changes, and a
 * bad value changes nothing. Whole windows are untouched.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { checkLimit, POLICIES, rateLimitMultiplier } from "../src/lib/rateLimit";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

const env = process.env as Record<string, string | undefined>;
let counter = 0;

/** Hits `register` (5 an hour) from a fresh address until it is denied. */
async function allowedBeforeDenied(cap: number): Promise<number> {
  const address = `203.0.113.${++counter}`;
  let allowed = 0;
  for (let i = 0; i < cap; i++) {
    const result = await checkLimit("register", address);
    if (!result.allowed) break;
    allowed++;
  }
  return allowed;
}

async function main() {
  await resetDatabase();
  delete env.RATE_LIMIT_MULTIPLIER;

  await check("without the variable, register allows 5 an hour", async () => {
    assert.equal(POLICIES.register.limit, 5);
    assert.equal(await allowedBeforeDenied(30), 5);
  });

  await check("a multiplier of 3 allows 15", async () => {
    env.RATE_LIMIT_MULTIPLIER = "3";
    assert.equal(await allowedBeforeDenied(40), 15);
  });

  await check("the maximum, 20, allows 100", async () => {
    env.RATE_LIMIT_MULTIPLIER = "20";
    assert.equal(await allowedBeforeDenied(150), 100);
  });

  await check("sign-in limits scale too: 30 attempts per address becomes 60 at 2", async () => {
    env.RATE_LIMIT_MULTIPLIER = "2";
    const address = "203.0.113.200";
    let allowed = 0;
    for (let i = 0; i < 80; i++) {
      if (!(await checkLimit("loginIp", address)).allowed) break;
      allowed++;
    }
    assert.equal(allowed, 60);
  });

  await check("invalid values are ignored: the limit stays 5", async () => {
    for (const bad of ["0", "21", "2.5", "-3", "lots", "", "1e1"]) {
      env.RATE_LIMIT_MULTIPLIER = bad;
      assert.equal(rateLimitMultiplier(), 1, bad);
      assert.equal(await allowedBeforeDenied(30), 5, bad);
    }
  });

  await check("the window is never stretched: a bucket still lasts one hour at most", async () => {
    env.RATE_LIMIT_MULTIPLIER = "20";
    const address = "203.0.113.201";
    await checkLimit("register", address);
    const rows = await testDb.rateLimitBucket.findMany({ where: { key: { startsWith: "register:" } } });
    assert.ok(rows.length > 0);
    const longest = Math.max(...rows.map((row) => row.resetAt.getTime() - Date.now()));
    assert.ok(longest <= 60 * 60 * 1000 + 5000, `window ${longest}ms`);
  });

  delete env.RATE_LIMIT_MULTIPLIER;
  console.log(`\n${passed} checks passed\n`);
  await testDb.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
