import { NextResponse } from "next/server";

import { createBooking } from "@/lib/services/bookingService";
import { getSession } from "@/lib/session";

/**
 * POST /api/bookings  { "slotId": number }
 *
 * The HTTP counterpart to the `book` server action in actions/gym.ts — both
 * call the same booking service, so the business rules live in one place.
 * This route is what a mobile client or an external caller would use; the
 * server action stays for the existing timetable page form.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: { message: "Sign in to book a class." } },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: { message: "Request body must be valid JSON." } },
        { status: 400 },
      );
    }

    const slotId =
      typeof body === "object" && body !== null && "slotId" in body
        ? Number((body as Record<string, unknown>).slotId)
        : NaN;

    const result = createBooking(session, slotId);

    if (!result.ok) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: result.status },
      );
    }

    return NextResponse.json({ data: result.slot }, { status: result.status });
  } catch {
    return NextResponse.json(
      { error: { message: "Could not complete the booking." } },
      { status: 500 },
    );
  }
}
