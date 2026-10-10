import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

// Large BTC transfers ("whale alerts"), read from each new block on mempool.space — free, no key.
// A block's summary lists every transaction's total output; for the few above the floor the
// transaction itself is read, and outputs paid back to the sending addresses (change) are left
// out, so a small payment from a big wallet isn't counted as a whale.
//
// Blocks are read only while something asks for them (the chart indicator polls this), starting
// from the last day's blocks; what was found is kept in data/ so history builds up over time.

export type Whale = {
  txid: string;
  /** Block time, unix seconds. */
  time: number;
  height: number;
  /** BTC moved to other addresses (change excluded). */
  btc: number;
  /** The sending addresses (a few), and where it went, largest first (change excluded). */
  from?: string[];
  to?: Array<{ address: string; btc: number }>;
};

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const API = "https://mempool.space/api";
const FLOOR_BTC = 100; // kept on disk; the indicator's own threshold is higher by default
const BACKFILL = 144; // blocks (about a day) read when starting fresh or after a long break
const KEEP_S = 400 * 86_400;
const storeFile = join(dataDir, "btc-whales.json");

type Store = { height: number; txs: Whale[] };
type BlockMeta = { id: string; height: number; timestamp: number };
type SummaryTx = { txid: string; value: number };
type Tx = {
  vin: Array<{ is_coinbase?: boolean; prevout: { scriptpubkey_address?: string } | null }>;
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
};

const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "OpenTerminal" } });

function readStore(): Store {
  try {
    if (existsSync(storeFile)) return JSON.parse(readFileSync(storeFile, "utf8")) as Store;
  } catch {
    // start over
  }
  return { height: 0, txs: [] };
}

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new Error(`mempool.space ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Who sent a transaction and where it went (change left out): a few of each. */
export function partiesOf(tx: Tx, keep = 3): { from: string[]; to: Array<{ address: string; btc: number }> } {
  const fromAll = [...new Set(tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter((a): a is string => Boolean(a)))];
  const own = new Set(fromAll);
  const sums = new Map<string, number>();
  for (const o of tx.vout) if (o.scriptpubkey_address && !own.has(o.scriptpubkey_address)) sums.set(o.scriptpubkey_address, (sums.get(o.scriptpubkey_address) ?? 0) + o.value);
  const to = [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, keep)
    .map(([address, sats]) => ({ address, btc: Math.round((sats / 1e8) * 1e4) / 1e4 }));
  return { from: fromAll.slice(0, keep), to };
}

/** A transaction as mempool.space gives it, for one read by txid. */
export async function txParties(txid: string, f: Fetch = defaultFetch): Promise<{ from: string[]; to: Array<{ address: string; btc: number }> }> {
  return partiesOf(await getJson<Tx>(f, `${API}/tx/${txid}`));
}

/** BTC a transaction sends to addresses other than its own inputs'. */
export function movedBtc(tx: Tx): number {
  const from = new Set(tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean));
  const sats = tx.vout.reduce((a, o) => (o.scriptpubkey_address && from.has(o.scriptpubkey_address) ? a : a + o.value), 0);
  return sats / 1e8;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the blocks since the last one seen (at most the last BACKFILL), saving after each. */
export async function syncWhales(f: Fetch = defaultFetch, pause = 1000): Promise<void> {
  const store = readStore();
  const tip = Number(await getJson<number>(f, `${API}/blocks/tip/height`));
  let h = Math.max(store.height + 1, tip - BACKFILL + 1);
  while (h <= tip) {
    // /v1/blocks/:height lists 15 blocks, newest first, ending at that height.
    const top = Math.min(h + 14, tip);
    const metas = (await getJson<BlockMeta[]>(f, `${API}/v1/blocks/${top}`)).filter((b) => b.height >= h).sort((a, b) => a.height - b.height);
    if (!metas.length) break;
    for (const b of metas) {
      const summary = await getJson<SummaryTx[]>(f, `${API}/v1/block/${b.id}/summary`);
      for (const s of summary.slice(1)) {
        if (s.value < FLOOR_BTC * 1e8) continue;
        const tx = await getJson<Tx>(f, `${API}/tx/${s.txid}`);
        const btc = movedBtc(tx);
        if (btc >= FLOOR_BTC) store.txs.push({ txid: s.txid, time: b.timestamp, height: b.height, btc: Math.round(btc * 1e4) / 1e4, ...partiesOf(tx) });
      }
      store.height = b.height;
      const cutoff = b.timestamp - KEEP_S;
      store.txs = store.txs.filter((t) => t.time >= cutoff);
      writeFileSync(storeFile, JSON.stringify(store));
      await sleep(pause);
    }
    h = metas[metas.length - 1].height + 1;
  }
}

let running: Promise<void> | null = null;
let lastStart = 0;

/** The stored whales (oldest first); starts reading new blocks in the background when due. */
export function btcWhales(f: Fetch = defaultFetch, now = Date.now()): { height: number; txs: Whale[] } {
  if (!running && now - lastStart > 60_000) {
    lastStart = now;
    running = syncWhales(f)
      .catch((err) => console.warn("whales:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = null;
      });
  }
  const { height, txs } = readStore();
  return { height, txs: [...txs].sort((a, b) => a.time - b.time) };
}
