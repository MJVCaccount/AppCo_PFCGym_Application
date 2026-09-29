import type { Metadata } from "next";

import { requireSession } from "@/actions/auth";
import { firstParam, type SearchParams } from "@/lib/types";
import Alert from "@/components/Alert";
import AdminDashboard from "./AdminDashboard";
import CoachDashboard from "./CoachDashboard";
import MemberDashboard from "./MemberDashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your PFC account.",
};

export const dynamic = "force-dynamic";

/**
 * One URL for all three roles. The session's role decides which dashboard
 * renders, so a coach visiting /dashboard lands on the coach view without a
 * separate route to guess at.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const welcome = firstParam(params.welcome);
  const session = await requireSession("/dashboard");

  const banner = welcome
    ? `Welcome to PFC, ${session.fullName.split(" ")[0]}. Your account is ready.`
    : notice;

  const board =
    session.role === "Admin" ? (
      <AdminDashboard session={session} />
    ) : session.role === "Coach" ? (
      <CoachDashboard session={session} />
    ) : (
      <MemberDashboard session={session} />
    );

  return (
    <>
      {banner && (
        <div className="wrap" style={{ paddingTop: 20 }}>
          <Alert kind="ok">{banner}</Alert>
        </div>
      )}
      {board}
    </>
  );
}
