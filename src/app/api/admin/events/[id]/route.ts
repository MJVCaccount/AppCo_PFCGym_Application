import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import {
  cancelEvent,
  completeEvent,
  updateEvent,
} from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/events/:id
 *
 * Admin only. Two shapes:
 *   { "status": "Cancelled" | "Completed" }   cancel, or complete a past event
 *   { "name"?, "venue"?, "description"?, "eventDate"?, "imageUrl"? }   edit
 *
 * A status change is sent on its own, so one request does one thing.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "PATCH /api/admin/events/[id]",
    "Could not update the event.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      const eventId = pathId((await params).id);

      if (body.status === undefined) {
        return jsonResult(await updateEvent(session, eventId, body));
      }

      if (Object.keys(body).length > 1) {
        return jsonError("Send status on its own, without other fields.", 400);
      }
      if (body.status === "Cancelled") {
        return jsonResult(await cancelEvent(session, eventId));
      }
      if (body.status === "Completed") {
        return jsonResult(await completeEvent(session, eventId));
      }

      return jsonError('status must be "Cancelled" or "Completed".', 400);
    },
  );
}
