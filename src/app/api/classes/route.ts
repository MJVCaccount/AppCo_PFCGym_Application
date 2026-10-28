import { NextResponse } from "next/server";

import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { getClasses } from "@/lib/services/catalogueService";

export const dynamic = "force-dynamic";

/** GET /api/classes: the class programmes. Public, and the same for everyone. */
export const GET = publicRoute(
  {
    name: "GET /api/classes",
    failure: "Could not load classes.",
    limit: "publicRead",
    cache: "public, s-maxage=60, stale-while-revalidate=300",
  },
  async () => NextResponse.json({ data: await getClasses() }),
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
