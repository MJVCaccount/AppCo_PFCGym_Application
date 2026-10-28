import { jsonResult } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import {
  listMyDocuments,
  uploadFighterDocument,
} from "@/lib/services/documentService";

export const dynamic = "force-dynamic";

/**
 * GET /api/fighter/documents
 *
 * The signed-in fighter's own documents, newest first. Never includes where
 * the file is stored. 403 for any role other than Fighter.
 */
export const GET = userRoute(
  {
    name: "GET /api/fighter/documents",
    failure: "Could not load your documents.",
    limit: "userRead",
  },
  async ({ session }) => jsonResult(await listMyDocuments(session)),
);

/**
 * POST /api/fighter/documents  (multipart: type = Medical | Licence | Other, file)
 *
 * Fighters only. The file goes to the private store through this route, never
 * from the browser: a client upload cannot be made private.
 */
export const POST = userRoute(
  {
    name: "POST /api/fighter/documents",
    failure: "Could not save your document.",
    limit: "upload",
  },
  async ({ request, session }) =>
    jsonResult(await uploadFighterDocument(session, request)),
);

export const { PUT, PATCH, DELETE } = methodNotAllowed(["GET", "POST"]);
