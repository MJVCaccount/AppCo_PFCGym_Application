/**
 * Data reads, accounts, password hashing, validation rules and formatting,
 * run against the seeded test database (see tests/helpers/db.ts).
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { Prisma } from "@prisma/client";

import { currentDayAndHour } from "../src/lib/dates";
import { AppError, ERROR_CODES, mapPrismaError } from "../src/lib/errors";
import { logger } from "../src/lib/logger";
import { hashPassword, verifyPassword } from "../src/lib/password";
import {
  getCoachByName,
  getCoaches,
} from "../src/lib/repositories/coachesRepository";
import {
  getHoursFor,
  getOpeningHours,
  isOpenAt,
} from "../src/lib/repositories/hoursRepository";
import {
  getCheapestPlanPrice,
  getPlan,
  getPlans,
} from "../src/lib/repositories/plansRepository";
import {
  getClass,
  getClasses,
} from "../src/lib/repositories/programmesRepository";
import { getReviews } from "../src/lib/repositories/reviewsRepository";
import {
  getNextAvailableSlot,
  getSlot,
  getSlotsFor,
  getSlotsForCoach,
  getTimetable,
} from "../src/lib/repositories/timetableRepository";
import {
  cancelMembership,
  countByRole,
  createMember,
  findByEmail,
  findById,
  getAll,
  setPlan,
  toSessionUser,
  validateCredentials,
} from "../src/lib/repositories/usersRepository";
import { changePlan } from "../src/lib/services/membershipService";
import { optionalText, requiredText } from "../src/lib/text";
import {
  DAY_ORDER,
  formatHours,
  formatPrice,
  initials,
  isFull,
  isMemberRole,
  spacesLeft,
  timeAgo,
  todayKey,
} from "../src/lib/types";
import { RULES, validate, valuesFrom } from "../src/lib/validation";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

/** Runs `fn` and returns what it wrote to the given stream, unprinted. */
function capture(stream: NodeJS.WriteStream, fn: () => void): string {
  const original = stream.write;
  let written = "";
  stream.write = ((chunk: string | Uint8Array) => {
    written += chunk.toString();
    return true;
  }) as typeof stream.write;

  try {
    fn();
  } finally {
    stream.write = original;
  }
  return written;
}

async function main() {
  await resetDatabase();
  const now = new Date();

  console.log("\nDATA");

  await check("six classes, unique slugs", async () => {
    const classes = await getClasses();
    assert.equal(classes.length, 6);
    assert.equal(new Set(classes.map((c) => c.slug)).size, 6);
  });

  await check("class lookup is case-insensitive", async () => {
    assert.equal((await getClass("MUAYTHAI"))?.name, "Muay Thai");
    assert.equal(await getClass("nope"), undefined);
  });

  await check("six coaches, named from their user account", async () => {
    const coaches = await getCoaches();
    assert.equal(coaches.length, 6);
    assert.equal(
      (await getCoachByName("Marcus Thompson"))?.role,
      "Head boxing coach",
    );
    assert.equal(await getCoachByName("Nobody Here"), undefined);
  });

  await check("an inactive coach is not listed", async () => {
    const maurice = (await getCoachByName("Maurice Joseph"))!;
    await testDb.coach.update({
      where: { coachId: maurice.id },
      data: { isActive: false },
    });
    assert.equal((await getCoaches()).length, 5);
    await testDb.coach.update({
      where: { coachId: maurice.id },
      data: { isActive: true },
    });
  });

  await check("exactly one plan is flagged most popular", async () => {
    const plans = await getPlans();
    assert.equal(plans.filter((p) => p.isMostPopular).length, 1);
  });

  await check("plans come back cheapest first; cheapest is R750", async () => {
    const prices = (await getPlans()).map((p) => p.pricePerMonth);
    assert.deepEqual(prices, [750, 900, 1050]);
    assert.equal(await getCheapestPlanPrice(), 750);
  });

  await check("plan lookup by id", async () => {
    const popular = (await getPlans()).find((p) => p.isMostPopular)!;
    assert.equal((await getPlan(popular.id))?.pricePerMonth, 900);
    assert.equal(await getPlan(999_999), undefined);
    assert.equal(await getPlan(Number("nope")), undefined);
  });

  await check("a retired plan is hidden unless asked for", async () => {
    const retired = await testDb.membershipPlan.create({
      data: { pricePerMonth: 100, features: ["Old"], isActive: false, sortOrder: 9 },
    });
    assert.equal(await getPlan(retired.id), undefined);
    assert.equal(
      (await getPlan(retired.id, { includeInactive: true }))?.pricePerMonth,
      100,
    );
    assert.equal(await getCheapestPlanPrice(), 750);
  });

  await check("every review has a rating of 1-5 and an ISO date", async () => {
    const reviews = await getReviews();
    assert.equal(reviews.length, 4);
    for (const r of reviews) {
      assert.ok(r.rating >= 1 && r.rating <= 5);
      assert.match(r.postedOn, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  await check("opening hours exist for all seven days, Monday first", async () => {
    assert.deepEqual(
      (await getOpeningHours()).map((h) => h.day),
      DAY_ORDER,
    );
    for (const day of DAY_ORDER) {
      const h = await getHoursFor(day);
      assert.ok(h.closes > h.opens, `${day} closes after it opens`);
    }
  });

  await check("isOpenAt agrees with the table, in gym time", async () => {
    // Wednesday 30 September 2026: 10:00 and 23:00 in Johannesburg (UTC+2).
    assert.equal(await isOpenAt(new Date("2026-09-30T08:00:00Z")), true);
    assert.equal(await isOpenAt(new Date("2026-09-30T21:00:00Z")), false);
    // 07:59 SAST is before opening, 08:00 is open.
    assert.equal(await isOpenAt(new Date("2026-09-30T05:59:00Z")), false);
    assert.equal(await isOpenAt(new Date("2026-09-30T06:00:00Z")), true);
  });

  console.log("\nTIMETABLE");

  await check("20 slots, every day covered, ids unique", async () => {
    const t = await getTimetable(now);
    assert.equal(t.length, 20);
    assert.equal(new Set(t.map((s) => s.id)).size, 20);
    for (const day of DAY_ORDER) {
      assert.ok((await getSlotsFor(day, now)).length > 0, `${day} has classes`);
    }
  });

  await check("slots come back sorted by start time", async () => {
    const times = (await getSlotsFor("mon", now)).map((s) => s.startsAt);
    assert.equal(times.length, 4);
    assert.deepEqual(times, [...times].sort());
  });

  await check("every slot's coach exists on the coaches list", async () => {
    const names = new Set((await getCoaches()).map((c) => c.name));
    for (const slot of await getTimetable(now)) {
      assert.ok(names.has(slot.coachName), `${slot.coachName} is a real coach`);
    }
  });

  await check("booked counts match the seed and never exceed capacity", async () => {
    const week = await getTimetable(now);
    for (const slot of week) {
      assert.ok(slot.booked <= slot.capacity, slot.className);
    }

    const grappling = week.find(
      (s) => s.day === "mon" && s.className === "Submission Grappling",
    )!;
    assert.equal(grappling.booked, 16);
    assert.equal(isFull(grappling), true);
    assert.equal(spacesLeft(grappling), 0);

    const boxing = week.find(
      (s) => s.day === "mon" && s.className === "Elite Boxing",
    )!;
    assert.equal(boxing.booked, 12);
    assert.equal(spacesLeft(boxing), 8);
  });

  await check("a single slot carries the same count as the week view", async () => {
    const fromWeek = (await getTimetable(now))[0];
    assert.deepEqual(await getSlot(fromWeek.id, now), fromWeek);
    assert.equal(await getSlot(999_999, now), undefined);
  });

  await check("only Confirmed bookings for the next session are counted", async () => {
    const slot = (await getSlotsFor("tue", now)).find(
      (s) => s.className === "Muay Thai",
    )!;
    const one = await testDb.booking.findFirstOrThrow({
      where: { gymClassId: slot.id, status: "Confirmed" },
    });

    await testDb.booking.update({
      where: { id: one.id },
      data: { status: "Cancelled" },
    });
    assert.equal((await getSlot(slot.id, now))!.booked, slot.booked - 1);

    await testDb.booking.update({
      where: { id: one.id },
      data: { status: "Confirmed" },
    });

    // A week later the next session is a different date with no bookings.
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    assert.equal((await getSlot(slot.id, nextWeek))!.booked, 0);
  });

  await check("an inactive class leaves the timetable", async () => {
    const slot = (await getSlotsFor("sun", now))[0];
    await testDb.gymClass.update({
      where: { id: slot.id },
      data: { isActive: false },
    });
    assert.equal((await getTimetable(now)).length, 19);
    assert.equal(await getSlot(slot.id, now), undefined);
    await testDb.gymClass.update({
      where: { id: slot.id },
      data: { isActive: true },
    });
  });

  await check("coach schedule filters to that coach only", async () => {
    const sofia = (await getCoachByName("Sofia Erasmus"))!;
    const week = await getSlotsForCoach(sofia.id, now);
    assert.equal(week.length, 5);
    assert.ok(week.every((s) => s.coachName === "Sofia Erasmus"));
    assert.ok(week.every((s) => s.coachId === sofia.id));
  });

  await check("next available slot is never a full one", async () => {
    const next = await getNextAvailableSlot(now);
    assert.ok(next);
    assert.equal(isFull(next), false);
  });

  console.log("\nUSERS AND AUTH");

  await check("seeded accounts have the expected roles", async () => {
    assert.equal((await getAll()).length, 33);
    assert.equal(await countByRole("Member"), 25);
    assert.equal(await countByRole("Fighter"), 1);
    assert.equal(await countByRole("Coach"), 6);
    assert.equal(await countByRole("Admin"), 1);

    assert.equal((await findByEmail("member@pfc.co.za"))?.role, "Member");
    assert.equal((await findByEmail("fighter@pfc.co.za"))?.role, "Fighter");
    assert.equal((await findByEmail("sofia@pfc.co.za"))?.role, "Coach");
    assert.equal((await findByEmail("admin@pfc.co.za"))?.role, "Admin");
  });

  await check("every seeded demo password authenticates", async () => {
    const creds: [string, string][] = [
      ["member@pfc.co.za", "Member123!"],
      ["fighter@pfc.co.za", "Fighter123!"],
      ["sofia@pfc.co.za", "Coach123!"],
      ["marcus@pfc.co.za", "Coach123!"],
      ["admin@pfc.co.za", "Admin123!"],
    ];
    for (const [email, password] of creds) {
      assert.ok(await validateCredentials(email, password), email);
    }
  });

  await check("wrong password is rejected", async () =>
    assert.equal(await validateCredentials("admin@pfc.co.za", "Admin123"), null),
  );

  await check("unknown email is rejected", async () =>
    assert.equal(await validateCredentials("nobody@pfc.co.za", "whatever"), null),
  );

  await check("email match ignores case and surrounding space", async () => {
    assert.ok(await validateCredentials("  ADMIN@PFC.CO.ZA  ", "Admin123!"));
    assert.equal((await findByEmail(" Admin@PFC.co.za "))?.fullName, "Ruan Cupido");
  });

  await check("a deactivated account cannot sign in", async () => {
    const marcus = (await findByEmail("marcus@pfc.co.za"))!;
    await testDb.user.update({
      where: { id: marcus.id },
      data: { isActive: false },
    });
    assert.equal(await validateCredentials("marcus@pfc.co.za", "Coach123!"), null);
    await testDb.user.update({
      where: { id: marcus.id },
      data: { isActive: true },
    });
    assert.ok(await validateCredentials("marcus@pfc.co.za", "Coach123!"));
  });

  await check("same password across accounts stores different hashes", async () => {
    const [sofia, marcus] = await Promise.all(
      ["sofia@pfc.co.za", "marcus@pfc.co.za"].map((email) =>
        testDb.user.findUniqueOrThrow({ where: { email } }),
      ),
    );
    assert.notEqual(sofia.passwordSalt, marcus.passwordSalt);
    assert.notEqual(sofia.passwordHash, marcus.passwordHash);
  });

  await check("no plaintext password is stored, and none leaves the repository", async () => {
    for (const row of await testDb.user.findMany()) {
      assert.ok(!JSON.stringify(row).includes("123!"), row.email);
    }
    for (const account of await getAll()) {
      const keys = Object.keys(account);
      assert.ok(!keys.includes("passwordHash"), account.email);
      assert.ok(!keys.includes("passwordSalt"), account.email);
    }
  });

  await check("hashPassword gives a 64-byte key and a fresh 16-byte salt", () => {
    const first = hashPassword("Testing123!");
    const second = hashPassword("Testing123!");
    assert.match(first.hash, /^[0-9a-f]{128}$/);
    assert.match(first.salt, /^[0-9a-f]{32}$/);
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
  });

  await check("verifyPassword accepts the right password only", () => {
    const { hash, salt } = hashPassword("Testing123!");
    assert.equal(verifyPassword("Testing123!", salt, hash), true);
    assert.equal(verifyPassword("testing123!", salt, hash), false);
    assert.equal(verifyPassword("Testing123!", salt, "abcd"), false);
  });

  await check("session user carries no hash or salt", async () => {
    const session = toSessionUser((await findByEmail("admin@pfc.co.za"))!);
    assert.deepEqual(Object.keys(session).sort(), [
      "email",
      "fullName",
      "id",
      "role",
    ]);
  });

  await check("staff accounts have no membership plan; members do", async () => {
    for (const u of await getAll()) {
      if (isMemberRole(u.role)) assert.notEqual(u.planId, null, u.email);
      else assert.equal(u.planId, null, u.email);
    }
  });

  const basePlan = (await getPlans())[0];
  const topPlan = (await getPlans())[2];

  await check("registering adds a member who can sign in", async () => {
    const created = await createMember({
      email: "  New.Person@Example.co.za ",
      fullName: "  New Person ",
      phone: "  +27 82 000 0000 ",
      password: "Testing123!",
      planId: basePlan.id,
    });
    assert.equal(created.email, "new.person@example.co.za");
    assert.equal(created.fullName, "New Person");
    assert.equal(created.phone, "+27 82 000 0000");
    assert.equal(created.role, "Member");
    assert.equal(created.planId, basePlan.id);
    assert.equal(created.isActive, true);

    assert.ok(await validateCredentials("new.person@example.co.za", "Testing123!"));

    const member = await testDb.member.findUniqueOrThrow({
      where: { membershipId: created.id },
    });
    assert.ok(member.planChangedAt, "planChangedAt stamped on sign-up");
  });

  await check("a blank phone and no plan are stored as null", async () => {
    const created = await createMember({
      email: "no.plan@example.co.za",
      fullName: "No Plan",
      phone: "   ",
      password: "Testing123!",
      planId: null,
    });
    assert.equal(created.phone, null);
    assert.equal(created.planId, null);
  });

  await check("a case-variant email logs in", async () => {
    await createMember({
      email: "john@pfc.co.za",
      fullName: "John Case",
      password: "Testing123!",
      planId: basePlan.id,
    });
    const user = await validateCredentials("JOHN@PFC.CO.ZA", "Testing123!");
    assert.equal(user?.email, "john@pfc.co.za");
  });

  await check("duplicate registration in a different case is rejected", async () => {
    let caught: unknown;
    try {
      await createMember({
        email: "John@PFC.co.za",
        fullName: "John Again",
        password: "Testing123!",
        planId: null,
      });
    } catch (e) {
      caught = e;
    }

    assert.ok(caught, "the second sign-up must throw");
    const mapped = mapPrismaError(caught);
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, ERROR_CODES.conflict);

    const rows = await testDb.user.count({
      where: { email: { equals: "john@pfc.co.za", mode: "insensitive" } },
    });
    assert.equal(rows, 1);
  });

  await check("setPlan updates and clears a plan", async () => {
    const user = (await findByEmail("member@pfc.co.za"))!;
    const original = user.planId;

    assert.equal(await setPlan(user.id, topPlan.id), "ok");
    assert.equal((await findById(user.id))?.planId, topPlan.id);

    assert.equal(await setPlan(user.id, null), "ok");
    assert.equal((await findById(user.id))?.planId, null);

    assert.equal(await setPlan(user.id, original), "ok");
    const member = await testDb.member.findUniqueOrThrow({
      where: { membershipId: user.id },
    });
    assert.ok(member.planChangedAt);
  });

  await check("setPlan refuses a missing member, an unknown plan and a retired plan", async () => {
    const user = (await findByEmail("member@pfc.co.za"))!;
    const admin = (await findByEmail("admin@pfc.co.za"))!;
    const retired = await testDb.membershipPlan.findFirstOrThrow({
      where: { isActive: false },
    });

    assert.equal(await setPlan(999_999, basePlan.id), "no-member");
    assert.equal(await setPlan(admin.id, basePlan.id), "no-member");
    assert.equal(await setPlan(user.id, 999_999), "no-plan");
    assert.equal(await setPlan(user.id, retired.id), "no-plan");
    assert.notEqual((await findById(user.id))?.planId, retired.id);
  });

  await check("cancelMembership clears the plan and records when", async () => {
    const user = (await findByEmail("new.person@example.co.za"))!;
    assert.equal(await cancelMembership(user.id), true);

    const member = await testDb.member.findUniqueOrThrow({
      where: { membershipId: user.id },
    });
    assert.equal(member.planId, null);
    assert.ok(member.cancelledAt);

    assert.equal(await cancelMembership(999_999), false);

    // Rejoining clears the cancellation stamp.
    assert.equal(await setPlan(user.id, basePlan.id), "ok");
    const rejoined = await testDb.member.findUniqueOrThrow({
      where: { membershipId: user.id },
    });
    assert.equal(rejoined.cancelledAt, null);
  });

  await check("only members may change a plan through the service", async () => {
    const coach = toSessionUser((await findByEmail("sofia@pfc.co.za"))!);
    const member = toSessionUser((await findByEmail("member@pfc.co.za"))!);

    const refused = await changePlan(coach, basePlan.id);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 403);

    const missing = await changePlan(member, 999_999);
    assert.equal(missing.status, 404);

    const changed = await changePlan(member, topPlan.id);
    assert.equal(changed.ok, true);
    assert.equal(changed.plan?.pricePerMonth, 1050);
  });

  console.log("\nDATABASE CONSTRAINTS");

  const anyCoach = await testDb.coach.findFirstOrThrow();
  const classRow = {
    name: "Constraint Test",
    coachId: anyCoach.coachId,
    day: "sun" as const,
    durationMinutes: 60,
  };

  await check("a class with capacity 0 is rejected", async () => {
    await assert.rejects(
      testDb.gymClass.create({
        data: { ...classRow, startsAt: "04:00", capacity: 0 },
      }),
      /gymclass_capacity_positive/,
    );
  });

  await check('a class starting at "25:99" is rejected', async () => {
    await assert.rejects(
      testDb.gymClass.create({
        data: { ...classRow, startsAt: "25:99", capacity: 10 },
      }),
      /gymclass_time_format/,
    );
  });

  await check("the same class with valid values is accepted", async () => {
    const ok = await testDb.gymClass.create({
      data: { ...classRow, startsAt: "04:00", capacity: 10 },
    });
    await testDb.gymClass.delete({ where: { id: ok.id } });
  });

  await check("a review rating of 6 is rejected", async () => {
    await assert.rejects(
      testDb.review.create({
        data: {
          memberName: "Too Keen",
          body: "Six stars",
          rating: 6,
          postedOn: new Date("2026-01-01"),
        },
      }),
      /review_rating_range/,
    );
  });

  await check("a negative plan price is rejected", async () => {
    await assert.rejects(
      testDb.membershipPlan.create({
        data: { pricePerMonth: -1, features: [] },
      }),
      /plan_price_nonnegative/,
    );
  });

  console.log("\nERRORS, LOGGING AND TEXT");

  await check("mapPrismaError maps the known Prisma codes", () => {
    const known = (code: string) =>
      new Prisma.PrismaClientKnownRequestError("boom", {
        code,
        clientVersion: "test",
      });

    assert.equal(mapPrismaError(known("P2002")).status, 409);
    assert.equal(mapPrismaError(known("P2002")).code, ERROR_CODES.conflict);
    assert.equal(mapPrismaError(known("P2025")).status, 404);
    assert.equal(mapPrismaError(known("P2003")).status, 409);
    assert.equal(mapPrismaError(known("P2003")).code, ERROR_CODES.inUse);

    const own = new AppError(418, "TEAPOT", "Short and stout.");
    assert.equal(mapPrismaError(own), own);
  });

  await check("an unknown error becomes a safe 500 and is logged", () => {
    let mapped: AppError | undefined;
    const logged = capture(process.stderr, () => {
      mapped = mapPrismaError(new Error('SELECT * FROM "User" exploded'));
    });

    assert.equal(mapped?.status, 500);
    assert.ok(!mapped?.message.includes("SELECT"), "no SQL in the client message");

    const line = JSON.parse(logged);
    assert.equal(line.level, "error");
    assert.ok(line.meta.error.message.includes("exploded"));
  });

  await check("the logger writes one JSON line and redacts credentials", () => {
    const written = capture(process.stdout, () => {
      logger.info("sign-in", {
        email: "a@b.co.za",
        password: "Secret123!",
        nested: { resetToken: "abc", passwordHash: "def", attempts: 2 },
        body: { anything: "at all" },
      });
    });

    assert.equal(written.trim().split("\n").length, 1);
    assert.ok(!written.includes("Secret123!"));
    assert.ok(!written.includes("abc"));

    const line = JSON.parse(written);
    assert.equal(line.message, "sign-in");
    assert.equal(line.meta.email, "a@b.co.za");
    assert.equal(line.meta.password, "[redacted]");
    assert.equal(line.meta.nested.resetToken, "[redacted]");
    assert.equal(line.meta.nested.passwordHash, "[redacted]");
    assert.equal(line.meta.nested.attempts, 2);
    assert.equal(line.meta.body, "[redacted]");
  });

  await check("optionalText treats null, undefined and blank alike", () => {
    assert.equal(optionalText(null), null);
    assert.equal(optionalText(undefined), null);
    assert.equal(optionalText(""), null);
    assert.equal(optionalText("   "), null);
    assert.equal(optionalText(42), null);
    assert.equal(optionalText("  hello "), "hello");
  });

  await check("requiredText enforces a trimmed length range", () => {
    assert.equal(requiredText("  abc ", 3, 5), "abc");
    assert.equal(requiredText("ab", 3, 5), null);
    assert.equal(requiredText("abcdef", 3, 5), null);
    assert.equal(requiredText("     ", 1, 5), null);
    assert.equal(requiredText(undefined, 1, 5), null);
  });

  console.log("\nVALIDATION");

  await check("name rule", () => {
    assert.equal(RULES.name("Ruan Cupido"), null);
    assert.ok(RULES.name(" "));
    assert.ok(RULES.name("R"));
  });

  await check("email rule", () => {
    assert.equal(RULES.email("a@b.co.za"), null);
    assert.ok(RULES.email("not-an-email"));
    assert.ok(RULES.email("a@b"));
    assert.ok(RULES.email("a b@c.com"));
  });

  await check("phone rule allows blank but rejects rubbish", () => {
    assert.equal(RULES.phone(""), null);
    assert.equal(RULES.phone("+27 82 670 9027"), null);
    assert.ok(RULES.phone("abc"));
  });

  await check("password rule enforces 8 characters", () => {
    assert.equal(RULES.password("12345678"), null);
    assert.ok(RULES.password("1234567"));
  });

  await check("message rule enforces 10 characters", () => {
    assert.equal(RULES.message("Hello there, coach."), null);
    assert.ok(RULES.message("hi"));
  });

  await check("fighter and event rules enforce their trimmed length ranges", () => {
    const ranges = [
      ["weightClass", 2, 40],
      ["eventName", 3, 120],
      ["venue", 2, 120],
      ["eventDescription", 10, 2000],
    ] as const;

    for (const [rule, min, max] of ranges) {
      assert.equal(RULES[rule]("x".repeat(min)), null, `${rule} min`);
      assert.equal(RULES[rule](`  ${"x".repeat(max)}  `), null, `${rule} max`);
      assert.ok(RULES[rule]("x".repeat(min - 1)), `${rule} too short`);
      assert.ok(RULES[rule]("x".repeat(max + 1)), `${rule} too long`);
      assert.ok(RULES[rule](" ".repeat(max)), `${rule} blank`);
    }
  });

  await check("text(min, max) checks the trimmed length and refuses non-text", () => {
    const rule = RULES.text(2, 80, "Class name");
    assert.equal(rule("ab"), null);
    assert.equal(rule(`  ${"x".repeat(80)}  `), null);
    assert.equal(rule("x"), "Class name must be 2 to 80 characters.");
    assert.ok(rule("x".repeat(81)));
    assert.ok(rule("   "));
    for (const notText of [null, undefined, 42, ["ab"], { length: 5 }]) {
      assert.ok(rule(notText), String(notText));
    }
  });

  await check("integerRange(min, max) accepts whole numbers in range only", () => {
    const rule = RULES.integerRange(1, 200, "Capacity");
    assert.equal(rule(1), null);
    assert.equal(rule(200), null);
    assert.equal(rule(0), "Capacity must be a whole number from 1 to 200.");
    for (const bad of [201, -5, 1.5, NaN, Infinity, 2 ** 53, "12", null, [12]]) {
      assert.ok(rule(bad), String(bad));
    }
  });

  await check("timeOfDay accepts 00:00 to 23:59 as HH:mm", () => {
    for (const time of ["00:00", "06:30", "19:05", "23:59"]) {
      assert.equal(RULES.timeOfDay(time), null, time);
    }
    for (const time of ["24:00", "23:60", "6:30", "06:3", "0630", " 06:30", "", "ab:cd"]) {
      assert.ok(RULES.timeOfDay(time), time);
    }
  });

  await check("url is optional and https only", () => {
    assert.equal(RULES.url(""), null);
    assert.equal(RULES.url("   "), null);
    assert.equal(RULES.url("https://example.co.za/coach.jpg"), null);
    for (const url of [
      "http://example.co.za/coach.jpg",
      "javascript:alert(1)",
      "ftp://example.co.za",
      "example.co.za",
      `https://example.co.za/${"a".repeat(2048)}`,
    ]) {
      assert.ok(RULES.url(url), url.slice(0, 40));
    }
  });

  await check("validate() collects only the failing fields", () => {
    const data = new FormData();
    data.set("fullName", "R");
    data.set("email", "good@example.co.za");
    const errors = validate(data, { fullName: "name", email: "email" });
    assert.deepEqual(Object.keys(errors), ["fullName"]);
  });

  await check("valuesFrom() echoes submitted values back", () => {
    const data = new FormData();
    data.set("email", "x@y.co.za");
    assert.deepEqual(valuesFrom(data, ["email", "phone"]), {
      email: "x@y.co.za",
      phone: "",
    });
  });

  console.log("\nFORMATTING");

  await check("initials", () => {
    assert.equal(initials("Marcus Thompson"), "MT");
    assert.equal(initials("Ryan O'Brian"), "RO");
    assert.equal(initials("Cher"), "C");
  });

  await check("price formatting has no decimals or separators", () => {
    assert.equal(formatPrice(900), "900");
    assert.equal(formatPrice(1050), "1050");
  });

  await check("hours formatting pads to HH:00", () =>
    assert.equal(
      formatHours({ day: "sun", opens: 9, closes: 19 }),
      "09:00 – 19:00",
    ),
  );

  await check("timeAgo", () => {
    const at = new Date("2026-09-29");
    assert.equal(timeAgo("2026-09-01", at), "This month");
    assert.equal(timeAgo("2026-03-01", at), "6 months ago");
    assert.equal(timeAgo("2025-09-01", at), "1 year ago");
    assert.equal(timeAgo("2023-09-01", at), "3 years ago");
  });

  await check("todayKey maps Sunday-first getDay to Monday-first keys", () => {
    assert.equal(todayKey(new Date("2026-09-28T09:00:00")), "mon");
    assert.equal(todayKey(new Date("2026-10-04T09:00:00")), "sun");
  });

  await check("currentDayAndHour reads the gym's clock, not the server's", () => {
    // Sunday 22:30 UTC is Monday 00:30 in Johannesburg.
    assert.deepEqual(currentDayAndHour(new Date("2026-10-04T22:30:00Z")), {
      day: "mon",
      hour: 0,
    });
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
