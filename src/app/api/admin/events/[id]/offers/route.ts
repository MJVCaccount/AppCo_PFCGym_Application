import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { offerBout } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events/:id/offers
 * { "fighterId", "opponentName"?, "boutWeightClass"?, "boutNotes"? }
 *
 * Admin only. The optional fields may be left out, null or empty.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "POST /api/admin/events/[id]/offers",
    "Could not create the offer.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      const { id } = await params;
      return jsonResult(
        await offerBout(session, pathId(id), body.fighterId, body),
      );
    },
  );
}
