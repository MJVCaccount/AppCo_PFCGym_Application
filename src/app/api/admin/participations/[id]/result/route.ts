import {
  jsonResult,
  pathId,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { recordResult } from "@/lib/services/eventService";
import { assertSameOrigin } from "@/lib/origin";

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
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "PATCH /api/admin/participations/[id]/result",
    "Could not record the result.",
    async (session) => {
      const read = await readJsonObject(request);
      if (!read.ok) return read.response;
      const body = read.body;

      const { id } = await params;
      return jsonResult(
        await recordResult(session, pathId(id), body.result, body.notes),
      );
    },
  );
}
