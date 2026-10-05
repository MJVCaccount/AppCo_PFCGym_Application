import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Access denied" };

export const dynamic = "force-dynamic";

export default function DeniedPage() {
  return (
    <section className="auth">
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1 style={{ fontSize: 32 }}>Access denied</h1>
        <p className="lead" style={{ marginInline: "auto" }}>
          Your account doesn&apos;t have permission to view that page.
        </p>
        <Link className="btn btn--red" href="/" style={{ marginTop: 28 }}>
          Back to home
        </Link>
      </div>
    </section>
  );
}
