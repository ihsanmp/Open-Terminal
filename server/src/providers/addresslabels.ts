// Names for the biggest Bitcoin addresses (exchanges' cold wallets, funds, seized coins …), from
// bitinfocharts' rich list, which tags the wallets it knows ("wallet: Binance-coldwallet"). The
// top thousand addresses are read once a day, a page at a time, and kept on disk. Wallets it
// only numbers ("wallet: 967") stay unnamed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const PAGES = 10;
const REFRESH_MS = 24 * 3_600_000;
const RETRY_MS = 30 * 60_000;
const storeFile = join(dataDir, "btc-address-labels.json");

type Store = { fetchedAt: number; labels: Record<string, string> };

/** A wallet tag as a name: "Binance-coldwallet" → "Binance (cold wallet)"; numbers → null. */
export function nameOf(tag: string): string | null {
  const t = tag.trim();
  if (!t || /^\d+$/.test(t)) return null;
  const cold = /-coldwallet$/i.test(t);
  const base = t
    .replace(/-coldwallet$/i, "")
    .replace(/-wallet$/i, "")
    .replace(/-/g, " ")
    .trim();
  return cold ? `${base} (cold wallet)` : base;
}

/** The tagged addresses on a rich-list page. */
export function parseRichList(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/\/address\/([0-9a-zA-Z]{26,64})">[^<]*<\/a>(?:(?!<tr>)[\s\S]){0,400}?wallet: ([^<]+)</g)) {
    const name = nameOf(m[2]);
    if (name) out[m[1]] = name;
  }
  return out;
}

function read(): Store {
  try {
    if (existsSync(storeFile)) return JSON.parse(readFileSync(storeFile, "utf8")) as Store;
  } catch {
    // start over
  }
  return { fetchedAt: 0, labels: {} };
}

let store: Store | null = null;
let running: Promise<void> | null = null;
let lastTry = 0;

async function refresh(): Promise<void> {
  const labels: Record<string, string> = {};
  for (let page = 1; page <= PAGES; page++) {
    const url = `https://bitinfocharts.com/top-100-richest-bitcoin-addresses${page === 1 ? "" : `-${page}`}.html`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`bitinfocharts ${res.status}`);
    Object.assign(labels, parseRichList(await res.text()));
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (Object.keys(labels).length === 0) throw new Error("bitinfocharts: no labels found");
  store = { fetchedAt: Date.now(), labels };
  writeFileSync(storeFile, JSON.stringify(store));
}

/** The names known now (refreshed in the background when due). */
export function btcLabels(now = Date.now()): Record<string, string> {
  store ??= read();
  if (!running && now - store.fetchedAt > REFRESH_MS && now - lastTry > RETRY_MS) {
    lastTry = now;
    running = refresh()
      .catch((err) => console.warn("address labels:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = null;
      });
  }
  return store.labels;
}
