import { NextResponse } from "next/server";

/** Liveness check for CI smoke tests and Vercel previews. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
