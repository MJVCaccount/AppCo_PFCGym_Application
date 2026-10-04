import "server-only";

import { logger } from "@/lib/logger";
import {
  ADMIN_ONLY,
  fail,
  isAdmin,
  succeed,
} from "@/lib/services/serviceResult";
import type { ServiceResult, SessionUser } from "@/lib/types";
import {
  generatePathname,
  isStoreNotConfigured,
  publicBlobs,
  readUpload,
} from "@/lib/uploads";

/**
 * Coach and event images. These are public by design: the returned URL goes
 * into the coach or event form and is shown on the public site. Admin only.
 */
export async function uploadPublicImage(
  session: SessionUser,
  request: Request,
): Promise<ServiceResult<{ url: string }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  const read = await readUpload(request, "image");
  if (!read.ok) return fail(read.status, read.error);

  try {
    const url = await publicBlobs.put(
      generatePathname("image", read.upload.mediaType),
      read.upload.bytes,
      read.upload.mediaType,
    );

    return succeed({ url }, 201);
  } catch (e) {
    logger.error("Image storage failed", { error: e });
    return fail(
      isStoreNotConfigured(e) ? 503 : 502,
      "Image storage is not available right now. Please try again later.",
    );
  }
}
