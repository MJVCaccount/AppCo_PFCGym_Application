import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getSlotsFor, getTimetable } from "@/lib/repositories/timetableRepository";
import { DAY_ORDER, type DayKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_DAYS: readonly string[] = DAY_ORDER;

/** GET /api/timetable?day=mon — day is optional; omitted returns the full week. */
export async function GET(request: Request) {
  try {
    const day = new URL(request.url).searchParams.get("day");

    if (day !== null && !VALID_DAYS.includes(day)) {
      return NextResponse.json(
        { error: { message: `day must be one of: ${DAY_ORDER.join(", ")}` } },
        { status: 400 },
      );
    }

    const slots = day
      ? await getSlotsFor(day as DayKey)
      : await getTimetable();
    return NextResponse.json({ data: slots });
  } catch (e) {
    logger.error("GET /api/timetable failed", { error: e });
    return NextResponse.json(
      { error: { message: "Could not load the timetable." } },
      { status: 500 },
    );
  }
}
