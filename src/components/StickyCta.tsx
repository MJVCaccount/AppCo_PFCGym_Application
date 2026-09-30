import Link from "next/link";

import { getCheapestPlanPrice } from "@/lib/gym-data";
import { formatPrice } from "@/lib/types";

/** Mobile-only bar. Hidden from 1024px up by the stylesheet. */
export default function StickyCta() {
  return (
    <div className="sticky-cta">
      <div>
        <small>From</small>
        <b>R{formatPrice(getCheapestPlanPrice())} / mo</b>
      </div>
      <Link className="btn btn--red" href="/memberships">
        Join now
      </Link>
    </div>
  );
}
