import { jsonResult, withSession } from "@/lib/api";
import { uploadFighterDocument } from "@/lib/services/documentService";

export const dynamic = "force-dynamic";

/**
 * POST /api/fighter/documents  (multipart: type = Medical | Licence | Other, file)
 *
 * Fighters only. The file goes to the private store through this route, never
 * from the browser: a client upload cannot be made private.
 */
export async function POST(request: Request) {
  return withSession(
    "POST /api/fighter/documents",
    "Could not save your document.",
    async (session) => jsonResult(await uploadFighterDocument(session, request)),
  );
}
