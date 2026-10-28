/**
 * The rule for choosing a password (registration and reset). No server-only
 * import: the form and the services share it.
 *
 * Length is 10 to 128 characters. The ceiling is a defence, not a courtesy:
 * scrypt runs on whatever it is given, so an unbounded password is a way to
 * tie the server up. Signing in only enforces the ceiling (see
 * isPasswordLengthAcceptable), so accounts made under the old 8-character
 * rule can still sign in; they meet this rule the next time they choose one.
 */

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

/**
 * Passwords that appear at the top of every breach list and are long enough to
 * pass the length rule. Compared case-insensitively. This is a floor against
 * the worst choices, not a substitute for a breached-password service.
 */
const COMMON = new Set([
  "password1!",
  "password12",
  "password123",
  "password1234",
  "password123!",
  "passw0rd123",
  "p@ssword123",
  "p@ssw0rd123",
  "1234567890",
  "12345678910",
  "123456789012",
  "0123456789",
  "0987654321",
  "qwertyuiop",
  "qwerty12345",
  "qwerty123456",
  "qwertyuiop123",
  "1q2w3e4r5t",
  "1qaz2wsx3edc",
  "asdfghjkl1",
  "asdfghjkl123",
  "iloveyou123",
  "iloveyou12",
  "letmein1234",
  "letmein123!",
  "welcome1234",
  "welcome123!",
  "changeme123",
  "administrator",
  "admin12345",
  "admin123456",
  "abcdefghij",
  "abcd123456",
  "trustno1234",
  "football123",
  "baseball123",
  "superman123",
  "monkey12345",
  "dragon12345",
  "mustang1234",
  "sunshine123",
  "princess123",
  "whatever123",
  "pfcgym12345",
  "pfcgym123!",
  "fighter1234",
  "boxing12345",
]);

/** Null when the password is acceptable, else the sentence to show. */
export function checkPassword(value: string): string | null {
  if (value.length > MAX_PASSWORD) {
    return `Password must be at most ${MAX_PASSWORD} characters.`;
  }
  if (value.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (isTooCommon(value)) {
    return "That password is too common. Choose a less guessable one.";
  }
  return null;
}

function isTooCommon(value: string): boolean {
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return true;

  // One character repeated ("aaaaaaaaaa") or a short block repeated ("abababababab").
  if (/^(.{1,3})\1+$/.test(lower)) return true;

  return false;
}

/**
 * What signing in checks before hashing: not empty and not longer than the
 * ceiling. No minimum and no list, so every existing password still works.
 */
export function isPasswordLengthAcceptable(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PASSWORD;
}
