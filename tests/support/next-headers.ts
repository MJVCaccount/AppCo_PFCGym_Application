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
