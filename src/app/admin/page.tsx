import { redirect } from "next/navigation";

import { requireRole } from "@/actions/auth";

export const dynamic = "force-dynamic";

/**
 * /admin has no page of its own: the dashboard is the overview, so the bare
 * address sends an administrator to the first section. Anyone else is
 * stopped by requireRole (login for a visitor, /denied for another role).
 */
export default async function AdminIndexPage(): Promise<never> {
  await requireRole("/admin", "Admin");
  redirect("/admin/classes");
}
