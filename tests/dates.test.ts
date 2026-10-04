/**
 * nextOccurrence must answer in Africa/Johannesburg time (UTC+2, no DST)
 * whatever time zone the server clock is in, so every "now" below is given as
 * an explicit UTC instant.
 */
import assert from "node:assert/strict";

import {
  currentDayAndHour,
  hasSessionStarted,
  isoDate,
  nextOccurrence,
} from "../src/lib/dates";
import type { DayKey } from "../src/lib/types";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

function next(day: DayKey, startsAt: string, nowUtc: string): string {
  return nextOccurrence(day, startsAt, new Date(nowUtc))
    .toISOString()
    .slice(0, 10);
}

console.log("\nNEXT OCCURRENCE");

// 2026-10-05 is a Monday.

check("same day before the start time is today", () => {
  // Monday 06:00 SAST
  assert.equal(next("mon", "06:30", "2026-10-05T04:00:00Z"), "2026-10-05");
});

check("same day after the start time rolls to next week", () => {
  // Monday 07:00 SAST
  assert.equal(next("mon", "06:30", "2026-10-05T05:00:00Z"), "2026-10-12");
});

check("a class starting this very minute has already started", () => {
  // Monday 06:30 SAST
  assert.equal(next("mon", "06:30", "2026-10-05T04:30:00Z"), "2026-10-12");
});

check("a later day this week", () => {
  // Monday 12:00 SAST
  assert.equal(next("thu", "17:00", "2026-10-05T10:00:00Z"), "2026-10-08");
});

check("an earlier weekday wraps into next week", () => {
  // Friday 12:00 SAST
  assert.equal(next("tue", "09:30", "2026-10-09T10:00:00Z"), "2026-10-13");
});

check("Sunday night in UTC is already Monday in Johannesburg", () => {
  // Sunday 22:30 UTC = Monday 00:30 SAST
  const now = "2026-10-04T22:30:00Z";
  assert.equal(next("mon", "06:30", now), "2026-10-05");
  assert.equal(next("sun", "10:30", now), "2026-10-11");
});

check("Sunday evening in Johannesburg points at tomorrow's Monday class", () => {
  // Sunday 20:00 SAST
  assert.equal(next("mon", "06:30", "2026-10-04T18:00:00Z"), "2026-10-05");
});

check("wraps across a month and year end", () => {
  // Thursday 31 December 2026, 12:00 SAST
  assert.equal(next("fri", "12:00", "2026-12-31T10:00:00Z"), "2027-01-01");
});

check("returns a date-only value at UTC midnight", () => {
  const date = nextOccurrence("wed", "09:30", new Date("2026-10-05T10:00:00Z"));
  assert.equal(date.toISOString(), "2026-10-07T00:00:00.000Z");
});

console.log("\nGYM CLOCK");

check("currentDayAndHour gives the Johannesburg weekday and hour", () => {
  // Monday 10:00 UTC = Monday 12:00 SAST
  assert.deepEqual(currentDayAndHour(new Date("2026-10-05T10:00:00Z")), {
    day: "mon",
    hour: 12,
  });
  // Monday 22:00 UTC = Tuesday 00:00 SAST
  assert.deepEqual(currentDayAndHour(new Date("2026-10-05T22:00:00Z")), {
    day: "tue",
    hour: 0,
  });
});

check("isoDate formats a date-only value", () => {
  assert.equal(isoDate(new Date("2026-10-07T00:00:00.000Z")), "2026-10-07");
});

check("a session has not started before its time on the day", () => {
  const monday = new Date("2026-10-05T00:00:00.000Z");
  // Monday 06:29 SAST
  assert.equal(
    hasSessionStarted(monday, "06:30", new Date("2026-10-05T04:29:00Z")),
    false,
  );
  // Sunday 23:59 SAST
  assert.equal(
    hasSessionStarted(monday, "06:30", new Date("2026-10-04T21:59:00Z")),
    false,
  );
});

check("a session has started from its start minute onwards", () => {
  const monday = new Date("2026-10-05T00:00:00.000Z");
  // Monday 06:30 SAST
  assert.equal(
    hasSessionStarted(monday, "06:30", new Date("2026-10-05T04:30:00Z")),
    true,
  );
  // Tuesday 00:10 SAST, which is still Monday in UTC
  assert.equal(
    hasSessionStarted(monday, "23:30", new Date("2026-10-05T22:10:00Z")),
    true,
  );
});

check("hasSessionStarted agrees with nextOccurrence", () => {
  const now = new Date("2026-10-05T05:00:00Z"); // Monday 07:00 SAST
  for (const startsAt of ["06:30", "07:00", "07:01", "19:00"]) {
    const next = nextOccurrence("mon", startsAt, now);
    assert.equal(hasSessionStarted(next, startsAt, now), false, startsAt);
  }
});

console.log(`\n${passed} checks passed\n`);
