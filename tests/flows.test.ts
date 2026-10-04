/**
 * End-to-end flows: one scripted scenario per kind of visitor, calling the
 * route handlers, server actions and services in sequence against the seeded
 * test database (see tests/helpers/db.ts), and asserting both the status codes
 * and what ended up in the database. "resend" and "@vercel/blob" are the
 * in-memory stubs from tests/support/register.cjs.
 *
 * The scenarios share one database and run in order: guest, new member,
 * member on a full class, fighter, coach, admin, hostile user. The hostile
 * scenario is last because it deliberately uses up a rate limit.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { resetDatabase, testDb } from "./helpers/db";
import { setTestRequestHeaders } from "./support/next-headers";
import { RedirectError } from "./support/next-navigation";

import { login, register, requestPasswordReset, submitPasswordReset } from "../src/actions/auth";
import { sendEnquiry } from "../src/actions/gym";
import { POST as adminEventsPost } from "../src/app/api/admin/events/route";
import { PATCH as adminEventPatch } from "../src/app/api/admin/events/[id]/route";
import { POST as adminOffersPost } from "../src/app/api/admin/events/[id]/offers/route";
import { POST as adminFightersPost } from "../src/app/api/admin/fighters/route";
import { DELETE as adminFighterDelete } from "../src/app/api/admin/fighters/[id]/route";
import { PATCH as adminResultPatch } from "../src/app/api/admin/participations/[id]/result/route";
import { POST as adminImagePost } from "../src/app/api/admin/uploads/image/route";
import { POST as bookRoute } from "../src/app/api/bookings/route";
import { POST as cancelRoute } from "../src/app/api/bookings/[id]/cancel/route";
import { GET as classesGet } from "../src/app/api/classes/route";
import { GET as documentGet } from "../src/app/api/documents/[id]/route";
import { GET as eventsGet } from "../src/app/api/events/route";
import { POST as fighterDocsPost } from "../src/app/api/fighter/documents/route";
import { DELETE as fighterDocDelete } from "../src/app/api/fighter/documents/[id]/route";
import { GET as offersGet } from "../src/app/api/fighter/offers/route";
import { POST as respondRoute } from "../src/app/api/fighter/offers/[id]/respond/route";
import { GET as healthGet } from "../src/app/api/health/route";
import { GET as readyGet } from "../src/app/api/health/ready/route";
import { GET as timetableGet } from "../src/app/api/timetable/route";
import { addDays, dayOfDate, formatEventDate, gymDateAndTime, isoDate, nextOccurrence } from "../src/lib/dates";
import { flushEmails } from "../src/lib/email/queue";
import { getCoaches } from "../src/lib/repositories/coachesRepository";
import { getClasses } from "../src/lib/repositories/programmesRepository";
import { getTimetable } from "../src/lib/repositories/timetableRepository";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { cancelBooking, createBooking, listMyBookings } from "../src/lib/services/bookingService";
import { createSession as createClass } from "../src/lib/services/classAdminService";
import { createCoach } from "../src/lib/services/coachAdminService";
import { getMyClasses, getRoster, markAttendance } from "../src/lib/services/coachService";
import {
  deleteMyDocument,
  listMyDocuments,
  openDocument,
  reviewDocument,
  uploadFighterDocument,
} from "../src/lib/services/documentService";
import {
  createEvent,
  listPublicEvents,
  offerBout,
  recordResult,
  respondToOffer,
} from "../src/lib/services/eventService";
import { listMyOffers, promoteToFighter } from "../src/lib/services/fighterService";
import { deactivateUser, listMembers, reactivateUser } from "../src/lib/services/memberAdminService";
import { changePlan } from "../src/lib/services/membershipService";
import { RESET_INVALID } from "../src/lib/services/passwordService";
import { createSession, destroySession, getSession } from "../src/lib/session";
import { COOKIE_NAME, encodeSession } from "../src/lib/sessionToken";
import { isFull } from "../src/lib/types";
import type { ServiceResult, SessionUser } from "../src/lib/types";
import { EMPTY_FORM_STATE } from "../src/lib/validation";
import type { FormState } from "../src/lib/validation";
import { middleware } from "../src/middleware";

const ORIGIN = "https://pfc.test.invalid";
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "Str0ng-Passw0rd!";

interface Sent {
  to: string | string[];
  subject: string;
  text?: string;
}
const outbox = (globalThis as unknown as { __resend: { outbox: Sent[] } }).__resend.outbox;
const blobs = (globalThis as unknown as {
  __blob: { blobs: Map<string, { access: string }>; calls: { fn: string; pathname: string; options: Record<string, unknown> }[] };
}).__blob;

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

// ---------------------------------------------------------------- helpers

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function jsonRequest(method: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function multipart(fields: Record<string, string>, file?: { bytes: Buffer; name: string; type: string }): Request {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  if (file) data.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return new Request("http://localhost/upload", { method: "POST", body: data, headers: { origin: ORIGIN } });
}

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function pdf(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 0x20)]);
}

/** The target of a redirect() thrown by an action, or null if it did not redirect. */
async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
}

/** Runs an action: its redirect target, or the form state it returned. Anything thrown fails the test. */
async function outcome(label: string, fn: () => Promise<FormState>): Promise<{ redirect: string | null; state: FormState | null }> {
  try {
    return { redirect: null, state: await fn() };
  } catch (e) {
    if (e instanceof RedirectError) return { redirect: e.url, state: null };
    assert.fail(`${label} threw: ${String(e)}`);
  }
}

async function signIn(user: SessionUser): Promise<void> {
  await createSession(user);
}
async function signOut(): Promise<void> {
  await destroySession();
}
async function asRole(email: string): Promise<SessionUser> {
  const user = await sessionFor(email);
  await signIn(user);
  return user;
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A response that must not leak SQL, a stack trace or a file path. */
async function assertSafeError(response: Response, label: string): Promise<void> {
  const text = await response.clone().text();
  assert.ok(response.status < 500, `${label} answered ${response.status}: ${text.slice(0, 120)}`);
  assert.doesNotMatch(text, /prisma|SELECT |INSERT |\.ts:|stack|ECONN/i, label);
  if (!response.ok) {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    assert.equal(typeof parsed.error?.message, "string", `${label} has the shared error shape`);
  }
}

async function clean<T>(label: string, call: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  let result: ServiceResult<T>;
  try {
    result = await call();
  } catch (e) {
    assert.fail(`${label} threw: ${String(e)}`);
  }
  assert.ok(result.status < 500, `${label} answered ${result.status}: ${result.error}`);
  assert.doesNotMatch(String(result.error ?? ""), /prisma|SELECT|INSERT|at .*\.ts|stack/i, label);
  return result;
}

/** A member row made directly, for fixtures. Its password is unusable. */
async function makeUser(email: string, fullName: string, role: "Member" | "Admin", planId: number | null): Promise<SessionUser> {
  const row = await testDb.user.create({
    data: {
      email,
      fullName,
      role,
      passwordHash: "x",
      passwordSalt: "y",
      ...(role === "Member" ? { member: { create: { planId } } } : { admin: { create: {} } }),
    },
  });
  return { id: row.id, email: row.email, fullName: row.fullName, role };
}

function previousWeekday(from: Date, day: string): Date {
  let date = addDays(from, -1);
  while (dayOfDate(date) !== day) date = addDays(date, -1);
  return date;
}

async function main() {
  await resetDatabase();

  process.env.APP_URL = ORIGIN;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "PFC <no-reply@test.pfc.invalid>";
  process.env.CONTACT_INBOX = "inbox@test.pfc.invalid";
  process.env.PUBLIC_BLOB_STORE_ID = "public-store-id";
  process.env.PRIVATE_BLOB_STORE_ID = "private-store-id";
  delete (process.env as Record<string, string | undefined>).RATE_LIMIT_MULTIPLIER;

  const now = new Date();
  const today = gymDateAndTime(now).date;

  const plan = await testDb.membershipPlan.findFirstOrThrow({ where: { isActive: true }, orderBy: { pricePerMonth: "asc" } });
  const demoMember = await sessionFor("member@pfc.co.za");
  const demoFighter = await sessionFor("fighter@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");
  const sofia = await sessionFor("sofia@pfc.co.za");
  const marcus = await sessionFor("marcus@pfc.co.za");

  // ================================================================ GUEST

  console.log("\nGUEST");

  await check("public data loads, and the demo events start at 19:00 Johannesburg time", async () => {
    for (const [label, handler] of [
      ["classes", classesGet],
      ["timetable", () => timetableGet(new Request("http://localhost/api/timetable"))],
      ["events", eventsGet],
    ] as const) {
      const response = await handler();
      assert.equal(response.status, 200, label);
      const data = (await bodyOf(response)).data as unknown[];
      assert.ok(Array.isArray(data) && data.length > 0, `${label} has rows`);
    }
    assert.equal((await healthGet()).status, 200);
    assert.equal((await readyGet()).status, 200);

    assert.ok((await getClasses()).length > 0);
    assert.ok((await getCoaches()).length > 0);
    const events = await listPublicEvents();
    assert.ok(events.length >= 2);
    for (const event of events) assert.match(formatEventDate(event.eventDate), /, 19:00$/, event.name);
  });

  /** Every state-changing or private route, called with whatever cookie is in the jar. */
  const protectedCalls = (): [string, () => Promise<Response>][] => [
    ["POST /api/bookings", () => bookRoute(jsonRequest("POST", { slotId: 1 }))],
    ["POST /api/bookings/:id/cancel", () => cancelRoute(jsonRequest("POST"), params(1))],
    ["GET /api/fighter/offers", () => offersGet()],
    ["POST /api/fighter/offers/:id/respond", () => respondRoute(jsonRequest("POST", { response: "Accepted" }), params(1))],
    ["POST /api/fighter/documents", () => fighterDocsPost(multipart({ type: "Medical" }, { bytes: pdf(), name: "a.pdf", type: "application/pdf" }))],
    ["DELETE /api/fighter/documents/:id", () => fighterDocDelete(jsonRequest("DELETE"), params(1))],
    ["GET /api/documents/:id", () => documentGet(jsonRequest("GET", undefined, {}), params(1))],
    ["POST /api/admin/events", () => adminEventsPost(jsonRequest("POST", { name: "Nope" }))],
    ["PATCH /api/admin/events/:id", () => adminEventPatch(jsonRequest("PATCH", { name: "Nope Nope" }), params(1))],
    ["POST /api/admin/events/:id/offers", () => adminOffersPost(jsonRequest("POST", { fighterId: 1 }), params(1))],
    ["PATCH /api/admin/participations/:id/result", () => adminResultPatch(jsonRequest("PATCH", { result: "Win" }), params(1))],
    ["POST /api/admin/fighters", () => adminFightersPost(jsonRequest("POST", { memberId: 1, weightClass: "Lightweight" }))],
    ["DELETE /api/admin/fighters/:id", () => adminFighterDelete(jsonRequest("DELETE"), params(1))],
    ["POST /api/admin/uploads/image", () => adminImagePost(multipart({}, { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), name: "a.jpg", type: "image/jpeg" }))],
  ];

  await check("every protected route answers 401 with no session", async () => {
    await signOut();
    for (const [label, call] of protectedCalls()) {
      const response = await call();
      assert.equal(response.status, 401, label);
      await assertSafeError(response, label);
    }
  });

  await check("a forged cookie is rejected on every protected route and by the page gate", async () => {
    const real = encodeSession(demoMember, 0);
    const [payload, signature] = real.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;

    const promoted = Buffer.from(JSON.stringify({ ...claims, role: "Admin" })).toString("base64url");
    const otherKey = createHmac("sha256", "another-secret-another-secret-0123456789").update(payload).digest("base64url");
    const noSuchUser = encodeSession({ id: 987654, email: "ghost@example.co.za", fullName: "Ghost", role: "Admin" }, 0);
    const wrongVersion = encodeSession(demoMember, 99);

    // [label, cookie, signature valid?]. The page gate only checks the signature
    // (no database), so a validly signed cookie for an account that is gone or
    // out of date gets past it and is stopped by getSession() and the routes.
    const forgeries: [string, string, boolean][] = [
      ["role edited, old signature", `${promoted}.${signature}`, false],
      ["signed with another key", `${payload}.${otherKey}`, false],
      ["no signature", payload, false],
      ["garbage", "not-a-cookie", false],
      ["empty", "", false],
      ["signed, but for an account that does not exist", noSuchUser, true],
      ["signed, but an old session version", wrongVersion, true],
    ];

    const store = await cookies();
    for (const [label, token, signedOk] of forgeries) {
      store.set(COOKIE_NAME, token);
      assert.equal(await getSession(), null, label);
      for (const [route, call] of protectedCalls()) {
        assert.equal((await call()).status, 401, `${label}: ${route}`);
      }

      const gate = middleware(
        new NextRequest(`${ORIGIN}/admin/members`, { headers: { cookie: `${COOKIE_NAME}=${token}` } }),
      );
      if (signedOk) {
        // A signed Admin cookie passes the gate; a signed Member cookie is sent to /denied.
        if (/does not exist/.test(label)) assert.equal(gate.status, 200, label);
        else assert.match(gate.headers.get("location") ?? "", /\/denied$/, label);
        continue;
      }
      assert.equal(gate.status, 307, `${label}: /admin gate`);
      assert.match(gate.headers.get("location") ?? "", /\/login\?returnUrl=%2Fadmin%2Fmembers$/, label);
    }
    await signOut();
  });

  await check("a signed-in member is refused (403) on every staff-only route, and sees no one else's document", async () => {
    await signIn(demoMember);
    const forbidden = [
      "POST /api/fighter/documents",
      "GET /api/fighter/offers",
      "POST /api/fighter/offers/:id/respond",
      "POST /api/admin/events",
      "PATCH /api/admin/events/:id",
      "POST /api/admin/events/:id/offers",
      "PATCH /api/admin/participations/:id/result",
      "POST /api/admin/fighters",
      "DELETE /api/admin/fighters/:id",
      "POST /api/admin/uploads/image",
    ];
    for (const [label, call] of protectedCalls()) {
      if (!forbidden.includes(label)) continue;
      const response = await call();
      assert.equal(response.status, 403, label);
      await assertSafeError(response, label);
    }
    // An ownership probe is a 404, never a 403.
    assert.equal((await documentGet(jsonRequest("GET", undefined, {}), params(1))).status, 404);
    await signOut();
  });

  // ================================================================ NEW MEMBER

  console.log("\nNEW MEMBER");

  const newEmail = "nomvula.flow@example.co.za";
  let newMember: SessionUser;
  let firstBookingId = 0;
  let slotId = 0;

  await check("registers, lands on the dashboard signed in, and a welcome email is queued", async () => {
    outbox.length = 0;
    const landed = await redirectOf(() =>
      register(EMPTY_FORM_STATE, form({ fullName: "Nomvula Dlamini", email: newEmail, phone: "0821234567", password: PASSWORD, planId: "" })),
    );
    assert.equal(landed, "/dashboard?welcome=1");

    const session = await getSession();
    assert.equal(session?.email, newEmail);
    assert.equal(session?.role, "Member");
    newMember = session!;

    await flushEmails();
    const welcome = outbox.find((m) => m.to === newEmail);
    assert.ok(welcome, "a welcome email was sent");
    assert.equal(welcome.subject, "Welcome to PFC");

    const row = await testDb.user.findUniqueOrThrow({ where: { email: newEmail }, include: { member: true } });
    assert.equal(row.member?.planId, null);
    assert.notEqual(row.passwordHash, PASSWORD, "the password is hashed");
  });

  await check("cannot book without a plan: 403, and nothing is stored", async () => {
    const slot = (await getTimetable(now)).find((s) => s.capacity - s.booked >= 3)!;
    slotId = slot.id;
    const result = await createBooking(newMember, slotId, now);
    assert.equal(result.status, 403);
    assert.match(result.error ?? "", /membership plan/);
    assert.equal(await testDb.booking.count({ where: { memberId: newMember.id } }), 0);

    const viaRoute = await bookRoute(jsonRequest("POST", { slotId }));
    assert.equal(viaRoute.status, 403);
  });

  await check("picks a plan, books (201), and sees the booking under My bookings", async () => {
    const changed = await changePlan(newMember, plan.id);
    assert.equal(changed.status, 200, changed.error);
    assert.equal((await testDb.member.findUniqueOrThrow({ where: { membershipId: newMember.id } })).planId, plan.id);

    outbox.length = 0;
    const booked = await createBooking(newMember, slotId, now);
    assert.equal(booked.status, 201, booked.error);
    firstBookingId = booked.booking!.id;
    assert.equal(booked.booking?.status, "Confirmed");
    assert.equal(booked.slot?.id, slotId);

    const mine = await listMyBookings(newMember, now);
    assert.ok(mine.upcoming.some((b) => b.id === firstBookingId && b.status === "Confirmed"));

    await flushEmails();
    assert.ok(outbox.some((m) => m.to === newEmail && /^Booked:/.test(m.subject)), "a confirmation email was sent");
  });

  await check("booking the same class twice is a 409 and makes no second row", async () => {
    const again = await createBooking(newMember, slotId, now);
    assert.equal(again.status, 409);
    assert.equal(await testDb.booking.count({ where: { memberId: newMember.id, gymClassId: slotId } }), 1);
  });

  await check("cancels (200), it moves out of upcoming, and the same class can be booked again", async () => {
    const cancelled = await cancelBooking(newMember, firstBookingId, now);
    assert.equal(cancelled.status, 200, cancelled.error);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: firstBookingId } })).status, "Cancelled");

    const mine = await listMyBookings(newMember, now);
    assert.ok(!mine.upcoming.some((b) => b.id === firstBookingId));
    assert.ok(mine.past.some((b) => b.id === firstBookingId && b.status === "Cancelled"));
    assert.equal((await cancelBooking(newMember, firstBookingId, now)).status, 409, "cancelling twice");

    const rebooked = await createBooking(newMember, slotId, now);
    assert.equal(rebooked.status, 201, rebooked.error);
    assert.equal(rebooked.booking?.id, firstBookingId, "the cancelled row is reused");
    assert.equal(await testDb.booking.count({ where: { memberId: newMember.id, gymClassId: slotId } }), 1);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: firstBookingId } })).status, "Confirmed");
    await signOut();
  });

  // ================================================================ FULL CLASS

  console.log("\nMEMBER ON A FULL CLASS");

  await check("a full class is a 409 with a Failed row; after a cancellation the same row books", async () => {
    const full = (await getTimetable(now)).find(isFull);
    assert.ok(full, "the seed has a full class");
    const sessionDate = nextOccurrence(full.day, full.startsAt, now);

    const refused = await createBooking(demoMember, full.id, now);
    assert.equal(refused.status, 409);
    assert.match(refused.error ?? "", /fully booked/);
    const failed = await testDb.booking.findUniqueOrThrow({
      where: { memberId_gymClassId_sessionDate: { memberId: demoMember.id, gymClassId: full.id, sessionDate } },
    });
    assert.equal(failed.status, "Failed");
    assert.ok(failed.failureReason);

    // Trying again while it is still full reuses the same Failed row.
    assert.equal((await createBooking(demoMember, full.id, now)).status, 409);
    assert.equal(
      await testDb.booking.count({ where: { memberId: demoMember.id, gymClassId: full.id, sessionDate } }),
      1,
    );

    // Someone else gives up a place.
    const holder = await testDb.booking.findFirstOrThrow({
      where: { gymClassId: full.id, sessionDate, status: "Confirmed" },
      include: { member: { include: { user: true } } },
    });
    const holderSession: SessionUser = {
      id: holder.memberId,
      email: holder.member.user.email,
      fullName: holder.member.user.fullName,
      role: "Member",
    };
    assert.equal((await cancelBooking(holderSession, holder.id, now)).status, 200);

    const booked = await createBooking(demoMember, full.id, now);
    assert.equal(booked.status, 201, booked.error);
    assert.equal(booked.booking?.id, failed.id, "the Failed row is reused");
    const after = await testDb.booking.findUniqueOrThrow({ where: { id: failed.id } });
    assert.equal(after.status, "Confirmed");
    assert.equal(after.failureReason, null);
    assert.equal(await testDb.booking.count({ where: { gymClassId: full.id, sessionDate, status: "Confirmed" } }), full.capacity);
  });

  // ================================================================ FIGHTER

  console.log("\nFIGHTER");

  const rival = await makeUser("rival.flow@example.co.za", "Rival Fighter", "Member", plan.id);
  await testDb.user.update({ where: { id: rival.id }, data: { role: "Fighter" } });
  await testDb.fighter.create({ data: { fighterId: rival.id, weightClass: "Welterweight" } });
  const rivalFighter: SessionUser = { ...rival, role: "Fighter" };

  let offerId = 0;
  let documentId = 0;

  await check("sees a pending offer, accepts it, then changes to decline", async () => {
    const offers = await listMyOffers(demoFighter, now);
    assert.equal(offers.status, 200);
    assert.equal(offers.data?.pending.length, 1);
    const offer = offers.data!.pending[0];
    offerId = offer.id;
    assert.equal(offer.eventName, "PFC Fight Night");
    assert.equal(offer.availability, "Pending");

    const accepted = await respondToOffer(demoFighter, offerId, "Accepted", now);
    assert.equal(accepted.status, 200, accepted.error);
    assert.equal((await testDb.eventParticipation.findUniqueOrThrow({ where: { id: offerId } })).availability, "Accepted");
    assert.equal((await listMyOffers(demoFighter, now)).data?.accepted.length, 1);

    const declined = await respondToOffer(demoFighter, offerId, "Declined", now);
    assert.equal(declined.status, 200);
    const row = await testDb.eventParticipation.findUniqueOrThrow({ where: { id: offerId } });
    assert.equal(row.availability, "Declined");
    assert.ok(row.respondedAt);
    assert.equal((await listMyOffers(demoFighter, now)).data?.declined.length, 1);
  });

  await check("cannot answer an offer that is not theirs: 404, and nothing changes", async () => {
    const theirs = await respondToOffer(rivalFighter, offerId, "Accepted", now);
    const missing = await respondToOffer(rivalFighter, 999_999, "Accepted", now);
    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(theirs.error, missing.error, "a probe learns nothing");
    assert.equal((await testDb.eventParticipation.findUniqueOrThrow({ where: { id: offerId } })).availability, "Declined");

    await signIn(rivalFighter);
    assert.equal((await respondRoute(jsonRequest("POST", { response: "Accepted" }), params(offerId))).status, 404);
    await signOut();

    assert.equal((await respondToOffer(demoMember, offerId, "Accepted", now)).status, 403, "a member is not a fighter");
  });

  await check("uploads a document to the private store and sees it Pending", async () => {
    const response = await (async () => {
      await signIn(demoFighter);
      return fighterDocsPost(multipart({ type: "Medical" }, { bytes: pdf(), name: "../medical check.pdf", type: "application/pdf" }));
    })();
    assert.equal(response.status, 201);
    const created = (await bodyOf(response)).data as { id: number; status: string; fileName: string };
    documentId = created.id;
    assert.equal(created.status, "Pending");
    assert.doesNotMatch(created.fileName, /\.\.|\//);

    const row = await testDb.fighterDocument.findUniqueOrThrow({ where: { id: documentId } });
    assert.match(row.fileUrl, /^fighter-docs\/\d+\/[0-9a-f-]+\.pdf$/, "fileUrl holds the private pathname, not a URL");
    assert.doesNotMatch(row.fileUrl, /^https?:/);
    assert.equal(blobs.blobs.get(row.fileUrl)?.access, "private");
    assert.ok(blobs.calls.some((c) => c.fn === "put" && c.options.storeId === "private-store-id"));

    const mine = await listMyDocuments(demoFighter);
    assert.deepEqual(mine.data?.map((d) => [d.id, d.status]), [[documentId, "Pending"]]);
    await signOut();
  });

  await check("cannot read, download or delete another fighter's document: 404 for all", async () => {
    const missing = await openDocument(rivalFighter, 999_999);
    const theirs = await openDocument(rivalFighter, documentId);
    assert.equal(theirs.status, 404);
    assert.equal(theirs.error, missing.error);
    assert.equal((await deleteMyDocument(rivalFighter, documentId)).status, 404);

    await signIn(rivalFighter);
    assert.equal((await documentGet(jsonRequest("GET", undefined, {}), params(documentId))).status, 404);
    assert.equal((await fighterDocDelete(jsonRequest("DELETE"), params(documentId))).status, 404);
    await signOut();
    assert.equal(await testDb.fighterDocument.count({ where: { id: documentId } }), 1);

    await signIn(demoFighter);
    const own = await documentGet(jsonRequest("GET", undefined, {}), params(documentId));
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("content-type"), "application/pdf");
    assert.match(own.headers.get("content-disposition") ?? "", /^attachment/);
    assert.equal(own.headers.get("x-content-type-options"), "nosniff");
    await signOut();
  });

  // ================================================================ COACH

  console.log("\nCOACH");

  await check("sees only their own classes", async () => {
    const mine = await getMyClasses(sofia, now);
    assert.equal(mine.status, 200);
    assert.ok(mine.data!.length > 0);
    assert.ok(mine.data!.every((c) => c.coachId === sofia.id));
    const others = await getMyClasses(marcus, now);
    assert.ok(others.data!.every((c) => c.coachId === marcus.id));
    assert.equal((await getMyClasses(demoMember, now)).status, 403);
  });

  await check("marks a past session, is refused for a future one (409) and for someone else's class (404)", async () => {
    const sofiaClass = await testDb.gymClass.findFirstOrThrow({ where: { coachId: sofia.id, isActive: true }, orderBy: { id: "asc" } });
    const marcusClass = await testDb.gymClass.findFirstOrThrow({ where: { coachId: marcus.id, isActive: true }, orderBy: { id: "asc" } });
    const attendee = await makeUser("attendee.flow@example.co.za", "Attendee Flow", "Member", plan.id);

    const past = previousWeekday(today, sofiaClass.day);
    const future = addDays(nextOccurrence(sofiaClass.day, sofiaClass.startsAt, now), 7);
    const pastMarcus = previousWeekday(today, marcusClass.day);

    const pastBooking = await testDb.booking.create({ data: { memberId: attendee.id, gymClassId: sofiaClass.id, sessionDate: past, status: "Confirmed" } });
    const futureBooking = await testDb.booking.create({ data: { memberId: attendee.id, gymClassId: sofiaClass.id, sessionDate: future, status: "Confirmed" } });
    const marcusBooking = await testDb.booking.create({ data: { memberId: attendee.id, gymClassId: marcusClass.id, sessionDate: pastMarcus, status: "Confirmed" } });

    const roster = await getRoster(sofia, sofiaClass.id, isoDate(past), now);
    assert.equal(roster.status, 200);
    assert.equal(roster.data?.canMark, true);
    assert.ok(roster.data?.entries.some((e) => e.bookingId === pastBooking.id));

    const marked = await markAttendance(sofia, pastBooking.id, "Completed", now);
    assert.equal(marked.status, 200, marked.error);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: pastBooking.id } })).status, "Completed");

    const tooEarly = await markAttendance(sofia, futureBooking.id, "Completed", now);
    assert.equal(tooEarly.status, 409);
    assert.match(tooEarly.error ?? "", /not happened/);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: futureBooking.id } })).status, "Confirmed");

    const notTheirs = await markAttendance(sofia, marcusBooking.id, "Completed", now);
    const missing = await markAttendance(sofia, 999_999, "Completed", now);
    assert.equal(notTheirs.status, 404);
    assert.equal(notTheirs.error, missing.error);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: marcusBooking.id } })).status, "Confirmed");

    assert.equal((await getRoster(sofia, marcusClass.id, isoDate(pastMarcus), now)).status, 404, "someone else's roster");
    assert.equal((await getRoster(sofia, sofiaClass.id, isoDate(addDays(past, 1)), now)).status, 400, "not the class's weekday");
    assert.equal((await markAttendance(demoMember, pastBooking.id, "Completed", now)).status, 403);
  });

  // ================================================================ ADMIN

  console.log("\nADMIN");

  let coachId = 0;
  const flowMember = await makeUser("rising.flow@example.co.za", "Rising Star", "Member", plan.id);
  let flowFighter: SessionUser;
  let eventId = 0;
  let boutId = 0;

  await check("creates a coach (invite queued) and schedules a class; a clash is refused", async () => {
    outbox.length = 0;
    const created = await createCoach(admin, {
      fullName: "Flow Coach",
      email: "flow.coach@example.co.za",
      title: "Wrestling",
      bio: "Ten years of coaching wrestling.",
      imageUrl: "",
    });
    assert.equal(created.status, 201, created.error);
    coachId = created.data!.id;
    await flushEmails();
    assert.ok(outbox.some((m) => m.to === "flow.coach@example.co.za" && /invited/.test(m.subject)));
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: coachId } })).role, "Coach");

    const input = { name: "Flow Wrestling", kind: "Group", coachId, day: "sat", startsAt: "10:00", durationMinutes: 60, capacity: 12 };
    const scheduled = await createClass(admin, input);
    assert.equal(scheduled.status, 201, scheduled.error);

    const clash = await createClass(admin, { ...input, name: "Same Slot Again" });
    assert.equal(clash.status, 409);
    assert.equal(clash.field, "startsAt");
    assert.equal(await testDb.gymClass.count({ where: { coachId } }), 1);

    assert.equal((await createClass(sofia, { ...input, startsAt: "11:00" })).status, 403, "a coach cannot schedule");
  });

  await check("promotes a member to fighter, creates an event, offers a bout and the fighter accepts", async () => {
    const promoted = await promoteToFighter(admin, flowMember.id, "Lightweight");
    assert.equal(promoted.status, 201, promoted.error);
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: flowMember.id } })).role, "Fighter");
    flowFighter = { ...flowMember, role: "Fighter" };

    const event = await createEvent(
      admin,
      {
        name: "Flow Showdown",
        venue: "Flow Arena",
        description: "A full card of amateur bouts under the lights.",
        eventDate: new Date(now.getTime() + 40 * DAY_MS).toISOString(),
        imageUrl: "",
      },
      now,
    );
    assert.equal(event.status, 201, event.error);
    eventId = event.data!.id;

    outbox.length = 0;
    const offer = await offerBout(admin, eventId, flowMember.id, { opponentName: "Sipho Zulu", boutWeightClass: "Lightweight" }, now);
    assert.equal(offer.status, 201, offer.error);
    boutId = offer.data!.id;
    await flushEmails();
    assert.ok(outbox.some((m) => m.to === flowMember.email && /Bout offer/.test(m.subject)));

    assert.equal((await offerBout(admin, eventId, flowMember.id, {}, now)).status, 409, "one offer per fighter and event");
    assert.equal((await respondToOffer(flowFighter, boutId, "Accepted", now)).status, 200);
  });

  await check("records a result and the record counters follow every change", async () => {
    const record = async () => {
      const row = await testDb.fighter.findUniqueOrThrow({ where: { fighterId: flowMember.id } });
      return [row.wins, row.losses, row.draws];
    };
    const afterEvent = new Date(now.getTime() + 41 * DAY_MS);

    assert.equal((await recordResult(admin, boutId, "Win", null, now)).status, 409, "before the event");
    assert.deepEqual(await record(), [0, 0, 0]);

    assert.equal((await recordResult(admin, boutId, "Win", "Won on points", afterEvent)).status, 200);
    assert.deepEqual(await record(), [1, 0, 0]);
    assert.equal((await recordResult(admin, boutId, "Win", "Won on points", afterEvent)).status, 200);
    assert.deepEqual(await record(), [1, 0, 0], "the same result twice changes nothing");

    assert.equal((await recordResult(admin, boutId, "Loss", null, afterEvent)).status, 200);
    assert.deepEqual(await record(), [0, 1, 0]);
    assert.equal((await recordResult(admin, boutId, "Draw", null, afterEvent)).status, 200);
    assert.deepEqual(await record(), [0, 0, 1]);
    assert.equal((await recordResult(admin, boutId, "NoContest", null, afterEvent)).status, 200);
    assert.deepEqual(await record(), [0, 0, 0], "a no contest counts for no one");
    assert.equal((await recordResult(admin, boutId, "Win", null, afterEvent)).status, 200);
    assert.equal((await recordResult(admin, boutId, null, null, afterEvent)).status, 200);
    assert.deepEqual(await record(), [0, 0, 0], "clearing a result takes it back");

    assert.equal((await recordResult(sofia, boutId, "Win", null, afterEvent)).status, 403);
    assert.equal((await recordResult(admin, 999_999, "Win", null, afterEvent)).status, 404);
  });

  await check("approves a document; the fighter sees it Approved and can no longer delete it", async () => {
    outbox.length = 0;
    const approved = await reviewDocument(admin, documentId, "Approved", null, now);
    assert.equal(approved.status, 200, approved.error);
    assert.equal((await testDb.fighterDocument.findUniqueOrThrow({ where: { id: documentId } })).status, "Approved");
    await flushEmails();
    assert.ok(outbox.some((m) => m.to === demoFighter.email && /approved/.test(m.subject)));

    assert.equal((await reviewDocument(admin, documentId, "Approved", null, now)).status, 409, "approving twice");
    assert.equal((await listMyDocuments(demoFighter)).data?.[0].status, "Approved");
    assert.equal((await deleteMyDocument(demoFighter, documentId)).status, 409);

    assert.equal((await reviewDocument(demoFighter, documentId, "Rejected", "no", now)).status, 403, "a fighter cannot review");
  });

  await check("deactivating a user ends their session at once, and reactivating restores it", async () => {
    const member = await makeUser("leaver.flow@example.co.za", "Leaving Member", "Member", plan.id);
    await signIn(member);
    assert.equal((await getSession())?.id, member.id);
    assert.equal((await bookRoute(jsonRequest("POST", { slotId: 999_999 }))).status, 404, "the session works");

    const result = await deactivateUser(admin, member.id, now);
    assert.equal(result.status, 200, result.error);
    assert.equal(await getSession(), null);
    assert.equal((await bookRoute(jsonRequest("POST", { slotId: 1 }))).status, 401);

    assert.equal((await reactivateUser(admin, member.id)).status, 200);
    assert.equal((await getSession())?.id, member.id, "the same cookie works again");
    await signOut();
  });

  await check("the last admin cannot be deactivated, by themselves or by a stale session (409)", async () => {
    assert.equal((await deactivateUser(admin, admin.id, now)).status, 409, "an admin cannot deactivate themselves");

    const second = await makeUser("second.admin.flow@example.co.za", "Second Admin", "Admin", null);
    assert.equal((await deactivateUser(second, admin.id, now)).status, 200, "one of two may go");
    assert.equal(await testDb.user.count({ where: { role: "Admin", isActive: true } }), 1);

    // The first admin is inactive now; the cookie in their hand is not an admin any more.
    const stale = await deactivateUser(admin, second.id, now);
    assert.equal(stale.status, 409, "the last active administrator is protected");
    assert.match(stale.error ?? "", /last active administrator/);
    assert.equal((await deactivateUser(second, second.id, now)).status, 409);
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: second.id } })).isActive, true);

    assert.equal((await reactivateUser(second, admin.id)).status, 200);
    assert.equal(await testDb.user.count({ where: { role: "Admin", isActive: true } }), 2);
  });

  // ================================================================ HOSTILE

  console.log("\nHOSTILE USER");

  await check("a 10,000-character name is a field error, not a 500 and not a row", async () => {
    const result = await outcome("long name", () =>
      register(EMPTY_FORM_STATE, form({ fullName: "x".repeat(10_000), email: "big.name@example.co.za", phone: "", password: PASSWORD, planId: "" })),
    );
    assert.equal(result.redirect, null);
    assert.equal(result.state?.ok, false);
    assert.ok(result.state?.errors?.fullName);
    assert.equal(await testDb.user.count({ where: { email: "big.name@example.co.za" } }), 0);

    const longPassword = await outcome("long password", () =>
      register(EMPTY_FORM_STATE, form({ fullName: "Long Password", email: "long.pw@example.co.za", phone: "", password: "p".repeat(100_000), planId: "" })),
    );
    assert.ok(longPassword.state?.errors?.password);
  });

  await check("emoji, right-to-left text, SQL, HTML, NUL and lone surrogates never cause an error", async () => {
    const names = [
      "🥊 Sipho 🔥",
      "مرحبا بالعالم",
      "שלום עולם",
      "abc‮def",
      "Robert'); DROP TABLE \"User\";--",
      "<script>alert(1)</script>",
      "abc\u0000def",
      "abc\uD800def",
      "   Padded Name   ",
      "      ",
    ];
    let n = 0;
    for (const fullName of names) {
      const email = `hostile.${++n}@example.co.za`;
      const result = await outcome(`name ${n}`, () => register(EMPTY_FORM_STATE, form({ fullName, email, phone: "", password: PASSWORD, planId: "" })));
      if (result.redirect) {
        assert.equal(result.redirect, "/dashboard?welcome=1");
        const stored = await testDb.user.findUniqueOrThrow({ where: { email } });
        // Stored as typed (React escapes it on display); a lone surrogate becomes U+FFFD.
        assert.equal(stored.fullName, fullName.trim().toWellFormed());
      } else {
        assert.equal(result.state?.ok, false, `name ${n}`);
        assert.equal(await testDb.user.count({ where: { email } }), 0);
      }
      await signOut();
    }
    assert.ok((await testDb.user.count()) > 30, "the User table is intact");
    assert.ok(await testDb.user.count({ where: { fullName: { contains: "DROP TABLE" } } }), "the SQL text is only data");
  });

  await check("SQL-looking text in sign-in, search and the contact form is only data", async () => {
    const sql = "' OR 1=1; DROP TABLE \"User\"; --";
    const signedIn = await outcome("login sql", () => login(EMPTY_FORM_STATE, form({ email: sql, password: sql })));
    assert.equal(signedIn.redirect, null);
    assert.equal(signedIn.state?.ok, false);

    const found = await listMembers(admin, { search: sql });
    assert.equal(found.status, 200);
    assert.equal(found.data?.total, 0);

    const enquiry = await outcome("enquiry sql", () =>
      sendEnquiry(EMPTY_FORM_STATE, form({ fullName: "Sql Visitor", email: "sql.visitor@example.co.za", phone: "", message: `Hello ${sql}`, website: "" })),
    );
    assert.equal(enquiry.state?.ok, true);
    assert.equal((await testDb.contactEnquiry.findFirstOrThrow({ where: { email: "sql.visitor@example.co.za" } })).message, `Hello ${sql}`);
    assert.ok((await testDb.user.count()) > 30);
  });

  await check("huge, negative, fractional and wrongly typed numbers and arrays are clean 4xx answers", async () => {
    const values: unknown[] = [2 ** 53, 2 ** 31, 1e308, -1, 0, 1.5, NaN, Infinity, "1", "1e2", [1], ["1"], null, undefined, {}, true];
    for (const value of values) {
      const label = String(JSON.stringify(value) ?? value).slice(0, 30);
      await clean(`createBooking ${label}`, async () => {
        const r = await createBooking(demoMember, value as number, now);
        return { ok: r.ok, status: r.status, error: r.error };
      });
      await clean(`cancelBooking ${label}`, async () => {
        const r = await cancelBooking(demoMember, value as number, now);
        return { ok: r.ok, status: r.status, error: r.error };
      });
      await clean(`respondToOffer ${label}`, () => respondToOffer(demoFighter, value, "Accepted", now));
      await clean(`openDocument ${label}`, () => openDocument(demoFighter, value));
      await clean(`markAttendance ${label}`, () => markAttendance(sofia, value, "Completed", now));
      await clean(`getRoster ${label}`, () => getRoster(sofia, value, "2026-10-05", now));
      await clean(`promoteToFighter ${label}`, () => promoteToFighter(admin, value, "Lightweight"));
      await clean(`recordResult ${label}`, () => recordResult(admin, value, "Win", null, now));
      await clean(`createEvent ${label}`, () => createEvent(admin, { name: value, venue: value, description: value, eventDate: value, imageUrl: value }, now));
    }
    assert.equal((await createBooking(demoMember, 2 ** 53, now)).status, 400);
    assert.equal((await createBooking(demoMember, -1, now)).status, 400);
    assert.equal((await createBooking(demoMember, 1.5, now)).status, 400);

    await signIn(demoMember);
    for (const slot of [2 ** 53, 1e308, -1, 1.5, "x", [1], null, {}]) {
      const response = await bookRoute(jsonRequest("POST", { slotId: slot }));
      await assertSafeError(response, `slotId ${JSON.stringify(slot)}`);
    }
    await signOut();
  });

  await check("arrays, objects and malformed bodies on the JSON routes are 4xx with the shared error shape", async () => {
    await signIn(admin);
    const patches: unknown[] = [{ name: ["x"] }, { name: { $ne: null } }, { eventDate: [1] }, { imageUrl: ["https://a.public.blob.vercel-storage.com/x.jpg"] }, { status: ["Cancelled"] }, { status: "Cancelled", name: "Other name" }];
    for (const body of patches) {
      const response = await adminEventPatch(jsonRequest("PATCH", body), params(eventId));
      assert.equal(response.status, 400, JSON.stringify(body));
      await assertSafeError(response, JSON.stringify(body));
    }
    const promote = await adminFightersPost(jsonRequest("POST", { memberId: [1], weightClass: ["x"] }));
    assert.equal(promote.status, 400);
    await assertSafeError(promote, "promote arrays");

    for (const raw of ["[]", "null", "5", '"text"', "{not json", ""]) {
      const response = await adminEventsPost(jsonRequest("POST", raw));
      assert.equal(response.status, 400, raw);
      await assertSafeError(response, raw);
    }

    const wrongType = await adminEventsPost(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "text/plain", origin: ORIGIN }, body: "{}" }));
    assert.equal(wrongType.status, 415);
    const tooBig = await adminEventsPost(jsonRequest("POST", JSON.stringify({ name: "x".repeat(200_000) })));
    assert.equal(tooBig.status, 413);
    assert.equal((await adminEventPatch(jsonRequest("PATCH", { name: "Valid New Name" }), params("1e2"))).status, 400, "an id that is not plain digits is not read as 100");
    assert.equal((await adminEventPatch(jsonRequest("PATCH", { name: "Valid New Name" }), params("abc"))).status, 400);
    await signOut();
  });

  await check("rapid duplicate submissions: one booking wins, the rest are 409, nobody gets a 500", async () => {
    const runner = await makeUser("rapid.flow@example.co.za", "Rapid Clicker", "Member", plan.id);
    const slot = (await getTimetable(now)).find((s) => s.capacity - s.booked >= 3 && s.id !== slotId)!;

    const results = await Promise.all(Array.from({ length: 6 }, () => createBooking(runner, slot.id, now)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409]);
    assert.equal(await testDb.booking.count({ where: { memberId: runner.id, gymClassId: slot.id } }), 1);

    // Six sign-ups with one address at once: one account.
    const email = "double.click@example.co.za";
    const signUps = await Promise.all(
      Array.from({ length: 5 }, () =>
        outcome("rapid register", () => register(EMPTY_FORM_STATE, form({ fullName: "Double Click", email, phone: "", password: PASSWORD, planId: "" }))),
      ),
    );
    assert.equal(signUps.filter((r) => r.redirect === "/dashboard?welcome=1").length, 1);
    assert.equal(signUps.filter((r) => r.state?.errors?.email).length, 4);
    assert.equal(await testDb.user.count({ where: { email } }), 1);
    await signOut();
  });

  await check("a password-reset token works once; the second use is the generic refusal", async () => {
    outbox.length = 0;
    const asked = await outcome("reset request", () => requestPasswordReset(EMPTY_FORM_STATE, form({ email: demoMember.email })));
    assert.equal(asked.state?.ok, true);
    await flushEmails();
    const mail = outbox.find((m) => m.to === demoMember.email);
    assert.ok(mail);
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(mail.text ?? "")?.[1];
    assert.ok(token);

    const first = await outcome("reset 1", () => submitPasswordReset(EMPTY_FORM_STATE, form({ token, password: "Brand-New-Passw0rd!" })));
    assert.equal(first.redirect, "/login?notice=Password+updated");

    const second = await outcome("reset 2", () => submitPasswordReset(EMPTY_FORM_STATE, form({ token, password: "Another-Passw0rd!x" })));
    assert.equal(second.redirect, null);
    assert.equal(second.state?.ok, false);
    assert.equal(second.state?.message, RESET_INVALID);

    const unknown = await outcome("reset 3", () => submitPasswordReset(EMPTY_FORM_STATE, form({ token: "A".repeat(43), password: "Another-Passw0rd!x" })));
    assert.equal(unknown.state?.message, RESET_INVALID, "an unknown token looks the same");

    const signedIn = await outcome("login new password", () => login(EMPTY_FORM_STATE, form({ email: demoMember.email, password: "Brand-New-Passw0rd!" })));
    assert.equal(signedIn.redirect, "/dashboard");
    const old = await outcome("login old password", () => login(EMPTY_FORM_STATE, form({ email: demoMember.email, password: "Member123!" })));
    assert.equal(old.state?.ok, false);
    await signOut();
  });

  await check("a POST from a foreign Origin, or with none, is a 403 and changes nothing", async () => {
    await signIn(admin);
    const before = await testDb.competitionEvent.count();
    const body = { name: "Evil Event", venue: "Evil Arena", description: "Created from another site.", eventDate: new Date(now.getTime() + 50 * DAY_MS).toISOString() };

    const sources: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "https://pfc.test.invalid.evil.example" },
      { referer: "https://evil.example/page" },
      {},
    ];
    for (const headers of sources) {
      const response = await adminEventsPost(jsonRequest("POST", body, headers));
      assert.equal(response.status, 403, JSON.stringify(headers));
      await assertSafeError(response, JSON.stringify(headers));
    }
    assert.equal((await bookRoute(jsonRequest("POST", { slotId: slotId }, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await cancelRoute(jsonRequest("POST", undefined, { origin: "https://evil.example" }), params(firstBookingId))).status, 403);
    assert.equal(await testDb.competitionEvent.count(), before, "no event was created");

    const own = await adminEventsPost(jsonRequest("POST", body, { referer: `${ORIGIN}/admin/events` }));
    assert.equal(own.status, 201, "the app's own Referer is accepted when Origin is missing");
    await signOut();
  });

  await check("a crafted returnUrl cannot bounce a signed-in user to another site", async () => {
    const targets: [string, string][] = [
      ["/admin/events?page=2", "/admin/events?page=2"],
      ["//evil.example", "/dashboard"],
      ["/\\evil.example", "/dashboard"],
      ["https://evil.example", "/dashboard"],
      ["/\t/evil.example", "/dashboard"],
    ];
    for (const [returnUrl, expected] of targets) {
      const result = await outcome("returnUrl", () =>
        login(EMPTY_FORM_STATE, form({ email: demoMember.email, password: "Brand-New-Passw0rd!", returnUrl })),
      );
      assert.equal(result.redirect, expected, returnUrl);
      await signOut();
    }
  });

  await check("50 rapid sign-in attempts: the limit engages, the right password is refused too, nothing throws", async () => {
    setTestRequestHeaders({ "x-real-ip": "203.0.113.77" });

    const messages: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const result = await outcome(`attempt ${i}`, () => login(EMPTY_FORM_STATE, form({ email: "member@pfc.co.za", password: `wrong-password-${i}` })));
      assert.equal(result.redirect, null, `attempt ${i}`);
      assert.equal(result.state?.ok, false);
      messages.push(result.state?.message ?? "");
    }

    assert.equal(messages.filter((m) => m === "Email or password is incorrect.").length, 5, "five tries per address and email");
    assert.equal(messages.filter((m) => /^Too many attempts\. Try again in \d+ minutes?\.$/.test(m)).length, 45);

    const right = await outcome("right password, locked out", () => login(EMPTY_FORM_STATE, form({ email: "member@pfc.co.za", password: "Brand-New-Passw0rd!" })));
    assert.equal(right.redirect, null, "guessing is not rewarded after the limit");
    assert.match(right.state?.message ?? "", /Too many attempts/);
    assert.equal(await getSession(), null);
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
