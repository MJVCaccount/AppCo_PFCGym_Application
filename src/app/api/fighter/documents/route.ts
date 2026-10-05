import { jsonResult, rateLimitedResponse, withSession } from "@/lib/api";
import { uploadFighterDocument } from "@/lib/services/documentService";
import { assertSameOrigin } from "@/lib/origin";
import { checkLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/fighter/documents  (multipart: type = Medical | Licence | Other, file)
 *
 * Fighters only. The file goes to the private store through this route, never
 * from the browser: a client upload cannot be made private.
 */
export async function POST(request: Request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/fighter/documents",
    "Could not save your document.",
    async (session) => {
      const limit = await checkLimit("upload", String(session.id));
      if (!limit.allowed) return rateLimitedResponse(limit);

      return jsonResult(await uploadFighterDocument(session, request));
    },
  );
}
