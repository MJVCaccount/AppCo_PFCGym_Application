import { NextResponse } from "next/server";

import { getClasses } from "@/lib/repositories/classesRepository";

export async function GET() {
  try {
    return NextResponse.json({ data: getClasses() });
  } catch {
    // Never leak the real error (stack trace, query, etc.) to the client.
    return NextResponse.json(
      { error: { message: "Could not load classes." } },
      { status: 500 },
    );
  }
}
