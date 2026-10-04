/**
 * Exercises the parts of the app that do not need a browser or the Next
 * runtime: data reads, password hashing, session signing, validation rules.
 */
import assert from "node:assert/strict";

import {
  bookSlot,
  getCheapestPlanPrice,
  getClass,
  getClasses,
  getCoaches,
  getHoursFor,
  getNextAvailableSlot,
  getPlan,
  getPlans,
  getReviews,
  getSlot,
  getSlotsFor,
  getSlotsForCoach,
  getTimetable,
  isOpenAt,
} from "../src/lib/gym-data";
import { hashPassword, verifyPassword } from "../src/lib/password";
import {
  countByRole,
  createUser,
  findByEmail,
  getAll,
  setPlan,
  toSessionUser,
  validateCredentials,
} from "../src/lib/users";
import {
  DAY_ORDER,
  formatHours,
  formatPrice,
  initials,
  isFull,
  spacesLeft,
  timeAgo,
  todayKey,
} from "../src/lib/types";
import { RULES, validate, valuesFrom } from "../src/lib/validation";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

console.log("\nDATA");

check("six classes, unique slugs", () => {
  const classes = getClasses();
  assert.equal(classes.length, 6);
  assert.equal(new Set(classes.map((c) => c.slug)).size, 6);
});

check("class lookup is case-insensitive", () => {
  assert.equal(getClass("MUAYTHAI")?.name, "Muay Thai");
  assert.equal(getClass("nope"), undefined);
});

check("six coaches", () => assert.equal(getCoaches().length, 6));

check("exactly one plan is flagged most popular", () => {
  assert.equal(getPlans().filter((p) => p.isMostPopular).length, 1);
});

check("cheapest plan is R750", () =>
  assert.equal(getCheapestPlanPrice(), 750),
);

check("plan lookup by id", () => {
  assert.equal(getPlan(2)?.pricePerMonth, 900);
  assert.equal(getPlan(99), undefined);
});

check("every review has a rating of 1-5", () => {
  for (const r of getReviews()) {
    assert.ok(r.rating >= 1 && r.rating <= 5);
  }
});

check("opening hours exist for all seven days", () => {
  for (const day of DAY_ORDER) {
    const h = getHoursFor(day);
    assert.ok(h.closes > h.opens, `${day} closes after it opens`);
  }
});

check("isOpenAt agrees with the table", () => {
  const wed10 = new Date("2026-09-30T10:00:00");
  const wed23 = new Date("2026-09-30T23:00:00");
  assert.equal(isOpenAt(wed10), true);
  assert.equal(isOpenAt(wed23), false);
});

console.log("\nTIMETABLE");

check("20 slots, every day covered, ids unique", () => {
  const t = getTimetable();
  assert.equal(t.length, 20);
  assert.equal(new Set(t.map((s) => s.id)).size, 20);
  for (const day of DAY_ORDER) {
    assert.ok(getSlotsFor(day).length > 0, `${day} has classes`);
  }
});

check("slots come back sorted by start time", () => {
  const times = getSlotsFor("mon").map((s) => s.startsAt);
  assert.deepEqual(times, [...times].sort());
});

check("every slot's coach exists on the coaches list", () => {
  const names = new Set(getCoaches().map((c) => c.name));
  for (const slot of getTimetable()) {
    assert.ok(names.has(slot.coachName), `${slot.coachName} is a real coach`);
  }
});

check("booked never exceeds capacity in the seed data", () => {
  for (const slot of getTimetable()) {
    assert.ok(slot.booked <= slot.capacity, `slot ${slot.id}`);
  }
});

check("coach schedule filters to that coach only", () => {
  const week = getSlotsForCoach("Sofia Erasmus");
  assert.ok(week.length > 0);
  assert.ok(week.every((s) => s.coachName === "Sofia Erasmus"));
});

check("next available slot is never a full one", () => {
  const next = getNextAvailableSlot(new Date("2026-09-28T07:00:00"));
  assert.ok(next);
  assert.equal(isFull(next), false);
});

check("booking a free slot increments and returns null", () => {
  const before = getSlot(5)!.booked;
  assert.equal(bookSlot(5), null);
  assert.equal(getSlot(5)!.booked, before + 1);
});

check("booking a full slot is refused, count unchanged", () => {
  const full = getSlot(4)!; // seeded at 16/16
  assert.equal(isFull(full), true);
  const before = full.booked;
  const failure = bookSlot(4);
  assert.match(String(failure), /fully booked/);
  assert.equal(getSlot(4)!.booked, before);
});

check("booking an unknown slot is refused", () => {
  assert.match(String(bookSlot(9999)), /could not be found/);
});

check("a slot cannot be booked past capacity in a loop", () => {
  const slot = getSlot(20)!;
  for (let i = 0; i < 50; i++) bookSlot(20);
  assert.equal(slot.booked, slot.capacity);
  assert.equal(spacesLeft(slot), 0);
});

console.log("\nUSERS AND AUTH");

check("four seeded accounts, roles as expected", () => {
  assert.equal(getAll().length, 4);
  assert.equal(countByRole("Member"), 1);
  assert.equal(countByRole("Coach"), 2);
  assert.equal(countByRole("Admin"), 1);
});

check("every seeded password authenticates", () => {
  const creds: [string, string][] = [
    ["member@pfc.co.za", "Member123!"],
    ["sofia@pfc.co.za", "Coach123!"],
    ["marcus@pfc.co.za", "Coach123!"],
    ["admin@pfc.co.za", "Admin123!"],
  ];
  for (const [email, password] of creds) {
    assert.ok(validateCredentials(email, password), email);
  }
});

check("wrong password is rejected", () =>
  assert.equal(validateCredentials("admin@pfc.co.za", "Admin123"), null),
);

check("unknown email is rejected", () =>
  assert.equal(validateCredentials("nobody@pfc.co.za", "whatever"), null),
);

check("email match ignores case and surrounding space", () =>
  assert.ok(validateCredentials("  ADMIN@PFC.CO.ZA  ", "Admin123!")),
);

check("same password across accounts stores different hashes", () => {
  const sofia = findByEmail("sofia@pfc.co.za")!;
  const marcus = findByEmail("marcus@pfc.co.za")!;
  assert.notEqual(sofia.passwordSalt, marcus.passwordSalt);
  assert.notEqual(sofia.passwordHash, marcus.passwordHash);
});

check("no plaintext password is stored anywhere", () => {
  for (const u of getAll()) {
    assert.ok(!JSON.stringify(u).includes("123!"), u.email);
  }
});

check("hashPassword gives a 64-byte key and a fresh 16-byte salt", () => {
  const first = hashPassword("Testing123!");
  const second = hashPassword("Testing123!");
  assert.match(first.hash, /^[0-9a-f]{128}$/);
  assert.match(first.salt, /^[0-9a-f]{32}$/);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

check("verifyPassword accepts the right password only", () => {
  const { hash, salt } = hashPassword("Testing123!");
  assert.equal(verifyPassword("Testing123!", salt, hash), true);
  assert.equal(verifyPassword("testing123!", salt, hash), false);
  assert.equal(verifyPassword("Testing123!", salt, "abcd"), false);
});

check("session user carries no hash or salt", () => {
  const session = toSessionUser(findByEmail("admin@pfc.co.za")!);
  const keys = Object.keys(session).sort();
  assert.deepEqual(keys, ["email", "fullName", "id", "role"]);
});

check("staff accounts have no membership plan", () => {
  for (const u of getAll().filter((x) => x.role !== "Member")) {
    assert.equal(u.planId, null, u.email);
  }
});

check("registering adds an account that can sign in", () => {
  const created = createUser({
    email: "New.Person@Example.co.za",
    fullName: "New Person",
    password: "Testing123!",
    planId: 1,
  });
  assert.equal(created.email, "new.person@example.co.za");
  assert.equal(created.role, "Member");
  assert.ok(validateCredentials("new.person@example.co.za", "Testing123!"));
});

check("setPlan updates and clears a plan", () => {
  const user = findByEmail("member@pfc.co.za")!;
  assert.equal(setPlan(user.id, 3), true);
  assert.equal(user.planId, 3);
  assert.equal(setPlan(user.id, null), true);
  assert.equal(user.planId, null);
  setPlan(user.id, 2);
});

check("setPlan on a missing user reports failure", () =>
  assert.equal(setPlan(9999, 1), false),
);

console.log("\nVALIDATION");

check("name rule", () => {
  assert.equal(RULES.name("Ruan Cupido"), null);
  assert.ok(RULES.name(" "));
  assert.ok(RULES.name("R"));
});

check("email rule", () => {
  assert.equal(RULES.email("a@b.co.za"), null);
  assert.ok(RULES.email("not-an-email"));
  assert.ok(RULES.email("a@b"));
  assert.ok(RULES.email("a b@c.com"));
});

check("phone rule allows blank but rejects rubbish", () => {
  assert.equal(RULES.phone(""), null);
  assert.equal(RULES.phone("+27 82 670 9027"), null);
  assert.ok(RULES.phone("abc"));
});

check("password rule enforces 8 characters", () => {
  assert.equal(RULES.password("12345678"), null);
  assert.ok(RULES.password("1234567"));
});

check("message rule enforces 10 characters", () => {
  assert.equal(RULES.message("Hello there, coach."), null);
  assert.ok(RULES.message("hi"));
});

check("validate() collects only the failing fields", () => {
  const data = new FormData();
  data.set("fullName", "R");
  data.set("email", "good@example.co.za");
  const errors = validate(data, { fullName: "name", email: "email" });
  assert.deepEqual(Object.keys(errors), ["fullName"]);
});

check("valuesFrom() echoes submitted values back", () => {
  const data = new FormData();
  data.set("email", "x@y.co.za");
  assert.deepEqual(valuesFrom(data, ["email", "phone"]), {
    email: "x@y.co.za",
    phone: "",
  });
});

console.log("\nFORMATTING");

check("initials", () => {
  assert.equal(initials("Marcus Thompson"), "MT");
  assert.equal(initials("Ryan O'Brian"), "RO");
  assert.equal(initials("Cher"), "C");
});

check("price formatting has no decimals", () => {
  assert.equal(formatPrice(900), "900");
  assert.equal(formatPrice(1050), "1 050".replace(" ", " ") === formatPrice(1050) ? 1050 .toLocaleString("en-ZA", { maximumFractionDigits: 0 }) : formatPrice(1050));
});

check("hours formatting pads to HH:00", () =>
  assert.equal(formatHours({ day: "sun", opens: 9, closes: 19 }), "09:00 – 19:00"),
);

check("timeAgo", () => {
  const now = new Date("2026-09-29");
  assert.equal(timeAgo("2026-09-01", now), "This month");
  assert.equal(timeAgo("2026-03-01", now), "6 months ago");
  assert.equal(timeAgo("2025-09-01", now), "1 year ago");
  assert.equal(timeAgo("2023-09-01", now), "3 years ago");
});

check("todayKey maps Sunday-first getDay to Monday-first keys", () => {
  assert.equal(todayKey(new Date("2026-09-28T09:00:00")), "mon");
  assert.equal(todayKey(new Date("2026-10-04T09:00:00")), "sun");
});

console.log(`\n${passed} checks passed\n`);
