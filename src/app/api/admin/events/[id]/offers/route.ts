import { jsonResult, pathId, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { offerBout } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events/:id/offers
 * { "fighterId", "opponentName"?, "boutWeightClass"?, "boutNotes"? }
 *
 * Admin only. The optional fields may be left out, null or empty.
 */
export const POST = userRoute(
  {
    name: "POST /api/admin/events/[id]/offers",
    failure: "Could not create the offer.",
    limit: "admin",
  },
  async ({ request, session, params }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;

    const { id } = await params();
    return jsonResult(
      await offerBout(session, pathId(id ?? ""), read.body.fighterId, read.body),
    );
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
