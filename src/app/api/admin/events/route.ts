import {
  jsonResult,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { createEvent } from "@/lib/services/eventService";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events
 * { "name", "venue", "description", "eventDate", "imageUrl"? }
 *
 * Admin only. `eventDate` is an ISO date and time with a time zone.
 */
export async function POST(request: Request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/admin/events",
    "Could not create the event.",
    async (session) => {
      const read = await readJsonObject(request);
      if (!read.ok) return read.response;
      const body = read.body;

      return jsonResult(await createEvent(session, body));
    },
  );
}
