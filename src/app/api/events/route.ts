import { NextResponse } from "next/server";

import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { listPublicEvents } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/** GET /api/events: upcoming scheduled events, soonest first. Public. */
export const GET = publicRoute(
  {
    name: "GET /api/events",
    failure: "Could not load events.",
    limit: "publicRead",
    cache: "public, s-maxage=60, stale-while-revalidate=300",
  },
  async () => NextResponse.json({ data: await listPublicEvents() }),
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
