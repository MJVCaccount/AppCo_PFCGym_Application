import { NextResponse } from "next/server";

import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";

export const dynamic = "force-dynamic";

/**
 * Liveness: the server is up and can answer. Deliberately shallow, with no
 * database call, so a database outage does not make the platform restart a
 * healthy server. /api/health/ready is the check that includes the database.
 */
export const GET = publicRoute(
  { name: "GET /api/health", failure: "Health check failed." },
  async () => NextResponse.json({ status: "ok" }),
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
