/**
 * Decides whether the seed may run against the database the environment
 * points at. The seed upserts demo accounts with known passwords, so running
 * it against production by accident would be a security hole, not a mess.
 *
 * Allowed targets: localhost, a host listed in SEED_ALLOWED_HOSTS (the dev
 * database), or the host named in SEED_CONFIRM_HOST (set for one command to
 * seed a new environment on purpose). Everything else is refused.
 *
 * Nothing here ever returns or prints credentials: only the host name.
 */

/** process.env, or a plain object in a test. Only the four names below are read. */
export type SeedEnv = Record<string, string | undefined>;

export type SeedCheck =
  | { ok: true; host: string }
  | { ok: false; message: string };

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/** Lowercase, no brackets, and Neon's "-pooler" removed, so a pooled and a direct string match. */
export function normaliseHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace("-pooler.", ".");
}

/** The host of a connection string, or null when it is missing or not a URL. */
export function hostOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;

  try {
    return normaliseHost(new URL(url.trim()).hostname);
  } catch {
    return null;
  }
}

function listOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(normaliseHost)
    .filter((host) => host !== "");
}

export function checkSeedTarget(env: SeedEnv): SeedCheck {
  const direct = hostOf(env.DIRECT_URL);
  const pooled = hostOf(env.DATABASE_URL);
  const host = direct ?? pooled;

  if (!host) {
    return {
      ok: false,
      message:
        "Refusing to seed: DIRECT_URL (or DATABASE_URL) is not set to a valid connection string.",
    };
  }

  // The seed connects with DATABASE_URL while migrations use DIRECT_URL. If they
  // name different databases, one check cannot vouch for both.
  if (direct && pooled && direct !== pooled) {
    return {
      ok: false,
      message: `Refusing to seed: DIRECT_URL names "${direct}" but DATABASE_URL names "${pooled}". Point both at the same database.`,
    };
  }

  const confirmed = env.SEED_CONFIRM_HOST
    ? normaliseHost(env.SEED_CONFIRM_HOST)
    : null;

  if (
    LOCAL_HOSTS.includes(host) ||
    listOf(env.SEED_ALLOWED_HOSTS).includes(host) ||
    confirmed === host
  ) {
    return { ok: true, host };
  }

  return {
    ok: false,
    message:
      `Refusing to seed "${host}": it is not localhost and not in SEED_ALLOWED_HOSTS. ` +
      `If you really mean to seed it, set SEED_CONFIRM_HOST to ${host} for this one command.`,
  };
}

// ---------------------------------------------------------------- passwords

/**
 * The demo passwords are printed in the public README, so on any database that
 * is not a local or dev one they must be replaced.
 */
export const PUBLISHED_DEMO_PASSWORDS: readonly string[] = [
  "Member123!",
  "Fighter123!",
  "Coach123!",
  "Admin123!",
];

export const MIN_SEED_PASSWORD_LENGTH = 12;

export type SeedPasswords =
  | {
      ok: true;
      /** For admin@pfc.co.za, or null to keep the published one. */
      adminPassword: string | null;
      /** For member@, fighter@, marcus@ and sofia@pfc.co.za, or null to keep the published ones. */
      demoPassword: string | null;
    }
  | { ok: false; message: string };

/**
 * A "private target" is a database that is neither localhost nor listed in
 * SEED_ALLOWED_HOSTS: it was let through only by SEED_CONFIRM_HOST, which is
 * how production is seeded. A host that cannot be read counts as private.
 */
export function isPrivateTarget(env: SeedEnv): boolean {
  const host = hostOf(env.DIRECT_URL) ?? hostOf(env.DATABASE_URL);
  if (!host) return true;

  return !LOCAL_HOSTS.includes(host) && !listOf(env.SEED_ALLOWED_HOSTS).includes(host);
}

/** What is wrong with one password variable, or null. The value is never in the answer. */
function passwordProblem(name: string, value: string): string | null {
  // The published ones are short, so name them before the length rule does.
  if (PUBLISHED_DEMO_PASSWORDS.includes(value)) {
    return `${name} must not be one of the demo passwords published in the README.`;
  }
  if (value.length < MIN_SEED_PASSWORD_LENGTH) {
    return `${name} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * SEED_ADMIN_PASSWORD (for admin@pfc.co.za) and SEED_DEMO_PASSWORD (for the
 * member, fighter and two demo coaches). Both are required for a private
 * target. For localhost and allow-listed hosts they are optional: unset means
 * the published passwords, set means they are validated the same way.
 *
 * A refusal names the variable and the rule, never a value.
 */
export function checkSeedPasswords(env: SeedEnv): SeedPasswords {
  const required = isPrivateTarget(env);
  const admin = env.SEED_ADMIN_PASSWORD || undefined;
  const demo = env.SEED_DEMO_PASSWORD || undefined;

  const given: [string, string | undefined][] = [
    ["SEED_ADMIN_PASSWORD", admin],
    ["SEED_DEMO_PASSWORD", demo],
  ];

  for (const [name, value] of given) {
    if (value === undefined) {
      if (required) {
        return {
          ok: false,
          message:
            `Refusing to seed: ${name} is required for a database that is not localhost or in SEED_ALLOWED_HOSTS, ` +
            `because the demo passwords are published in the README. Set it for this one command.`,
        };
      }
      continue;
    }

    const problem = passwordProblem(name, value);
    if (problem) return { ok: false, message: `Refusing to seed: ${problem}` };
  }

  if (admin !== undefined && demo !== undefined && admin === demo) {
    return {
      ok: false,
      message: "Refusing to seed: SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD must be different from each other.",
    };
  }

  return { ok: true, adminPassword: admin ?? null, demoPassword: demo ?? null };
}
