/**
 * Where to send someone after they sign in. Only a path on this site counts.
 *
 * "//host" is a protocol-relative URL, and browsers read a backslash as a
 * slash, so "/\host" is the same thing; control characters (a tab or newline
 * inside "//") are stripped by browsers before they parse. All are refused,
 * or a crafted login link could bounce the user to another site.
 *
 * No server-only import: the login page, the login action and the tests use it.
 */

const MAX_LENGTH = 2048;

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;

  return value;
}
