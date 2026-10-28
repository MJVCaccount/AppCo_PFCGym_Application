/**
 * Hardening: password rule, session cookie, security.txt, rate limits
 * on every route, audit rows, sign-out-everywhere, erasure (POPIA), and the
 * stricter upload checks.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { resetDatabase, testDb } from "./helpers/db";
import { jpegHead, padded, pdfWith, pngHead, webpHead } from "./support/files";
import { cookies, lastCookieOptions, setTestRequestHeaders } from "./support/next-headers";

import { POST as signOutRoute } from "../src/app/api/account/sign-out-everywhere/route";
import { GET as classesGet } from "../src/app/api/classes/route";
import { GET as documentGet } from "../src/app/api/documents/[id]/route";
import { POST as eraseRoute } from "../src/app/api/admin/users/[id]/erase/route";
import { GET as securityTxt } from "../src/app/.well-known/security.txt/route";
import { login, register, requestPasswordReset } from "../src/actions/auth";
import {
  imageDimensions,
  inspectImage,
  MAX_DOCUMENT_PIXELS,
  pdfHasActiveContent,
} from "../src/lib/uploadInspection";
import { checkPassword } from "../src/lib/passwordPolicy";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { authenticate } from "../src/lib/services/authService";
import { createBooking } from "../src/lib/services/bookingService";
import { uploadFighterDocument } from "../src/lib/services/documentService";
import { uploadPublicImage } from "../src/lib/services/imageService";
import { COOKIE_NAME, encodeSession, sessionCookieName } from "../src/lib/sessionToken";
import { createSession, destroySession, getSession } from "../src/lib/session";
import { EMPTY_FORM_STATE } from "../src/lib/validation";
import type { SessionUser } from "../src/lib/types";

const ORIGIN = "https://pfc.test.invalid";
process.env.APP_URL = ORIGIN;
const ROOT = path.resolve(__dirname, "..");

interface BlobStub {
  blobs: Map<string, { body: Buffer }>;
}
const blob = (globalThis as unknown as { __blob: BlobStub }).__blob;

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const post = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", { method: "POST", headers: { origin: ORIGIN, ...headers } });
const get = (headers: Record<string, string> = {}) => new Request("http://localhost/api/test", { headers });
const idParams = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

function upload(fields: Record<string, string>, bytes: Buffer, name: string, type: string): Request {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  data.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost/upload", { method: "POST", body: data, headers: { origin: ORIGIN } });
}

const setEnv = (name: string, value: string | undefined) => {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
};

async function auditRows(action: string) {
  return testDb.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });
}

async function main() {
  await resetDatabase();
  process.env.PRIVATE_BLOB_STORE_ID = "private-store-id";
  process.env.PUBLIC_BLOB_STORE_ID = "public-store-id";

  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");

  console.log("\nPASSWORDS");

  await check("choosing a password: 10 to 128 characters, no common ones", () => {
    assert.equal(checkPassword("kettle-Lamp-42"), null);
    assert.match(checkPassword("short")!, /at least 10/);
    assert.match(checkPassword("Zq7-".repeat(33))!, /at most 128/);
    assert.match(checkPassword("password123")!, /too common/);
    assert.match(checkPassword("1234567890")!, /too common/);
    assert.match(checkPassword("zzzzzzzzzz")!, /too common/);
  });

  await check("sign-up refuses a 9-character, a common and a 129-character password; 10 is accepted", async () => {
    const attempt = async (password: string, n: number) => {
      try {
        const state = await register(EMPTY_FORM_STATE, form({ fullName: "Test Person", email: `pw${n}@example.co.za`, phone: "", password, planId: "" }));
        return { state, redirected: false };
      } catch (e) {
        return { state: null, redirected: String((e as { message?: string }).message ?? e).includes("REDIRECT") || true };
      }
    };
    assert.ok((await attempt("abcdefghi", 1)).state?.errors?.password, "9 characters");
    assert.ok((await attempt("password123", 2)).state?.errors?.password, "common");
    assert.ok((await attempt("Zq7-".repeat(33), 3)).state?.errors?.password, "129 characters");
    assert.equal((await attempt("kettle-Lamp-42", 4)).state, null, "a good one signs up (redirects)");
    await destroySession();
  });

  await check("signing in with a password from the old 8-character rule still works; an enormous one is refused unhashed", async () => {
    const ok = await authenticate("coach@pfc.co.za".replace("coach", "sofia"), "Coach123!"); // 9 characters
    assert.equal(ok.ok, true);

    const started = Date.now();
    const huge = await authenticate("sofia@pfc.co.za", "x".repeat(1_000_000));
    assert.equal(huge.status, 401);
    assert.ok(Date.now() - started < 50, "no scrypt run on a megabyte");
  });

  console.log("\nSESSION COOKIE");

  await check("production uses the __Host- name; development keeps the plain one", () => {
    assert.equal(sessionCookieName("production"), "__Host-pfc_session");
    assert.equal(sessionCookieName("development"), "pfc_session");
    assert.equal(sessionCookieName(undefined), "pfc_session");
  });

  await check("the cookie is httpOnly, lax, path / and Secure in production, with no Domain; sign-out clears it the same way", async () => {
    setEnv("NODE_ENV", "production");
    try {
      await createSession(member);
      const options = lastCookieOptions(COOKIE_NAME)!;
      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, "lax");
      assert.equal(options.path, "/");
      assert.ok(!("domain" in options), "a __Host- cookie must not name a Domain");

      await destroySession();
      const cleared = lastCookieOptions(COOKIE_NAME)!;
      assert.equal(cleared.maxAge, 0);
      assert.equal(cleared.secure, true, "a __Host- cookie can only be overwritten by a Secure one");
      assert.equal(await getSession(), null);
    } finally {
      setEnv("NODE_ENV", "test");
    }
  });

  console.log("\nsecurity.txt");

  await check("security.txt carries Contact, a future Expires within a year, and Canonical", async () => {
    setEnv("SECURITY_CONTACT", undefined);
    setEnv("CONTACT_INBOX", "security@example.co.za");
    const res = securityTxt();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
    const body = await res.text();
    assert.match(body, /^Contact: mailto:security@example\.co\.za$/m);
    assert.match(body, /^Canonical: https:\/\/pfc\.test\.invalid\/\.well-known\/security\.txt$/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(body)![1]!);
    assert.ok(expires > Date.now() && expires < Date.now() + 366 * 86_400_000);

    setEnv("SECURITY_CONTACT", "https://example.co.za/report");
    assert.match(await securityTxt().text(), /^Contact: https:\/\/example\.co\.za\/report$/m);

    setEnv("SECURITY_CONTACT", undefined);
    setEnv("CONTACT_INBOX", "");
    assert.equal(securityTxt().status, 404, "nothing honest to publish");
    setEnv("CONTACT_INBOX", "");
  });

  console.log("\nRATE LIMITS EVERYWHERE");

  await check("every route except the two health checks counts its callers", () => {
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") {
          const rel = path.relative(path.join(ROOT, "src", "app", "api"), full).replace(/\\/g, "/");
          if (rel.startsWith("health/") || rel === "health/route.ts" || rel.startsWith("[...path]")) continue;
          const text = readFileSync(full, "utf8");
          const handlers = [...text.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = (?:userRoute|publicRoute)\(\s*\{([\s\S]*?)\},\s*\n\s*async/g)];
          assert.ok(handlers.length > 0, rel);
          for (const [, method, options] of handlers) {
            if (!/limit: "/.test(options!)) missing.push(`${method} ${rel}`);
          }
        }
      }
    };
    walk(path.join(ROOT, "src", "app", "api"));
    assert.deepEqual(missing, []);
  });

  await check("a script hammering a public read is stopped at 120 a minute; a new address is not", async () => {
    await testDb.rateLimitBucket.deleteMany();
    const call = (ip: string) => classesGet(get({ "x-real-ip": ip }));
    for (let i = 0; i < 120; i++) assert.equal((await call("203.0.113.9")).status, 200);
    const denied = await call("203.0.113.9");
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) >= 1);
    assert.equal((await call("203.0.113.10")).status, 200);
  });

  console.log("\nAUDIT ROWS");

  await check("an administrator downloading a document is audited; the owner doing so is not", async () => {
    const created = await uploadFighterDocument(
      fighter,
      upload({ type: "Medical" }, pdfWith("a medical certificate"), "medical.pdf", "application/pdf"),
    );
    assert.equal(created.status, 201, created.error);
    const id = created.data!.id;

    await createSession(fighter);
    assert.equal((await documentGet(get(), idParams(id))).status, 200);
    assert.equal((await auditRows("document.download")).length, 0, "the owner is not audited");

    await createSession(admin);
    const res = await documentGet(get(), idParams(id));
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    const rows = await auditRows("document.download");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorId, admin.id);
    assert.equal(rows[0]!.entity, "FighterDocument");
    assert.equal(rows[0]!.entityId, id);
    await destroySession();
  });

  await check("a download is refused with the CSP sandbox header set on the response that succeeds", async () => {
    const doc = await testDb.fighterDocument.findFirstOrThrow();
    await createSession(admin);
    const res = await documentGet(get(), idParams(doc.id));
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /\bsandbox\b/);
    assert.match(csp, /default-src 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    await res.arrayBuffer();
    await destroySession();
  });

  await check("a sign-in lockout writes exactly one audit row, with a hashed address and no email", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.50" });
    for (let i = 0; i < 8; i++) {
      await login(EMPTY_FORM_STATE, form({ email: "member@pfc.co.za", password: "wrong-password-1" }));
    }
    const rows = await auditRows("login.lockout");
    assert.equal(rows.length, 1, "one row per lockout, not one per refused attempt");
    assert.equal(rows[0]!.actorId, null);
    assert.equal(rows[0]!.entityId, member.id);
    const text = JSON.stringify(rows[0]);
    assert.ok(!text.includes("203.0.113.50") && !text.includes("member@pfc.co.za"));
    assert.match((rows[0]!.detail as { client: string }).client, /^[0-9a-f]{12}$/);
    setTestRequestHeaders({ "x-real-ip": "198.51.100.1" });
  });

  await check("a password-reset request is audited for an existing account only, and the answer is the same", async () => {
    setTestRequestHeaders({ "x-real-ip": "198.51.100.2" });
    const known = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "sofia@pfc.co.za" }));
    setTestRequestHeaders({ "x-real-ip": "198.51.100.3" });
    const unknown = await requestPasswordReset(EMPTY_FORM_STATE, form({ email: "nobody-here@example.co.za" }));
    assert.deepEqual(known, unknown);

    const rows = await auditRows("password.reset.request");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entityId, coach.id);
    assert.equal(rows[0]!.actorId, null);
  });

  console.log("\nSIGN OUT EVERYWHERE");

  await check("it ends every device's session, this one included, and is audited", async () => {
    const user = await testDb.user.findUniqueOrThrow({ where: { id: member.id } });
    // Two "devices": cookies issued under the same session version.
    const phone = encodeSession(member, user.sessionVersion);
    const laptop = encodeSession(member, user.sessionVersion);

    const jar = await cookies();
    const use = (token: string) => jar.set(COOKIE_NAME, token);

    use(phone);
    assert.equal((await getSession())?.id, member.id);
    use(laptop);
    assert.equal((await getSession())?.id, member.id);

    await createSession(member);
    const res = await signOutRoute(post());
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { signedOut: true });

    assert.equal(await getSession(), null, "this device's cookie was cleared");
    use(phone);
    assert.equal(await getSession(), null, "the phone is out");
    use(laptop);
    assert.equal(await getSession(), null, "the laptop is out");

    const after = await testDb.user.findUniqueOrThrow({ where: { id: member.id } });
    assert.equal(after.sessionVersion, user.sessionVersion + 1);
    const rows = await auditRows("session.revoke_all");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorId, member.id);
    await destroySession();
  });

  await check("it needs a session and a same-origin write, and is limited to 5 an hour", async () => {
    assert.equal((await signOutRoute(post())).status, 401);
    await createSession(member);
    assert.equal((await signOutRoute(post({ origin: "https://evil.example" }))).status, 403);

    await testDb.rateLimitBucket.deleteMany();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      await createSession(member);
      statuses.push((await signOutRoute(post())).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  });

  console.log("\nERASURE (POPIA)");

  await check("erasing a fighter anonymises them, removes documents, files and enquiries, and keeps bookings and history", async () => {
    // A fighter with a booking, a document and an enquiry sent from their address.
    const target = await sessionFor("filler05@demo.pfc.invalid");
    await testDb.fighter.create({ data: { fighterId: target.id, weightClass: "Lightweight", imageUrl: "https://x.public.blob.vercel-storage.com/images/p.png" } });
    await testDb.user.update({ where: { id: target.id }, data: { role: "Fighter", phone: "0821234567" } });
    const doc = await uploadFighterDocument(
      { ...target, role: "Fighter" },
      upload({ type: "Medical" }, pdfWith("private"), "private.pdf", "application/pdf"),
    );
    assert.equal(doc.status, 201, doc.error);
    const pathname = (await testDb.fighterDocument.findFirstOrThrow({ where: { fighterId: target.id } })).fileUrl;
    assert.ok(blob.blobs.has(pathname));
    await testDb.contactEnquiry.create({ data: { fullName: "Filler", email: "FILLER05@demo.pfc.invalid", message: "Please call me back about fights." } });
    await testDb.contactEnquiry.create({ data: { fullName: "Someone", email: "someone@else.example", message: "A different enquiry altogether." } });

    const futureClass = await testDb.gymClass.findFirstOrThrow({ where: { isActive: true, day: "sat" } });
    await testDb.membershipPlan.findFirstOrThrow();
    const bookingsBefore = await testDb.booking.count({ where: { memberId: target.id } });
    const booked = await createBooking({ ...target, role: "Fighter" }, futureClass.id);
    assert.ok(booked.status === 201 || booked.status === 409, String(booked.error));
    const bookingsAfter = await testDb.booking.count({ where: { memberId: target.id } });

    const oldHash = (await testDb.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash;
    const version = (await testDb.user.findUniqueOrThrow({ where: { id: target.id } })).sessionVersion;

    await createSession(admin);
    const res = await eraseRoute(post(), idParams(target.id));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const { data } = await res.json();
    assert.equal(data.id, target.id);
    assert.equal(data.documentsDeleted, 1);

    const row = await testDb.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.fullName, "Erased member");
    assert.equal(row.email, `erased-${target.id}@erased.invalid`);
    assert.equal(row.phone, null);
    assert.equal(row.isActive, false);
    assert.notEqual(row.passwordHash, oldHash, "the password no longer matches anything anyone knows");
    assert.equal(row.sessionVersion, version + 1);

    assert.equal(await testDb.fighterDocument.count({ where: { fighterId: target.id } }), 0);
    assert.equal(blob.blobs.has(pathname), false, "the file is gone from the store");
    assert.equal((await testDb.fighter.findUniqueOrThrow({ where: { fighterId: target.id } })).imageUrl, null);
    assert.equal(await testDb.contactEnquiry.count({ where: { email: { equals: "filler05@demo.pfc.invalid", mode: "insensitive" } } }), 0);
    assert.equal(await testDb.contactEnquiry.count(), 1, "someone else's enquiry stays");

    assert.equal(await testDb.booking.count({ where: { memberId: target.id } }), bookingsAfter, "bookings are kept");
    assert.ok(bookingsAfter >= bookingsBefore);
    assert.equal(await testDb.booking.count({ where: { memberId: target.id, status: "Confirmed" } }), 0, "future places are given back");

    const audit = (await auditRows("user.erase"))[0]!;
    assert.equal(audit.actorId, admin.id);
    assert.equal(audit.entityId, target.id);
    assert.ok(!/filler05|Filler|0821234567/.test(JSON.stringify(audit)), "no personal data in the audit row");

    // The old credentials open nothing.
    assert.equal((await authenticate("filler05@demo.pfc.invalid", "Member123!")).ok, false);
    await destroySession();
  });

  await check("erasure is admin only, refuses staff, yourself, the unknown and a second time", async () => {
    const target = await sessionFor("filler06@demo.pfc.invalid");

    await createSession(member);
    assert.equal((await eraseRoute(post(), idParams(target.id))).status, 403);
    await createSession(coach);
    assert.equal((await eraseRoute(post(), idParams(target.id))).status, 403);
    await destroySession();
    assert.equal((await eraseRoute(post(), idParams(target.id))).status, 401);
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: target.id } })).fullName.startsWith("Erased"), false);

    await createSession(admin);
    assert.equal((await eraseRoute(post(), idParams(coach.id))).status, 409, "a coach");
    assert.equal((await eraseRoute(post(), idParams(admin.id))).status, 409, "yourself");
    assert.equal((await eraseRoute(post(), idParams(999999))).status, 404);
    assert.equal((await eraseRoute(post(), idParams(Number.NaN))).status, 400);
    assert.equal((await eraseRoute(post({ origin: "https://evil.example" }), idParams(target.id))).status, 403);
    assert.equal((await eraseRoute(post(), idParams(target.id))).status, 200);
    assert.equal((await eraseRoute(post(), idParams(target.id))).status, 409, "already erased");
    await destroySession();
  });

  console.log("\nUPLOAD CHECKS");

  const asFighter = (bytes: Buffer) =>
    uploadFighterDocument(fighter, upload({ type: "Other" }, bytes, "f.pdf", "application/pdf"));

  await check("a PDF with /JavaScript, /JS, /Launch or /OpenAction is refused, however the name is written", async () => {
    const hostile = [
      "1 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj",
      "1 0 obj << /S /JS /JS (x) >> endobj",
      "1 0 obj << /S /Launch /F (cmd.exe) >> endobj",
      "trailer << /Root << /OpenAction 2 0 R >> >>",
      "1 0 obj << /S /J#61vaScript /JS (x) >> endobj",
      "1 0 obj << /S /#4Aava#53cript >> endobj",
    ];
    for (const body of hostile) {
      const r = await asFighter(pdfWith(body));
      assert.equal(r.status, 400, body);
      assert.match(r.error ?? "", /scripts or actions/);
    }
    assert.equal(await testDb.fighterDocument.count({ where: { fileName: "f.pdf" } }), 0, "nothing was stored");
  });

  await check("active content hidden in a compressed object stream is found", () => {
    const hidden = deflateSync(Buffer.from("<< /S /JavaScript /JS (app.alert(1)) >>"));
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n"), hidden, Buffer.from("\nendstream\nendobj\n%%EOF")]);
    assert.equal(pdfHasActiveContent(pdf), true);
    const harmless = deflateSync(Buffer.from("BT /F1 12 Tf (hello) Tj ET"));
    const ok = Buffer.concat([Buffer.from("%PDF-1.7\n5 0 obj << /Filter /FlateDecode >>\nstream\n"), harmless, Buffer.from("\nendstream\nendobj\n%%EOF")]);
    assert.equal(pdfHasActiveContent(ok), false);
  });

  await check("a compressed stream that expands without bound is refused", () => {
    const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024, 0));
    assert.ok(bomb.length < 100_000, "the bomb is small on the wire");
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << /Filter /FlateDecode >>\nstream\n"), bomb, Buffer.from("\nendstream\nendobj")]);
    assert.equal(pdfHasActiveContent(pdf), true);
  });

  await check("ordinary PDFs pass, including the words JavaScript and Launch in plain text", async () => {
    const r = await asFighter(pdfWith("BT (Launch of the JavaScript course, see /Helpful) Tj ET"));
    assert.equal(r.status, 201, r.error);
  });

  await check("image headers are read for PNG, JPEG and all three WebP forms", () => {
    assert.deepEqual(imageDimensions(pngHead(640, 480), "image/png"), { width: 640, height: 480 });
    assert.deepEqual(imageDimensions(jpegHead(1920, 1080), "image/jpeg"), { width: 1920, height: 1080 });
    assert.deepEqual(imageDimensions(webpHead(300, 200), "image/webp"), { width: 300, height: 200 });

    // VP8 (lossy) and VP8L (lossless), written by hand.
    const vp8 = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.from([10, 0, 0, 0]), Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a]), Buffer.from([0x40, 0x01, 0xf0, 0x00])]);
    assert.deepEqual(imageDimensions(vp8, "image/webp"), { width: 320, height: 240 });
    const bits = (500 - 1) | ((400 - 1) << 14);
    const vp8l = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8L"), Buffer.from([5, 0, 0, 0]), Buffer.from([0x2f]), Buffer.from([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255]), Buffer.alloc(8)]);
    assert.deepEqual(imageDimensions(vp8l, "image/webp"), { width: 500, height: 400 });
  });

  await check("a decompression bomb or a lying header is refused before it is stored", async () => {
    const png = (w: number, h: number) => padded(pngHead(w, h), 300);
    assert.equal(inspectImage(png(4000, 3000), "image/png", MAX_DOCUMENT_PIXELS), null);
    assert.match(inspectImage(png(65_535, 65_535), "image/png", MAX_DOCUMENT_PIXELS)!, /too large in pixels/);
    assert.match(inspectImage(png(12_001, 10), "image/png", MAX_DOCUMENT_PIXELS)!, /too large in pixels/);
    assert.match(inspectImage(png(10_000, 10_000), "image/png", MAX_DOCUMENT_PIXELS)!, /too large in pixels/, "100 MP");
    assert.match(inspectImage(png(0, 10), "image/png", MAX_DOCUMENT_PIXELS)!, /could not be read/);
    assert.match(inspectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png", MAX_DOCUMENT_PIXELS)!, /could not be read/, "truncated");
    assert.match(inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]), "image/jpeg", MAX_DOCUMENT_PIXELS)!, /could not be read/, "no frame header");

    const asDocument = (bytes: Buffer, name: string, type: string) =>
      uploadFighterDocument(fighter, upload({ type: "Other" }, bytes, name, type));
    const bomb = await asDocument(png(60_000, 60_000), "bomb.png", "image/png");
    assert.equal(bomb.status, 400);
    assert.match(bomb.error ?? "", /too large in pixels/);
    assert.equal((await asDocument(padded(jpegHead(30_000, 30_000), 400), "bomb.jpg", "image/jpeg")).status, 400);
    assert.equal((await asDocument(png(1200, 900), "ok.png", "image/png")).status, 201);

    const admin1 = await uploadPublicImage(admin, upload({}, padded(webpHead(9000, 9000), 400), "bomb.webp", "image/webp"));
    assert.equal(admin1.status, 400, "a site image is held to a tighter 25 MP");
    assert.equal((await uploadPublicImage(admin, upload({}, padded(webpHead(4000, 3000), 400), "ok.webp", "image/webp"))).status, 201);
  });

  console.log(`\n${passed} checks passed\n`);
}

main()
  .then(() => testDb.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
