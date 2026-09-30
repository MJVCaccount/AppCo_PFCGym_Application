import Link from "next/link";

import { changePlan } from "@/actions/gym";
import type { MembershipPlan } from "@/lib/types";
import { formatPrice } from "@/lib/types";

interface Props {
  plan: MembershipPlan;
  /** Overrides the "Most popular" ribbon, e.g. "Current plan". */
  badge?: string;
  ctaLabel?: string;
  /**
   * How the button behaves:
   *  - "register": link to sign-up, carrying the chosen plan (visitors)
   *  - "switch":   form posting to changePlan (signed-in members)
   *  - "link":     plain link to `href` (the plan already in use)
   */
  cta?: "register" | "switch" | "link";
  href?: string;
}

export default function PlanCard({
  plan,
  badge,
  ctaLabel = "Get started",
  cta = "register",
  href = "/dashboard",
}: Props) {
  const label = badge ?? (plan.isMostPopular ? "Most popular" : null);
  const highlight = badge !== undefined || plan.isMostPopular;
  const buttonClass = highlight ? "btn--red" : "btn--grey";

  return (
    <article className={`plan${highlight ? " plan--pop" : ""} reveal`}>
      {label && <p className="plan__badge">{label}</p>}

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

      {cta === "switch" ? (
        <form action={changePlan}>
          <input type="hidden" name="planId" value={plan.id} />
          <button className={`btn ${buttonClass} btn--block`} type="submit">
            {ctaLabel}
          </button>
        </form>
      ) : (
        <Link
          className={`btn ${buttonClass} btn--block`}
          href={cta === "register" ? `/register?planId=${plan.id}` : href}
        >
          {ctaLabel}
        </Link>
      )}
    </article>
  );
}
