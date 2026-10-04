type Cookie = { name: string; value: string };

const jar = new Map<string, Cookie>();

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
  set(name: string, value: string, _options?: unknown): void {
    jar.set(name, { name, value });
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
