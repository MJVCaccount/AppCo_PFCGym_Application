/**
 * Booking under concurrency, against the seeded test database.
 *
 * The invariant: however requests interleave, a class never holds more
 * Confirmed bookings than its capacity, and no member holds two rows for one
 * session. Every scenario runs ROUNDS times, because a race that is lost one
 * run in ten will not show in a single pass.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { getSlot } from "../src/lib/repositories/timetableRepository";
import {
  createMember,
  toSessionUser,
} from "../src/lib/repositories/usersRepository";
import { cancelBooking, createBooking } from "../src/lib/services/bookingService";
import type { SessionUser } from "../src/lib/types";

const ROUNDS = 5;
const CAPACITY = 3;
const CROWD = 30;

let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function main() {
  await resetDatabase();
  const now = new Date();

  const plan = await testDb.membershipPlan.findFirstOrThrow({ where: { isActive: true } });
  const coach = await testDb.coach.findFirstOrThrow();

  // Thirty members, each on a plan so they are allowed to book.
  const crowd: SessionUser[] = [];
  for (let n = 1; n <= CROWD; n++) {
    const account = await createMember({
      email: `crowd${n}@concurrency.pfc.invalid`,
      fullName: `Crowd ${n}`,
      password: "Crowd-Password-1!",
      planId: plan.id,
    });
    crowd.push(toSessionUser(account));
  }

  let sequence = 0;
  /** A fresh class per round, so rounds never share rows. */
  async function newClass(capacity = CAPACITY) {
    sequence++;
    return testDb.gymClass.create({
      data: {
        name: `Race ${sequence}`,
        coachId: coach.coachId,
        day: "wed",
        // The timetable allows one class per coach, day and start time.
        startsAt: `01:${String(sequence).padStart(2, "0")}`,
        durationMinutes: 30,
        capacity,
      },
    });
  }

  const confirmedIn = (gymClassId: number) =>
    testDb.booking.count({ where: { gymClassId, status: "Confirmed" } });

  /** No member has two rows for one class, whatever else happened. */
  async function assertNoDuplicateRows(gymClassId: number) {
    const rows = await testDb.booking.groupBy({
      by: ["memberId", "sessionDate"],
      where: { gymClassId },
      _count: { _all: true },
    });
    assert.ok(rows.every((r) => r._count._all === 1), "one row per member and session");
  }

  console.log("\nBOOKING CONCURRENCY");

  await check(`${CROWD} members racing for ${CAPACITY} places: exactly ${CAPACITY} Confirmed, the rest 409 (x${ROUNDS})`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const gymClass = await newClass();

      const results = await Promise.all(
        crowd.map((member) => createBooking(member, gymClass.id, now)),
      );

      const created = results.filter((r) => r.status === 201).length;
      const refused = results.filter((r) => r.status === 409).length;
      assert.equal(created, CAPACITY, `round ${round}: 201s`);
      assert.equal(refused, CROWD - CAPACITY, `round ${round}: 409s`);
      assert.equal(created + refused, CROWD, `round ${round}: nothing else came back`);

      assert.equal(await confirmedIn(gymClass.id), CAPACITY, `round ${round}: Confirmed rows`);
      assert.equal(
        await testDb.booking.count({ where: { gymClassId: gymClass.id, status: "Failed" } }),
        CROWD - CAPACITY,
        `round ${round}: Failed rows`,
      );
      assert.equal((await getSlot(gymClass.id, now))!.booked, CAPACITY);
      await assertNoDuplicateRows(gymClass.id);
    }
  });

  await check(`one member double-submitting gets one 201 and one 409 and one row (x${ROUNDS})`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const gymClass = await newClass();
      const member = crowd[round]!;

      const results = await Promise.all(
        Array.from({ length: 4 }, () => createBooking(member, gymClass.id, now)),
      );

      assert.deepEqual(
        results.map((r) => r.status).sort(),
        [201, 409, 409, 409],
        `round ${round}`,
      );
      assert.equal(
        await testDb.booking.count({ where: { gymClassId: gymClass.id, memberId: member.id } }),
        1,
      );
      assert.equal(await confirmedIn(gymClass.id), 1);
    }
  });

  await check(`a holder cancelling and rebooking while others race for the place never overfills (x${ROUNDS})`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const gymClass = await newClass();
      const holders = crowd.slice(0, CAPACITY);
      const waiting = crowd.slice(CAPACITY, CAPACITY + 6);

      const held = await Promise.all(holders.map((m) => createBooking(m, gymClass.id, now)));
      assert.ok(held.every((r) => r.status === 201), "the class starts full");
      const firstBookingId = held[0]!.data!.booking.id;

      const [cancelled, rebooked, ...others] = await Promise.all([
        cancelBooking(holders[0]!, firstBookingId, now),
        // Starts at the same moment as the cancel; it may lose to it or beat it.
        createBooking(holders[0]!, gymClass.id, now),
        ...waiting.map((m) => createBooking(m, gymClass.id, now)),
      ]);

      assert.ok([200, 409].includes(cancelled.status), `round ${round}: cancel is 200 or 409`);
      assert.ok([201, 409].includes(rebooked.status), `round ${round}: rebook is 201 or 409`);
      assert.ok(others.every((r) => r.status === 201 || r.status === 409));

      assert.ok(
        (await confirmedIn(gymClass.id)) <= CAPACITY,
        `round ${round}: never over capacity`,
      );
      await assertNoDuplicateRows(gymClass.id);

      // Settle: whoever is left on the waiting list now tries again. The class
      // must fill to exactly its capacity and then refuse everybody.
      for (const member of waiting) await createBooking(member, gymClass.id, now);
      assert.equal(await confirmedIn(gymClass.id), CAPACITY, `round ${round}: full again`);
      assert.equal((await createBooking(crowd[CROWD - 1]!, gymClass.id, now)).status, 409);
      assert.equal(await confirmedIn(gymClass.id), CAPACITY);
    }
  });

  await check(`everyone cancelling at once frees every place exactly once (x${ROUNDS})`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const gymClass = await newClass();
      const holders = crowd.slice(0, CAPACITY);
      const held = await Promise.all(holders.map((m) => createBooking(m, gymClass.id, now)));

      // Each holder cancels twice at once: one wins, the other is "not confirmed".
      const results = await Promise.all(
        held.flatMap((r, i) => [
          cancelBooking(holders[i]!, r.data!.booking.id, now),
          cancelBooking(holders[i]!, r.data!.booking.id, now),
        ]),
      );

      assert.equal(results.filter((r) => r.status === 200).length, CAPACITY);
      assert.equal(results.filter((r) => r.status === 409).length, CAPACITY);
      assert.equal(await confirmedIn(gymClass.id), 0);
      assert.equal((await getSlot(gymClass.id, now))!.booked, 0);
    }
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
