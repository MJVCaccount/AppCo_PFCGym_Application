import { NextResponse } from "next/server";

import { jsonError, rateLimitedResponse, withSession } from "@/lib/api";
import { uploadPublicImage } from "@/lib/services/imageService";
import { assertSameOrigin } from "@/lib/origin";
import { checkLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/uploads/image  (multipart: file)
 *
 * Administrators only. Stores a coach or event image in the public store and
 * answers { url }, which the form puts in its image field.
 */
export async function POST(request: Request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withSession(
    "POST /api/admin/uploads/image",
    "Could not upload the image.",
    async (session) => {
      const limit = await checkLimit("upload", String(session.id));
      if (!limit.allowed) return rateLimitedResponse(limit);

      const result = await uploadPublicImage(session, request);

      if (!result.ok || !result.data) {
        return jsonError(result.error ?? "The image could not be uploaded.", result.status);
      }

      return NextResponse.json({ url: result.data.url }, { status: result.status });
    },
  );
}
