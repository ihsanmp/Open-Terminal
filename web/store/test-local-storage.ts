// A Map-backed localStorage for tests of the persisted store (Node has none).
if (typeof globalThis.localStorage === "undefined") {
  const items = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  } as Storage;
}
// zustand's persist reads window.localStorage.
if (typeof (globalThis as { window?: unknown }).window === "undefined") (globalThis as { window?: unknown }).window = globalThis;
