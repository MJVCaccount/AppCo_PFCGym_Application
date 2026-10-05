import { logout } from "@/actions/auth";
import { currentDayAndHour } from "@/lib/dates";
import { getHoursFor } from "@/lib/repositories/hoursRepository";
import { getSession } from "@/lib/session";
import { formatHours } from "@/lib/types";

import SiteNav from "./SiteNav";

/**
 * Server wrapper: reads the session and today's hours, then hands them to the
 * client component that owns the menu's open state.
 */
export default async function Header() {
  const [session, hours] = await Promise.all([
    getSession(),
    getHoursFor(currentDayAndHour(new Date()).day),
  ]);

  return (
    <SiteNav
      session={session}
      todayHours={formatHours(hours)}
      logoutAction={logout}
    />
  );
}
