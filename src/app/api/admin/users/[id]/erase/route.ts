import { jsonResult, pathId } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { eraseAccount } from "@/lib/services/erasureService";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/:id/erase
 *
 * Admin only. Anonymises a member or fighter (name, email, phone), deactivates
 * the account, deletes their documents and files, and keeps bookings and the
 * audit trail. Irreversible. Staff accounts and your own are refused (409).
 */
export const POST = userRoute(
  {
    name: "POST /api/admin/users/[id]/erase",
    failure: "Could not erase the account.",
    limit: "admin",
  },
  async ({ session, params }) =>
    jsonResult(await eraseAccount(session, pathId((await params()).id ?? ""))),
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
