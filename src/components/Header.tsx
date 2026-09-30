import { logout } from "@/actions/auth";
import { getHoursFor } from "@/lib/gym-data";
import { getSession } from "@/lib/session";
import { formatHours, todayKey } from "@/lib/types";

import SiteNav from "./SiteNav";

/**
 * Server wrapper: reads the session and today's hours, then hands them to the
 * client component that owns the menu's open state.
 */
export default async function Header() {
  const session = await getSession();
  const hours = getHoursFor(todayKey());

  return (
    <SiteNav
      session={session}
      todayHours={formatHours(hours)}
      logoutAction={logout}
    />
  );
}
