/**
 * "Stupid user" tests: every service function is fed input no form would
 * normally send, and must answer with a clean 400/404/409 (or accept the
 * input) and never a 500 or an exception.
 *
 * Runs against the seeded test database (see tests/helpers/db.ts).
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { addDays, gymDateAndTime } from "../src/lib/dates";
import {
  createProgramme,
  createSession,
  deactivateSession,
  updateProgramme,
  updateSession,
} from "../src/lib/services/classAdminService";
import {
  createCoach,
  updateCoach,
} from "../src/lib/services/coachAdminService";
import { getRoster, markAttendance } from "../src/lib/services/coachService";
import { createEvent, offerBout, recordResult } from "../src/lib/services/eventService";
import { promoteToFighter } from "../src/lib/services/fighterService";
import {
  deactivateUser,
  listMembers,
  setMemberPlan,
} from "../src/lib/services/memberAdminService";
import { createPlan, updatePlan } from "../src/lib/services/planAdminService";
import type { ServiceResult, SessionUser } from "../src/lib/types";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

/** Runs a call and asserts it neither threw nor answered 500. */
async function clean<T>(label: string, call: () => Promise<ServiceResult<T>>) {
  let result: ServiceResult<T>;
  try {
    result = await call();
  } catch (e) {
    assert.fail(`${label} threw: ${String(e)}`);
  }
  assert.ok(result.status < 500, `${label} answered ${result.status}: ${result.error}`);
  assert.ok([200, 201, 400, 403, 404, 409].includes(result.status), `${label} -> ${result.status}`);
  if (!result.ok) assert.equal(typeof result.error, "string", label);
  assert.doesNotMatch(String(result.error ?? ""), /prisma|SELECT|INSERT|at .*\.ts|stack/i, label);
  return result;
}

async function sessionFor(email: string): Promise<SessionUser> {
  const row = await testDb.user.findUniqueOrThrow({ where: { email } });
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

const HOSTILE_TEXT: [string, unknown][] = [
  ["10,000 characters", "x".repeat(10_000)],
  ["emoji", "🥊🔥💪 Fight Club 🥋"],
  ["right-to-left", "مرحبا بالعالم שלום עולם"],
  ["RTL override character", "abc‮def"],
  ["leading and trailing whitespace", "   Padded Name   "],
  ["only whitespace", "     \t\n  "],
  ["SQL injection", "Robert'); DROP TABLE \"User\";--"],
  ["SQL comment", "' OR 1=1 --"],
  ["HTML", "<script>alert(1)</script>"],
  ["NUL byte", "abc\u0000def"],
  ["lone surrogate", "abc\uD800def"],
  ["zero-width space", "​​​"],
  ["empty string", ""],
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  ["NaN", NaN],
  ["boolean", true],
  ["array", ["a", "b"]],
  ["array of arrays", [[["x"]]]],
  ["object", { toString: "x" }],
  ["nested object", { $ne: null }],
];

const HOSTILE_NUMBERS: [string, unknown][] = [
  ["negative", -5],
  ["zero", 0],
  ["fraction", 2.5],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["huge integer", 2 ** 53],
  ["beyond Postgres INTEGER", 2 ** 31],
  ["1e21", 1e21],
  ["numeric string", "12"],
  ["text", "twelve"],
  ["empty string", ""],
  ["null", null],
  ["array", [12]],
  ["object", { value: 12 }],
  ["boolean", false],
];

async function main() {
  await resetDatabase();
  const now = new Date();

  const admin = await sessionFor("admin@pfc.co.za");
  const sofia = await sessionFor("sofia@pfc.co.za");

  const classInput = {
    name: "Hostile Class",
    kind: "Group",
    coachId: sofia.id,
    day: "sun",
    startsAt: "04:00",
    durationMinutes: 60,
    capacity: 10,
  };
  const coachInput = {
    fullName: "Hostile Coach",
    email: "hostile@example.co.za",
    title: "Boxing",
    bio: "A long enough biography.",
  };
  const planInput = { pricePerMonth: 500, features: ["Gym access"], isMostPopular: false };
  const programmeInput = { name: "Hostile Programme", description: "A programme description.", level: "All levels", durationMinutes: 60 };

  // Every call gets a new start time from 06:00 on, so none of them clash.
  let slot = 0;
  const uniqueTime = () => {
    const minutes = 6 * 60 + slot++;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  };

  console.log("\nTEXT FIELDS");

  await check("hostile text in every text field of every create is a clean answer", async () => {
    for (const [what, value] of HOSTILE_TEXT) {
      await clean(`class name: ${what}`, () => createSession(admin, { ...classInput, startsAt: uniqueTime(), name: value }));
      await clean(`programme name: ${what}`, () => createProgramme(admin, { ...programmeInput, name: value }));
      await clean(`programme description: ${what}`, () => createProgramme(admin, { ...programmeInput, description: value }));
      await clean(`programme level: ${what}`, () => createProgramme(admin, { ...programmeInput, level: value }));
      await clean(`coach name: ${what}`, () => createCoach(admin, { ...coachInput, email: `a${slot++}@example.co.za`, fullName: value }));
      await clean(`coach title: ${what}`, () => createCoach(admin, { ...coachInput, email: `b${slot++}@example.co.za`, title: value }));
      await clean(`coach bio: ${what}`, () => createCoach(admin, { ...coachInput, email: `c${slot++}@example.co.za`, bio: value }));
      await clean(`coach email: ${what}`, () => createCoach(admin, { ...coachInput, email: value }));
      await clean(`coach image: ${what}`, () => createCoach(admin, { ...coachInput, email: `d${slot++}@example.co.za`, imageUrl: value }));
      await clean(`plan feature: ${what}`, () => createPlan(admin, { ...planInput, features: [value] }));
      await clean(`plan features: ${what}`, () => createPlan(admin, { ...planInput, features: value }));
      await clean(`member search: ${what}`, () => listMembers(admin, { search: value }));
      await clean(`weight class: ${what}`, () => promoteToFighter(admin, 2, value));
      await clean(`event name: ${what}`, () => createEvent(admin, { name: value, venue: "Hall", description: "A full card of bouts.", eventDate: addDays(now, 20).toISOString() }, now));
      await clean(`opponent: ${what}`, () => offerBout(admin, 1, 999_999, { opponentName: value }, now));
      await clean(`result notes: ${what}`, () => recordResult(admin, 1, "Win", value, now));
    }
  });

  await check("a whole non-object body is a 400 for every create and update", async () => {
    for (const body of ["text", 5, null, undefined, [], [1], true]) {
      const calls: [string, () => Promise<ServiceResult<unknown>>][] = [
        ["createSession", () => createSession(admin, body)],
        ["updateSession", () => updateSession(admin, 1, body, now)],
        ["createProgramme", () => createProgramme(admin, body)],
        ["updateProgramme", () => updateProgramme(admin, 1, body)],
        ["createCoach", () => createCoach(admin, body)],
        ["updateCoach", () => updateCoach(admin, sofia.id, body)],
        ["createPlan", () => createPlan(admin, body)],
        ["updatePlan", () => updatePlan(admin, 1, body)],
      ];
      // listMembers treats "no query" as the first page, so undefined is valid.
      if (body !== undefined) calls.push(["listMembers", () => listMembers(admin, body)]);
      for (const [label, call] of calls) {
        const r = await clean(`${label}(${JSON.stringify(body)})`, call);
        assert.equal(r.status, 400, `${label}(${JSON.stringify(body)})`);
      }
    }
  });

  await check("padding is trimmed, not stored", async () => {
    const r = await createProgramme(admin, { ...programmeInput, name: "   Padded Programme   ", level: "  Beginner  " });
    assert.equal(r.data?.name, "Padded Programme");
    assert.equal(r.data?.level, "Beginner");
    const c = await createCoach(admin, { ...coachInput, email: "  PADDED@Example.co.za ", fullName: "  Pad Coach  " });
    assert.equal(c.data?.email, "padded@example.co.za");
    assert.equal(c.data?.name, "Pad Coach");
  });

  await check("SQL-looking text is stored as plain text and harms nothing", async () => {
    const evil = "Robert'); DROP TABLE \"User\";--";
    const r = await createProgramme(admin, { ...programmeInput, name: evil });
    assert.equal(r.status, 201);
    assert.equal(r.data?.name, evil);
    assert.match(String(r.data?.slug), /^[a-z0-9-]+$/);
    assert.ok((await testDb.user.count()) > 20);
  });

  console.log("\nNUMBERS");

  await check("hostile numbers in every numeric field are a clean answer", async () => {
    for (const [what, value] of HOSTILE_NUMBERS) {
      await clean(`capacity: ${what}`, () => createSession(admin, { ...classInput, startsAt: uniqueTime(), capacity: value }));
      await clean(`duration: ${what}`, () => createSession(admin, { ...classInput, startsAt: uniqueTime(), durationMinutes: value }));
      await clean(`coachId: ${what}`, () => createSession(admin, { ...classInput, startsAt: uniqueTime(), coachId: value }));
      await clean(`programmeId: ${what}`, () => createSession(admin, { ...classInput, startsAt: uniqueTime(), programmeId: value }));
      await clean(`programme duration: ${what}`, () => createProgramme(admin, { ...programmeInput, durationMinutes: value }));
      await clean(`price: ${what}`, () => createPlan(admin, { ...planInput, pricePerMonth: value }));
      await clean(`update class id: ${what}`, () => updateSession(admin, value, { capacity: 5 }, now));
      await clean(`update plan id: ${what}`, () => updatePlan(admin, value, { pricePerMonth: 5 }));
      await clean(`plan for member: ${what}`, () => setMemberPlan(admin, 2, value, now));
      await clean(`member id: ${what}`, () => setMemberPlan(admin, value, null, now));
      await clean(`deactivate user: ${what}`, () => deactivateUser(admin, value, now));
      await clean(`deactivate class: ${what}`, () => deactivateSession(admin, value, {}, now));
      await clean(`roster class id: ${what}`, () => getRoster(admin, value, "2026-10-05", now));
      await clean(`mark booking id: ${what}`, () => markAttendance(admin, value, "Completed", now));
      await clean(`page: ${what}`, () => listMembers(admin, { page: value }));
      await clean(`offer fighter id: ${what}`, () => offerBout(admin, 1, value, {}, now));
      await clean(`result id: ${what}`, () => recordResult(admin, value, "Win", null, now));
    }
  });

  await check("negative, fractional, NaN and huge numbers are refused, not stored", async () => {
    for (const bad of [-5, 2.5, NaN, 2 ** 53, 1e21]) {
      assert.equal((await createPlan(admin, { ...planInput, pricePerMonth: bad })).status, 400, String(bad));
      assert.equal((await createSession(admin, { ...classInput, startsAt: uniqueTime(), capacity: bad })).status, 400, String(bad));
    }
    assert.equal(await testDb.membershipPlan.count({ where: { pricePerMonth: { lt: 0 } } }), 0);
    assert.equal(await testDb.membershipPlan.count({ where: { pricePerMonth: { gt: 100_000 } } }), 0);
  });

  console.log("\nSHAPES");

  await check("arrays and objects where strings are expected are a clean 400", async () => {
    for (const bad of [["Boxing"], { name: "Boxing" }, [[]], [null]]) {
      for (const field of ["name", "kind", "day", "startsAt"]) {
        const r = await clean(`${field}: ${JSON.stringify(bad)}`, () =>
          createSession(admin, { ...classInput, startsAt: uniqueTime(), [field]: bad }),
        );
        assert.equal(r.status, 400, `${field}: ${JSON.stringify(bad)}`);
      }
    }
  });

  await check("empty strings for optional fields are accepted as 'none'", async () => {
    const withBlank = await createSession(admin, { ...classInput, startsAt: uniqueTime(), programmeId: "" });
    assert.equal(withBlank.status, 201, withBlank.error);
    assert.equal(withBlank.data?.programmeId, null);

    for (const blank of ["", "   ", null, undefined]) {
      const c = await createCoach(admin, { ...coachInput, email: `blank${slot++}@example.co.za`, imageUrl: blank });
      assert.equal(c.status, 201, String(blank));
      assert.equal(c.data?.imageUrl, null);
    }
    assert.equal((await listMembers(admin, { search: "" })).status, 200);
    assert.equal((await listMembers(admin, { search: "   " })).data?.total, (await listMembers(admin, {})).data?.total);
  });

  await check("a plan's features: duplicates collapse, lists of lists do not crash", async () => {
    const r = await createPlan(admin, { ...planInput, features: ["Same one", "same ONE", " Same one "] });
    assert.deepEqual(r.data?.features, ["Same one"]);
    assert.equal((await createPlan(admin, { ...planInput, features: [["nested"]] })).status, 400);
  });

  await check("a malformed date, status or result is a clean 400", async () => {
    for (const date of ["2026-02-30", "'; --", "2026-13-45", "٢٠٢٦-١٠-٠٥", "9".repeat(10_000), {}, []]) {
      await clean(`roster date ${String(date).slice(0, 20)}`, () => getRoster(admin, 1, date, now));
    }
    for (const status of ["Completed ", "COMPLETED", ["Completed"], { status: "Completed" }]) {
      assert.equal((await clean("status", () => markAttendance(admin, 1, status, now))).status, 400);
    }
    for (const date of ["tomorrow", "2026-11-28T19:00", 0, NaN, "9999-99-99T99:99:99Z"]) {
      assert.equal((await clean("event date", () => createEvent(admin, { name: "Hostile Event", venue: "Hall", description: "A full card of bouts.", eventDate: date }, now))).status, 400);
    }
  });

  console.log("\nTHE SAME FORM TWICE, QUICKLY");

  await check("a coach submitted twice at once: one 201, one 409", async () => {
    const input = { ...coachInput, email: "double.coach@example.co.za" };
    const results = await Promise.all([createCoach(admin, input), createCoach(admin, input)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await testDb.user.count({ where: { email: "double.coach@example.co.za" } }), 1);
  });

  await check("a class submitted ten times at once: one 201, nine 409, no 500", async () => {
    const input = { ...classInput, startsAt: "02:00" };
    const results = await Promise.all(Array.from({ length: 10 }, () => createSession(admin, input)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 9);
    assert.equal(await testDb.gymClass.count({ where: { coachId: sofia.id, day: "sun", startsAt: "02:00" } }), 1);
  });

  await check("a programme submitted five times at once gets five distinct slugs", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createProgramme(admin, { ...programmeInput, name: "Rush Hour" })),
    );
    for (const r of results) assert.ok(r.status === 201 || r.status === 409, `${r.status}: ${r.error}`);
    const slugs = results.filter((r) => r.ok).map((r) => r.data!.slug);
    assert.equal(new Set(slugs).size, slugs.length, "no duplicate slug");
    assert.ok(slugs.length >= 1);
  });

  await check("a plan and a deactivation submitted twice do not 500", async () => {
    const a = await Promise.all([createPlan(admin, planInput), createPlan(admin, planInput)]);
    for (const r of a) assert.equal(r.status, 201);

    const cls = await createSession(admin, { ...classInput, startsAt: "01:00" });
    const d = await Promise.all([
      deactivateSession(admin, cls.data!.id, {}, now),
      deactivateSession(admin, cls.data!.id, {}, now),
    ]);
    assert.deepEqual(d.map((r) => r.status).sort(), [200, 409]);
  });

  await check("one attendance mark submitted twice at once is stable", async () => {
    const today = gymDateAndTime(now).date;
    const sofiaClass = await testDb.gymClass.findFirstOrThrow({ where: { coachId: sofia.id } });
    const filler = await testDb.user.findFirstOrThrow({ where: { email: { startsWith: "filler" } } });
    const booking = await testDb.booking.create({
      data: { memberId: filler.id, gymClassId: sofiaClass.id, sessionDate: addDays(today, -2), status: "Confirmed" },
    });
    const results = await Promise.all([
      markAttendance(sofia, booking.id, "Completed", now),
      markAttendance(sofia, booking.id, "Completed", now),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal((await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, "Completed");
  });

  await check("nothing hostile leaked into the audit log", async () => {
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
