/**
 * The Content-Security-Policy, built fresh for every request in
 * src/middleware.ts with a per-request nonce.
 *
 * What it does against XSS: scripts run only if they carry this request's
 * nonce (or were loaded by a script that does, via 'strict-dynamic'), so a
 * script injected into a page has no nonce and the browser refuses it. React
 * already escapes everything it renders; this is the second layer for the day
 * something slips through. Inline event handlers and javascript: URLs are
 * blocked for the same reason.
 *
 * No server-only import: middleware and tests both load this file.
 */

const BLOB_IMAGES = "https://*.public.blob.vercel-storage.com";

export interface CspOptions {
  /** Defaults to process.env.NODE_ENV. */
  nodeEnv?: string;
}

export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";

  const directives = [
    "default-src 'self'",
    // React's dev tooling needs eval; production never gets it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isProduction ? "" : " 'unsafe-eval'"
    }`,
    // Next and next/font write inline styles; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${BLOB_IMAGES}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (isProduction) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/** A fresh base64 nonce: 16 random bytes would do, a v4 UUID is plenty. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Report-only mode sends the same policy under the report-only header, so a
 * browser logs violations without blocking anything. CSP_REPORT_ONLY=1 is the
 * switch to fall back to if a new page ever trips the enforcing policy.
 */
export function cspHeaderName(
  reportOnly: string | undefined = process.env.CSP_REPORT_ONLY,
): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return reportOnly === "1"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}
