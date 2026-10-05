import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { listPublicEvents } from "@/lib/services/eventService";

export const dynamic = "force-dynamic";

/** GET /api/events — upcoming scheduled events, soonest first. Public. */
export async function GET() {
  try {
    return NextResponse.json({ data: await listPublicEvents() });
  } catch (e) {
    logger.error("GET /api/events failed", { error: e });
    return jsonError("Could not load events.", 500);
  }
}
