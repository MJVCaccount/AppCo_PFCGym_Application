import { jsonResult, pathId } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { deleteMyDocument } from "@/lib/services/documentService";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/fighter/documents/:id
 *
 * The owner only, and only while the document is Pending or Rejected.
 */
export const DELETE = userRoute(
  {
    name: "DELETE /api/fighter/documents/[id]",
    failure: "Could not delete the document.",
    limit: "documentDelete",
  },
  async ({ session, params }) =>
    jsonResult(await deleteMyDocument(session, pathId((await params()).id ?? ""))),
);

export const { GET, POST, PUT, PATCH } = methodNotAllowed(["DELETE"]);
