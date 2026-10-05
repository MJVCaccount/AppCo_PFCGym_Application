import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { pingDatabase } from "@/lib/repositories/healthRepository";

export const dynamic = "force-dynamic";

/**
 * Readiness: the server can reach its database. Used by the deploy pipeline's
 * smoke test. The failure body carries no detail on purpose; the reason is in
 * the server log.
 */
export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    logger.error("Readiness check failed", { error: e });
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
