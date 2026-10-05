import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness: the server is up and can answer. Deliberately shallow, with no
 * database call, so a database outage does not make the platform restart a
 * healthy server. /api/health/ready is the check that includes the database.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
