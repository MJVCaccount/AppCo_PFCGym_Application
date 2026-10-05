/**
 * Booking service and API route tests, run against the seeded test database
 * (see tests/helpers/db.ts).
 *
 * The service functions take the session as a parameter, so most checks call
 * them directly. The POST routes read the session from `next/headers`, which
 * tests/support/register.cjs swaps for an in-memory cookie jar.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { POST as cancelRoute } from "../src/app/api/bookings/[id]/cancel/route";
import { POST as bookRoute } from "../src/app/api/bookings/route";
import { GET as getClassesRoute } from "../src/app/api/classes/route";
import { GET as getHealthRoute } from "../src/app/api/health/route";
import { GET as getTimetableRoute } from "../src/app/api/timetable/route";
import { getSlot, getTimetable } from "../src/lib/repositories/timetableRepository";
import {
  createMember,
  findByEmail,
  toSessionUser,
} from "../src/lib/repositories/usersRepository";
import {
  cancelBooking,
  createBooking,
  listMyBookings,
} from "../src/lib/services/bookingService";
import { createSession, destroySession } from "../src/lib/session";
import type { DayKey, SessionUser, TimetableSlot } from "../src/lib/types";

// State-changing routes check the Origin header against APP_URL, so these
// requests come from the app's own address, as a browser's would.
const ORIGIN = "https://pfc.test.invalid";
process.env.APP_URL = ORIGIN;

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

function fillerEmail(n: number): string {
  return `filler${String(n).padStart(2, "0")}@demo.pfc.invalid`;
}

function bookRequest(body: unknown): Request {
  return new Request("http://localhost/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function cancelRequest(id: string | number) {
  return cancelRoute(
    new Request(`http://localhost/api/bookings/${id}/cancel`, { method: "POST", headers: { origin: ORIGIN } }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

async function main() {
  await resetDatabase();
  const now = new Date();

  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");

  // Classes are looked up by day and name, never by id.
  const week = await getTimetable(now);
  const find = (day: DayKey, name: string): TimetableSlot => {
    const slot = week.find((s) => s.day === day && s.className === name);
    assert.ok(slot, `${name} on ${day} is seeded`);
    return slot;
  };

  const boxing = find("mon", "Elite Boxing"); // seeded 12 of 20
  const grappling = find("mon", "Submission Grappling"); // seeded 16 of 16
  const muayThai = find("tue", "Muay Thai"); // seeded 7 of 20
  const openMat = find("sat", "Open Mat"); // seeded 10 of 24

  const bookingsFor = (memberId: number, gymClassId: number) =>
    testDb.booking.findMany({ where: { memberId, gymClassId } });

  console.log("\nBOOKING SERVICE: WHO AND WHAT");

  await check("rejects a non-numeric class id", async () => {
    const result = await createBooking(member, Number("not-a-number"), now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  await check("rejects zero, negative, fractional and oversized ids", async () => {
    for (const id of [0, -1, 1.5, 2 ** 31]) {
      assert.equal((await createBooking(member, id, now)).status, 400, String(id));
    }
  });

  await check("rejects a class that does not exist", async () => {
    const result = await createBooking(member, 999_999, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  await check("rejects an inactive class", async () => {
    await testDb.gymClass.update({
      where: { id: openMat.id },
      data: { isActive: false },
    });
    assert.equal((await createBooking(member, openMat.id, now)).status, 404);
    await testDb.gymClass.update({
      where: { id: openMat.id },
      data: { isActive: true },
    });
  });

  await check("staff cannot book: coach and admin get 403", async () => {
    for (const staff of [coach, admin]) {
      const result = await createBooking(staff, boxing.id, now);
      assert.equal(result.ok, false);
      assert.equal(result.status, 403);
      assert.equal(result.error, "Only members can book classes.");
      assert.equal((await bookingsFor(staff.id, boxing.id)).length, 0);
    }
  });

  await check("a member with no plan is blocked", async () => {
    const account = await createMember({
      email: "no.plan@example.co.za",
      fullName: "No Plan",
      password: "Testing123!",
      planId: null,
    });
    const result = await createBooking(toSessionUser(account), boxing.id, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.match(String(result.error), /membership plan is required/);
    assert.equal((await bookingsFor(account.id, boxing.id)).length, 0);
  });

  await check("a session for an account that no longer exists is blocked", async () => {
    const ghost: SessionUser = { ...member, id: 999_999 };
    const result = await createBooking(ghost, boxing.id, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  console.log("\nBOOKING SERVICE: BOOKING");

  let memberBookingId = 0;

  await check("confirms a booking and returns the refreshed slot", async () => {
    const result = await createBooking(member, boxing.id, now);
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.equal(result.slot?.booked, boxing.booked + 1);
    assert.equal(result.booking?.className, "Elite Boxing");
    assert.equal(result.booking?.coachName, "Marcus Thompson");
    assert.equal(result.booking?.status, "Confirmed");
    assert.match(String(result.booking?.sessionDate), /^\d{4}-\d{2}-\d{2}$/);

    const rows = await bookingsFor(member.id, boxing.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Confirmed");
    memberBookingId = rows[0].id;
  });

  await check("booking the same class twice returns 409", async () => {
    const result = await createBooking(member, boxing.id, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "You are already booked into this class.");
    assert.equal((await bookingsFor(member.id, boxing.id)).length, 1);
    assert.equal((await getSlot(boxing.id, now))!.booked, boxing.booked + 1);
  });

  await check("a fighter can book too", async () => {
    const result = await createBooking(fighter, muayThai.id, now);
    assert.equal(result.status, 201);
    assert.equal(result.slot?.booked, muayThai.booked + 1);
  });

  await check("a full class returns 409 and writes a Failed row", async () => {
    const result = await createBooking(member, grappling.id, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "Submission Grappling at 19:00 is fully booked.");

    const rows = await bookingsFor(member.id, grappling.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Failed");
    assert.equal(rows[0].failureReason, "Class full");

    assert.equal((await getSlot(grappling.id, now))!.booked, grappling.capacity);
  });

  await check("trying a full class again reuses the Failed row", async () => {
    const before = (await bookingsFor(member.id, grappling.id))[0];
    assert.equal((await createBooking(member, grappling.id, now)).status, 409);

    const rows = await bookingsFor(member.id, grappling.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, before.id);
    assert.equal(rows[0].status, "Failed");
  });

  await check("when a place frees up, the Failed row becomes Confirmed", async () => {
    const someone = await testDb.booking.findFirstOrThrow({
      where: { gymClassId: grappling.id, status: "Confirmed" },
    });
    await testDb.booking.update({
      where: { id: someone.id },
      data: { status: "Cancelled", cancelledAt: new Date() },
    });

    const failed = (await bookingsFor(member.id, grappling.id))[0];
    const result = await createBooking(member, grappling.id, now);
    assert.equal(result.status, 201);
    assert.equal(result.slot?.booked, grappling.capacity);

    const rows = await bookingsFor(member.id, grappling.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, failed.id);
    assert.equal(rows[0].status, "Confirmed");
    assert.equal(rows[0].failureReason, null);
  });

  console.log("\nBOOKING SERVICE: CONCURRENCY");

  await check("5 members racing for 1 place: one 201, four 409, one Confirmed", async () => {
    const anyCoach = await testDb.coach.findFirstOrThrow();
    const lastPlace = await testDb.gymClass.create({
      data: {
        name: "Last Place",
        coachId: anyCoach.coachId,
        day: "wed",
        startsAt: "05:15",
        durationMinutes: 30,
        capacity: 1,
      },
    });
    const racers = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => sessionFor(fillerEmail(n))),
    );

    const results = await Promise.all(
      racers.map((racer) => createBooking(racer, lastPlace.id, now)),
    );

    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [201, 409, 409, 409, 409],
    );
    for (const refused of results.filter((r) => !r.ok)) {
      assert.equal(refused.error, "Last Place at 05:15 is fully booked.");
    }

    const count = (status: "Confirmed" | "Failed") =>
      testDb.booking.count({ where: { gymClassId: lastPlace.id, status } });
    assert.equal(await count("Confirmed"), 1);
    assert.equal(await count("Failed"), 4);
    assert.equal((await getSlot(lastPlace.id, now))!.booked, 1);
  });

  await check("one member double-submitting gets one 201 and one 409, not two rows", async () => {
    const results = await Promise.all([
      createBooking(member, openMat.id, now),
      createBooking(member, openMat.id, now),
    ]);

    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await bookingsFor(member.id, openMat.id)).length, 1);
    assert.equal((await getSlot(openMat.id, now))!.booked, openMat.booked + 1);
  });

  console.log("\nBOOKING SERVICE: CANCELLING AND LISTING");

  const other = await sessionFor(fillerEmail(20));
  const otherBooking = await createBooking(other, muayThai.id, now);
  assert.equal(otherBooking.status, 201);
  const otherBookingId = otherBooking.booking!.id;

  await check("my bookings lists upcoming sessions with class and coach", async () => {
    const { upcoming, past } = await listMyBookings(member, now);
    assert.deepEqual(
      upcoming.map((b) => b.className).sort(),
      ["Elite Boxing", "Open Mat", "Submission Grappling"],
    );
    assert.ok(upcoming.every((b) => b.status === "Confirmed"));
    assert.equal(past.length, 0);

    const when = (b: { sessionDate: string; startsAt: string }) =>
      `${b.sessionDate} ${b.startsAt}`;

    const soonestFirst = upcoming.map(when);
    assert.deepEqual(soonestFirst, [...soonestFirst].sort(), "upcoming ascending");
    // Elite Boxing (Mon 06:30) and Submission Grappling (Mon 19:00) usually
    // share a date, so the start time decides. On a Monday between those two
    // times, boxing has already started and rolls to next week while
    // grappling is still today, so grappling comes first. Either way the order
    // must follow the real date and time.
    const boxingAt = upcoming.findIndex((b) => b.className === "Elite Boxing");
    const grapplingAt = upcoming.findIndex(
      (b) => b.className === "Submission Grappling",
    );
    const boxingFirst =
      when(upcoming[boxingAt]) < when(upcoming[grapplingAt]);
    assert.equal(boxingAt < grapplingAt, boxingFirst, "Monday classes in time order");
    if (upcoming[boxingAt].sessionDate === upcoming[grapplingAt].sessionDate) {
      assert.ok(boxingFirst, "same date: the earlier start time comes first");
    }

    // Seen from after they have all happened, the same bookings are past.
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const newestFirst = (await listMyBookings(member, later)).past.map(when);
    assert.equal(newestFirst.length, 3);
    assert.deepEqual(
      newestFirst,
      [...newestFirst].sort().reverse(),
      "past descending",
    );

    assert.deepEqual(await listMyBookings(coach, now), { upcoming: [], past: [] });
  });

  await check("cancelling someone else's booking returns 404, like a missing one", async () => {
    const theirs = await cancelBooking(member, otherBookingId, now);
    const missing = await cancelBooking(member, 999_999, now);

    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(theirs.error, missing.error);

    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: otherBookingId },
    });
    assert.equal(row.status, "Confirmed");
  });

  await check("staff get the same 404 for any booking id", async () => {
    assert.equal((await cancelBooking(admin, otherBookingId, now)).status, 404);
    assert.equal((await cancelBooking(coach, otherBookingId, now)).status, 404);
  });

  await check("a bad booking id is a 400", async () => {
    assert.equal((await cancelBooking(member, Number("x"), now)).status, 400);
    assert.equal((await cancelBooking(member, 0, now)).status, 400);
  });

  await check("cancelling after the class has started returns 409", async () => {
    const afterStart = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const result = await cancelBooking(member, memberBookingId, afterStart);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "This class has already started.");

    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: memberBookingId },
    });
    assert.equal(row.status, "Confirmed");
  });

  await check("a past Confirmed booking is shown as Completed without rewriting it", async () => {
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const { upcoming, past } = await listMyBookings(member, later);
    assert.equal(upcoming.length, 0);
    assert.ok(past.length >= 3);
    assert.ok(past.every((b) => b.status === "Completed"));

    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: memberBookingId },
    });
    assert.equal(row.status, "Confirmed");
  });

  await check("a NoShow set by a coach is shown as it is", async () => {
    const mine = (await bookingsFor(member.id, openMat.id))[0];
    await testDb.booking.update({
      where: { id: mine.id },
      data: { status: "NoShow" },
    });

    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const { past } = await listMyBookings(member, later);
    assert.equal(past.find((b) => b.id === mine.id)?.status, "NoShow");

    await testDb.booking.update({
      where: { id: mine.id },
      data: { status: "Confirmed" },
    });
  });

  await check("cancel works: Cancelled, cancelledAt set, the place is freed", async () => {
    const result = await cancelBooking(member, memberBookingId, now);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.booking?.status, "Cancelled");

    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: memberBookingId },
    });
    assert.equal(row.status, "Cancelled");
    assert.ok(row.cancelledAt);

    assert.equal((await getSlot(boxing.id, now))!.booked, boxing.booked);

    const { upcoming, past } = await listMyBookings(member, now);
    assert.ok(!upcoming.some((b) => b.id === memberBookingId));
    assert.equal(past.find((b) => b.id === memberBookingId)?.status, "Cancelled");
  });

  await check("cancelling twice returns 409", async () => {
    const result = await cancelBooking(member, memberBookingId, now);
    assert.equal(result.status, 409);
  });

  await check("re-booking after a cancel reuses the same row", async () => {
    const result = await createBooking(member, boxing.id, now);
    assert.equal(result.status, 201);
    assert.equal(result.booking?.id, memberBookingId);

    const rows = await bookingsFor(member.id, boxing.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Confirmed");
    assert.equal(rows[0].cancelledAt, null);
  });

  console.log("\nAPI ROUTES: GET");

  await check("GET /api/health reports ok", async () => {
    const res = getHealthRoute();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  await check("GET /api/classes returns the six programmes", async () => {
    const res = await getClassesRoute();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(Array.isArray(body.data), true);
    assert.equal(body.data.length, 6);
  });

  await check("GET /api/timetable returns the week, or one day", async () => {
    const all = await getTimetableRoute(new Request("http://localhost/api/timetable"));
    assert.equal(all.status, 200);
    assert.equal((await all.json()).data.length, 21); // 20 seeded + Last Place

    const res = await getTimetableRoute(
      new Request("http://localhost/api/timetable?day=mon"),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 4);
    assert.ok(body.data.every((slot: { day: string }) => slot.day === "mon"));
  });

  await check("GET /api/timetable?day=whenever is rejected", async () => {
    const res = await getTimetableRoute(
      new Request("http://localhost/api/timetable?day=whenever"),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.message.includes("mon"));
  });

  console.log("\nAPI ROUTES: POST");

  const yoga = find("sun", "Mobility & Recovery"); // seeded 4 of 22

  await check("POST routes answer 401 with { error: { message } } when signed out", async () => {
    await destroySession();

    for (const res of [
      await bookRoute(bookRequest({ slotId: yoga.id })),
      await cancelRequest(memberBookingId),
    ]) {
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(typeof body.error.message, "string");
    }
  });

  await check("POST /api/bookings rejects bad JSON and a missing slotId", async () => {
    await createSession(member);

    const badJson = await bookRoute(bookRequest("{not json"));
    assert.equal(badJson.status, 400);
    assert.equal(typeof (await badJson.json()).error.message, "string");

    const noId = await bookRoute(bookRequest({}));
    assert.equal(noId.status, 400);
  });

  let routeBookingId = 0;

  await check("POST /api/bookings books, then refuses the repeat with 409", async () => {
    const first = await bookRoute(bookRequest({ slotId: yoga.id }));
    assert.equal(first.status, 201);
    const body = await first.json();
    assert.equal(body.data.id, yoga.id);
    assert.equal(body.data.booked, yoga.booked + 1);

    const second = await bookRoute(bookRequest({ slotId: yoga.id }));
    assert.equal(second.status, 409);
    assert.equal(
      (await second.json()).error.message,
      "You are already booked into this class.",
    );

    routeBookingId = (await bookingsFor(member.id, yoga.id))[0].id;
  });

  await check("POST /api/bookings/:id/cancel cancels my booking only", async () => {
    const theirs = await cancelRequest(otherBookingId);
    assert.equal(theirs.status, 404);
    assert.equal(typeof (await theirs.json()).error.message, "string");

    assert.equal((await cancelRequest("abc")).status, 400);

    const mine = await cancelRequest(routeBookingId);
    assert.equal(mine.status, 200);
    assert.equal((await mine.json()).data.status, "Cancelled");

    assert.equal((await cancelRequest(routeBookingId)).status, 409);
  });

  await check("POST /api/bookings refuses a coach with 403", async () => {
    await createSession(coach);
    const res = await bookRoute(bookRequest({ slotId: yoga.id }));
    assert.equal(res.status, 403);
    assert.equal(
      (await res.json()).error.message,
      "Only members can book classes.",
    );
    await destroySession();
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
