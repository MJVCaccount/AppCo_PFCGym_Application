import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { recordResult } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/participations/:id/result
 * { "result": "Win" | "Loss" | "Draw" | "NoContest" | null, "notes"? }
 *
 * Admin only. `result` must be sent: null clears a recorded result, so a body
 * that simply forgot it is refused rather than read as "clear".
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "PATCH /api/admin/participations/[id]/result",
    "Could not record the result.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      const { id } = await params;
      return jsonResult(
        await recordResult(session, pathId(id), body.result, body.notes),
      );
    },
  );
}
