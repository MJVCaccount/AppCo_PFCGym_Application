import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api";
import { methodNotAllowed, publicRoute } from "@/lib/apiHandler";
import { bearerMatches, secretConfigured } from "@/lib/bearer";
import { runMaintenance } from "@/lib/services/maintenanceService";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/maintenance
 *
 * Run once a day by Vercel Cron, which sends the header
 * "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set. Deletes
 * expired or used password-reset tokens and expired rate-limit counters, and
 * drains the email outbox. Safe to run twice. With CRON_SECRET unset (or
 * shorter than 32 characters) the route answers 404, as if absent.
 */
export const GET = publicRoute(
  {
    name: "GET /api/cron/maintenance",
    failure: "Maintenance failed.",
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

    const report = await runMaintenance();
    return NextResponse.json({ data: report });
  },
);

export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
