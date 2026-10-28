import { NextResponse } from "next/server";

import { jsonError, pathId } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
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
export const GET = userRoute(
  { name: "GET /api/documents/[id]", failure: "Could not open the document.", limit: "documentDownload" },
  async ({ session, params }) => {
    const result = await openDocument(session, pathId((await params()).id ?? ""));

    if (!result.ok || !result.data) {
      return jsonError(
        result.error ?? "That document could not be found.",
        result.status,
      );
    }

    return new NextResponse(result.data.stream, {
      status: 200,
      headers: {
        "Content-Type": result.data.contentType,
        "Content-Disposition": contentDisposition(result.data.fileName),
        "X-Content-Type-Options": "nosniff",
        // Whatever the file turns out to be, it may not run scripts, load
        // anything or navigate, even if a browser were to display it.
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
      },
    });
  },
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
