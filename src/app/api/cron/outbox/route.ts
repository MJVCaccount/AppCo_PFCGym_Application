import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { bearerMatches, secretConfigured } from "@/lib/bearer";
import { runOutboxDrain } from "@/lib/services/maintenanceService";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/outbox
 *
 * Drains the email outbox and does nothing else: no deletions, no purge. Called
 * hourly by .github/workflows/outbox-drain.yml with the header
 * "Authorization: Bearer <CRON_SECRET>". Writes an audit row only if it sent or
 * parked something. Safe to run twice. With CRON_SECRET unset (or shorter than
 * 32 characters) the route answers 404, as if absent.
 */
export const GET = publicRoute(
  {
    name: "GET /api/cron/outbox",
    failure: "Could not drain the outbox.",
    limit: "secretRoute",
  },
  async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    if (!secretConfigured(secret)) return jsonError("That API route does not exist.", 404);

    if (!bearerMatches(request, secret)) {
      const denied = jsonError("A valid cron secret is required.", 401);
      denied.headers.set("WWW-Authenticate", "Bearer");
      return denied;
    }

    return NextResponse.json({ data: await runOutboxDrain() });
  },
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
