import { jsonResult, pathId, withSession } from "@/lib/api";
import { deleteMyDocument } from "@/lib/services/documentService";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/fighter/documents/:id
 *
 * The owner only, and only while the document is Pending or Rejected.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "DELETE /api/fighter/documents/[id]",
    "Could not delete the document.",
    async (session) => {
      const { id } = await params;
      return jsonResult(await deleteMyDocument(session, pathId(id)));
    },
  );
}
