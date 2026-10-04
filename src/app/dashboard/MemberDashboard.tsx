import Link from "next/link";

import { logout } from "@/actions/auth";
import { cancelMembership } from "@/actions/gym";
import { getPlan } from "@/lib/repositories/plansRepository";
import { getNextAvailableSlot } from "@/lib/repositories/timetableRepository";
import { findById } from "@/lib/repositories/usersRepository";
import { DAY_NAMES, formatPrice, initials } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

export default async function MemberDashboard({
  session,
}: {
  session: SessionUser;
}) {
  const [user, next] = await Promise.all([
    findById(session.id),
    getNextAvailableSlot(),
  ]);
  const plan =
    user?.planId != null
      ? await getPlan(user.planId, { includeInactive: true })
      : undefined;

  const nextPayment = new Date();
  nextPayment.setMonth(nextPayment.getMonth() + 1, 1);

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
            <span>Member</span>
          </span>
        </div>
      </aside>

      <div className="dash__main">
        <div className="wrap">
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
                  12
                </p>
                <p style={{ color: "var(--mut)" }}>classes attended</p>
              </article>

              <article className="dash-card">
                <p className="eyebrow">Billing</p>
                {plan ? (
                  <>
                    <p style={{ color: "var(--mut)", marginTop: 6 }}>
                      Next payment{" "}
                      {nextPayment.toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
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
