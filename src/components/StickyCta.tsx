import Link from "next/link";

import { getCheapestPlanPrice } from "@/lib/repositories/plansRepository";
import { formatPrice } from "@/lib/types";

/** Mobile-only bar. Hidden from 1024px up by the stylesheet. */
export default async function StickyCta() {
  const cheapestPrice = await getCheapestPlanPrice();

  return (
    <div className="sticky-cta">
      <div>
        <small>From</small>
        <b>R{formatPrice(cheapestPrice)} / mo</b>
      </div>
      <Link className="btn btn--red" href="/memberships">
        Join now
      </Link>
    </div>
  );
}
