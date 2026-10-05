/**
 * Small pure checks that need no database: the post-login redirect guard, the
 * image-link rule shared by coaches and events, the rate-limit multiplier,
 * the production start-up check, the weekday helper and the favicon.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { dayOfDate, parseIsoDate } from "../src/lib/dates";
import { sessionSecretProblem, validateEnv } from "../src/lib/env";
import { IMAGE_URL_ERROR, parsePublicImageUrl } from "../src/lib/publicImage";
import { effectiveLimit, POLICIES, rateLimitMultiplier } from "../src/lib/rateLimit";
import type { PolicyName } from "../src/lib/rateLimit";
import { safeReturnPath } from "../src/lib/returnUrl";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

const env = process.env as Record<string, string | undefined>;

/** Runs `fn` with some environment variables set, then puts them back. */
function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const name of Object.keys(values)) before[name] = env[name];
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    fn();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
}

console.log("\nPOST-LOGIN REDIRECT");

check("a path on this site is followed", () => {
  for (const ok of ["/dashboard", "/admin/events?page=2", "/coach/classes/5?date=2026-10-06", "/"]) {
    assert.equal(safeReturnPath(ok), ok);
  }
});

check("anything that could leave the site is refused", () => {
  const bad: unknown[] = [
    "//evil.example",
    "/\\evil.example",
    "/\\\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\u0000/evil.example",
    "https://evil.example",
    "http://localhost:3000/dashboard",
    "javascript:alert(1)",
    "dashboard",
    "",
    null,
    undefined,
    42,
    ["/dashboard"],
    "/" + "a".repeat(3000),
  ];
  for (const value of bad) assert.equal(safeReturnPath(value), null, String(value).slice(0, 30));
});

console.log("\nIMAGE LINKS");

check("only an https link to the public Blob store is accepted", () => {
  const good = "https://abc123.public.blob.vercel-storage.com/images/x.jpg";
  assert.deepEqual(parsePublicImageUrl(good), { value: good });
  assert.deepEqual(parsePublicImageUrl(`  ${good}  `), { value: good });
});

check("blank, null and undefined mean no image", () => {
  for (const blank of ["", "   ", null, undefined]) {
    assert.deepEqual(parsePublicImageUrl(blank), { value: null });
  }
});

check("other hosts, schemes, look-alikes and non-text are refused", () => {
  const bad: unknown[] = [
    "https://example.co.za/a.jpg",
    "http://abc123.public.blob.vercel-storage.com/a.jpg",
    "https://public.blob.vercel-storage.com.evil.example/a.jpg",
    "https://evilpublic.blob.vercel-storage.com/a.jpg",
    "https://abc.private.blob.vercel-storage.com/a.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "not a url",
    5,
    ["https://abc.public.blob.vercel-storage.com/a.jpg"],
    { url: "x" },
  ];
  for (const value of bad) {
    assert.deepEqual(parsePublicImageUrl(value), { error: IMAGE_URL_ERROR }, String(value).slice(0, 40));
  }
});

console.log("\nRATE LIMIT MULTIPLIER");

check("a whole number from 1 to 20 is used", () => {
  for (const [value, expected] of [["1", 1], ["2", 2], ["10", 10], ["20", 20], [" 5 ", 5], ["05", 5]] as const) {
    assert.equal(rateLimitMultiplier(value), expected, value);
  }
});

check("anything else is ignored", () => {
  for (const value of [undefined, "", " ", "0", "21", "100", "-3", "2.5", "1e1", "lots", "NaN", "Infinity", "0x10", "5x", "٥"]) {
    assert.equal(rateLimitMultiplier(value), 1, String(value));
  }
});

check("it scales every limit in POLICIES and never the window", () => {
  withEnv({ RATE_LIMIT_MULTIPLIER: undefined }, () => {
    for (const name of Object.keys(POLICIES) as PolicyName[]) {
      assert.equal(effectiveLimit(name), POLICIES[name].limit, name);
    }
  });
  withEnv({ RATE_LIMIT_MULTIPLIER: "4" }, () => {
    for (const name of Object.keys(POLICIES) as PolicyName[]) {
      assert.equal(effectiveLimit(name), POLICIES[name].limit * 4, name);
    }
    assert.equal(effectiveLimit("register"), 20);
    assert.equal(effectiveLimit("loginIp"), 120);
  });
  withEnv({ RATE_LIMIT_MULTIPLIER: "99" }, () => {
    assert.equal(effectiveLimit("register"), 5);
  });
});

console.log("\nSTART-UP CHECK");

check("production needs a SESSION_SECRET of at least 32 characters", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.match(sessionSecretProblem(undefined) ?? "", /SESSION_SECRET/);
    assert.match(sessionSecretProblem("short") ?? "", /SESSION_SECRET/);
    assert.equal(sessionSecretProblem("x".repeat(32)), null);
  });
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(sessionSecretProblem(undefined), null);
  });
});

check("validateEnv stops a production server with no secret, and passes with one", () => {
  withEnv({ NODE_ENV: "production", APP_URL: "https://pfc.example.co.za", SESSION_SECRET: "" }, () => {
    assert.throws(() => validateEnv(), /SESSION_SECRET/);
  });
  withEnv({ NODE_ENV: "production", APP_URL: "https://pfc.example.co.za", SESSION_SECRET: "y".repeat(40) }, () => {
    assert.doesNotThrow(() => validateEnv());
  });
  withEnv({ NODE_ENV: "production", APP_URL: "http://pfc.example.co.za", SESSION_SECRET: "y".repeat(40) }, () => {
    assert.throws(() => validateEnv(), /https/);
  });
});

console.log("\nWEEKDAYS AND FAVICON");

check("dayOfDate gives the gym's weekday key for a date-only value", () => {
  const expected: [string, string][] = [
    ["2026-10-05", "mon"],
    ["2026-10-06", "tue"],
    ["2026-10-07", "wed"],
    ["2026-10-08", "thu"],
    ["2026-10-09", "fri"],
    ["2026-10-10", "sat"],
    ["2026-10-11", "sun"],
    ["2026-12-31", "thu"],
    ["2028-02-29", "tue"],
  ];
  for (const [iso, day] of expected) {
    assert.equal(dayOfDate(parseIsoDate(iso)!), day, iso);
  }
});

check("/favicon.ico exists as a real icon file", () => {
  const bytes = readFileSync(path.resolve(__dirname, "..", "src", "app", "favicon.ico"));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0], "ICO header");
  assert.ok(bytes.length > 100);
});

console.log(`\n${passed} checks passed\n`);
