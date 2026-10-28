import { NextResponse } from "next/server";

import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { isReady } from "@/lib/services/healthService";

export const dynamic = "force-dynamic";

/**
 * Readiness: the server can reach its database. Used by the deploy pipeline's
 * smoke test. The failure body carries no detail on purpose; the reason is in
 * the server log.
 */
export const GET = publicRoute(
  { name: "GET /api/health/ready", failure: "Readiness check failed." },
  async () =>
    (await isReady())
      ? NextResponse.json({ status: "ok" })
      : NextResponse.json({ status: "unavailable" }, { status: 503 }),
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
