import { jsonResult } from "@/lib/api";
import { methodNotAllowed, userRoute } from "@/lib/apiHandler";
import { signOutEverywhere } from "@/lib/services/authService";
import { destroySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/sign-out-everywhere
 *
 * Ends every session of the signed-in account, on every device, including
 * this one: the account's sessionVersion goes up, so each cookie issued
 * before now is refused on its next request. For a lost phone or a shared
 * computer. Any signed-in role; limited to 5 a hour.
 */
export const POST = userRoute(
  {
    name: "POST /api/account/sign-out-everywhere",
    failure: "Could not sign you out everywhere.",
    limit: "signOutEverywhere",
  },
  async ({ session }) => {
    const result = await signOutEverywhere(session);
    if (result.ok) await destroySession();

    return jsonResult(result);
  },
);

export const { GET, PUT, PATCH, DELETE } = methodNotAllowed(["POST"]);
