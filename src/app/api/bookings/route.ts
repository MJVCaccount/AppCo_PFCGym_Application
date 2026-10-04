import { NextResponse } from "next/server";

import { rateLimitedResponse } from "@/lib/api";
import { readJson } from "@/lib/json";
import { logger } from "@/lib/logger";
import { checkLimit } from "@/lib/rateLimit";
import { createBooking } from "@/lib/services/bookingService";
import { getSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings  { "slotId": number }
 *
 * The HTTP counterpart to the `book` server action in actions/gym.ts — both
 * call the same booking service, so the business rules live in one place.
 * This route is what a mobile client or an external caller would use; the
 * server action stays for the existing timetable page form.
 */
export async function POST(request: Request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: { message: "Sign in to book a class." } },
        { status: 401 },
      );
    }

    const limit = await checkLimit("booking", String(session.id));
    if (!limit.allowed) return rateLimitedResponse(limit);

    const read = await readJson(request);
    if (!read.ok) return read.response;
    const body = read.data;

    const slotId =
      typeof body === "object" && body !== null && "slotId" in body
        ? Number((body as Record<string, unknown>).slotId)
        : NaN;

    const result = await createBooking(session, slotId);

    if (!result.ok) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: result.status },
      );
    }

    return NextResponse.json({ data: result.slot }, { status: result.status });
  } catch (e) {
    logger.error("POST /api/bookings failed", { error: e });
    return NextResponse.json(
      { error: { message: "Could not complete the booking." } },
      { status: 500 },
    );
  }
}
