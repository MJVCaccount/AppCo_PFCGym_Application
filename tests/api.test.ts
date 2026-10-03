import assert from "node:assert/strict";

import { createBooking } from "../src/lib/services/bookingService";
import { GET as getClassesRoute } from "../src/app/api/classes/route";
import { GET as getTimetableRoute } from "../src/app/api/timetable/route";
import { GET as getHealthRoute } from "../src/app/api/health/route";
import type { SessionUser } from "../src/lib/types";

/**
 * API / service-layer tests.
 *
 * `createBooking` takes the session as a parameter rather than reading it
 * from `next/headers` itself, so it runs directly under tsx like the other
 * test files. The POST /api/bookings route (which does call getSession())
 * needs a real request scope — that one is covered by the curl checks in
 * the README instead.
 */

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

const memberWithPlan: SessionUser = {
  id: 1, // member@pfc.co.za — seeded with planId 2
  email: "member@pfc.co.za",
  fullName: "John Wick",
  role: "Member",
};

const coach: SessionUser = {
  id: 2, // sofia@pfc.co.za — a coach, planId is always null
  email: "sofia@pfc.co.za",
  fullName: "Sofia Erasmus",
  role: "Coach",
};

async function main() {
  console.log("\nBOOKING SERVICE");

  await check("rejects a non-numeric slot id", () => {
    const result = createBooking(memberWithPlan, Number("not-a-number"));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  await check("rejects a slot that does not exist", () => {
    const result = createBooking(memberWithPlan, 999_999);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  await check("blocks a Member with no active plan", () => {
    const noPlanMember: SessionUser = { ...memberWithPlan, id: 999 };
    // id 999 does not exist in users.ts, so findById returns undefined ->
    // treated the same as "no plan", which is the safe default.
    const result = createBooking(noPlanMember, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  await check("blocks booking a slot that is already full", () => {
    // Slot 4 is seeded at capacity 16 / booked 16.
    const result = createBooking(memberWithPlan, 4);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  await check("confirms a booking for a Member with a plan and lets a Coach through too", () => {
    const memberResult = createBooking(memberWithPlan, 1);
    assert.equal(memberResult.ok, true);
    assert.equal(memberResult.status, 201);
    assert.equal(memberResult.slot?.booked, 13); // was seeded at 12

    // Coaches/admins are staff, not members, so the plan check doesn't apply.
    const coachResult = createBooking(coach, 5);
    assert.equal(coachResult.ok, true);
    assert.equal(coachResult.status, 201);
  });

  console.log("\nAPI ROUTES (GET — no request scope needed)");

  await check("GET /api/health reports ok", async () => {
    const res = getHealthRoute();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: "ok" });
  });

  await check("GET /api/classes returns the seeded list", async () => {
    const res = await getClassesRoute();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(Array.isArray(body.data), true);
    assert.equal(body.data.length, 6);
  });

  await check("GET /api/timetable?day=mon filters to one day", async () => {
    const res = await getTimetableRoute(
      new Request("http://localhost/api/timetable?day=mon"),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
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

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
