import {
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { respondToOffer } from "@/lib/services/eventService";
import { assertSameOrigin } from "@/lib/origin";

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
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/fighter/offers/[id]/respond",
    "Could not save your answer.",
    async (session) => {
      const read = await readJsonObject(request);
      if (!read.ok) return read.response;
      const body = read.body;

      const { id } = await params;
      return jsonResult(
        await respondToOffer(session, pathId(id), body.response),
      );
    },
  );
}
