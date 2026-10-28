import { jsonResult, pathId } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { cancelBooking } from "@/lib/services/bookingService";

export const dynamic = "force-dynamic";

/**
 * POST /api/bookings/:id/cancel
 *
 * The HTTP counterpart to `cancelBookingAction` in actions/gym.ts. Someone
 * else's booking answers 404, the same as one that does not exist.
 */
export const POST = userRoute(
  {
    name: "POST /api/bookings/[id]/cancel",
    failure: "Could not cancel the booking.",
    unauthenticated: "Sign in to cancel a booking.",
    limit: "cancel",
  },
  async ({ session, params }) =>
    jsonResult(await cancelBooking(session, pathId((await params()).id ?? ""))),
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
