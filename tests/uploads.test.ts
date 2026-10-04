/**
 * Upload tests, run against the seeded test database (see tests/helpers/db.ts).
 * "@vercel/blob" is replaced by an in-memory stub (tests/support/register.cjs),
 * so no test can reach a real store; the stub records every call's options.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { GET as downloadRoute } from "../src/app/api/documents/[id]/route";
import { POST as imageRoute } from "../src/app/api/admin/uploads/image/route";
import { DELETE as deleteRoute } from "../src/app/api/fighter/documents/[id]/route";
import { POST as uploadRoute } from "../src/app/api/fighter/documents/route";
import { flushEmails } from "../src/lib/email/queue";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import {
  deleteMyDocument,
  listDocumentsForReview,
  listFightersWithApprovedMedical,
  listMyDocuments,
  MAX_DOCUMENTS_PER_FIGHTER,
  openDocument,
  reviewDocument,
  uploadFighterDocument,
} from "../src/lib/services/documentService";
import { uploadPublicImage } from "../src/lib/services/imageService";
import { createSession, destroySession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";
import {
  contentDisposition,
  contentTypeForPathname,
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  sanitizeFileName,
  sniffType,
} from "../src/lib/uploads";

interface Call {
  fn: string;
  pathname: string;
  options: Record<string, unknown>;
}
interface BlobStub {
  blobs: Map<string, { body: Buffer; contentType: string; access: string }>;
  calls: Call[];
  failDelete: boolean;
}
const blob = (globalThis as unknown as { __blob: BlobStub }).__blob;
const resend = (globalThis as unknown as { __resend: { outbox: { to: string; subject: string }[] } })
  .__resend;

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

// ---------------------------------------------------------------- fixtures

const PDF_HEAD = Buffer.from("%PDF-1.7\n");
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEAD = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);

function pdf(totalBytes = 200): Buffer {
  return Buffer.concat([PDF_HEAD, Buffer.alloc(Math.max(0, totalBytes - PDF_HEAD.length), 0x20)]);
}
function padded(head: Buffer, totalBytes: number): Buffer {
  return Buffer.concat([head, Buffer.alloc(Math.max(0, totalBytes - head.length), 1)]);
}

function multipart(
  fields: Record<string, string>,
  file?: { bytes: Buffer; name: string; type: string },
  headers: Record<string, string> = {},
): Request {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  if (file) data.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));

  return new Request("http://localhost/upload", { method: "POST", body: data, headers });
}

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function main() {
  await resetDatabase();

  process.env.PRIVATE_BLOB_STORE_ID = "private-store-id";
  process.env.PUBLIC_BLOB_STORE_ID = "public-store-id";
  process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "";
  process.env.PUBLIC_BLOB_READ_WRITE_TOKEN = "";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "PFC <no-reply@test.pfc.invalid>";
  process.env.APP_URL = "https://pfc.test.invalid";

  const admin = await sessionFor("admin@pfc.co.za");
  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");

  const rival = await testDb.user.create({
    data: {
      email: "rival@example.co.za",
      fullName: "Rival Fighter",
      role: "Fighter",
      passwordHash: "x",
      passwordSalt: "y",
      member: { create: { fighter: { create: { weightClass: "Welterweight" } } } },
    },
  });
  const otherFighter: SessionUser = {
    id: rival.id,
    email: rival.email,
    fullName: rival.fullName,
    role: "Fighter",
  };

  console.log("\nSNIFFING AND NAMES");

  await check("magic bytes identify PDF, JPEG, PNG and WebP, and nothing else", () => {
    assert.equal(sniffType(PDF_HEAD), "application/pdf");
    assert.equal(sniffType(JPEG_HEAD), "image/jpeg");
    assert.equal(sniffType(PNG_HEAD), "image/png");
    assert.equal(sniffType(WEBP_HEAD), "image/webp");
    assert.equal(sniffType(Buffer.from("<html><body>hi</body></html>")), null);
    assert.equal(sniffType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffType(Buffer.from("GIF89a")), null);
    assert.equal(sniffType(Buffer.from("RIFF\0\0\0\0WAVEfmt ")), null, "RIFF without WEBP");
    assert.equal(sniffType(Buffer.alloc(0)), null);
    assert.equal(sniffType(Buffer.from([0xff, 0xd8])), null, "truncated JPEG signature");
  });

  await check("file names are sanitised and capped at 100 characters", () => {
    assert.equal(sanitizeFileName("../../etc/passwd.pdf"), "etc_passwd.pdf");
    assert.equal(sanitizeFileName('a"b\\c:d*e?.pdf'), "a_b_c_d_e_.pdf");
    assert.equal(sanitizeFileName("\u0000\u0007bad\r\nname.pdf"), "badname.pdf");
    assert.equal(sanitizeFileName(""), "upload");
    assert.equal(sanitizeFileName(undefined), "upload");
    assert.equal(sanitizeFileName(".hidden"), "hidden");
    const long = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    assert.equal(long.length, 100);
    assert.ok(long.endsWith(".pdf"), "the extension survives the cut");
  });

  await check("the download header forces a download and cannot be broken out of", () => {
    const header = contentDisposition('na"me\r\nX-Evil: 1.pdf');
    assert.match(header, /^attachment; filename="/);
    assert.doesNotMatch(header, /[\r\n]/);
    assert.equal((header.match(/"/g) ?? []).length, 2, "only the two delimiting quotes");
    assert.equal(contentTypeForPathname("fighter-docs/1/abc.pdf"), "application/pdf");
    assert.equal(contentTypeForPathname("x/y.html"), "application/octet-stream");
  });

  console.log("\nUPLOADING A DOCUMENT");

  await check("only a fighter may upload, and the role is checked before the body is read", async () => {
    for (const who of [member, coach, admin]) {
      const request = multipart({ type: "Medical" }, { bytes: pdf(), name: "a.pdf", type: "application/pdf" });
      assert.equal((await uploadFighterDocument(who, request)).status, 403, who.role);
      assert.equal(request.bodyUsed, false, "the body was never read");
    }
    assert.equal(blob.blobs.size, 0);
  });

  await check("a .pdf that is really HTML is rejected, whatever the browser says", async () => {
    const request = multipart(
      { type: "Medical" },
      { bytes: Buffer.from("<html><script>alert(1)</script></html>"), name: "medical.pdf", type: "application/pdf" },
    );
    const result = await uploadFighterDocument(fighter, request);

    assert.equal(result.ok, false);
    assert.equal(result.status, 415);
    assert.equal(blob.blobs.size, 0, "nothing was stored");
    assert.equal(await testDb.fighterDocument.count(), 0, "no row was created");
  });

  await check("an image type is not accepted as a different type; WebP is not a document", async () => {
    const result = await uploadFighterDocument(
      fighter,
      multipart({ type: "Other" }, { bytes: padded(WEBP_HEAD, 100), name: "x.webp", type: "image/webp" }),
    );
    assert.equal(result.status, 415);
  });

  await check("oversize files are refused, by header before reading and by real length after", async () => {
    // The header lies low: the real bytes are one over the limit.
    const big = pdf(DOCUMENT_MAX_BYTES + 1);
    const over = await uploadFighterDocument(
      fighter,
      multipart({ type: "Medical" }, { bytes: big, name: "big.pdf", type: "application/pdf" }),
    );
    assert.equal(over.status, 413);
    assert.match(over.error ?? "", /4 MB/);

    // The header says huge: refused without reading the body at all.
    const request = multipart(
      { type: "Medical" },
      { bytes: pdf(), name: "small.pdf", type: "application/pdf" },
      { "content-length": String(50 * 1024 * 1024) },
    );
    const early = await uploadFighterDocument(fighter, request);
    assert.equal(early.status, 413);
    assert.equal(request.bodyUsed, false, "refused from the header alone");

    assert.equal(blob.blobs.size, 0);
    assert.equal(await testDb.fighterDocument.count(), 0);
  });

  await check("a bad or missing type or file is a 400", async () => {
    const good = { bytes: pdf(), name: "a.pdf", type: "application/pdf" };
    const wrongType = await uploadFighterDocument(fighter, multipart({ type: "Passport" }, good));
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.field, "type");
    assert.equal((await uploadFighterDocument(fighter, multipart({}, good))).status, 400);
    assert.equal((await uploadFighterDocument(fighter, multipart({ type: "Medical" }))).status, 400);
    assert.equal(
      (await uploadFighterDocument(fighter, multipart({ type: "Medical" }, { ...good, bytes: Buffer.alloc(0) })))
        .status,
      400,
    );
    const json = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal((await uploadFighterDocument(fighter, json)).status, 400);
    assert.equal(blob.blobs.size, 0);
  });

  let ownDocumentId = 0;
  let ownBytes = Buffer.alloc(0);

  await check("a valid upload goes to the private store under a generated pathname", async () => {
    ownBytes = Buffer.concat([pdf(300), Buffer.from("unique-marker")]);
    const result = await uploadFighterDocument(
      fighter,
      multipart(
        { type: "Medical" },
        { bytes: ownBytes, name: "../../My Medical Certificate.pdf", type: "text/plain" },
      ),
    );

    assert.equal(result.ok, true, result.error);
    assert.equal(result.status, 201);
    ownDocumentId = result.data!.id;
    assert.equal(result.data!.status, "Pending");
    assert.equal(result.data!.type, "Medical");
    assert.equal(result.data!.fileName, "My Medical Certificate.pdf");
    assert.ok(!("fileUrl" in result.data!) && !JSON.stringify(result.data).includes("fighter-docs"));

    assert.equal(blob.blobs.size, 1);
    const [pathname] = [...blob.blobs.keys()];
    assert.match(pathname, new RegExp(`^fighter-docs/${fighter.id}/[0-9a-f-]{36}\\.pdf$`));
    assert.ok(!pathname.toLowerCase().includes("medical"), "no client filename in the path");
    assert.equal((pathname.match(/\./g) ?? []).length, 1, "one dot: no '..'");
    assert.ok(!pathname.includes(".."));

    const put = blob.calls.find((c) => c.fn === "put")!;
    assert.equal(put.options.access, "private");
    assert.equal(put.options.storeId, "private-store-id");
    assert.equal(put.options.contentType, "application/pdf", "the sniffed type, not the browser's text/plain");
    assert.ok(!("token" in put.options), "no token when none is configured (OIDC)");

    const row = await testDb.fighterDocument.findUniqueOrThrow({ where: { id: ownDocumentId } });
    assert.equal(row.fileUrl, pathname, "the column holds the pathname");
    assert.equal(row.fighterId, fighter.id);
    assert.equal(row.status, "Pending");
  });

  await check("a read-write token is passed along only when one is set", async () => {
    process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "rw_local_token";
    try {
      const before = blob.calls.length;
      await openDocument(fighter, ownDocumentId);
      const get = blob.calls.slice(before).find((c) => c.fn === "get")!;
      assert.equal(get.options.access, "private");
      assert.equal(get.options.storeId, "private-store-id");
      assert.equal(get.options.token, "rw_local_token");
    } finally {
      process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "";
    }
  });

  await check("a missing store id is a clean 503 and stores nothing", async () => {
    process.env.PRIVATE_BLOB_STORE_ID = "";
    try {
      const result = await uploadFighterDocument(
        fighter,
        multipart({ type: "Other" }, { bytes: pdf(), name: "a.pdf", type: "application/pdf" }),
      );
      assert.equal(result.status, 503);
      assert.doesNotMatch(result.error ?? "", /PRIVATE_BLOB|STORE_ID|undefined/);
      assert.equal(await testDb.fighterDocument.count({ where: { fighterId: fighter.id } }), 1);
    } finally {
      process.env.PRIVATE_BLOB_STORE_ID = "private-store-id";
    }
  });

  console.log("\nWHO MAY READ A DOCUMENT");

  await check("the owner gets the file; an admin gets it too", async () => {
    for (const who of [fighter, admin]) {
      const result = await openDocument(who, ownDocumentId);
      assert.equal(result.ok, true, who.role);
      assert.equal(result.data!.contentType, "application/pdf");
      assert.equal(result.data!.fileName, "My Medical Certificate.pdf");
      const body = Buffer.from(await new Response(result.data!.stream).arrayBuffer());
      assert.deepEqual(body, ownBytes);
    }
  });

  await check("a member, another fighter and a coach get 404, not 403", async () => {
    for (const who of [member, otherFighter, coach]) {
      const result = await openDocument(who, ownDocumentId);
      assert.equal(result.status, 404, who.role);
      assert.equal(result.data, undefined);
    }
    assert.equal((await openDocument(fighter, 999_999)).status, 404, "missing id looks the same");
    assert.equal((await openDocument(fighter, "1; DROP")).status, 404);
    assert.equal((await openDocument(fighter, -1)).status, 404);
  });

  await check("the download route sends a private, non-sniffable attachment and never the blob URL", async () => {
    await createSession(fighter);
    const response = await downloadRoute(new Request("http://localhost/api/documents/1"), params(ownDocumentId));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="My Medical Certificate\.pdf"/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), ownBytes);

    await createSession(otherFighter);
    const refused = await downloadRoute(new Request("http://localhost/api/documents/1"), params(ownDocumentId));
    assert.equal(refused.status, 404);
    const text = await refused.text();
    assert.doesNotMatch(text, /fighter-docs|blob\.vercel/);

    await createSession(member);
    assert.equal((await downloadRoute(new Request("http://localhost/x"), params(ownDocumentId))).status, 404);

    await destroySession();
    assert.equal((await downloadRoute(new Request("http://localhost/x"), params(ownDocumentId))).status, 401);
  });

  console.log("\nLIMITS, REVIEW AND DELETION");

  await check("the 11th document is refused and nothing extra is stored", async () => {
    for (let i = 1; i < MAX_DOCUMENTS_PER_FIGHTER; i++) {
      const result = await uploadFighterDocument(
        fighter,
        multipart({ type: "Other" }, { bytes: pdf(), name: `doc${i}.pdf`, type: "application/pdf" }),
      );
      assert.equal(result.ok, true, `document ${i + 1}: ${result.error}`);
    }
    assert.equal(await testDb.fighterDocument.count({ where: { fighterId: fighter.id } }), 10);
    const stored = blob.blobs.size;

    const eleventh = await uploadFighterDocument(
      fighter,
      multipart({ type: "Other" }, { bytes: pdf(), name: "eleventh.pdf", type: "application/pdf" }),
    );
    assert.equal(eleventh.ok, false);
    assert.equal(eleventh.status, 409);
    assert.equal(blob.blobs.size, stored, "the file was not even uploaded");
    assert.equal(await testDb.fighterDocument.count({ where: { fighterId: fighter.id } }), 10);

    // Another fighter has their own allowance.
    const theirs = await uploadFighterDocument(
      otherFighter,
      multipart({ type: "Licence" }, { bytes: pdf(), name: "licence.pdf", type: "application/pdf" }),
    );
    assert.equal(theirs.ok, true);
  });

  await check("the limit holds when uploads race", async () => {
    const racer = await testDb.user.create({
      data: {
        email: "racer@example.co.za",
        fullName: "Racing Fighter",
        role: "Fighter",
        passwordHash: "x",
        passwordSalt: "y",
        member: { create: { fighter: { create: { weightClass: "Heavyweight" } } } },
      },
    });
    const session: SessionUser = { id: racer.id, email: racer.email, fullName: racer.fullName, role: "Fighter" };

    const results = await Promise.all(
      Array.from({ length: 14 }, (_, i) =>
        uploadFighterDocument(
          session,
          multipart({ type: "Other" }, { bytes: pdf(), name: `r${i}.pdf`, type: "application/pdf" }),
        ),
      ),
    );

    assert.equal(results.filter((r) => r.ok).length, MAX_DOCUMENTS_PER_FIGHTER);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.status === 409));
    assert.equal(await testDb.fighterDocument.count({ where: { fighterId: racer.id } }), 10);
    const stored = [...blob.blobs.keys()].filter((k) => k.startsWith(`fighter-docs/${racer.id}/`));
    assert.equal(stored.length, 10, "blobs of refused uploads were cleaned up");
  });

  await check("reviewing is admin only, a rejection needs a note, and the fighter is emailed", async () => {
    assert.equal((await reviewDocument(fighter, ownDocumentId, "Approved", null)).status, 403);
    assert.equal((await reviewDocument(coach, ownDocumentId, "Approved", null)).status, 403);
    assert.equal((await reviewDocument(admin, "x", "Approved", null)).status, 400);
    assert.equal((await reviewDocument(admin, ownDocumentId, "Maybe", null)).status, 400);
    assert.equal((await reviewDocument(admin, 999_999, "Approved", null)).status, 404);

    const noNote = await reviewDocument(admin, ownDocumentId, "Rejected", "   ");
    assert.equal(noNote.status, 400);
    assert.equal(noNote.field, "note");
    assert.equal((await testDb.fighterDocument.findUniqueOrThrow({ where: { id: ownDocumentId } })).status, "Pending");

    resend.outbox.length = 0;
    const rejected = await reviewDocument(admin, ownDocumentId, "Rejected", "The scan is cut off.");
    await flushEmails();
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data!.status, "Rejected");
    assert.equal(rejected.data!.reviewNote, "The scan is cut off.");
    assert.equal(resend.outbox.length, 1);
    assert.equal(resend.outbox[0].to, fighter.email);
    assert.match(resend.outbox[0].subject, /rejected/);

    assert.equal((await reviewDocument(admin, ownDocumentId, "Rejected", "again")).status, 409, "no duplicate email");
    assert.equal(
      await testDb.auditLog.count({ where: { action: "document.reject", entityId: ownDocumentId } }),
      1,
    );
  });

  await check("the review queue lists Pending first and is admin only", async () => {
    assert.equal((await listDocumentsForReview(fighter)).status, 403);
    const list = await listDocumentsForReview(admin);
    assert.equal(list.ok, true);
    const statuses = list.data!.map((d) => d.status);
    const firstNonPending = statuses.findIndex((s) => s !== "Pending");
    assert.ok(firstNonPending === -1 || statuses.slice(firstNonPending).every((s) => s !== "Pending"));
    assert.ok(list.data!.every((d) => typeof d.fighterName === "string"));
    assert.ok(!JSON.stringify(list.data).includes("fighter-docs/"), "no pathnames in the queue");
  });

  await check("a rejected document can be deleted by its owner, blob and row", async () => {
    const pathname = (await testDb.fighterDocument.findUniqueOrThrow({ where: { id: ownDocumentId } })).fileUrl;
    assert.ok(blob.blobs.has(pathname));

    assert.equal((await deleteMyDocument(otherFighter, ownDocumentId)).status, 404, "not theirs");
    assert.equal((await deleteMyDocument(member, ownDocumentId)).status, 403);
    assert.equal((await deleteMyDocument(fighter, "nope")).status, 404);

    const result = await deleteMyDocument(fighter, ownDocumentId);
    assert.equal(result.ok, true);
    assert.equal(blob.blobs.has(pathname), false, "the file is gone");
    assert.equal(await testDb.fighterDocument.count({ where: { id: ownDocumentId } }), 0);
  });

  await check("an approved document cannot be deleted", async () => {
    const upload = await testDb.fighterDocument.findFirstOrThrow({
      where: { fighterId: otherFighter.id },
    });
    const approved = await reviewDocument(admin, upload.id, "Approved", "Looks good.");
    assert.equal(approved.ok, true);

    const result = await deleteMyDocument(otherFighter, upload.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(await testDb.fighterDocument.count({ where: { id: upload.id } }), 1);
    assert.ok(blob.blobs.has(upload.fileUrl), "the file is kept");

    // Through the route, too.
    await createSession(otherFighter);
    const viaRoute = await deleteRoute(new Request("http://localhost/x", { method: "DELETE" }), params(upload.id));
    assert.equal(viaRoute.status, 409);
    await destroySession();
  });

  await check("a failed blob delete is logged but the row is still removed", async () => {
    const [pending] = await listMyDocuments(fighter).then((r) => r.data!.filter((d) => d.status === "Pending"));
    const pathname = (await testDb.fighterDocument.findUniqueOrThrow({ where: { id: pending.id } })).fileUrl;

    blob.failDelete = true;
    try {
      const result = await deleteMyDocument(fighter, pending.id);
      assert.equal(result.ok, true);
    } finally {
      blob.failDelete = false;
    }
    assert.equal(await testDb.fighterDocument.count({ where: { id: pending.id } }), 0);
    assert.ok(blob.blobs.has(pathname), "the orphaned blob is left for a clean-up (it was logged)");
  });

  await check("the document routes enforce their roles", async () => {
    await createSession(member);
    const asMember = await uploadRoute(
      multipart({ type: "Medical" }, { bytes: pdf(), name: "a.pdf", type: "application/pdf" }),
    );
    assert.equal(asMember.status, 403);

    await createSession(fighter);
    const ok = await uploadRoute(
      multipart({ type: "Licence" }, { bytes: pdf(), name: "licence.pdf", type: "application/pdf" }),
    );
    assert.equal(ok.status, 201);
    const created = (await ok.json()) as { data: { id: number } };
    const removed = await deleteRoute(new Request("http://localhost/x", { method: "DELETE" }), params(created.data.id));
    assert.equal(removed.status, 200);

    await destroySession();
    assert.equal(
      (await uploadRoute(multipart({ type: "Medical" }, { bytes: pdf(), name: "a.pdf", type: "application/pdf" })))
        .status,
      401,
    );
  });

  await check("the offer form can tell who has an approved medical", async () => {
    assert.equal((await listFightersWithApprovedMedical(member)).status, 403);
    assert.deepEqual((await listFightersWithApprovedMedical(admin)).data, [], "only a Licence is approved so far");

    const medical = await uploadFighterDocument(
      otherFighter,
      multipart({ type: "Medical" }, { bytes: pdf(), name: "med.pdf", type: "application/pdf" }),
    );
    assert.equal((await reviewDocument(admin, medical.data!.id, "Approved", null)).ok, true);
    assert.deepEqual((await listFightersWithApprovedMedical(admin)).data, [otherFighter.id]);
  });

  console.log("\nPUBLIC IMAGES");

  await check("only an admin may upload an image, and it lands in the public store", async () => {
    for (const who of [member, fighter, coach]) {
      const request = multipart({}, { bytes: padded(JPEG_HEAD, 500), name: "me.jpg", type: "image/jpeg" });
      assert.equal((await uploadPublicImage(who, request)).status, 403, who.role);
      assert.equal(request.bodyUsed, false);
    }

    const before = blob.calls.length;
    const result = await uploadPublicImage(
      admin,
      multipart({}, { bytes: padded(WEBP_HEAD, 500), name: "../Poster Final.PNG", type: "image/png" }),
    );
    assert.equal(result.ok, true, result.error);
    assert.equal(result.status, 201);
    assert.match(result.data!.url, /^https:\/\/public-store-id\.public\.blob\.vercel-storage\.com\/images\/[0-9a-f-]{36}\.webp$/);
    assert.ok(!result.data!.url.toLowerCase().includes("poster"), "no client filename in the path");

    const put = blob.calls.slice(before).find((c) => c.fn === "put")!;
    assert.equal(put.options.access, "public");
    assert.equal(put.options.storeId, "public-store-id");
    assert.equal(put.options.contentType, "image/webp");
  });

  await check("images are held to their own type and size limits", async () => {
    const png = await uploadPublicImage(admin, multipart({}, { bytes: padded(PNG_HEAD, 100), name: "a", type: "" }));
    assert.equal(png.ok, true);

    const pdfAsImage = await uploadPublicImage(admin, multipart({}, { bytes: pdf(), name: "a.jpg", type: "image/jpeg" }));
    assert.equal(pdfAsImage.status, 415, "a PDF is not an image");

    const svg = await uploadPublicImage(
      admin,
      multipart({}, { bytes: Buffer.from("<svg onload=alert(1)/>"), name: "a.png", type: "image/png" }),
    );
    assert.equal(svg.status, 415);

    const huge = await uploadPublicImage(
      admin,
      multipart({}, { bytes: padded(JPEG_HEAD, IMAGE_MAX_BYTES + 1), name: "big.jpg", type: "image/jpeg" }),
    );
    assert.equal(huge.status, 413);
    assert.match(huge.error ?? "", /2 MB/);

    const exact = await uploadPublicImage(
      admin,
      multipart({}, { bytes: padded(JPEG_HEAD, IMAGE_MAX_BYTES), name: "edge.jpg", type: "image/jpeg" }),
    );
    assert.equal(exact.ok, true, "exactly 2 MB is allowed");
  });

  await check("the image route answers { url } to an admin and refuses everyone else", async () => {
    await createSession(admin);
    const ok = await imageRoute(multipart({}, { bytes: padded(JPEG_HEAD, 300), name: "x.jpg", type: "image/jpeg" }));
    assert.equal(ok.status, 201);
    const body = (await ok.json()) as { url: string };
    assert.match(body.url, /^https:\/\/.+\.public\.blob\.vercel-storage\.com\/images\/.+\.jpg$/);

    await createSession(member);
    assert.equal(
      (await imageRoute(multipart({}, { bytes: padded(JPEG_HEAD, 300), name: "x.jpg", type: "image/jpeg" }))).status,
      403,
    );
    await destroySession();
    assert.equal(
      (await imageRoute(multipart({}, { bytes: padded(JPEG_HEAD, 300), name: "x.jpg", type: "image/jpeg" }))).status,
      401,
    );
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
