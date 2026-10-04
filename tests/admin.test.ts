/**
 * Admin and coach service tests, run against the seeded test database (see
 * tests/helpers/db.ts). Services take the session and the time as parameters,
 * so most checks call them directly. Live-role checks go through the cookie
 * jar that tests/support/register.cjs swaps in for `next/headers`.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { addDays, dayOfDate, gymDateAndTime, isoDate, nextOccurrence } from "../src/lib/dates";
import { getCoaches } from "../src/lib/repositories/coachesRepository";
import {
  createProgramme,
  deactivateProgramme,
  createSession as createClass,
  deactivateSession,
  deleteSession,
  listSessions,
  reactivateSession,
  updateProgramme,
  updateSession,
} from "../src/lib/services/classAdminService";
import {
  archiveCoach,
  createCoach,
  listCoaches,
  restoreCoach,
  updateCoach,
} from "../src/lib/services/coachAdminService";
import {
  coachStats,
  getMyClasses,
  getRoster,
  markAttendance,
  memberStats,
} from "../src/lib/services/coachService";
import { inviteService } from "../src/lib/services/inviteService";
import { listMyOffers } from "../src/lib/services/fighterService";
import { promoteToFighter, demoteFighter } from "../src/lib/services/fighterService";
import {
  deactivateUser,
  listMembers,
  reactivateUser,
  setMemberPlan,
} from "../src/lib/services/memberAdminService";
import {
  createPlan,
  deactivatePlan,
  listPlans,
  updatePlan,
} from "../src/lib/services/planAdminService";
import { listAuditLog } from "../src/lib/services/auditService";
import { createSession, destroySession, getSession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const row = await testDb.user.findUniqueOrThrow({ where: { email } });
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

async function newMember(email: string, planId: number | null = null) {
  const user = await testDb.user.create({
    data: {
      email,
      fullName: `Test ${email.split("@")[0]}`,
      role: "Member",
      passwordHash: "x",
      passwordSalt: "y",
      member: { create: { planId } },
    },
  });
  return user;
}

async function main() {
  await resetDatabase();
  const now = new Date();
  const today = gymDateAndTime(now).date;

  const admin = await sessionFor("admin@pfc.co.za");
  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const sofia = await sessionFor("sofia@pfc.co.za");
  const marcus = await sessionFor("marcus@pfc.co.za");

  const audited = (action: string, entityId?: number) =>
    testDb.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });

  const classInput = {
    name: "Test Sparring",
    kind: "Group",
    coachId: sofia.id,
    day: "sat",
    startsAt: "05:00",
    durationMinutes: 60,
    capacity: 10,
  };

  console.log("\nAUTHORISATION: NON-ADMINS GET 403");

  await check("every admin function refuses a member, fighter and coach", async () => {
    for (const s of [member, fighter, sofia]) {
      const results = await Promise.all([
        listSessions(s),
        createClass(s, classInput),
        updateSession(s, 1, { capacity: 5 }),
        deactivateSession(s, 1, {}),
        reactivateSession(s, 1),
        deleteSession(s, 1),
        createProgramme(s, { name: "Zumba", description: "Dance fitness class", level: "All levels", durationMinutes: 45 }),
        updateProgramme(s, 1, { level: "Beginner" }),
        deactivateProgramme(s, 1),
        listCoaches(s),
        createCoach(s, { fullName: "Eve Coach", email: "eve@example.co.za", title: "Boxing", bio: "A long enough biography." }),
        updateCoach(s, sofia.id, { title: "Hijacked" }),
        archiveCoach(s, sofia.id),
        restoreCoach(s, sofia.id),
        listMembers(s, {}),
        setMemberPlan(s, member.id, null),
        deactivateUser(s, member.id),
        reactivateUser(s, member.id),
        listPlans(s),
        createPlan(s, { pricePerMonth: 500, features: ["Gym access"], isMostPopular: false }),
        updatePlan(s, 1, { pricePerMonth: 1 }),
        deactivatePlan(s, 1),
        listAuditLog(s),
      ]);
      for (const r of results) {
        assert.equal(r.ok, false, s.role);
        assert.equal(r.status, 403, s.role);
      }
    }
    assert.equal(await testDb.user.count({ where: { isActive: false } }), 0);
    assert.equal(await testDb.coach.count({ where: { isActive: false } }), 0);
  });

  await check("a member gets 403 from coach functions; admin and coach are let in", async () => {
    assert.equal((await getMyClasses(member, now)).status, 403);
    assert.equal((await coachStats(member, now)).status, 403);
    assert.equal((await markAttendance(member, 1, "Completed", now)).status, 403);
    assert.equal((await getRoster(fighter, 1, isoDate(today), now)).status, 403);
    assert.equal((await getMyClasses(sofia, now)).ok, true);
    assert.equal((await getMyClasses(admin, now)).ok, true);
  });

  console.log("\nCLASS SCHEDULING");

  let classId = 0;

  await check("creates a class and audits it", async () => {
    const r = await createClass(admin, { ...classInput, name: "  Test Sparring " });
    assert.equal(r.status, 201, r.error);
    assert.equal(r.data?.name, "Test Sparring");
    assert.equal(r.data?.coachName, sofia.fullName);
    assert.equal(r.data?.programmeId, null);
    classId = r.data!.id;
    assert.equal(await audited("class.create", classId), 1);
  });

  await check("a same coach, day and time clash is a 409 with the stated message", async () => {
    const r = await createClass(admin, classInput);
    assert.equal(r.status, 409);
    assert.equal(r.error, "That coach already teaches a class at that time.");
  });

  await check("two admins adding the same slot at once: one 201, one 409", async () => {
    const input = { ...classInput, startsAt: "05:15" };
    const results = await Promise.all([createClass(admin, input), createClass(admin, input)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await testDb.gymClass.count({ where: { coachId: sofia.id, startsAt: "05:15" } }), 1);
  });

  await check("bad class fields are a 400 naming the field", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "x" }, "name"],
      [{ name: 7 }, "name"],
      [{ kind: "Yoga" }, "kind"],
      [{ coachId: "3" }, "coachId"],
      [{ day: "monday" }, "day"],
      [{ startsAt: "24:00" }, "startsAt"],
      [{ startsAt: "6:30" }, "startsAt"],
      [{ durationMinutes: 14 }, "durationMinutes"],
      [{ durationMinutes: 241 }, "durationMinutes"],
      [{ durationMinutes: 60.5 }, "durationMinutes"],
      [{ capacity: 0 }, "capacity"],
      [{ capacity: 201 }, "capacity"],
      [{ capacity: NaN }, "capacity"],
      [{ programmeId: "abc" }, "programmeId"],
    ];
    for (const [override, field] of cases) {
      const r = await createClass(admin, { ...classInput, startsAt: "05:30", ...override });
      assert.equal(r.status, 400, JSON.stringify(override));
      assert.equal(r.field, field, JSON.stringify(override));
    }
    assert.equal((await createClass(admin, "text")).status, 400);
    assert.equal((await createClass(admin, null)).status, 400);
    assert.equal((await createClass(admin, [])).status, 400);
  });

  await check("an unknown, or archived, coach and an unknown programme are 404", async () => {
    assert.equal((await createClass(admin, { ...classInput, startsAt: "05:30", coachId: 999_999 })).status, 404);
    assert.equal((await createClass(admin, { ...classInput, startsAt: "05:30", coachId: admin.id })).status, 404);
    assert.equal((await createClass(admin, { ...classInput, startsAt: "05:30", programmeId: 999_999 })).status, 404);
  });

  // Bookings on this class's next session, from filler members.
  const fillers = await testDb.user.findMany({
    where: { email: { startsWith: "filler" } },
    orderBy: { id: "asc" },
    take: 6,
  });
  const next = nextOccurrence("sat", "05:00", now);
  await testDb.booking.createMany({
    data: fillers.slice(0, 4).map((f) => ({
      memberId: f.id,
      gymClassId: classId,
      sessionDate: next,
      status: "Confirmed" as const,
    })),
  });

  await check("capacity cannot drop below the confirmed bookings for the next session", async () => {
    const r = await updateSession(admin, classId, { capacity: 3 }, now);
    assert.equal(r.status, 409);
    assert.match(String(r.error), /4 already booked/);
    assert.equal((await testDb.gymClass.findUniqueOrThrow({ where: { id: classId } })).capacity, 10);

    const ok = await updateSession(admin, classId, { capacity: 4 }, now);
    assert.equal(ok.status, 200);
    assert.equal(ok.data?.capacity, 4);
    assert.equal(ok.data?.booked, 4);
  });

  await check("day or time cannot change while future bookings exist", async () => {
    for (const patch of [{ day: "sun" }, { startsAt: "06:00" }]) {
      const r = await updateSession(admin, classId, patch, now);
      assert.equal(r.status, 409, JSON.stringify(patch));
      assert.match(String(r.error), /Deactivate it and create a new class/);
    }
    const row = await testDb.gymClass.findUniqueOrThrow({ where: { id: classId } });
    assert.equal(row.day, "sat");
    assert.equal(row.startsAt, "05:00");
    // A change that is not a move is still fine.
    assert.equal((await updateSession(admin, classId, { name: "Renamed Sparring" }, now)).status, 200);
  });

  await check("update validates, 404s and refuses an empty patch", async () => {
    assert.equal((await updateSession(admin, classId, {}, now)).status, 400);
    assert.equal((await updateSession(admin, classId, { capacity: -1 }, now)).status, 400);
    assert.equal((await updateSession(admin, 999_999, { capacity: 5 }, now)).status, 404);
    assert.equal((await updateSession(admin, "x", { capacity: 5 }, now)).status, 400);
  });

  await check("delete is refused once the class has had a booking", async () => {
    const r = await deleteSession(admin, classId);
    assert.equal(r.status, 409);
    assert.equal(r.error, "This class has bookings. Deactivate it instead.");
    assert.ok(await testDb.gymClass.findUnique({ where: { id: classId } }));
  });

  await check("deactivating with future bookings needs cancelBookings, then cancels them", async () => {
    const refused = await deactivateSession(admin, classId, { cancelBookings: false }, now);
    assert.equal(refused.status, 409);
    assert.match(String(refused.error), /4 future bookings/);
    assert.equal((await testDb.gymClass.findUniqueOrThrow({ where: { id: classId } })).isActive, true);

    assert.equal((await deactivateSession(admin, classId, { cancelBookings: "yes" }, now)).status, 400);

    const done = await deactivateSession(admin, classId, { cancelBookings: true }, now);
    assert.equal(done.status, 200, done.error);
    assert.equal(done.data?.cancelledBookings, 4);
    assert.equal(await testDb.booking.count({ where: { gymClassId: classId, status: "Cancelled" } }), 4);
    assert.equal(await testDb.booking.count({ where: { gymClassId: classId, status: "Confirmed" } }), 0);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "class.deactivate", entityId: classId },
    });
    assert.deepEqual(log.detail, { cancelledBookings: 4 });

    assert.equal((await deactivateSession(admin, classId, {}, now)).status, 409);
  });

  await check("a deactivated class can be reactivated", async () => {
    assert.equal((await reactivateSession(admin, classId)).status, 200);
    assert.equal((await reactivateSession(admin, classId)).status, 409);
    assert.equal((await reactivateSession(admin, 999_999)).status, 404);
  });

  await check("a class that never had a booking can be deleted", async () => {
    const made = await createClass(admin, { ...classInput, startsAt: "05:45" });
    const r = await deleteSession(admin, made.data!.id);
    assert.equal(r.status, 200);
    assert.equal(await testDb.gymClass.findUnique({ where: { id: made.data!.id } }), null);
    assert.equal(await audited("class.delete", made.data!.id), 1);
    assert.equal((await deleteSession(admin, made.data!.id)).status, 404);
  });

  await check("listSessions includes inactive classes with their booked figures", async () => {
    const r = await listSessions(admin, now);
    assert.equal(r.status, 200);
    const row = r.data!.find((c) => c.id === classId)!;
    assert.equal(row.hasBookings, true);
    assert.equal(row.booked, 0);
    assert.ok(r.data!.length >= 21);
  });

  console.log("\nPROGRAMMES");

  const programme = { name: "Boxing", description: "A programme description here.", level: "All levels", durationMinutes: 60 };

  await check("the slug is generated from the name and made unique with -2, -3", async () => {
    const a = await createProgramme(admin, programme);
    const b = await createProgramme(admin, programme);
    assert.equal(a.data?.slug, "boxing-2");
    assert.equal(b.data?.slug, "boxing-3");

    const c = await createProgramme(admin, { ...programme, name: "Zumba & Fun!!", slug: "hacked" });
    assert.equal(c.data?.slug, "zumba-fun");
    const d = await createProgramme(admin, { ...programme, name: "🥊🥊" });
    assert.match(String(d.data?.slug), /^programme(-\d+)?$/);
    for (const r of [a, b, c, d]) assert.match(String(r.data?.slug), /^[a-z0-9-]+$/);
  });

  await check("updating keeps the slug; deactivating hides it from the catalogue", async () => {
    const row = await testDb.classProgramme.findFirstOrThrow({ where: { slug: "boxing-2" } });
    const u = await updateProgramme(admin, row.id, { name: "Boxing Advanced", slug: "x" });
    assert.equal(u.data?.name, "Boxing Advanced");
    assert.equal(u.data?.slug, "boxing-2");
    assert.equal((await updateProgramme(admin, 999_999, { level: "Beginner" })).status, 404);
    assert.equal((await updateProgramme(admin, row.id, {})).status, 400);

    assert.equal((await deactivateProgramme(admin, row.id)).status, 200);
    assert.equal((await deactivateProgramme(admin, row.id)).status, 409);
    assert.equal((await deactivateProgramme(admin, 999_999)).status, 404);
  });

  console.log("\nCOACHES");

  const coachInput = {
    fullName: "  Eve Newcoach ",
    email: "  Eve.Newcoach@Example.CO.ZA ",
    title: "Kickboxing",
    bio: "A long enough biography for the test.",
    imageUrl: "",
  };

  let newCoachId = 0;

  await check("createCoach makes User + Coach, lowercases the email and calls the invite", async () => {
    const calls: number[] = [];
    const original = inviteService.sendCoachInvite;
    inviteService.sendCoachInvite = async (id: number) => {
      calls.push(id);
    };
    try {
      const r = await createCoach(admin, coachInput);
      assert.equal(r.status, 201, r.error);
      assert.equal(r.data?.email, "eve.newcoach@example.co.za");
      assert.equal(r.data?.name, "Eve Newcoach");
      assert.equal(r.data?.imageUrl, null);
      newCoachId = r.data!.id;
      assert.deepEqual(calls, [newCoachId]);

      const user = await testDb.user.findUniqueOrThrow({ where: { id: newCoachId } });
      assert.equal(user.role, "Coach");
      assert.ok(user.passwordHash.length > 0);
      assert.equal(await audited("coach.create", newCoachId), 1);
      assert.doesNotMatch(JSON.stringify(r), /passwordHash|passwordSalt/);
    } finally {
      inviteService.sendCoachInvite = original;
    }
  });

  await check("a failing invite does not undo the account", async () => {
    const original = inviteService.sendCoachInvite;
    inviteService.sendCoachInvite = async () => {
      throw new Error("mail down");
    };
    try {
      const r = await createCoach(admin, { ...coachInput, email: "second.coach@example.co.za" });
      assert.equal(r.status, 201);
    } finally {
      inviteService.sendCoachInvite = original;
    }
  });

  await check("a duplicate email, in any case, is a 409 on the email field", async () => {
    const r = await createCoach(admin, { ...coachInput, email: "EVE.NEWCOACH@example.co.za" });
    assert.equal(r.status, 409);
    assert.equal(r.field, "email");
    const clash = await createCoach(admin, { ...coachInput, email: "sofia@pfc.co.za" });
    assert.equal(clash.status, 409);
  });

  await check("bad coach fields are a 400; an http image is refused", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ fullName: "E" }, "fullName"],
      [{ email: "nope" }, "email"],
      [{ title: "" }, "title"],
      [{ bio: "short" }, "bio"],
      [{ imageUrl: "http://example.co.za/a.jpg" }, "imageUrl"],
      [{ imageUrl: 5 }, "imageUrl"],
      // https, but not the public Blob store: it would save and then show the monogram
      [{ imageUrl: "https://example.co.za/a.jpg" }, "imageUrl"],
      [{ imageUrl: "https://public.blob.vercel-storage.com.evil.example/a.jpg" }, "imageUrl"],
      [{ imageUrl: "javascript:alert(1)" }, "imageUrl"],
      [{ imageUrl: ["https://abc.public.blob.vercel-storage.com/a.jpg"] }, "imageUrl"],
    ];
    for (const [override, field] of cases) {
      const r = await createCoach(admin, { ...coachInput, email: "third@example.co.za", ...override });
      assert.equal(r.status, 400, JSON.stringify(override));
      assert.equal(r.field, field);
    }
  });

  await check("updateCoach changes the profile and the name, and rejects a taken email", async () => {
    const r = await updateCoach(admin, newCoachId, { title: "Kickboxing lead", imageUrl: "https://example.co.za/eve.jpg" });
    assert.equal(r.status, 400, "a link that is not on the public Blob store is refused");
    assert.equal(r.field, "imageUrl");
    const blob = "https://abc123.public.blob.vercel-storage.com/images/eve.jpg";
    const saved = await updateCoach(admin, newCoachId, { title: "Kickboxing lead", imageUrl: blob });
    assert.equal(saved.status, 200, saved.error);
    assert.equal(saved.data?.imageUrl, blob);
    assert.equal(saved.data?.title, "Kickboxing lead");
    assert.equal((await updateCoach(admin, newCoachId, { imageUrl: null })).data?.imageUrl, null);
    assert.equal((await updateCoach(admin, newCoachId, { email: "sofia@pfc.co.za" })).status, 409);
    assert.equal((await updateCoach(admin, 999_999, { title: "Nobody" })).status, 404);
    assert.equal((await updateCoach(admin, newCoachId, {})).status, 400);
  });

  await check("archiving a coach with active classes is a 409 that says how many", async () => {
    const r = await archiveCoach(admin, sofia.id);
    assert.equal(r.status, 409);
    assert.match(String(r.error), /still teaches \d+ active classes/);
    assert.equal((await testDb.coach.findUniqueOrThrow({ where: { coachId: sofia.id } })).isActive, true);
  });

  await check("archive hides a coach publicly, keeps history, and restore brings them back", async () => {
    assert.equal((await archiveCoach(admin, newCoachId)).status, 200);
    assert.equal((await archiveCoach(admin, newCoachId)).status, 409);
    assert.ok(!(await getCoaches()).some((c) => c.id === newCoachId));
    assert.ok((await listCoaches(admin)).data!.some((c) => c.id === newCoachId && !c.isActive));
    assert.ok(await testDb.user.findUnique({ where: { id: newCoachId } }));

    const cls = await createClass(admin, { ...classInput, startsAt: "07:00", coachId: newCoachId });
    assert.equal(cls.status, 404, "an archived coach cannot be given a class");

    assert.equal((await restoreCoach(admin, newCoachId)).status, 200);
    assert.equal((await restoreCoach(admin, newCoachId)).status, 409);
    assert.ok((await getCoaches()).some((c) => c.id === newCoachId));
  });

  console.log("\nMEMBERS AND PLANS");

  await check("listMembers searches case-insensitively, pages by 25 and leaks no credentials", async () => {
    const found = await listMembers(admin, { search: "  JOHN WICK " });
    assert.equal(found.data?.total, 1);
    assert.equal(found.data?.items[0].email, "member@pfc.co.za");
    assert.equal((await listMembers(admin, { search: "PFC.CO.ZA" })).data!.total >= 9, true);

    const page1 = await listMembers(admin, { page: 1 });
    const page2 = await listMembers(admin, { page: 2 });
    assert.equal(page1.data?.items.length, 25);
    assert.ok(page2.data!.items.length > 0);
    assert.equal(page1.data?.pageCount, 2);
    assert.ok(page1.data!.total > 25);

    for (const item of [...page1.data!.items, ...page2.data!.items]) {
      assert.deepEqual(Object.keys(item).sort(), ["email", "fullName", "id", "isActive", "planId", "role"]);
    }
    assert.doesNotMatch(JSON.stringify(page1), /passwordHash|passwordSalt/);

    // A search that is SQL-shaped is only ever data.
    assert.equal((await listMembers(admin, { search: "'; DROP TABLE \"User\"; --" })).data?.total, 0);
    assert.ok(await testDb.user.count() > 0);
  });

  await check("listMembers rejects a bad search or page", async () => {
    for (const q of [{ search: 5 }, { search: "x".repeat(101) }, { page: 0 }, { page: 1.5 }, { page: "2" }, { page: NaN }, "text", null]) {
      assert.equal((await listMembers(admin, q)).status, 400, JSON.stringify(q));
    }
  });

  const plans = await testDb.membershipPlan.findMany({ orderBy: { id: "asc" } });

  await check("setMemberPlan moves a member, clears a plan, and refuses retired or unknown ones", async () => {
    assert.equal((await setMemberPlan(admin, member.id, plans[2].id, now)).status, 200);
    assert.equal((await testDb.member.findUniqueOrThrow({ where: { membershipId: member.id } })).planId, plans[2].id);
    assert.equal(await audited("member.setPlan", member.id), 1);
    assert.equal((await setMemberPlan(admin, member.id, null, now)).status, 200);
    assert.equal((await setMemberPlan(admin, member.id, 999_999, now)).status, 404);
    assert.equal((await setMemberPlan(admin, admin.id, plans[0].id, now)).status, 404);
    assert.equal((await setMemberPlan(admin, member.id, "2", now)).status, 400);
    assert.equal((await setMemberPlan(admin, member.id, 1.5, now)).status, 400);
    await setMemberPlan(admin, member.id, plans[1].id, now);
  });

  await check("a plan is created with validated, de-duplicated features", async () => {
    const r = await createPlan(admin, {
      pricePerMonth: 600,
      features: ["  Gym access ", "gym access", "Showers"],
      isMostPopular: false,
    });
    assert.equal(r.status, 201, r.error);
    assert.deepEqual(r.data?.features, ["Gym access", "Showers"]);

    const bad: [Record<string, unknown>, string][] = [
      [{ pricePerMonth: -1 }, "pricePerMonth"],
      [{ pricePerMonth: 100_001 }, "pricePerMonth"],
      [{ pricePerMonth: 99.5 }, "pricePerMonth"],
      [{ pricePerMonth: NaN }, "pricePerMonth"],
      [{ pricePerMonth: "600" }, "pricePerMonth"],
      [{ features: [] }, "features"],
      [{ features: "Gym access" }, "features"],
      [{ features: ["a"] }, "features"],
      [{ features: ["x".repeat(81)] }, "features"],
      [{ features: Array.from({ length: 11 }, (_, i) => `Feature number ${i}`) }, "features"],
      [{ features: [5] }, "features"],
      [{ isMostPopular: "yes" }, "isMostPopular"],
    ];
    for (const [override, field] of bad) {
      const x = await createPlan(admin, { pricePerMonth: 600, features: ["Gym access"], isMostPopular: false, ...override });
      assert.equal(x.status, 400, JSON.stringify(override));
      assert.equal(x.field, field);
    }
    assert.equal((await createPlan(admin, { pricePerMonth: 0, features: ["Free trial"] })).status, 201);
  });

  await check("only one plan is most popular, whichever way it is set", async () => {
    const created = await createPlan(admin, { pricePerMonth: 1500, features: ["Everything"], isMostPopular: true });
    let popular = (await listPlans(admin)).data!.filter((p) => p.isMostPopular);
    assert.deepEqual(popular.map((p) => p.id), [created.data!.id]);

    const u = await updatePlan(admin, plans[0].id, { isMostPopular: true });
    assert.equal(u.status, 200);
    popular = (await listPlans(admin)).data!.filter((p) => p.isMostPopular);
    assert.deepEqual(popular.map((p) => p.id), [plans[0].id]);

    const results = await Promise.all([
      updatePlan(admin, plans[1].id, { isMostPopular: true }),
      updatePlan(admin, plans[2].id, { isMostPopular: true }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal((await listPlans(admin)).data!.filter((p) => p.isMostPopular).length, 1);

    assert.equal((await updatePlan(admin, 999_999, { pricePerMonth: 5 })).status, 404);
    assert.equal((await updatePlan(admin, plans[0].id, {})).status, 400);
  });

  await check("a plan with active members cannot be deactivated; an empty one can", async () => {
    const busy = await deactivatePlan(admin, plans[1].id);
    assert.equal(busy.status, 409);
    assert.match(String(busy.error), /active members? (is|are) on this plan/);

    const empty = await createPlan(admin, { pricePerMonth: 123, features: ["Day pass"], isMostPopular: true });
    assert.equal((await deactivatePlan(admin, empty.data!.id)).status, 200);
    assert.equal((await deactivatePlan(admin, empty.data!.id)).status, 409);
    assert.equal((await setMemberPlan(admin, member.id, empty.data!.id, now)).status, 404, "retired plan cannot be joined");
    assert.equal((await deactivatePlan(admin, 999_999)).status, 404);
  });

  console.log("\nDEACTIVATING USERS");

  await check("an admin cannot deactivate themselves", async () => {
    const r = await deactivateUser(admin, admin.id, now);
    assert.equal(r.status, 409);
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive, true);
  });

  await check("the last active admin cannot be deactivated", async () => {
    const second = await testDb.user.create({
      data: { email: "admin2@pfc.co.za", fullName: "Second Admin", role: "Admin", passwordHash: "x", passwordSalt: "y", admin: { create: {} } },
    });
    const adminTwo: SessionUser = { id: second.id, email: second.email, fullName: second.fullName, role: "Admin" };

    assert.equal((await deactivateUser(admin, second.id, now)).status, 200);
    // `adminTwo` is now deactivated and is the target's only peer: admin is last.
    const r = await deactivateUser(adminTwo, admin.id, now);
    assert.equal(r.status, 409);
    assert.match(String(r.error), /last active administrator/);
    assert.equal((await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive, true);

    assert.equal((await reactivateUser(admin, second.id)).status, 200);
    assert.equal((await reactivateUser(admin, second.id)).status, 409);
  });

  await check("the last two admins deactivating each other at once: one succeeds, one clean 409", async () => {
    const two = await testDb.user.findUniqueOrThrow({ where: { email: "admin2@pfc.co.za" } });
    const adminTwo: SessionUser = { id: two.id, email: two.email, fullName: two.fullName, role: "Admin" };

    const results = await Promise.all([
      deactivateUser(admin, adminTwo.id, now),
      deactivateUser(adminTwo, admin.id, now),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results));
    assert.equal(await testDb.user.count({ where: { role: "Admin", isActive: true } }), 1);

    // Put both back for the rest of the tests.
    await testDb.user.updateMany({ where: { role: "Admin" }, data: { isActive: true } });
  });

  await check("deactivating the same user twice at once: one 200, one 409", async () => {
    const target = await newMember("twice@example.co.za");
    const results = await Promise.all([
      deactivateUser(admin, target.id, now),
      deactivateUser(admin, target.id, now),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await audited("user.deactivate", target.id), 1);
  });

  await check("deactivating cancels future bookings in the same step; reactivating restores sign-in", async () => {
    const target = await newMember("leaver@example.co.za", plans[0].id);
    const future = nextOccurrence("sat", "05:00", now);
    const past = addDays(today, -3);
    await testDb.booking.createMany({
      data: [
        { memberId: target.id, gymClassId: classId, sessionDate: future, status: "Confirmed" },
        { memberId: target.id, gymClassId: classId, sessionDate: past, status: "Confirmed" },
      ],
    });

    const r = await deactivateUser(admin, target.id, now);
    assert.equal(r.status, 200);
    assert.equal(r.data?.cancelledBookings, 1);

    const rows = await testDb.booking.findMany({ where: { memberId: target.id }, orderBy: { sessionDate: "asc" } });
    assert.deepEqual(rows.map((b) => b.status), ["Confirmed", "Cancelled"], "past booking is untouched");
    assert.ok(rows[1].cancelledAt);

    assert.equal((await deactivateUser(admin, 999_999, now)).status, 404);
    assert.equal((await deactivateUser(admin, "x", now)).status, 400);
    assert.equal((await reactivateUser(admin, target.id)).status, 200);
  });

  console.log("\nLIVE ROLE AND ACTIVE STATE THROUGH THE SERVICES");

  await check("a deactivated user's cookie stops working at once", async () => {
    const target = await newMember("cookie@example.co.za");
    const asTarget: SessionUser = { id: target.id, email: target.email, fullName: target.fullName, role: "Member" };

    await createSession(asTarget);
    assert.ok(await getSession());
    assert.equal((await deactivateUser(admin, target.id, now)).status, 200);
    assert.equal(await getSession(), null);
    await reactivateUser(admin, target.id);
    assert.ok(await getSession());
    await destroySession();
  });

  await check("a promoted member sees the fighter dashboard without signing in again", async () => {
    const target = await newMember("riser@example.co.za", plans[0].id);
    // The cookie is issued while the account is still a Member.
    await createSession({ id: target.id, email: target.email, fullName: target.fullName, role: "Member" });

    const before = (await getSession())!;
    assert.equal(before.role, "Member");
    assert.equal((await listMyOffers(before, now)).status, 403);

    assert.equal((await promoteToFighter(admin, target.id, "Lightweight")).status, 201);

    const after = (await getSession())!;
    assert.equal(after.role, "Fighter", "same cookie, new role");
    assert.equal((await listMyOffers(after, now)).status, 200);
  });

  await check("a demoted fighter is refused fighter-only actions immediately", async () => {
    const target = await testDb.user.findUniqueOrThrow({ where: { email: "riser@example.co.za" } });
    // The cookie still says Fighter, as it would after the earlier sign-in.
    await createSession({ id: target.id, email: target.email, fullName: target.fullName, role: "Fighter" });
    assert.equal((await listMyOffers((await getSession())!, now)).status, 200);

    assert.equal((await demoteFighter(admin, target.id)).status, 200);

    const session = (await getSession())!;
    assert.equal(session.role, "Member");
    assert.equal((await listMyOffers(session, now)).status, 403);
    await destroySession();
  });

  console.log("\nCOACH ATTENDANCE");

  const sofiaClass = await testDb.gymClass.findFirstOrThrow({ where: { coachId: sofia.id, day: "tue", startsAt: "09:30" } });
  const marcusClass = await testDb.gymClass.findFirstOrThrow({ where: { coachId: marcus.id, day: "tue", startsAt: "18:00" } });
  // A Tuesday before today: both classes meet on Tuesdays, and a roster date
  // must fall on the class's weekday. (The real clock decides what "today" is.)
  let pastTuesday = addDays(today, -1);
  while (dayOfDate(pastTuesday) !== "tue") pastTuesday = addDays(pastTuesday, -1);

  const pastBooking = await testDb.booking.create({
    data: { memberId: fillers[4].id, gymClassId: sofiaClass.id, sessionDate: pastTuesday, status: "Confirmed" },
  });
  const pastBooking2 = await testDb.booking.create({
    data: { memberId: fillers[5].id, gymClassId: sofiaClass.id, sessionDate: pastTuesday, status: "Confirmed" },
  });
  const cancelled = await testDb.booking.create({
    data: { memberId: fillers[3].id, gymClassId: sofiaClass.id, sessionDate: pastTuesday, status: "Cancelled" },
  });
  const futureBooking = await testDb.booking.create({
    data: { memberId: fillers[4].id, gymClassId: sofiaClass.id, sessionDate: addDays(today, 3), status: "Confirmed" },
  });
  const marcusBooking = await testDb.booking.create({
    data: { memberId: fillers[4].id, gymClassId: marcusClass.id, sessionDate: pastTuesday, status: "Confirmed" },
  });

  await check("coachStats is null with no attendance recorded", async () => {
    const r = await coachStats(sofia, now);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { attended: 0, noShow: 0, rate: null });
  });

  await check("a coach sees only their own classes; an admin sees all", async () => {
    const mine = (await getMyClasses(sofia, now)).data!;
    assert.ok(mine.length > 0);
    assert.ok(mine.every((c) => c.coachId === sofia.id));
    assert.ok(mine.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.rosterDate)));
    const all = (await getMyClasses(admin, now)).data!;
    assert.ok(all.some((c) => c.coachId === marcus.id) && all.some((c) => c.coachId === sofia.id));
  });

  await check("a coach asking for someone else's roster gets 404, never 403", async () => {
    const theirs = await getRoster(sofia, marcusClass.id, isoDate(pastTuesday), now);
    const missing = await getRoster(sofia, 999_999, isoDate(pastTuesday), now);
    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(theirs.error, missing.error);
  });

  await check("the roster names members and statuses and says whether marking is open", async () => {
    const r = await getRoster(sofia, sofiaClass.id, isoDate(pastTuesday), now);
    assert.equal(r.status, 200);
    assert.equal(r.data?.canMark, true);
    const names = r.data!.entries.map((e) => e.memberName);
    assert.deepEqual(names, [...names].sort());
    assert.ok(r.data!.entries.some((e) => e.bookingId === cancelled.id && e.status === "Cancelled"));

    // The class meets on Tuesdays; two weeks after a past Tuesday is always in the future.
    const future = await getRoster(sofia, sofiaClass.id, isoDate(addDays(pastTuesday, 14)), now);
    assert.equal(future.status, 200);
    assert.equal(future.data?.canMark, false);
    assert.equal((await getRoster(admin, marcusClass.id, isoDate(pastTuesday), now)).status, 200);

    for (const bad of ["2026-02-30", "tomorrow", "", null, 5]) {
      assert.equal((await getRoster(sofia, sofiaClass.id, bad, now)).status, 400, String(bad));
    }
    assert.equal((await getRoster(sofia, "x", isoDate(pastTuesday), now)).status, 400);
  });

  await check("a roster date that is not the class's weekday is a 400 on the date", async () => {
    // sofiaClass meets on Tuesdays; every other weekday around pastTuesday is wrong.
    for (const offset of [1, 2, 3, 4, 5, 6]) {
      const date = isoDate(addDays(pastTuesday, offset));
      for (const who of [sofia, admin]) {
        const r = await getRoster(who, sofiaClass.id, date, now);
        assert.equal(r.status, 400, `${date} for ${who.role}`);
        assert.equal(r.field, "date");
        assert.match(r.error ?? "", /meets on Tuesdays/);
      }
    }
    // Ownership is checked first, so a wrong date cannot be used to probe ids.
    const probe = await getRoster(sofia, marcusClass.id, isoDate(addDays(pastTuesday, 1)), now);
    assert.equal(probe.status, 404);
    assert.equal((await getRoster(sofia, 999_999, isoDate(addDays(pastTuesday, 1)), now)).status, 404);
    assert.equal((await getRoster(sofia, sofiaClass.id, isoDate(addDays(pastTuesday, 14)), now)).status, 200);
    assert.equal((await getRoster(sofia, sofiaClass.id, isoDate(addDays(pastTuesday, -7)), now)).status, 200);
  });

  await check("a coach cannot mark another coach's booking: 404", async () => {
    const r = await markAttendance(sofia, marcusBooking.id, "Completed", now);
    assert.equal(r.status, 404);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: marcusBooking.id } })).status, "Confirmed");
    assert.equal((await markAttendance(sofia, 999_999, "Completed", now)).status, 404);
    // An admin may.
    assert.equal((await markAttendance(admin, marcusBooking.id, "Completed", now)).status, 200);
  });

  await check("marking a future class is a 409 with the stated message", async () => {
    const r = await markAttendance(sofia, futureBooking.id, "Completed", now);
    assert.equal(r.status, 409);
    assert.equal(r.error, "That class has not happened yet.");
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: futureBooking.id } })).status, "Confirmed");
  });

  await check("a cancelled or failed booking cannot be marked", async () => {
    const r = await markAttendance(sofia, cancelled.id, "NoShow", now);
    assert.equal(r.status, 409);
    const failed = await testDb.booking.create({
      data: { memberId: fillers[2].id, gymClassId: sofiaClass.id, sessionDate: pastTuesday, status: "Failed" },
    });
    assert.equal((await markAttendance(sofia, failed.id, "Completed", now)).status, 409);
  });

  await check("bad ids and statuses are a 400", async () => {
    for (const status of ["Confirmed", "completed", "", null, undefined, 1]) {
      assert.equal((await markAttendance(sofia, pastBooking.id, status, now)).status, 400, String(status));
    }
    assert.equal((await markAttendance(sofia, 0, "Completed", now)).status, 400);
    assert.equal((await markAttendance(sofia, "1", "Completed", now)).status, 400);
  });

  await check("Completed sets completedAt; a mistake can be corrected to NoShow and back", async () => {
    const done = await markAttendance(sofia, pastBooking.id, "Completed", now);
    assert.equal(done.status, 200, done.error);
    assert.equal(done.data?.status, "Completed");
    assert.ok((await testDb.booking.findUniqueOrThrow({ where: { id: pastBooking.id } })).completedAt);

    const fixed = await markAttendance(sofia, pastBooking.id, "NoShow", now);
    assert.equal(fixed.data?.status, "NoShow");
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: pastBooking.id } })).completedAt, null);

    assert.equal((await markAttendance(sofia, pastBooking.id, "Completed", now)).status, 200);
    assert.equal((await markAttendance(sofia, pastBooking2.id, "NoShow", now)).status, 200);
    assert.ok((await audited("attendance.mark", pastBooking.id)) >= 3);
  });

  await check("coachStats counts the last 30 days and gives the rate", async () => {
    const r = await coachStats(sofia, now);
    assert.deepEqual(r.data, { attended: 1, noShow: 1, rate: 0.5 });

    // Marcus's booking was marked Completed by the admin: his rate is 1.
    assert.equal((await coachStats(marcus, now)).data?.rate, 1);
    // Seen from 40 days later, nothing is inside the window.
    assert.equal((await coachStats(sofia, addDays(now, 40))).data?.rate, null);
  });

  await check("memberStats counts the month's attendance and upcoming bookings", async () => {
    const filler = fillers[4];
    const asFiller: SessionUser = { id: filler.id, email: filler.email, fullName: filler.fullName, role: "Member" };

    const r = await memberStats(asFiller, filler.id, now);
    assert.equal(r.status, 200, r.error);
    assert.ok(r.data!.upcoming >= 1, "seeded and test bookings in the future");
    assert.ok(r.data!.planStartedAt);
    assert.equal(typeof r.data!.attendedThisMonth, "number");

    // Someone else's stats are 404 for a member, readable for an admin.
    assert.equal((await memberStats(asFiller, fillers[0].id, now)).status, 404);
    assert.equal((await memberStats(admin, filler.id, now)).status, 200);
    assert.equal((await memberStats(admin, admin.id, now)).status, 404, "staff hold no membership");

    const noPlan = await newMember("noplan@example.co.za");
    const none = await memberStats(admin, noPlan.id, now);
    assert.equal(none.data?.planStartedAt, null);
    assert.deepEqual([none.data?.attendedThisMonth, none.data?.upcoming], [0, 0]);
  });

  console.log("\nAUDIT");

  await check("the audit log lists the latest rows, newest first, with no credentials", async () => {
    const r = await listAuditLog(admin);
    assert.equal(r.status, 200);
    assert.ok(r.data!.length <= 100 && r.data!.length > 10);
    const ids = r.data!.map((row) => row.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    assert.ok(r.data!.some((row) => row.actorName === admin.fullName));
    assert.doesNotMatch(JSON.stringify(r.data), /password|hash|salt|token/i);
    for (const log of await testDb.auditLog.findMany()) {
      assert.doesNotMatch(JSON.stringify(log.detail ?? {}), /password|hash|salt|token/i);
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
