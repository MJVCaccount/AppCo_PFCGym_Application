/**
 * The EMAIL_SKIP list: addresses that must never reach the email provider.
 *
 * A comma-separated value. Each entry is a full address ("admin@pfc.co.za") or a
 * domain ("demo.pfc.test"). Matching ignores case and surrounding spaces, and
 * empty entries are ignored. A domain entry matches that domain exactly: it does
 * not match a subdomain, a longer domain that merely ends the same way
 * ("notpfc.co.za"), or a domain that merely starts the same way
 * ("pfc.co.za.evil.example").
 *
 * Pure and dependency-free so it can be tested on its own. No "server-only"
 * import, no logging: the address is personal and is never written anywhere here.
 */

export interface SkipList {
  addresses: ReadonlySet<string>;
  domains: ReadonlySet<string>;
}

export function parseSkipList(value: string | undefined | null): SkipList {
  const addresses = new Set<string>();
  const domains = new Set<string>();

  for (const raw of (value ?? "").split(",")) {
    const entry = raw.trim().toLowerCase();
    if (entry === "") continue;

    if (entry.startsWith("@")) {
      // "@pfc.co.za" is a domain written the way people write it
      const domain = entry.slice(1).trim();
      if (domain !== "") domains.add(domain);
    } else if (entry.includes("@")) {
      addresses.add(entry);
    } else {
      domains.add(entry);
    }
  }

  return { addresses, domains };
}

/** Whether `address` is on the list. */
export function isSkipped(address: string, list: SkipList): boolean {
  const normal = address.trim().toLowerCase();
  if (list.addresses.has(normal)) return true;

  const at = normal.lastIndexOf("@");
  return at !== -1 && list.domains.has(normal.slice(at + 1));
}
