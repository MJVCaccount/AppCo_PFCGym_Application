/**
 * Property tests (fast-check). No database: these are the pure functions that
 * take input from strangers. For each, a rule that must hold for ANY input,
 * checked on many generated inputs and shrunk to a minimal counterexample when
 * one fails.
 *
 * On a failure the seed and the minimal counterexample are printed. Replay with
 *   FC_SEED=<seed> npm test      (or run this file alone)
 * and raise the effort with FC_RUNS=<n> (default 300).
 */
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import fc from "fast-check";

import { backoffUntil, MAX_ATTEMPTS } from "../src/lib/services/outboxService";
import { checkPassword, isPasswordLengthAcceptable, MAX_PASSWORD, MIN_PASSWORD } from "../src/lib/passwordPolicy";
import { safeReturnPath } from "../src/lib/returnUrl";
import { decodeSession, encodeSession, MAX_AGE_SECONDS } from "../src/lib/sessionToken";
import { imageDimensions, inspectImage, inspectUpload, pdfHasActiveContent } from "../src/lib/uploadInspection";
import { contentDisposition, sanitizeFileName, sniffType } from "../src/lib/uploads";
import { RULES } from "../src/lib/validation";

const RUNS = Number(process.env.FC_RUNS ?? 300);
const SEED = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED);

let passed = 0;

/** The string rules take text (form fields are always text); turn any generated value into some, without throwing. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return "";
  }
}

/** Runs a property; on failure prints the seed and the shrunk counterexample, then throws. */
function property<T extends unknown[]>(label: string, arbitraries: { [K in keyof T]: fc.Arbitrary<T[K]> }, predicate: (...args: T) => void, runs = RUNS) {
  const details = fc.check(
    (fc.property as (...a: unknown[]) => fc.IPropertyWithHooks<unknown[]>)(...arbitraries, (...args: unknown[]) => {
      predicate(...(args as T));
    }),
    { numRuns: runs, ...(SEED === undefined ? {} : { seed: SEED }) },
  );

  if (details.failed) {
    console.error(`\nPROPERTY FAILED: ${label}`);
    console.error(`  seed: ${details.seed}   (replay: FC_SEED=${details.seed})`);
    console.error(`  counterexample: ${JSON.stringify(details.counterexample, (_, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 600)}`);
    console.error(`  error: ${details.errorInstance instanceof Error ? details.errorInstance.message : String(details.errorInstance)}`);
    throw new Error(`Property failed: ${label} (seed ${details.seed})`);
  }

  passed++;
  console.log(`  ok  ${label}  (${details.numRuns} runs)`);
}

/** Fails the property if `fn` takes longer than `ms`. */
function quickly<T>(ms: number, fn: () => T): T {
  const started = performance.now();
  const result = fn();
  const took = performance.now() - started;
  assert.ok(took < ms, `took ${took.toFixed(0)} ms (limit ${ms} ms)`);
  return result;
}

// ---------------------------------------------------------------- generators

/** Any string, including lone surrogates, NUL, bidi marks and very long ones. */
const anyString = fc.oneof(
  fc.string({ unit: "binary", maxLength: 300 }),
  fc.string({ unit: "grapheme", maxLength: 100 }),
  fc.string({ maxLength: 4000 }),
  fc.constantFrom("", " ", "\u0000", "\ud800", "‮", "﻿", "\r\n", "../..", "%00", "null", "NaN", "9".repeat(400)),
);

const anyValue = fc.oneof(anyString, fc.anything(), fc.constantFrom(undefined, null, NaN, Infinity, -0, 1e309));

const bytes = (max: number) => fc.uint8Array({ maxLength: max });

const SIGNATURES = [
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0xff, 0xd8, 0xff, 0xe0], // JPEG
  [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], // WebP
  [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a], // %PDF-1.7
];
/** Random bytes that START like a real file, so the parsers go past their first check. */
const fileLike = fc.tuple(fc.constantFrom(...SIGNATURES), bytes(600)).map(([head, rest]) => new Uint8Array([...head, ...rest]));
const anyBytes = fc.oneof(bytes(3000), fileLike);

/** A PDF made of random text, hostile names (also #xx-escaped) and real deflate streams. */
const pdfLike = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.constantFrom("/JavaScript", "/J#61vaScript", "/JS", "/Launch", "/OpenAction", "/Open#41ction", "/Type /Action", "stream\n", "endstream", "<<", ">>"),
      bytes(120).map((b) => "stream\n" + Buffer.from(deflateSync(Buffer.from(b))).toString("latin1") + "\nendstream"),
      bytes(60).map((b) => "stream\n" + Buffer.from(b).toString("latin1") + "\nendstream"),
    ),
    { maxLength: 25 },
  )
  .map((parts) => Buffer.from("%PDF-1.7\n" + parts.join("\n"), "latin1"));

const roles = fc.constantFrom("Member", "Fighter", "Coach", "Admin" as const);
const sessionUser = fc.record({
  id: fc.integer({ min: 1, max: 2_147_483_647 }),
  email: anyString,
  fullName: anyString,
  role: roles,
});

async function main() {
  console.log("\nPROPERTIES: PASSWORDS AND VALIDATION RULES");

  property("checkPassword never throws and answers null or a sentence, for any string", [anyString], (value) => {
    const answer = checkPassword(value);
    assert.ok(answer === null || (typeof answer === "string" && answer.length > 0));
  });

  property("checkPassword agrees with the length limits: under 10 or over 128 is always refused", [anyString], (value) => {
    if (value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) assert.notEqual(checkPassword(value), null);
    if (checkPassword(value) === null) assert.ok(value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD);
    assert.equal(isPasswordLengthAcceptable(value), value.length > 0 && value.length <= MAX_PASSWORD);
  });

  property("every RULES function returns null or a sentence and never throws, for any value", [anyValue, fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 5000 })], (value, min, max) => {
    const stringRules = ["name", "email", "phone", "password", "loginPassword", "message", "weightClass", "eventName", "venue", "eventDescription", "timeOfDay"] as const;
    for (const name of stringRules) {
      const answer = (RULES[name] as (v: string) => string | null)(asText(value));
      assert.ok(answer === null || typeof answer === "string", name);
    }
    for (const rule of [RULES.text(min, max, "Field"), RULES.integerRange(min, max, "Number")]) {
      const answer = rule(value as never);
      assert.ok(answer === null || typeof answer === "string");
    }
  });

  property("the text(min, max) rule never accepts a value that is not a string", [fc.anything().filter((v) => typeof v !== "string")], (value) => {
    assert.notEqual(RULES.text(0, 100)(value as never), null);
  });

  console.log("\nPROPERTIES: THE SESSION COOKIE");

  property("a session round-trips: decode(encode(user, sv)) is the same user, version and an expiry 8 hours out", [sessionUser, fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 })], (user, sv, nowMs) => {
    const token = encodeSession(user, sv, nowMs);
    const decoded = decodeSession(token, nowMs + 1000);
    assert.ok(decoded, "a fresh cookie decodes");
    assert.deepEqual({ id: decoded.id, email: decoded.email, fullName: decoded.fullName, role: decoded.role, sv: decoded.sv }, { ...user, sv });
    assert.equal(decoded.exp, Math.floor(nowMs / 1000) + MAX_AGE_SECONDS);
    assert.equal(decodeSession(token, nowMs + MAX_AGE_SECONDS * 1000), null, "and not at its expiry");
  });

  property("decodeSession returns null and never throws on arbitrary strings", [anyString], (value) => {
    assert.equal(decodeSession(value), null);
  });

  property("decodeSession returns null for anything shaped like a cookie that was not signed by us", [anyString, anyString], (payload, signature) => {
    const body = Buffer.from(payload).toString("base64url");
    assert.equal(decodeSession(`${body}.${Buffer.from(signature).toString("base64url")}`), null);
    assert.equal(decodeSession(`${payload}.${signature}`), null);
    assert.equal(decodeSession(`${body}.`), null);
  });

  property("editing one character of a real cookie always breaks it", [sessionUser, fc.nat(), fc.integer({ min: 1, max: 255 })], (user, position, delta) => {
    const token = encodeSession(user, 0);
    const at = position % token.length;
    const flipped = token.slice(0, at) + String.fromCharCode((token.charCodeAt(at) + delta) % 128 || 65) + token.slice(at + 1);
    if (flipped !== token) assert.equal(decodeSession(flipped), null);
  });

  console.log("\nPROPERTIES: UPLOAD INSPECTION");

  property("sniffType, imageDimensions and inspectImage never throw on any bytes, and finish quickly", [anyBytes], (data) => {
    quickly(200, () => {
      const type = sniffType(data);
      assert.ok(type === null || typeof type === "string");
      for (const mediaType of ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/html", ""]) {
        const size = imageDimensions(data, mediaType);
        assert.ok(size === null || (Number.isFinite(size.width) && Number.isFinite(size.height)));
        const sentence = inspectImage(data, mediaType, 25_000_000);
        assert.ok(sentence === null || typeof sentence === "string");
      }
    });
  });

  property("inspectUpload never throws for any bytes and any claimed type, and is fast", [anyBytes, fc.constantFrom("image/png", "image/jpeg", "image/webp", "application/pdf"), fc.constantFrom("document", "image" as const)], (data, mediaType, kind) => {
    quickly(300, () => {
      const answer = inspectUpload(data, mediaType, kind as "document" | "image");
      assert.ok(answer === null || typeof answer === "string");
    });
  });

  property("an image the inspector accepts always has a readable, reasonable size", [anyBytes], (data) => {
    for (const mediaType of ["image/png", "image/jpeg", "image/webp"]) {
      if (inspectImage(data, mediaType, 25_000_000) === null) {
        const size = imageDimensions(data, mediaType)!;
        assert.ok(size.width >= 1 && size.height >= 1 && size.width <= 12_000 && size.height <= 12_000 && size.width * size.height <= 25_000_000);
      }
    }
  });

  property("pdfHasActiveContent never throws on arbitrary bytes or on PDF-shaped input with real deflate streams, and is fast", [fc.oneof(anyBytes, pdfLike)], (data) => {
    quickly(500, () => assert.equal(typeof pdfHasActiveContent(data), "boolean"));
  });

  property("a PDF that names /JavaScript, /JS, /Launch or /OpenAction in plain text is always caught, wherever the name sits", [fc.string({ maxLength: 80 }), fc.string({ maxLength: 80 }), fc.constantFrom("/JavaScript", "/JS", "/Launch", "/OpenAction", "/J#61vaScript", "/#4AS", "/L#61unch", "/Open#41ction")], (before, after, name) => {
    // Names are delimited by whitespace or a delimiter in a real PDF.
    const pdf = Buffer.from(`%PDF-1.7\n${before.replace(/[\r\n]/g, " ")}\n<< /S ${name} >>\n${after.replace(/[\r\n]/g, " ")}`, "latin1");
    assert.equal(pdfHasActiveContent(pdf), true);
  });

  property("a hostile name inside a deflate stream is caught too", [bytes(80), fc.constantFrom("/JavaScript", "/JS", "/Launch", "/OpenAction")], (junk, name) => {
    const inner = Buffer.concat([Buffer.from(junk), Buffer.from(` << /S ${name} >> `)]);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << /Filter /FlateDecode >>\nstream\n", "latin1"), deflateSync(inner), Buffer.from("\nendstream\nendobj", "latin1")]);
    assert.equal(pdfHasActiveContent(pdf), true);
  });

  console.log("\nPROPERTIES: FILE NAMES AND REDIRECTS");

  property("sanitizeFileName is always safe: no separators, control or header characters, no leading dot, 1 to 100 characters, well-formed", [fc.oneof(anyValue, fc.constantFrom("../../etc/passwd", "..\\..\\x", "a/b\\c", "‮gpj.exe", "x".repeat(500) + ".pdf"))], (name) => {
    const clean = sanitizeFileName(name);
    assert.equal(typeof clean, "string");
    assert.ok(clean.length >= 1 && clean.length <= 100, `length ${clean.length}`);
    assert.ok(!/[\\/:*?"<>|;,%]/.test(clean), "no separator or special character");
    assert.ok(!/[\u0000-\u001f\u007f]/.test(clean), "no control character");
    assert.ok(!clean.startsWith("."), "no leading dot");
    assert.ok(clean.isWellFormed(), "no lone surrogate");
    assert.equal(sanitizeFileName(clean), clean, "idempotent");
  });

  property("contentDisposition never throws on a sanitised name and is a single safe header line", [anyValue], (name) => {
    const header = contentDisposition(sanitizeFileName(name));
    assert.ok(header.startsWith("attachment;"));
    assert.ok(!/[\r\n\u0000]/.test(header), "one line");
    assert.ok(/^[\x20-\x7e]*$/.test(header), "ASCII only");
  });

  property("safeReturnPath never returns a target off this site", [fc.oneof(anyValue, anyString.map((s) => "/" + s), anyString.map((s) => "//" + s), anyString.map((s) => "/\\" + s), fc.constantFrom("/", "/dashboard", "//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "javascript:alert(1)", "/%2f/evil.example"))], (value) => {
    const target = safeReturnPath(value);
    if (target === null) return;

    assert.ok(target.startsWith("/") && !target.startsWith("//"));
    assert.ok(!/[\u0000-\u001f\u007f\\]/.test(target));
    const resolved = new URL(target, "https://site.test");
    assert.equal(resolved.origin, "https://site.test", target);
    // Browsers drop tab, CR and LF before parsing; the result must still be on-site.
    const stripped = new URL(target.replace(/[\t\r\n]/g, ""), "https://site.test");
    assert.equal(stripped.origin, "https://site.test");
  });

  console.log("\nPROPERTIES: EMAIL BACKOFF");

  property("backoffUntil never goes back in time, never shortens as failures grow, and ends in null", [fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 })], (ms) => {
    const now = new Date(ms);
    let previous = 0;
    for (let failures = 1; failures < MAX_ATTEMPTS; failures++) {
      const at = backoffUntil(failures, now);
      assert.ok(at !== null, `failure ${failures} retries`);
      assert.ok(at.getTime() > now.getTime(), "in the future");
      assert.ok(at.getTime() - now.getTime() >= previous, "monotonic");
      previous = at.getTime() - now.getTime();
    }
    for (const failures of [MAX_ATTEMPTS, MAX_ATTEMPTS + 1, 1000]) assert.equal(backoffUntil(failures, now), null);
  });

  property("backoffUntil is a pure function of its arguments", [fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1_000_000_000_000, max: 4_000_000_000_000 })], (failures, ms) => {
    assert.deepEqual(backoffUntil(failures, new Date(ms)), backoffUntil(failures, new Date(ms)));
  });

  console.log(`\n${passed} checks passed\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
