import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { createEvent } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events
 * { "name", "venue", "description", "eventDate", "imageUrl"? }
 *
 * Admin only. `eventDate` is an ISO date and time with a time zone.
 */
export async function POST(request: Request) {
  return withSession(
    "POST /api/admin/events",
    "Could not create the event.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      return jsonResult(await createEvent(session, body));
    },
  );
}
