import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { bearerMatches, secretConfigured } from "@/lib/bearer";
import { getHealthDetail } from "@/lib/services/healthService";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/detail
 *
 * For an operator or a monitor, not for browsers: needs the header
 * "Authorization: Bearer <HEALTH_TOKEN>". Reports database latency and size,
 * applied versus expected migrations, row counts, the email outbox, the
 * rate-limit bucket count, and whether email and file storage are configured.
 * No secret, key or connection string is ever in the answer. With HEALTH_TOKEN
 * unset (or shorter than 32 characters) the route answers 404, as if absent.
 */
export const GET = publicRoute(
  {
    name: "GET /api/health/detail",
    failure: "Could not read the health detail.",
    limit: "secretRoute",
  },
  async ({ request }) => {
    const secret = process.env.HEALTH_TOKEN;
    if (!secretConfigured(secret)) return jsonError("That API route does not exist.", 404);

    if (!bearerMatches(request, secret)) {
      const denied = jsonError("A valid health token is required.", 401);
      denied.headers.set("WWW-Authenticate", "Bearer");
      return denied;
    }

    return NextResponse.json({ data: await getHealthDetail() });
  },
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
