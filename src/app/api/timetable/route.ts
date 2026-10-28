import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { getSlotsFor, getTimetable } from "@/lib/services/timetableService";
import { DAY_ORDER, type DayKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_DAYS: readonly string[] = DAY_ORDER;

/**
 * GET /api/timetable?day=mon: day is optional; omitted returns the full week.
 * Never cached: the booked counts change with every booking.
 */
export const GET = publicRoute(
  { name: "GET /api/timetable", failure: "Could not load the timetable.", limit: "publicRead" },
  async ({ request }) => {
    const day = new URL(request.url).searchParams.get("day");

    if (day !== null && !VALID_DAYS.includes(day)) {
      return jsonError(`day must be one of: ${DAY_ORDER.join(", ")}`, 400);
    }

    const slots = day ? await getSlotsFor(day as DayKey) : await getTimetable();
    return NextResponse.json({ data: slots });
  },
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
