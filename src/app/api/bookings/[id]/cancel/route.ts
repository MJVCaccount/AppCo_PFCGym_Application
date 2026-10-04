import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { cancelBooking } from "@/lib/services/bookingService";
import { getSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings/:id/cancel
 *
 * The HTTP counterpart to `cancelBookingAction` in actions/gym.ts. Someone
 * else's booking answers 404, the same as one that does not exist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: { message: "Sign in to cancel a booking." } },
        { status: 401 },
      );
    }

    const { id } = await params;
    // Number("") is 0 and Number("1e2") is 100, so only plain digits count.
    const bookingId = /^\d+$/.test(id) ? Number(id) : NaN;

    const result = await cancelBooking(session, bookingId);

    if (!result.ok) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: result.status },
      );
    }

    return NextResponse.json({ data: result.booking }, { status: result.status });
  } catch (e) {
    logger.error("POST /api/bookings/[id]/cancel failed", { error: e });
    return NextResponse.json(
      { error: { message: "Could not cancel the booking." } },
      { status: 500 },
    );
  }
}
