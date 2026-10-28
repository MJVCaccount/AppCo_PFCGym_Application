import { jsonResult, readJsonObject } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { promoteToFighter } from "@/lib/services/fighterService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/fighters  { "memberId", "weightClass" }
 *
 * Admin only. Promotes a member to Fighter.
 */
export const POST = userRoute(
  { name: "POST /api/admin/fighters", failure: "Could not promote the member.", limit: "admin" },
  async ({ request, session }) => {
    const read = await readJsonObject(request);
    if (!read.ok) return read.response;

    return jsonResult(
      await promoteToFighter(session, read.body.memberId, read.body.weightClass),
    );
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
