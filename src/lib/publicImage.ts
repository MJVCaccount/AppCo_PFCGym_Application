import { isOptionalString } from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";

/**
 * The one check for an image link on a coach or an event.
 *
 * Only an https link to the public Blob store is accepted, because that is the
 * only host `next/image` and the Content-Security-Policy let the site show.
 * Any other link would save fine and then silently render as the monogram or
 * as nothing. Blank, null and undefined all mean "no image".
 */

/** Vercel Blob serves public files from <store>.public.blob.vercel-storage.com. */
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export const IMAGE_URL_ERROR =
  "Image URL must be an https link to an uploaded image, or empty.";

export type ParsedImageUrl = { value: string | null } | { error: string };

export function parsePublicImageUrl(value: unknown): ParsedImageUrl {
  if (!isOptionalString(value)) return { error: IMAGE_URL_ERROR };

  const text = optionalText(value);
  if (text === null) return { value: null };

  try {
    const url = new URL(text);
    const allowed =
      url.protocol === "https:" && url.hostname.endsWith(BLOB_HOST_SUFFIX);
    return allowed ? { value: url.toString() } : { error: IMAGE_URL_ERROR };
  } catch {
    return { error: IMAGE_URL_ERROR };
  }
}
