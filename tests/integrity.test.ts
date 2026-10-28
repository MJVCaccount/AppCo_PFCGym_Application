/**
 * Integrity audit: drives real flows through the services and repositories,
 * then asks prisma/verifyIntegrity.ts whether any row ended up in a state the
 * data rules forbid. Also checks that verifyIntegrity really finds bad rows.
 *
 * Against the seeded test database, see tests/helpers/db.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { resetDatabase, testDb } from "./helpers/db";

import { RULE_COUNT, verifyIntegrity } from "../prisma/verifyIntegrity";
import { markAttendance } from "../src/lib/repositories/attendanceRepository";
import {
  createDocument,
  reviewDocument,
} from "../src/lib/repositories/documentsRepository";
import { replaceToken } from "../src/lib/repositories/passwordResetRepository";
import {
  createMember,
  findByEmail,
  toSessionUser,
} from "../src/lib/repositories/usersRepository";
import { cancelBooking, createBooking } from "../src/lib/services/bookingService";
import { deactivateSession } from "../src/lib/services/classAdminService";
import {
  cancelEvent,
  createEvent,
  offerBout,
  recordResult,
  respondToOffer,
  updateEvent,
} from "../src/lib/services/eventService";
import { deactivateUser } from "../src/lib/services/memberAdminService";
import { cancelMembership } from "../src/lib/services/membershipService";
import type { SessionUser } from "../src/lib/types";

const PASSWORD = "Audit-Password-1!";

let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

async function assertClean(when: string) {
  const found = await verifyIntegrity(testDb);
  assert.deepEqual(found, [], `integrity broken ${when}`);
}

async function main() {
  await resetDatabase();
  const now = new Date();
  const admin = await sessionFor("admin@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const plan = await testDb.membershipPlan.findFirstOrThrow({ where: { isActive: true } });
  const coachRow = await testDb.coach.findFirstOrThrow();

  const newMember = async (name: string) =>
    toSessionUser(
      await createMember({
        email: `${name}@audit.pfc.invalid`,
        fullName: name,
        password: PASSWORD,
        planId: plan.id,
      }),
    );
  const newClass = (name: string, day: "wed" | "thu" | "fri", startsAt: string, capacity: number) =>
    testDb.gymClass.create({
      data: { name, coachId: coachRow.coachId, day, startsAt, durationMinutes: 30, capacity },
    });

  console.log("\nINTEGRITY: THE VERIFIER");

  await check("a freshly seeded database passes every check", async () => {
    assert.ok(RULE_COUNT >= 20);
    await assertClean("after seeding");
  });

  // Rows the CHECK constraints reject cannot be planted, so the verifier is
  // exercised with a rule only the application keeps: a Fighter user with no
  // Member or Fighter row.
  const plantOrphan = () =>
    testDb.user.create({
      data: {
        email: "orphan@audit.pfc.invalid",
        fullName: "Orphan",
        role: "Fighter",
        passwordHash: "x",
        passwordSalt: "y",
      },
    });

  await check("the verifier finds a Fighter user with no Member or Fighter row", async () => {
    const orphan = await plantOrphan();
    const found = await verifyIntegrity(testDb);
    assert.equal(found.length, 2);
    assert.ok(found.every((v) => v.sampleIds.includes(orphan.id)));
    await testDb.user.delete({ where: { id: orphan.id } });
    await assertClean("after removing the orphan");
  });

  await check("npm run db:verify exits 0 on a clean database and 1 with the failing rule on a bad one", async () => {
    const run = () =>
      spawnSync("npx", ["tsx", "prisma/verifyIntegrity.ts"], {
        cwd: process.cwd(),
        env: { ...process.env },
        encoding: "utf8",
        shell: true,
      });

    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, new RegExp(`all ${RULE_COUNT} checks passed`));

    const orphan = await plantOrphan();
    const dirty = run();
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout, /has no Fighter row/);

    await testDb.user.delete({ where: { id: orphan.id } });
    await assertClean("after removing the orphan");
  });

  console.log("\nINTEGRITY: BOOKING LIFECYCLE");

  await check("cancel, class fills, the cancelled member tries again: the Failed row keeps no cancelledAt", async () => {
    const klass = await newClass("Audit One", "wed", "02:01", 1);
    const a = await newMember("a1");
    const b = await newMember("b1");

    const first = await createBooking(a, klass.id, now);
    assert.equal(first.status, 201);
    assert.equal((await cancelBooking(a, first.data!.booking.id, now)).status, 200);
    assert.equal((await createBooking(b, klass.id, now)).status, 201);
    assert.equal((await createBooking(a, klass.id, now)).status, 409); // full: Cancelled -> Failed

    await assertClean("after Cancelled -> Failed");

    // And back: the place frees up and the Failed row becomes Confirmed.
    const bBooking = await testDb.booking.findFirstOrThrow({ where: { memberId: b.id, gymClassId: klass.id } });
    assert.equal((await cancelBooking(b, bBooking.id, now)).status, 200);
    assert.equal((await createBooking(a, klass.id, now)).status, 201);
    await assertClean("after Failed -> Confirmed");
  });

  await check("attendance moves a booking Completed -> NoShow -> Completed with completedAt following", async () => {
    const klass = await newClass("Audit Two", "thu", "02:02", 5);
    const m = await newMember("m2");
    const booked = await createBooking(m, klass.id, now);
    const id = booked.data!.booking.id;
    const later = new Date(now.getTime() + 8 * 24 * 3600 * 1000);

    for (const status of ["Completed", "NoShow", "Completed"] as const) {
      const done = await markAttendance(id, status, null, admin.id, later);
      assert.equal(done.ok, true);
      await assertClean(`after marking ${status}`);
    }
  });

  await check("deactivating a member and a class cancels their future bookings cleanly", async () => {
    const klass = await newClass("Audit Three", "fri", "02:03", 5);
    const m = await newMember("m3");
    assert.equal((await createBooking(m, klass.id, now)).status, 201);
    assert.equal((await deactivateUser(admin, m.id)).ok, true);
    await assertClean("after deactivating a member");

    const m4 = await newMember("m4");
    assert.equal((await createBooking(m4, klass.id, now)).status, 201);
    assert.equal((await deactivateSession(admin, klass.id, { cancelBookings: true }, now)).ok, true);
    await assertClean("after deactivating a class");
  });

  await check("cancelling a membership leaves the data rules intact", async () => {
    const m = await newMember("m5");
    assert.equal((await cancelMembership(m)).ok, true);
    await assertClean("after cancelling a membership");
  });

  console.log("\nINTEGRITY: BOUT OFFERS");

  await check("offer, accept, decline, accept, result: availability and respondedAt stay in step", async () => {
    const past = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    const future = new Date(now.getTime() + 20 * 24 * 3600 * 1000);
    const event = await createEvent(admin, {
      name: "Audit Night",
      venue: "Audit Hall",
      description: "An event created by the integrity audit.",
      eventDate: future.toISOString(),
    });
    assert.equal(event.status, 201, event.error);
    const eventId = event.data!.id;

    const offer = await offerBout(admin, eventId, fighter.id, { opponentName: "Opp" }, now);
    assert.equal(offer.status, 201, offer.error);
    const offerId = offer.data!.id;
    await assertClean("after offering");

    for (const answer of ["Accepted", "Declined", "Accepted"]) {
      assert.equal((await respondToOffer(fighter, offerId, answer, now)).status, 200);
      await assertClean(`after answering ${answer}`);
    }

    // The event happens; the admin records a result.
    await testDb.competitionEvent.update({ where: { id: eventId }, data: { eventDate: past } });
    assert.equal((await recordResult(admin, offerId, "Win", "ok", now)).status, 200);
    await assertClean("after recording a result");
  });

  await check("moving the date of an event that has results cannot let a fighter withdraw afterwards", async () => {
    const row = await testDb.eventParticipation.findFirstOrThrow({ where: { result: "Win" } });
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    await updateEvent(admin, row.eventId, { eventDate: future.toISOString() });
    const withdrawal = await respondToOffer(fighter, row.id, "Declined", now);

    // Both together would leave a Win recorded for a fighter who declined, so
    // the withdrawal is refused while a result stands.
    assert.equal(withdrawal.status, 409);
    assert.match(withdrawal.error ?? "", /result has been recorded/);
    assert.equal((await testDb.eventParticipation.findUniqueOrThrow({ where: { id: row.id } })).availability, "Accepted");
    await assertClean("after moving the date and withdrawing");
  });

  await check("cancelling an event keeps its offers and results consistent", async () => {
    const row = await testDb.eventParticipation.findFirstOrThrow();
    await cancelEvent(admin, row.eventId, now);
    await assertClean("after cancelling an event");
  });

  console.log("\nINTEGRITY: DOCUMENTS AND TOKENS");

  await check("upload, approve, reject, approve keeps reviewedAt in step with status", async () => {
    const created = await createDocument(
      { fighterId: fighter.id, type: "Medical", fileName: "m.pdf", pathname: "audit/m.pdf" },
      10,
    );
    assert.equal(created.ok, true);
    const id = (created as { ok: true; document: { id: number } }).document.id;
    await assertClean("after upload");

    for (const decision of ["Approved", "Rejected", "Approved"] as const) {
      const done = await reviewDocument(id, decision, null, admin.id, now);
      assert.equal(done.ok, true);
      await assertClean(`after ${decision}`);
    }
  });

  await check("reset tokens expire after they are created", async () => {
    await replaceToken({
      userId: fighter.id,
      tokenHash: "audit-hash-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await assertClean("after issuing a reset token");
  });

  await check("every email is stored in lowercase, whatever was typed", async () => {
    await createMember({ email: "MiXeD@Audit.PFC.invalid", fullName: "Mixed Case", password: PASSWORD, planId: null });
    const row = await testDb.user.findFirstOrThrow({ where: { fullName: "Mixed Case" } });
    assert.equal(row.email, row.email.toLowerCase());
    await assertClean("after registering a mixed-case address");
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
