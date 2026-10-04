import {
  INVALID_BODY,
  jsonError,
  jsonResult,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { promoteToFighter } from "@/lib/services/fighterService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/fighters  { "memberId", "weightClass" }
 *
 * Admin only. Promotes a member to Fighter.
 */
export async function POST(request: Request) {
  return withSession(
    "POST /api/admin/fighters",
    "Could not promote the member.",
    async (session) => {
      const body = await readJsonObject(request);
      if (!body) return jsonError(INVALID_BODY, 400);

      return jsonResult(
        await promoteToFighter(session, body.memberId, body.weightClass),
      );
    },
  );
}
