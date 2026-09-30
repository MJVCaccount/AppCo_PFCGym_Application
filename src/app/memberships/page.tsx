import type { Metadata } from "next";

import Alert from "@/components/Alert";
import PlanCard from "@/components/PlanCard";
import { getPlan, getPlans } from "@/lib/gym-data";
import { getSession } from "@/lib/session";
import { firstParam, formatPrice, type SearchParams } from "@/lib/types";
import { findById } from "@/lib/users";

export const metadata: Metadata = {
  title: "Memberships",
  description:
    "PFC membership plans from R750 per month. Cancel or upgrade anytime.",
};

export const dynamic = "force-dynamic";

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const error = firstParam((await searchParams).error);

  const plans = getPlans();
  const session = await getSession();
  const user = session ? findById(session.id) : undefined;

  const currentPlan =
    user?.planId != null ? getPlan(user.planId) : undefined;
  const isStaff = session?.role === "Coach" || session?.role === "Admin";

  return (
    <section className="section">
      <div className="wrap">
        {error && <Alert kind="err">{error}</Alert>}

        {currentPlan ? (
          <>
            <div className="section-head">
              <p className="eyebrow">Your account</p>
              <h2>Your membership</h2>
              <p className="lead">
                You are on the R{formatPrice(currentPlan.pricePerMonth)} plan.
              </p>
            </div>

            <div className="plans">
              <PlanCard
                plan={currentPlan}
                badge="Current plan"
                cta="link"
                href="/dashboard"
                ctaLabel="Manage on dashboard"
              />
            </div>

            <div className="section-head" style={{ marginTop: 56 }}>
              <h2>Change your plan</h2>
              <p className="lead">
                Switching takes effect on your next billing date.
              </p>
            </div>

            <div className="plans">
              {plans
                .filter((plan) => plan.id !== currentPlan.id)
                .map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    cta="switch"
                    ctaLabel={
                      plan.pricePerMonth > currentPlan.pricePerMonth
                        ? "Upgrade"
                        : "Switch"
                    }
                  />
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="section-head">
              <p className="eyebrow">Pricing</p>
              <h2>Join PFC</h2>
              <p className="lead">
                {isStaff
                  ? "Staff accounts have full facility access — no membership needed."
                  : "Cancel or upgrade anytime. All plans include full facility access."}
              </p>
            </div>

            <div className="plans">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  cta={session !== null && !isStaff ? "switch" : "register"}
                  ctaLabel={
                    session !== null && !isStaff ? "Choose plan" : "Get started"
                  }
                />
              ))}
            </div>

            <p className="form-note" style={{ marginTop: 26 }}>
              Prices include VAT. No joining fee, no contract.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
