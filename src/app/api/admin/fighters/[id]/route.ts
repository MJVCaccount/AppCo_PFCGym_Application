import { jsonResult, pathId, withSession } from "@/lib/api";
import { demoteFighter } from "@/lib/services/fighterService";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/fighters/:id
 *
 * Admin only. Puts a fighter back to Member; refused with 409 while the
 * fighter has any bout offer or document.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "DELETE /api/admin/fighters/[id]",
    "Could not demote the fighter.",
    async (session) => {
      const { id } = await params;
      return jsonResult(await demoteFighter(session, pathId(id)));
    },
  );
}
