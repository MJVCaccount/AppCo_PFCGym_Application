import { NextResponse } from "next/server";

import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import spec from "@/lib/openapi.json";

export const dynamic = "force-dynamic";

/**
 * GET /api/openapi.json: this API's OpenAPI 3.1 description. The source is
 * docs/openapi.yaml; `npm run openapi:build` writes the JSON copy served here.
 */
export const GET = publicRoute(
  {
    name: "GET /api/openapi.json",
    failure: "Could not load the API description.",
    limit: "publicRead",
    cache: "public, s-maxage=3600, stale-while-revalidate=86400",
  },
  async () => NextResponse.json(spec),
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
