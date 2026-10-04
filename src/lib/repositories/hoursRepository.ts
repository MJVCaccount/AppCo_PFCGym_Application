import "server-only";

import type { OpeningHours as HoursRow } from "@prisma/client";
import { cache } from "react";

import { currentDayAndHour } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { DAY_ORDER, type DayKey, type OpeningHours } from "@/lib/types";

/** Data-access layer for opening hours. */

function toHours(row: HoursRow): OpeningHours {
  return { day: row.day, opens: row.opens, closes: row.closes };
}

/**
 * The whole week, Monday first. Wrapped in React's cache so the header, the
 * footer and the page share one query per request.
 */
export const getOpeningHours = cache(async (): Promise<OpeningHours[]> => {
  const rows = await prisma.openingHours.findMany();

  return rows
    .map(toHours)
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
});

/** A day with no row in the table is treated as closed all day. */
export async function getHoursFor(day: DayKey): Promise<OpeningHours> {
  const week = await getOpeningHours();
  return week.find((h) => h.day === day) ?? { day, opens: 0, closes: 0 };
}

/** Whether the gym is open at `now`, on the gym's own clock. */
export async function isOpenAt(now: Date = new Date()): Promise<boolean> {
  const { day, hour } = currentDayAndHour(now);
  const hours = await getHoursFor(day);

  return hour >= hours.opens && hour < hours.closes;
}
