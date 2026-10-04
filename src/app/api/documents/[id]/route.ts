import { NextResponse } from "next/server";

import { jsonError, pathId, withSession } from "@/lib/api";
import { openDocument } from "@/lib/services/documentService";
import { contentDisposition } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents/:id
 *
 * Streams a fighter's document to its owner or an administrator. Everyone
 * else gets 404, not 403. The blob's own URL is never sent to the client: the
 * file is fetched here with the store's credentials and passed through, as a
 * download that the browser must not try to display or sniff.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSession(
    "GET /api/documents/[id]",
    "Could not open the document.",
    async (session) => {
      const { id } = await params;
      const result = await openDocument(session, pathId(id));

      if (!result.ok || !result.data) {
        return jsonError(result.error ?? "That document could not be found.", result.status);
      }

      return new NextResponse(result.data.stream, {
        status: 200,
        headers: {
          "Content-Type": result.data.contentType,
          "Content-Disposition": contentDisposition(result.data.fileName),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    },
  );
}
