import { jsonResult, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { createEvent } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events
 * { "name", "venue", "description", "eventDate", "imageUrl"? }
 *
 * Admin only. `eventDate` is an ISO date and time with a time zone.
 */
export const POST = userRoute(
  { name: "POST /api/admin/events", failure: "Could not create the event.", limit: "admin" },
  async ({ request, session }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;

    return jsonResult(await createEvent(session, read.body));
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
