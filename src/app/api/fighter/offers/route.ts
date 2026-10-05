import { jsonResult, withSession } from "@/lib/api";
import { listMyOffers } from "@/lib/services/fighterService";

export const dynamic = "force-dynamic";

/**
 * GET /api/fighter/offers
 *
 * The signed-in fighter's profile, open offers and bout history. 401 without
 * a session, 403 for any role other than Fighter.
 */
export async function GET() {
  return withSession(
    "GET /api/fighter/offers",
    "Could not load your offers.",
    async (session) => jsonResult(await listMyOffers(session)),
  );
}
