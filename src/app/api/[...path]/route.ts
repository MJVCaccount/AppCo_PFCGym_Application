import { jsonError } from "@/lib/api";
import { NOT_ALLOWED, newRequestId } from "@/lib/apiHandler";
import { runWithRequest } from "@/lib/requestContext";

export const dynamic = "force-dynamic";

/**
 * Every path under /api that has no route of its own: a JSON 404 in the same
 * envelope as every other error, never an HTML page. A wrong method on a real
 * route is answered by that route (see methodNotAllowed).
 */
function notFound(request: Request): Response {
  const requestId = newRequestId(request.headers.get("x-request-id"));
  return runWithRequest(
    { requestId },
    () => {
      const response = jsonError("That API route does not exist.", 404);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Request-Id", requestId);
      return response;
    },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
(notFound as unknown as Record<symbol, boolean>)[NOT_ALLOWED] = true;
