import { jsonError, jsonResult, pathId, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
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
export const PATCH = userRoute(
  { name: "PATCH /api/admin/events/[id]", failure: "Could not update the event.", limit: "admin" },
  async ({ request, session, params }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;
    const body = read.body;

    const eventId = pathId((await params()).id ?? "");

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

export const { GET, POST, PUT, DELETE } = methodNotAllowed(["PATCH"]);
