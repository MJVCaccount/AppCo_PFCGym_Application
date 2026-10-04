import Link from "next/link";

import { logout } from "@/actions/auth";
import { cancelMembership } from "@/actions/gym";
import { formatGymDate } from "@/lib/dates";
import { getPlan } from "@/lib/repositories/plansRepository";
import { memberStats } from "@/lib/services/coachService";
import { getNextAvailableSlot } from "@/lib/repositories/timetableRepository";
import { findById } from "@/lib/repositories/usersRepository";
import { DAY_NAMES, formatPrice, initials } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

/**
 * `roleLabel` and `children` exist for the fighter dashboard, which is this
 * page with the fighter's own sections above the membership ones.
 */
export default async function MemberDashboard({
  session,
  roleLabel = "Member",
  children,
}: {
  session: SessionUser;
  roleLabel?: string;
  children?: React.ReactNode;
}) {
  const [user, next, stats] = await Promise.all([
    findById(session.id),
    getNextAvailableSlot(),
    memberStats(session, session.id),
  ]);
  const plan =
    user?.planId != null
      ? await getPlan(user.planId, { includeInactive: true })
      : undefined;

  const attended = stats.data?.attendedThisMonth ?? 0;
  const upcoming = stats.data?.upcoming ?? 0;
  const planStarted = stats.data?.planStartedAt;

  return (
    <div className="dash">
      <aside className="dash__side">
        <Link
          className="btn btn--red btn--sm"
          href="/dashboard"
          aria-current="page"
        >
          Dashboard
        </Link>
        <div className="dash__user">
          <span className="dash__avatar" aria-hidden="true">
            {initials(session.fullName)}
          </span>
          <span>
            <b>{session.fullName}</b>
            <span>{roleLabel}</span>
          </span>
        </div>
      </aside>

      <div className="dash__main">
        <div className="wrap">
          {children}

          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Account</p>
              <h2>Your membership</h2>
            </div>
            <form action={logout}>
              <button className="pill-link" type="submit">
                Sign out
              </button>
            </form>
          </div>

          <div className="dash-grid dash-grid--2">
            {plan ? (
              <article className="plan plan--pop" style={{ order: 0 }}>
                <p className="plan__badge">Current plan</p>
                <p className="plan__price">
                  <sup>R</sup>
                  {formatPrice(plan.pricePerMonth)}
                  <small>/ mo</small>
                </p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link className="btn btn--grey btn--block" href="/memberships">
                  Change plan
                </Link>
              </article>
            ) : (
              <article className="dash-card">
                <p className="eyebrow">Membership</p>
                <h3 style={{ fontSize: 20, marginTop: 4 }}>No active plan</h3>
                <p style={{ color: "var(--mut)", marginTop: 6 }}>
                  Join to book classes and access the facility.
                </p>
                <Link
                  className="btn btn--red btn--block"
                  href="/memberships"
                  style={{ marginTop: 16 }}
                >
                  View plans
                </Link>
              </article>
            )}

            <div className="dash-grid">
              <article className="dash-card">
                <p className="eyebrow">Next available class</p>
                {next ? (
                  <>
                    <h3 style={{ fontSize: 20, marginTop: 4 }}>
                      {next.className}
                    </h3>
                    <p style={{ color: "var(--mut)", marginTop: 6 }}>
                      {DAY_NAMES[next.day]} {next.startsAt} with{" "}
                      {next.coachName}
                    </p>
                  </>
                ) : (
                  <p style={{ color: "var(--mut)", marginTop: 6 }}>
                    Everything is fully booked this week.
                  </p>
                )}
                <Link
                  className="btn btn--red btn--block btn--sm"
                  href="/timetable"
                  style={{ marginTop: 16 }}
                >
                  View timetable
                </Link>
                <Link
                  className="btn btn--grey btn--block btn--sm"
                  href="/bookings"
                  style={{ marginTop: 10 }}
                >
                  My bookings
                </Link>
              </article>

              <article className="dash-card">
                <p className="eyebrow">This month</p>
                <p
                  style={{
                    fontSize: 40,
                    fontWeight: 900,
                    letterSpacing: "-.03em",
                    marginTop: 4,
                  }}
                >
                  {attended}
                </p>
                <p style={{ color: "var(--mut)" }}>
                  {attended === 1 ? "class attended" : "classes attended"}
                  {" · "}
                  {upcoming} upcoming
                </p>
              </article>

              <article className="dash-card">
                <p className="eyebrow">Billing</p>
                {plan ? (
                  <>
                    <p style={{ color: "var(--mut)", marginTop: 6 }}>
                      R{formatPrice(plan.pricePerMonth)} per month
                      {planStarted ? `, since ${formatGymDate(planStarted)}` : ""}
                    </p>
                    <form action={cancelMembership}>
                      <button
                        className="btn btn--line btn--block btn--sm"
                        type="submit"
                        style={{ marginTop: 16 }}
                      >
                        Cancel membership
                      </button>
                    </form>
                  </>
                ) : (
                  <p style={{ color: "var(--mut)", marginTop: 6 }}>
                    Nothing to bill — no active membership.
                  </p>
                )}
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
