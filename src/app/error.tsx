"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Part 2: send this to a logging service rather than the console.
    console.error(error);
  }, [error]);

  return (
    <section className="auth">
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1 style={{ fontSize: 32 }}>Something went wrong</h1>
        <p className="lead" style={{ marginInline: "auto" }}>
          That page could not be loaded. Try again, or head back to the home
          page.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 28,
          }}
        >
          <button className="btn btn--red" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="btn btn--line" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
