import "server-only";

import { jsonError } from "@/lib/api";
import { appUrl } from "@/lib/env";

/**
 * Same-origin check for state-changing API routes (POST, PATCH, DELETE).
 *
 * The session cookie is sameSite=lax, which already keeps it off cross-site
 * POSTs; this is the second layer. The Origin header (or Referer, when a
 * browser leaves Origin out) must name the host in APP_URL. A request with
 * neither is refused: browsers always send one on a write, so only a
 * hand-built request lacks both.
 *
 * Server actions are not checked here: Next compares Origin to Host itself.
 *
 * Returns the 403 response to send, or null when the request may go on.
 */
export function assertSameOrigin(request: Request): Response | null {
  if (isSameOrigin(request)) return null;

  return jsonError("Cross-origin requests are not allowed.", 403);
}

export function isSameOrigin(request: Request): boolean {
  let expectedHost: string;
  try {
    expectedHost = new URL(appUrl()).host;
  } catch {
    return false;
  }

  const source =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;

  try {
    return new URL(source).host === expectedHost;
  } catch {
    // Includes the literal Origin "null" sent from sandboxed frames.
    return false;
  }
}
