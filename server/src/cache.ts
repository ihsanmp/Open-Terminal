type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Stale entries are kept around so provider outages can fall back to last-known data.
const staleStore = new Map<string, unknown>();

export function staleSet(key: string, value: unknown): void {
  staleStore.set(key, value);
}

export function staleGet<T>(key: string): T | undefined {
  return staleStore.get(key) as T | undefined;
}

// Loads in progress, by key: requests for the same data that arrive while it's being fetched
// (the same chart or quotes in several app windows) wait for that one fetch instead of each
// asking the provider again, which is what gets an app rate-limited.
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  let load = inflight.get(key) as Promise<T> | undefined;
  if (!load) {
    load = fn()
      .then((value) => {
        cacheSet(key, value, ttlMs);
        staleSet(key, value);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, load);
  }
  try {
    return await load;
  } catch (err) {
    const stale = staleGet<T>(key);
    if (stale !== undefined) return stale;
    throw err;
  }
}

export function cacheStore(key: string, value: unknown, ttlMs: number): void {
  cacheSet(key, value, ttlMs);
  staleSet(key, value);
}

