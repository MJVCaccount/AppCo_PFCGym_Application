import { jsonResult, pathId, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { respondToOffer } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/fighter/offers/:id/respond  { "response": "Accepted" | "Declined" }
 *
 * The HTTP counterpart to `respondToOfferAction` in actions/fighter.ts.
 * Someone else's offer answers 404, the same as one that does not exist.
 */
export const POST = userRoute(
  {
    name: "POST /api/fighter/offers/[id]/respond",
    failure: "Could not save your answer.",
    limit: "respond",
  },
  async ({ request, session, params }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;

    const { id } = await params();
    return jsonResult(
      await respondToOffer(session, pathId(id ?? ""), read.body.response),
    );
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
