/**
 * Fighter, event and bout-offer tests, run against the seeded test database
 * (see tests/helpers/db.ts).
 *
 * The services take the session and the current time as parameters, so most
 * checks call them directly and stand before or after an event by passing a
 * different `now`. The routes read the session from `next/headers`, which
 * tests/support/register.cjs swaps for an in-memory cookie jar.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { POST as offerRoute } from "../src/app/api/admin/events/[id]/offers/route";
import { PATCH as eventRoute } from "../src/app/api/admin/events/[id]/route";
import { POST as createEventRoute } from "../src/app/api/admin/events/route";
import { DELETE as demoteRoute } from "../src/app/api/admin/fighters/[id]/route";
import { POST as promoteRoute } from "../src/app/api/admin/fighters/route";
import { PATCH as resultRoute } from "../src/app/api/admin/participations/[id]/result/route";
import { GET as eventsRoute } from "../src/app/api/events/route";
import { POST as respondRoute } from "../src/app/api/fighter/offers/[id]/respond/route";
import { GET as myOffersRoute } from "../src/app/api/fighter/offers/route";
import { listForEvent } from "../src/lib/repositories/participationsRepository";
import {
  createMember,
  findByEmail,
  toSessionUser,
} from "../src/lib/repositories/usersRepository";
import {
  cancelEvent,
  completeEvent,
  createEvent,
  listPublicEvents,
  offerBout,
  recordResult,
  respondToOffer,
  updateEvent,
} from "../src/lib/services/eventService";
import {
  demoteFighter,
  listMyOffers,
  promoteToFighter,
} from "../src/lib/services/fighterService";
import { createSession, destroySession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BLOB_IMAGE = "https://abc123.public.blob.vercel-storage.com/poster.jpg";

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

function jsonRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

function idParams(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function main() {
  await resetDatabase();

  const now = new Date();
  const daysFromNow = (days: number) => new Date(now.getTime() + days * MS_PER_DAY);

  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");

  // Seeded: Fight Night in 30 days with a Pending offer for the demo fighter,
  // and the Regional Championship in 75 days with no offers.
  const fightNight = await testDb.competitionEvent.findFirstOrThrow({
    where: { name: "PFC Fight Night" },
  });
  const regional = await testDb.competitionEvent.findFirstOrThrow({
    where: { name: "PFC Regional Championship" },
  });
  const seededOffer = await testDb.eventParticipation.findFirstOrThrow({
    where: { fighterId: fighter.id, eventId: fightNight.id },
  });
  const afterFightNight = daysFromNow(40);

  const record = () =>
    testDb.fighter.findUniqueOrThrow({
      where: { fighterId: fighter.id },
      select: { wins: true, losses: true, draws: true },
    });
  const roleOf = async (id: number) =>
    (await testDb.user.findUniqueOrThrow({ where: { id } })).role;
  const audited = (action: string, entityId: number) =>
    testDb.auditLog.count({ where: { action, entityId } });

  const validEvent = {
    name: "PFC Summer Showdown",
    venue: "Bellville Velodrome",
    description: "A full card of amateur bouts under the lights.",
    eventDate: daysFromNow(20).toISOString(),
  };

  console.log("\nAUTHORISATION");

  await check("a member cannot offer a bout or promote anyone", async () => {
    const offer = await offerBout(member, regional.id, fighter.id, {}, now);
    assert.equal(offer.ok, false);
    assert.equal(offer.status, 403);

    const promote = await promoteToFighter(member, member.id, "Lightweight");
    assert.equal(promote.status, 403);
    assert.equal(await roleOf(member.id), "Member");
  });

  await check("a coach cannot record a result", async () => {
    const result = await recordResult(coach, seededOffer.id, "Win", null, afterFightNight);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.deepEqual(await record(), { wins: 3, losses: 1, draws: 0 });
  });

  await check("only an admin can create, edit, cancel, complete or demote", async () => {
    for (const session of [member, fighter, coach]) {
      assert.equal((await createEvent(session, validEvent, now)).status, 403);
      assert.equal((await updateEvent(session, fightNight.id, { name: "Hijacked" })).status, 403);
      assert.equal((await cancelEvent(session, fightNight.id, now)).status, 403);
      assert.equal((await completeEvent(session, fightNight.id, afterFightNight)).status, 403);
      assert.equal((await demoteFighter(session, fighter.id)).status, 403);
    }

    const row = await testDb.competitionEvent.findUniqueOrThrow({
      where: { id: fightNight.id },
    });
    assert.equal(row.name, "PFC Fight Night");
    assert.equal(row.status, "Scheduled");
  });

  console.log("\nPROMOTE TO FIGHTER");

  const prospectAccount = await createMember({
    email: "prospect@example.co.za",
    fullName: "Pat Prospect",
    password: "Testing123!",
    planId: null,
  });
  // The session a promoted member holds after signing in again.
  const prospect: SessionUser = { ...toSessionUser(prospectAccount), role: "Fighter" };

  await check("promotes a member: Fighter row, role and audit record", async () => {
    const result = await promoteToFighter(admin, prospectAccount.id, "  Lightweight ");
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.deepEqual(result.data, {
      id: prospectAccount.id,
      fullName: "Pat Prospect",
      weightClass: "Lightweight",
      wins: 0,
      losses: 0,
      draws: 0,
      imageUrl: null,
    });

    assert.equal(await roleOf(prospectAccount.id), "Fighter");
    assert.ok(
      await testDb.fighter.findUnique({ where: { fighterId: prospectAccount.id } }),
    );

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "fighter.promote", entityId: prospectAccount.id },
    });
    assert.equal(log.actorId, admin.id);
    assert.deepEqual(log.detail, { weightClass: "Lightweight" });
  });

  await check("promoting the same member twice returns 409", async () => {
    const result = await promoteToFighter(admin, prospectAccount.id, "Lightweight");
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(await testDb.fighter.count({ where: { fighterId: prospectAccount.id } }), 1);
  });

  await check("staff, unknown and deactivated accounts are 404", async () => {
    assert.equal((await promoteToFighter(admin, coach.id, "Lightweight")).status, 404);
    assert.equal((await promoteToFighter(admin, admin.id, "Lightweight")).status, 404);
    assert.equal((await promoteToFighter(admin, 999_999, "Lightweight")).status, 404);

    const inactive = await createMember({
      email: "inactive@example.co.za",
      fullName: "Ina Ctive",
      password: "Testing123!",
      planId: null,
    });
    await testDb.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    assert.equal((await promoteToFighter(admin, inactive.id, "Lightweight")).status, 404);
    assert.equal(await roleOf(inactive.id), "Member");
  });

  await check("a bad memberId or weight class is a 400 naming the field", async () => {
    assert.equal((await promoteToFighter(admin, "7", "Lightweight")).status, 400);
    assert.equal((await promoteToFighter(admin, 1.5, "Lightweight")).status, 400);

    for (const weightClass of ["x", "", null, undefined, 70, "w".repeat(41)]) {
      const result = await promoteToFighter(admin, member.id, weightClass);
      assert.equal(result.status, 400, String(weightClass));
      assert.match(String(result.error), /Weight class/);
    }
    assert.equal(await roleOf(member.id), "Member");
  });

  console.log("\nEVENTS");

  let showdownId = 0;

  await check("creates an event and returns the date as an ISO string", async () => {
    const result = await createEvent(admin, { ...validEvent, imageUrl: "" }, now);
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.equal(result.data?.status, "Scheduled");
    assert.equal(result.data?.imageUrl, null);
    assert.equal(result.data?.eventDate, validEvent.eventDate);
    showdownId = result.data!.id;

    assert.equal(await audited("event.create", showdownId), 1);
  });

  await check("rejects bad event fields with a 400 naming the field", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ name: "ab" }, /Event name/],
      [{ name: 42 }, /Event name/],
      [{ venue: "x" }, /Venue/],
      [{ description: "too short" }, /Description/],
      [{ description: "d".repeat(2001) }, /Description/],
      [{ eventDate: "next friday" }, /Event date/],
      [{ eventDate: "2030-01-01T19:00" }, /Event date/], // no time zone
      [{ eventDate: 1_900_000_000_000 }, /Event date/],
      [{ eventDate: daysFromNow(-1).toISOString() }, /in the future/],
      [{ imageUrl: "http://abc.public.blob.vercel-storage.com/a.jpg" }, /Image URL/],
      [{ imageUrl: "https://example.com/a.jpg" }, /Image URL/],
      [{ imageUrl: "https://public.blob.vercel-storage.com.evil.test/a.jpg" }, /Image URL/],
      [{ imageUrl: 5 }, /Image URL/],
    ];

    for (const [override, message] of cases) {
      const result = await createEvent(admin, { ...validEvent, ...override }, now);
      assert.equal(result.status, 400, JSON.stringify(override));
      assert.match(String(result.error), message);
    }

    assert.equal(
      await testDb.competitionEvent.count({ where: { name: validEvent.name } }),
      1,
    );
  });

  await check("an image on the Vercel Blob host is accepted, and can be cleared", async () => {
    const set = await updateEvent(admin, showdownId, { imageUrl: BLOB_IMAGE });
    assert.equal(set.status, 200);
    assert.equal(set.data?.imageUrl, BLOB_IMAGE);

    for (const empty of ["", "   ", null]) {
      await updateEvent(admin, showdownId, { imageUrl: BLOB_IMAGE });
      const cleared = await updateEvent(admin, showdownId, { imageUrl: empty });
      assert.equal(cleared.status, 200);
      assert.equal(cleared.data?.imageUrl, null);
    }
  });

  await check("update changes only what was sent; unknown id 404, nothing sent 400", async () => {
    const result = await updateEvent(admin, showdownId, { venue: "Grand Arena" });
    assert.equal(result.status, 200);
    assert.equal(result.data?.venue, "Grand Arena");
    assert.equal(result.data?.name, validEvent.name);
    assert.equal(result.data?.eventDate, validEvent.eventDate);

    assert.equal((await updateEvent(admin, 999_999, { venue: "Nowhere" })).status, 404);
    assert.equal((await updateEvent(admin, showdownId, {})).status, 400);
    assert.equal((await updateEvent(admin, showdownId, { name: "x" })).status, 400);
    assert.equal((await updateEvent(admin, Number("abc"), { venue: "Nowhere" })).status, 400);
  });

  const cancelled = await testDb.competitionEvent.create({
    data: {
      name: "Rained Off Rumble",
      eventDate: daysFromNow(10),
      venue: "Open Air Ring",
      description: "This one gets cancelled by the test below.",
    },
  });
  const pastEvent = await testDb.competitionEvent.create({
    data: {
      name: "Last Month's Card",
      eventDate: daysFromNow(-20),
      venue: "PFC Gym, main arena",
      description: "Already happened but never marked completed.",
    },
  });

  await check("cancelling sets Cancelled and keeps the row; twice is a 409", async () => {
    const result = await cancelEvent(admin, cancelled.id, now);
    assert.equal(result.status, 200);
    assert.equal(result.data?.status, "Cancelled");

    const row = await testDb.competitionEvent.findUnique({ where: { id: cancelled.id } });
    assert.equal(row?.status, "Cancelled");
    assert.equal(await audited("event.cancel", cancelled.id), 1);

    assert.equal((await cancelEvent(admin, cancelled.id, now)).status, 409);
    assert.equal((await cancelEvent(admin, 999_999, now)).status, 404);
  });

  await check("completing needs the date to have passed", async () => {
    const early = await completeEvent(admin, showdownId, now);
    assert.equal(early.status, 409);
    assert.equal(early.error, "The event has not happened yet.");

    const done = await completeEvent(admin, pastEvent.id, now);
    assert.equal(done.status, 200);
    assert.equal(done.data?.status, "Completed");

    assert.equal((await completeEvent(admin, cancelled.id, afterFightNight)).status, 409);
  });

  console.log("\nOFFER A BOUT");

  let regionalOfferId = 0;

  await check("offers a bout; blank optional fields are stored as null", async () => {
    const result = await offerBout(
      admin,
      regional.id,
      fighter.id,
      { opponentName: "  Sipho Dlamini ", boutWeightClass: "", boutNotes: null },
      now,
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.equal(result.data?.availability, "Pending");
    assert.equal(result.data?.opponentName, "Sipho Dlamini");
    assert.equal(result.data?.boutWeightClass, null);
    assert.equal(result.data?.boutNotes, null);
    assert.equal(result.data?.eventName, "PFC Regional Championship");
    assert.equal(result.data?.fighterName, "Demo Fighter");
    assert.equal(result.data?.respondedAt, null);
    regionalOfferId = result.data!.id;

    assert.equal(await audited("offer.create", regionalOfferId), 1);
  });

  await check("a second offer for the same fighter and event is a 409", async () => {
    const result = await offerBout(admin, fightNight.id, fighter.id, {}, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "That fighter already has an offer for this event.");
    assert.equal((await listForEvent(fightNight.id)).length, 1);
  });

  await check("two admins offering the same bout at once: one 201, one 409", async () => {
    const results = await Promise.all([
      offerBout(admin, showdownId, fighter.id, {}, now),
      offerBout(admin, showdownId, fighter.id, {}, now),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await listForEvent(showdownId)).length, 1);
  });

  await check("a past, cancelled or completed event is a 409", async () => {
    // Scheduled but already over, seen from after its date.
    assert.equal(
      (await offerBout(admin, fightNight.id, prospect.id, {}, afterFightNight)).status,
      409,
    );
    assert.equal((await offerBout(admin, cancelled.id, fighter.id, {}, now)).status, 409);
    assert.equal((await offerBout(admin, pastEvent.id, fighter.id, {}, now)).status, 409);

    assert.equal((await listForEvent(cancelled.id)).length, 0);
    assert.equal((await listForEvent(pastEvent.id)).length, 0);
  });

  await check("unknown event or fighter is a 404; bad input is a 400", async () => {
    assert.equal((await offerBout(admin, 999_999, fighter.id, {}, now)).status, 404);
    assert.equal((await offerBout(admin, regional.id, 999_999, {}, now)).status, 404);
    assert.equal((await offerBout(admin, regional.id, member.id, {}, now)).status, 404);

    assert.equal((await offerBout(admin, regional.id, "3", {}, now)).status, 400);
    const wrongType = await offerBout(admin, regional.id, prospect.id, { opponentName: 12 }, now);
    assert.equal(wrongType.status, 400);
    assert.match(String(wrongType.error), /Opponent name/);
    const tooLong = await offerBout(
      admin,
      regional.id,
      prospect.id,
      { boutNotes: "n".repeat(1001) },
      now,
    );
    assert.equal(tooLong.status, 400);
    assert.match(String(tooLong.error), /Bout notes/);
  });

  console.log("\nRESPOND TO AN OFFER");

  await check("the owner can accept, then change to decline", async () => {
    const accepted = await respondToOffer(fighter, seededOffer.id, "Accepted", now);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data?.availability, "Accepted");
    assert.equal(accepted.data?.respondedAt, now.toISOString());

    const later = new Date(now.getTime() + 60_000);
    const declined = await respondToOffer(fighter, seededOffer.id, "Declined", later);
    assert.equal(declined.status, 200);
    assert.equal(declined.data?.availability, "Declined");
    assert.equal(declined.data?.respondedAt, later.toISOString());

    const row = await testDb.eventParticipation.findUniqueOrThrow({
      where: { id: seededOffer.id },
    });
    assert.equal(row.availability, "Declined");
  });

  await check("another fighter gets 404, the same as a missing offer", async () => {
    const theirs = await respondToOffer(prospect, seededOffer.id, "Accepted", now);
    const missing = await respondToOffer(prospect, 999_999, "Accepted", now);

    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(theirs.error, missing.error);

    const row = await testDb.eventParticipation.findUniqueOrThrow({
      where: { id: seededOffer.id },
    });
    assert.equal(row.availability, "Declined");
  });

  await check("a member, a coach and an admin get 403", async () => {
    for (const session of [member, coach, admin]) {
      const result = await respondToOffer(session, seededOffer.id, "Accepted", now);
      assert.equal(result.status, 403, session.role);
    }
  });

  await check("a bad id or response is a 400", async () => {
    assert.equal((await respondToOffer(fighter, 0, "Accepted", now)).status, 400);
    for (const response of ["Maybe", "accepted", "Pending", null, undefined, 1]) {
      const result = await respondToOffer(fighter, seededOffer.id, response, now);
      assert.equal(result.status, 400, String(response));
    }
  });

  await check("after the event date, or once it is cancelled, the answer is locked: 409", async () => {
    const late = await respondToOffer(fighter, seededOffer.id, "Accepted", afterFightNight);
    assert.equal(late.ok, false);
    assert.equal(late.status, 409);

    const lost = await testDb.eventParticipation.create({
      data: { fighterId: fighter.id, eventId: cancelled.id },
    });
    assert.equal((await respondToOffer(fighter, lost.id, "Accepted", now)).status, 409);
    await testDb.eventParticipation.delete({ where: { id: lost.id } });

    const row = await testDb.eventParticipation.findUniqueOrThrow({
      where: { id: seededOffer.id },
    });
    assert.equal(row.availability, "Declined");
  });

  await check("listMyOffers groups offers by answer, then moves them to past", async () => {
    const before = await listMyOffers(fighter, now);
    assert.equal(before.status, 200);
    assert.equal(before.data?.fighter.weightClass, "Welterweight");
    assert.deepEqual(before.data?.declined.map((o) => o.id), [seededOffer.id]);
    assert.equal(before.data?.accepted.length, 0);
    assert.equal(before.data?.past.length, 0);
    // Showdown (20 days) before Regional (75 days): soonest first.
    assert.deepEqual(
      before.data?.pending.map((o) => o.eventName),
      [validEvent.name, "PFC Regional Championship"],
    );

    const after = await listMyOffers(fighter, daysFromNow(100));
    assert.equal(after.data?.pending.length, 0);
    assert.equal(after.data?.declined.length, 0);
    // Latest event first.
    assert.deepEqual(
      after.data?.past.map((o) => o.eventName),
      ["PFC Regional Championship", "PFC Fight Night", validEvent.name],
    );

    assert.equal((await listMyOffers(member, now)).status, 403);
    assert.equal((await listMyOffers(admin, now)).status, 403);
  });

  console.log("\nRECORD A RESULT");

  // Back to Accepted, which a result needs.
  assert.equal(
    (await respondToOffer(fighter, seededOffer.id, "Accepted", now)).status,
    200,
  );
  const base = { wins: 3, losses: 1, draws: 0 };

  await check("before the event date is a 409", async () => {
    const result = await recordResult(admin, seededOffer.id, "Win", null, now);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "The event has not happened yet.");
    assert.deepEqual(await record(), base);
  });

  await check("an offer that was not accepted is a 409", async () => {
    // Regional offer is still Pending; stand after its date.
    const result = await recordResult(admin, regionalOfferId, "Win", null, daysFromNow(100));
    assert.equal(result.status, 409);
    assert.deepEqual(await record(), base);
  });

  await check("a bad result or id is a 400, an unknown offer a 404", async () => {
    for (const result of ["Won", "win", undefined, 1, ""]) {
      const outcome = await recordResult(admin, seededOffer.id, result, null, afterFightNight);
      assert.equal(outcome.status, 400, String(result));
    }
    assert.equal(
      (await recordResult(admin, seededOffer.id, "Win", 5, afterFightNight)).status,
      400,
    );
    assert.equal((await recordResult(admin, -1, "Win", null, afterFightNight)).status, 400);
    assert.equal((await recordResult(admin, 999_999, "Win", null, afterFightNight)).status, 404);
    assert.deepEqual(await record(), base);
  });

  await check("Win adds one win; Win again adds nothing", async () => {
    const first = await recordResult(admin, seededOffer.id, "Win", " KO, round 2 ", afterFightNight);
    assert.equal(first.status, 200);
    assert.equal(first.data?.result, "Win");
    assert.equal(first.data?.resultNotes, "KO, round 2");
    assert.deepEqual(await record(), { ...base, wins: 4 });

    const second = await recordResult(admin, seededOffer.id, "Win", "KO, round 2", afterFightNight);
    assert.equal(second.status, 200);
    assert.deepEqual(await record(), { ...base, wins: 4 });

    assert.equal(await audited("result.record", seededOffer.id), 2);
  });

  await check("Win changed to Loss moves the counters", async () => {
    await recordResult(admin, seededOffer.id, "Loss", null, afterFightNight);
    assert.deepEqual(await record(), { ...base, losses: 2 });
  });

  await check("Loss changed to Draw moves them again", async () => {
    await recordResult(admin, seededOffer.id, "Draw", null, afterFightNight);
    assert.deepEqual(await record(), { ...base, draws: 1 });
  });

  await check("null clears the result and reverses it", async () => {
    const result = await recordResult(admin, seededOffer.id, null, null, afterFightNight);
    assert.equal(result.status, 200);
    assert.equal(result.data?.result, null);
    assert.deepEqual(await record(), base);

    // Clearing an already clear result changes nothing either.
    await recordResult(admin, seededOffer.id, null, null, afterFightNight);
    assert.deepEqual(await record(), base);
  });

  await check("NoContest changes no counter, in either direction", async () => {
    const result = await recordResult(admin, seededOffer.id, "NoContest", null, afterFightNight);
    assert.equal(result.data?.result, "NoContest");
    assert.deepEqual(await record(), base);

    await recordResult(admin, seededOffer.id, "Win", null, afterFightNight);
    assert.deepEqual(await record(), { ...base, wins: 4 });
    await recordResult(admin, seededOffer.id, "NoContest", null, afterFightNight);
    assert.deepEqual(await record(), base);
    await recordResult(admin, seededOffer.id, null, null, afterFightNight);
    assert.deepEqual(await record(), base);
  });

  await check("two admins recording Win at once add one win, not two", async () => {
    const results = await Promise.all([
      recordResult(admin, seededOffer.id, "Win", null, afterFightNight),
      recordResult(admin, seededOffer.id, "Win", null, afterFightNight),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.deepEqual(await record(), { ...base, wins: 4 });

    await recordResult(admin, seededOffer.id, null, null, afterFightNight);
    assert.deepEqual(await record(), base);
  });

  await check("a cancelled event takes no results", async () => {
    const lost = await testDb.eventParticipation.create({
      data: { fighterId: fighter.id, eventId: cancelled.id, availability: "Accepted" },
    });
    const result = await recordResult(admin, lost.id, "Win", null, afterFightNight);
    assert.equal(result.status, 409);
    assert.deepEqual(await record(), base);
    await testDb.eventParticipation.delete({ where: { id: lost.id } });
  });

  console.log("\nDEMOTE A FIGHTER");

  await check("a fighter with an offer cannot be demoted", async () => {
    const result = await demoteFighter(admin, fighter.id);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(await roleOf(fighter.id), "Fighter");
    assert.ok(await testDb.fighter.findUnique({ where: { fighterId: fighter.id } }));
    assert.ok(await testDb.eventParticipation.findUnique({ where: { id: seededOffer.id } }));
  });

  await check("a fighter with a document cannot be demoted", async () => {
    const document = await testDb.fighterDocument.create({
      data: {
        fighterId: prospect.id,
        type: "Medical",
        fileName: "medical.pdf",
        fileUrl: "https://abc123.public.blob.vercel-storage.com/medical.pdf",
      },
    });
    assert.equal((await demoteFighter(admin, prospect.id)).status, 409);
    assert.equal(await roleOf(prospect.id), "Fighter");
    await testDb.fighterDocument.delete({ where: { id: document.id } });
  });

  await check("a fighter with no history is demoted back to Member", async () => {
    const result = await demoteFighter(admin, prospect.id);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(await roleOf(prospect.id), "Member");
    assert.equal(await testDb.fighter.findUnique({ where: { fighterId: prospect.id } }), null);
    // The membership itself is untouched.
    assert.ok(await testDb.member.findUnique({ where: { membershipId: prospect.id } }));
    assert.equal(await audited("fighter.demote", prospect.id), 1);

    assert.equal((await demoteFighter(admin, prospect.id)).status, 404);
    assert.equal((await demoteFighter(admin, 999_999)).status, 404);
    assert.equal((await demoteFighter(admin, "abc")).status, 400);
  });

  await check("the audit log holds no credentials", async () => {
    const logs = await testDb.auditLog.findMany();
    assert.ok(logs.length > 0);
    for (const log of logs) {
      assert.doesNotMatch(JSON.stringify(log.detail ?? {}), /password|hash|salt|token/i);
    }
  });

  console.log("\nAPI ROUTES: PUBLIC");

  await check("GET /api/events returns only Scheduled future events, soonest first", async () => {
    await destroySession();

    const res = await eventsRoute();
    assert.equal(res.status, 200);
    const names = (await res.json()).data.map((e: { name: string }) => e.name);

    // Not the cancelled one, and not the past one (Completed above).
    assert.deepEqual(names, [
      validEvent.name,
      "PFC Fight Night",
      "PFC Regional Championship",
    ]);

    // A Scheduled event whose date has passed is left out as well.
    const stale = await testDb.competitionEvent.create({
      data: {
        name: "Stale Scheduled",
        eventDate: daysFromNow(-2),
        venue: "PFC Gym, main arena",
        description: "Scheduled, but its date has gone by.",
      },
    });
    const again = await (await eventsRoute()).json();
    assert.equal(again.data.length, 3);
    assert.ok(again.data.every((e: { status: string }) => e.status === "Scheduled"));
    assert.ok(
      again.data.every((e: { eventDate: string }) => new Date(e.eventDate) > now),
    );
    await testDb.competitionEvent.delete({ where: { id: stale.id } });

    assert.equal((await listPublicEvents(daysFromNow(50))).length, 1);
  });

  console.log("\nAPI ROUTES: FIGHTER");

  await check("fighter routes answer 401 with { error: { message } } when signed out", async () => {
    await destroySession();

    for (const res of [
      await myOffersRoute(),
      await respondRoute(
        jsonRequest("POST", { response: "Accepted" }),
        idParams(seededOffer.id),
      ),
    ]) {
      assert.equal(res.status, 401);
      assert.equal(typeof (await res.json()).error.message, "string");
    }
  });

  await check("GET /api/fighter/offers is 403 for a member and 200 for a fighter", async () => {
    await createSession(member);
    assert.equal((await myOffersRoute()).status, 403);

    await createSession(fighter);
    const res = await myOffersRoute();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.fighter.id, fighter.id);
    assert.deepEqual(
      body.data.accepted.map((o: { id: number }) => o.id),
      [seededOffer.id],
    );
    assert.equal(body.data.pending.length, 2);
  });

  await check("POST /api/fighter/offers/:id/respond validates, then saves", async () => {
    await createSession(fighter);

    const badJson = await respondRoute(jsonRequest("POST", "{not json"), idParams(seededOffer.id));
    assert.equal(badJson.status, 400);
    assert.equal(typeof (await badJson.json()).error.message, "string");

    for (const body of [[], "text", 5, {}, { response: "Maybe" }, { response: 1 }]) {
      const res = await respondRoute(jsonRequest("POST", body), idParams(seededOffer.id));
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(
      (await respondRoute(jsonRequest("POST", { response: "Declined" }), idParams("abc"))).status,
      400,
    );
    assert.equal(
      (await respondRoute(jsonRequest("POST", { response: "Declined" }), idParams(999_999))).status,
      404,
    );

    const ok = await respondRoute(
      jsonRequest("POST", { response: "Declined" }),
      idParams(seededOffer.id),
    );
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.availability, "Declined");

    await createSession(member);
    const forbidden = await respondRoute(
      jsonRequest("POST", { response: "Accepted" }),
      idParams(seededOffer.id),
    );
    assert.equal(forbidden.status, 403);
  });

  console.log("\nAPI ROUTES: ADMIN");

  const routeEvent = {
    name: "Route Made Rumble",
    venue: "Route Hall",
    description: "Created through the admin route by the tests.",
    eventDate: daysFromNow(15).toISOString(),
  };

  const adminCalls = (): Promise<Response>[] => [
    createEventRoute(jsonRequest("POST", routeEvent)),
    eventRoute(jsonRequest("PATCH", { venue: "Hijacked" }), idParams(regional.id)),
    eventRoute(jsonRequest("PATCH", { status: "Cancelled" }), idParams(regional.id)),
    offerRoute(jsonRequest("POST", { fighterId: fighter.id }), idParams(regional.id)),
    resultRoute(jsonRequest("PATCH", { result: "Win" }), idParams(seededOffer.id)),
    promoteRoute(jsonRequest("POST", { memberId: member.id, weightClass: "Lightweight" })),
    demoteRoute(jsonRequest("DELETE"), idParams(fighter.id)),
  ];

  await check("every admin route is 401 signed out and 403 for other roles", async () => {
    await destroySession();
    for (const res of await Promise.all(adminCalls())) {
      assert.equal(res.status, 401);
      assert.equal(typeof (await res.json()).error.message, "string");
    }

    for (const session of [member, fighter, coach]) {
      await createSession(session);
      for (const res of await Promise.all(adminCalls())) {
        assert.equal(res.status, 403, session.role);
        const body = await res.json();
        assert.equal(typeof body.error.message, "string");
        assert.equal(body.error.stack, undefined);
      }
    }

    assert.equal(await roleOf(member.id), "Member");
    assert.equal(await roleOf(fighter.id), "Fighter");
    const row = await testDb.competitionEvent.findUniqueOrThrow({ where: { id: regional.id } });
    assert.equal(row.status, "Scheduled");
    assert.equal(row.venue, "City Sports Centre");
  });

  await check("admin routes reject invalid JSON and non-object bodies with 400", async () => {
    await createSession(admin);

    for (const body of ["{not json", [], "text", 5, null]) {
      const responses = [
        await createEventRoute(jsonRequest("POST", body)),
        await eventRoute(jsonRequest("PATCH", body), idParams(regional.id)),
        await offerRoute(jsonRequest("POST", body), idParams(regional.id)),
        await resultRoute(jsonRequest("PATCH", body), idParams(seededOffer.id)),
        await promoteRoute(jsonRequest("POST", body)),
      ];
      for (const res of responses) {
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(typeof (await res.json()).error.message, "string");
      }
    }
  });

  await check("admin can create, edit, offer, promote, demote and cancel through the routes", async () => {
    await createSession(admin);

    const created = await createEventRoute(jsonRequest("POST", { ...routeEvent, imageUrl: null }));
    assert.equal(created.status, 201);
    const event = (await created.json()).data;
    assert.equal(event.name, routeEvent.name);
    assert.equal(event.eventDate, routeEvent.eventDate);

    const edited = await eventRoute(
      jsonRequest("PATCH", { venue: "Bigger Hall" }),
      idParams(event.id),
    );
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).data.venue, "Bigger Hall");

    assert.equal(
      (await eventRoute(jsonRequest("PATCH", { status: "Postponed" }), idParams(event.id))).status,
      400,
    );
    assert.equal(
      (
        await eventRoute(
          jsonRequest("PATCH", { status: "Cancelled", venue: "Elsewhere" }),
          idParams(event.id),
        )
      ).status,
      400,
    );
    assert.equal(
      (await eventRoute(jsonRequest("PATCH", { status: "Completed" }), idParams(event.id))).status,
      409,
    );
    assert.equal(
      (await eventRoute(jsonRequest("PATCH", { venue: "Nowhere" }), idParams("1e2"))).status,
      400,
    );

    const promoted = await promoteRoute(
      jsonRequest("POST", { memberId: prospectAccount.id, weightClass: "Lightweight" }),
    );
    assert.equal(promoted.status, 201);
    assert.equal((await promoted.json()).data.id, prospectAccount.id);

    const offered = await offerRoute(
      jsonRequest("POST", { fighterId: fighter.id, opponentName: null, boutNotes: "" }),
      idParams(event.id),
    );
    assert.equal(offered.status, 201);
    const offer = (await offered.json()).data;
    assert.equal(offer.opponentName, null);
    assert.equal(offer.boutNotes, null);

    const duplicate = await offerRoute(
      jsonRequest("POST", { fighterId: fighter.id }),
      idParams(event.id),
    );
    assert.equal(duplicate.status, 409);
    assert.equal(
      (await duplicate.json()).error.message,
      "That fighter already has an offer for this event.",
    );
    assert.equal(
      (await offerRoute(jsonRequest("POST", { fighterId: "x" }), idParams(event.id))).status,
      400,
    );

    const early = await resultRoute(jsonRequest("PATCH", { result: "Win" }), idParams(offer.id));
    assert.equal(early.status, 409);
    assert.equal((await early.json()).error.message, "The event has not happened yet.");
    assert.equal(
      (await resultRoute(jsonRequest("PATCH", { notes: "forgot the result" }), idParams(offer.id)))
        .status,
      400,
    );

    const demoted = await demoteRoute(jsonRequest("DELETE"), idParams(prospectAccount.id));
    assert.equal(demoted.status, 200);
    assert.equal(await roleOf(prospectAccount.id), "Member");
    assert.equal((await demoteRoute(jsonRequest("DELETE"), idParams(fighter.id))).status, 409);
    assert.equal((await demoteRoute(jsonRequest("DELETE"), idParams("abc"))).status, 400);

    const cancelledRes = await eventRoute(
      jsonRequest("PATCH", { status: "Cancelled" }),
      idParams(event.id),
    );
    assert.equal(cancelledRes.status, 200);
    assert.equal((await cancelledRes.json()).data.status, "Cancelled");
    // Cancelling kept the event and its offer.
    assert.ok(await testDb.eventParticipation.findUnique({ where: { id: offer.id } }));

    await destroySession();
  });

  await check("a past bout's result can be recorded through the route", async () => {
    // An accepted bout at an event that has genuinely happened.
    const fought = await testDb.eventParticipation.create({
      data: { fighterId: fighter.id, eventId: pastEvent.id, availability: "Accepted" },
    });

    await createSession(admin);
    const res = await resultRoute(
      jsonRequest("PATCH", { result: "Win", notes: "Unanimous decision" }),
      idParams(fought.id),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.result, "Win");
    assert.equal(body.data.resultNotes, "Unanimous decision");
    assert.deepEqual(await record(), { ...base, wins: 4 });

    const cleared = await resultRoute(jsonRequest("PATCH", { result: null }), idParams(fought.id));
    assert.equal(cleared.status, 200);
    assert.deepEqual(await record(), base);

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
