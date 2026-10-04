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
