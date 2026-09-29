import Link from "next/link";

export default function NotFound() {
  return (
    <section className="auth">
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1 style={{ fontSize: 32 }}>Page not found</h1>
        <p className="lead" style={{ marginInline: "auto" }}>
          That page doesn&apos;t exist. Check the address, or head back to the
          home page.
        </p>
        <Link className="btn btn--red" href="/" style={{ marginTop: 28 }}>
          Back to home
        </Link>
      </div>
    </section>
  );
}
