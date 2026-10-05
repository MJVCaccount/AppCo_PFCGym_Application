"use client";

import "./globals.css";

// Replaces the root layout when the layout itself fails, so it must render
// <html> and <body> and cannot use the header, footer or next/link. The
// server has already logged the real error; nothing about it reaches here
// beyond a digest, and the digest is not shown.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-ZA">
      <body>
        <section className="auth">
          <div style={{ textAlign: "center", maxWidth: 460 }}>
            <div className="auth__logo" aria-hidden="true">
              PFC
            </div>
            <h1 style={{ fontSize: 32 }}>Something went wrong</h1>
            <p className="lead" style={{ marginInline: "auto" }}>
              The site could not be loaded. Try again, or head back to the
              home page.
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
              {/* A plain link: a full page load gets past a broken layout. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="btn btn--line" href="/">
                Back to home
              </a>
            </div>
          </div>
        </section>
      </body>
    </html>
  );
}
