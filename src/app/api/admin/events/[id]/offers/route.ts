import {
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { offerBout } from "@/lib/services/eventService";
import { assertSameOrigin } from "@/lib/origin";

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
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/admin/events/[id]/offers",
    "Could not create the offer.",
    async (session) => {
      const read = await readJsonObject(request);
      if (!read.ok) return read.response;
      const body = read.body;

      const { id } = await params;
      return jsonResult(
        await offerBout(session, pathId(id), body.fighterId, body),
      );
    },
  );
}
