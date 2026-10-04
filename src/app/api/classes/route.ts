import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getClasses } from "@/lib/repositories/programmesRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ data: await getClasses() });
  } catch (e) {
    // Never leak the real error (stack trace, query, etc.) to the client.
    logger.error("GET /api/classes failed", { error: e });
    return NextResponse.json(
      { error: { message: "Could not load classes." } },
      { status: 500 },
    );
  }
}
