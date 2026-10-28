import { jsonResult } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { readJson } from "@/lib/json";
import { createBooking, getMyBookings } from "@/lib/services/bookingService";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings
 *
 * The signed-in member's bookings: `upcoming` (confirmed, not yet started,
 * soonest first) and `past` (everything else, newest first; a confirmed
 * booking whose day has passed reads as Completed). Staff get 403.
 */
export const GET = userRoute(
  {
    name: "GET /api/bookings",
    failure: "Could not load your bookings.",
    limit: "userRead",
    unauthenticated: "Sign in to see your bookings.",
  },
  async ({ session }) => jsonResult(await getMyBookings(session)),
);

/**
 * POST /api/bookings  { "slotId": number }
 *
 * The HTTP counterpart to the `book` server action in actions/gym.ts: both
 * call the same booking service, so the business rules live in one place.
 * This route is what a mobile client or an external caller would use; the
 * server action stays for the existing timetable page form.
 */
export const POST = userRoute(
  {
    name: "POST /api/bookings",
    failure: "Could not complete the booking.",
    unauthenticated: "Sign in to book a class.",
    limit: "booking",
  },
  async ({ request, session }) => {
    const read = await readJson(request);
    if (!read.ok) return read.response;
    const body = read.data;

    const slotId =
      typeof body === "object" && body !== null && "slotId" in body
        ? Number((body as Record<string, unknown>).slotId)
        : NaN;

    const result = await createBooking(session, slotId);

    // The response body is the class as it now stands, not the booking row.
    return jsonResult({ ...result, data: result.data?.slot });
  },
);

export const { PUT, PATCH, DELETE } = methodNotAllowed(["GET", "POST"]);
