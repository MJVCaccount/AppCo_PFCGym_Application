import {
  jsonResult,
  readJsonObject,
  withSession,
} from "@/lib/api";
import { promoteToFighter } from "@/lib/services/fighterService";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/fighters  { "memberId", "weightClass" }
 *
 * Admin only. Promotes a member to Fighter.
 */
export async function POST(request: Request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/admin/fighters",
    "Could not promote the member.",
    async (session) => {
      const read = await readJsonObject(request);
      if (!read.ok) return read.response;
      const body = read.body;

      return jsonResult(
        await promoteToFighter(session, body.memberId, body.weightClass),
      );
    },
  );
}
