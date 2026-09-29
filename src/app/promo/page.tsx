import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fight events",
  description: "PFC fight promotions, cards and results.",
};

export default function PromoPage() {
  return (
    <section className="auth">
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1 style={{ fontSize: 32 }}>Fight events</h1>
        <p className="lead" style={{ marginInline: "auto" }}>
          Fight cards, tickets and results live on the PFC promotions site. It
          opens in a new tab.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 28,
          }}
        >
          <a
            className="btn btn--red"
            href="#"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open promotions site &#8599;
          </a>
          <Link className="btn btn--line" href="/">
            Back to website
          </Link>
        </div>
      </div>
    </section>
  );
}
