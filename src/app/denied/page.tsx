import type { Metadata } from "next";
import Logo from "@/components/Logo";
import Link from "next/link";

export const metadata: Metadata = { title: "Access denied" };

export const dynamic = "force-dynamic";

export default function DeniedPage() {
  return (
    <section className="auth">
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        {/* Decorative: the h1 below names the page and the header already
            carries the brand, so the mark takes an empty alt. */}
        <div className="auth__logo">
          <Logo variant="full" width={88} alt="" />
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
