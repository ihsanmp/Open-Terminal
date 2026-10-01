import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheGet, cacheSet, staleGet, staleSet } from "./cache.js";
import { dataDir } from "./db.js";

// Responses kept on disk across restarts (data/cache), for the requests a fresh start waits on —
// chart history above all: TradingView takes ~2 s for a long daily history, every launch. The
// first request after a start gets what the last run saw at once, while a fresh copy is fetched
// in the background (stale-while-revalidate); the response says so, so the page asks again soon.

const dir = join(dataDir, "cache");
const MAX_FILES = 300;
const inflight = new Map<string, Promise<unknown>>();
let writes = 0;

const fileOf = (key: string) => join(dir, `${createHash("sha1").update(key).digest("hex")}.json`);

function readDisk<T>(key: string): T | undefined {
  try {
    const saved = JSON.parse(readFileSync(fileOf(key), "utf8")) as { key: string; value: T };
    return saved.key === key ? saved.value : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the most recently written files. */
function prune(): void {
  try {
    const files = readdirSync(dir).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
    files.sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(MAX_FILES)) unlinkSync(join(dir, f));
  } catch {
    // another write got there first
  }
}

async function writeDisk(key: string, value: unknown): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await writeFile(fileOf(key), JSON.stringify({ key, savedAt: Date.now(), value }));
  if (++writes % 25 === 0) prune();
}

/** One fetch per key at a time; a result goes to memory and to disk. */
function refresh<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      staleSet(key, value);
      writeDisk(key, value).catch(() => {});
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Like `cached`, but survives restarts: with nothing in memory, a copy saved by an earlier run is
 * returned at once (`fromDisk: true`) and refreshed in the background. `usable` rejects saved
 * values that shouldn't be served (an empty history).
 */
export async function cachedOnDisk<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  usable: (value: T) => boolean = () => true
): Promise<{ value: T; fromDisk: boolean }> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return { value: hit, fromDisk: false };
  const saved = readDisk<T>(key);
  if (saved !== undefined && usable(saved)) {
    staleSet(key, saved);
    refresh(key, ttlMs, fn).catch(() => {});
    return { value: saved, fromDisk: true };
  }
  try {
    return { value: await refresh(key, ttlMs, fn), fromDisk: false };
  } catch (err) {
    const stale = staleGet<T>(key);
    if (stale !== undefined) return { value: stale, fromDisk: false };
    throw err;
  }
}
