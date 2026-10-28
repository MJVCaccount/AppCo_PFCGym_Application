import { jsonResult, pathId, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { recordResult } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/participations/:id/result
 * { "result": "Win" | "Loss" | "Draw" | "NoContest" | null, "notes"? }
 *
 * Admin only. `result` must be sent: null clears a recorded result, so a body
 * that simply forgot it is refused rather than read as "clear".
 */
export const PATCH = userRoute(
  {
    name: "PATCH /api/admin/participations/[id]/result",
    failure: "Could not record the result.",
    limit: "admin",
  },
  async ({ request, session, params }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;

    const { id } = await params();
    return jsonResult(
      await recordResult(session, pathId(id ?? ""), read.body.result, read.body.notes),
    );
  },
);

export const { GET, POST, PUT, DELETE } = methodNotAllowed(["PATCH"]);
