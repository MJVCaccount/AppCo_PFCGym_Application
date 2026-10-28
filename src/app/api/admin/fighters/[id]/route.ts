import { jsonResult, pathId } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { demoteFighter } from "@/lib/services/fighterService";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/fighters/:id
 *
 * Admin only. Puts a fighter back to Member; refused with 409 while the
 * fighter has any bout offer or document.
 */
export const DELETE = userRoute(
  {
    name: "DELETE /api/admin/fighters/[id]",
    failure: "Could not demote the fighter.",
    limit: "admin",
  },
  async ({ session, params }) =>
    jsonResult(await demoteFighter(session, pathId((await params()).id ?? ""))),
);

export const { GET, POST, PUT, PATCH } = methodNotAllowed(["DELETE"]);
