import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { respondToOffer } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/fighter/offers/:id/respond  { "response": "Accepted" | "Declined" }
 *
 * The HTTP counterpart to `respondToOfferAction` in actions/fighter.ts.
 * Someone else's offer answers 404, the same as one that does not exist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "POST /api/fighter/offers/[id]/respond",
    "Could not save your answer.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      const { id } = await params;
      return jsonResult(
        await respondToOffer(session, pathId(id), body.response),
      );
    },
  );
}
