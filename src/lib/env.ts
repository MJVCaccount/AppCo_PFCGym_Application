import "server-only";

/**
 * Environment checks and the few settings the app derives from it.
 *
 * Absolute links in emails come from APP_URL and nowhere else. The Host header
 * of a request is chosen by the sender, so a link built from it could be made
 * to point a password reset at an attacker's site.
 */

const DEV_APP_URL = "http://localhost:3000";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Why APP_URL is unusable, or null when it is fine. */
export function appUrlProblem(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";

  if (raw === "") {
    return isProduction() ? "APP_URL must be set in production." : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "APP_URL must be a full URL such as https://example.co.za.";
  }

  if (isProduction() && !raw.startsWith("https://")) {
    return "APP_URL must start with https:// in production.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "APP_URL must start with http:// or https://.";
  }

  return null;
}

/**
 * The public base URL, without a trailing slash. Throws when it is unusable
 * in production; in development an empty value falls back to localhost.
 */
export function appUrl(): string {
  const problem = appUrlProblem(process.env.APP_URL);
  if (problem) throw new Error(problem);

  const raw = process.env.APP_URL?.trim() ?? "";
  return (raw === "" ? DEV_APP_URL : raw).replace(/\/+$/, "");
}

/** Whether transactional email can be sent from this environment. */
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim(),
  );
}

/** Called once when the server starts (see src/instrumentation.ts). */
export function validateEnv(): void {
  const problem = appUrlProblem(process.env.APP_URL);
  if (problem) throw new Error(`Invalid environment: ${problem}`);
}
