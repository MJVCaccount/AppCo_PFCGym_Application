type Cookie = { name: string; value: string };

const jar = new Map<string, Cookie>();

/** The attributes of the last Set-Cookie for each name, so tests can check them. */
const lastOptions = new Map<string, Record<string, unknown>>();

export function lastCookieOptions(name: string): Record<string, unknown> | undefined {
  return lastOptions.get(name);
}

const store = {
  get(name: string): Cookie | undefined {
    return jar.get(name);
  },
  getAll(): Cookie[] {
    return [...jar.values()];
  },
  has(name: string): boolean {
    return jar.has(name);
  },
  set(name: string, value: string, options?: Record<string, unknown>): void {
    lastOptions.set(name, options ?? {});
    // An empty value or a zero lifetime is how a cookie is cleared.
    if (value === "" || options?.maxAge === 0) jar.delete(name);
    else jar.set(name, { name, value });
  },
  delete(name: string): void {
    jar.delete(name);
  },
};

export async function cookies() {
  return store;
}

// The request headers a server action would see. A test that cares about the
// caller's address sets them with setTestRequestHeaders. Otherwise every call
// comes from a fresh address, so the rate limits (which are per address) never
// make one test depend on how many requests an earlier test made.
let requestHeaders: Headers | null = null;
let nextAddress = 1;

export function setTestRequestHeaders(init: Record<string, string>): void {
  requestHeaders = new Headers(init);
}

export async function headers() {
  if (requestHeaders) return requestHeaders;

  nextAddress += 1;
  return new Headers({ "x-real-ip": `198.18.${nextAddress >> 8}.${nextAddress & 255}` });
}
