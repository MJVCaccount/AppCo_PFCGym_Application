import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { uploadPublicImage } from "@/lib/services/imageService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/uploads/image  (multipart: file)
 *
 * Administrators only. Stores a coach or event image in the public store and
 * answers { url }, which the form puts in its image field.
 */
export const POST = userRoute(
  {
    name: "POST /api/admin/uploads/image",
    failure: "Could not upload the image.",
    limit: "upload",
  },
  async ({ request, session }) => {
    const result = await uploadPublicImage(session, request);

    if (!result.ok || !result.data) {
      return jsonError(
        result.error ?? "The image could not be uploaded.",
        result.status,
      );
    }

    return NextResponse.json({ url: result.data.url }, { status: result.status });
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
