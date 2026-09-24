import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import * as yahoo from "./yahoo.js";

// Daily Bitcoin series for on-chain indicators (Bitcoin Thermocap): price and
// blocks mined per UTC day, from the first priced day to today.
//
// TradingView reads blocks mined from Glassnode (BTC_BLOCKSMINED), which is paid.
// blockchain.info publishes the coin supply after every block for free; the
// supply pins down the block height exactly (the subsidy halves every 210,000
// blocks), so the height at the end of each day gives blocks mined that day.

export type BtcDaily = { time: number[]; price: number[]; blocks: number[] };

const DAY = 86_400;
const CHARTS = "https://api.blockchain.info/charts";
const heightsFile = join(dataDir, "btc-heights.json");

async function chart(name: string, timespan: string): Promise<Array<{ x: number; y: number }>> {
  const res = await fetch(`${CHARTS}/${name}?timespan=${timespan}&format=json&sampled=false`, {
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`blockchain.info ${res.status} for ${name}`);
  const body = (await res.json()) as { values?: Array<{ x: number; y: number }> };
  if (!Array.isArray(body.values) || body.values.length === 0) throw new Error(`blockchain.info: empty ${name}`);
  return body.values;
}

/** Blocks needed to issue `supply` coins: 50 BTC per block, halving every 210,000 blocks. */
export function heightFromSupply(supply: number): number {
  let remaining = supply;
  let reward = 50;
  let blocks = 0;
  while (reward > 1e-8 && remaining >= 210_000 * reward - 1e-6) {
    remaining -= 210_000 * reward;
    blocks += 210_000;
    reward /= 2;
  }
  return blocks + Math.round(remaining / reward);
}

/** `covered`: time of the newest block seen — days before its UTC day are complete. */
type Heights = { updated: number; covered: number; days: Record<string, number> };
let heights: Heights | null = null;

function loadHeights(): Heights | null {
  if (heights) return heights;
  try {
    if (existsSync(heightsFile)) heights = JSON.parse(readFileSync(heightsFile, "utf8")) as Heights;
  } catch {
    heights = null;
  }
  return heights;
}

/** Block height at the end of every UTC day. The full supply history (~30 MB) is
 *  fetched once and kept on disk; later refreshes only pull the last month. */
async function dailyHeights(): Promise<Heights> {
  const known = loadHeights();
  if (known?.covered && Date.now() - known.updated < 3 * 3_600_000) return known;

  // The full history is served from a cache that can trail by a day, so the recent
  // window is always merged on top of it.
  const points = [...(known?.covered ? [] : await chart("total-bitcoins", "all")), ...(await chart("total-bitcoins", "30days"))];
  const days: Record<string, number> = { ...(known?.days ?? {}) };
  let covered = known?.covered ?? 0;
  for (const p of points) {
    covered = Math.max(covered, p.x);
    const day = Math.floor(p.x / DAY);
    const h = heightFromSupply(p.y);
    // The first day of a partial window only has its early blocks; keep the full count.
    if (!(days[day] >= h)) days[day] = h;
  }
  heights = { updated: Date.now(), covered, days };
  try {
    writeFileSync(heightsFile, JSON.stringify(heights));
  } catch {
    // A read-only data dir only costs the next start a full download.
  }
  return heights;
}

/** Daily close in USD. Yahoo's BTC-USD daily closes for the last ten years (closest to
 *  TradingView's INDEX:BTCUSD, with today's live price as the last bar — its "max" range
 *  is monthly); blockchain.info's daily market price before that and for any day Yahoo
 *  skips, back to Aug 2010. */
async function dailyPrice(): Promise<Map<number, number>> {
  const prices = new Map<number, number>();
  for (const p of await chart("market-price", "all")) {
    if (p.y > 0) prices.set(Math.floor(p.x / DAY), p.y);
  }
  try {
    for (const c of await yahoo.history("BTC-USD", "10y", "1d")) {
      if (c.close > 0) prices.set(Math.floor(c.time / DAY), c.close);
    }
  } catch {
    // blockchain.info alone still covers every day but today.
  }
  return prices;
}

export async function btcDaily(now = Date.now()): Promise<BtcDaily> {
  const [{ days, covered }, prices] = await Promise.all([dailyHeights(), dailyPrice()]);
  const today = Math.floor(now / 1000 / DAY);
  const complete = Math.min(today, Math.floor(covered / DAY));
  const dayKeys = Object.keys(days).map(Number).sort((a, b) => a - b);

  // Blocks per completed day. The day still in progress has no Glassnode row yet, so it
  // carries the last completed day's count forward, as request.security does for a
  // missing bar.
  const mined = new Map<number, number>();
  for (let i = 1; i < dayKeys.length; i++) {
    const d = dayKeys[i];
    if (d >= complete) break;
    mined.set(d, days[d] - days[dayKeys[i - 1]]);
  }

  const out: BtcDaily = { time: [], price: [], blocks: [] };
  const firstPriced = Math.min(...prices.keys());
  let lastBlocks = NaN;
  for (let d = firstPriced; d <= today; d++) {
    const price = prices.get(d);
    if (mined.has(d)) lastBlocks = mined.get(d)!;
    if (price === undefined) continue;
    out.time.push(d * DAY);
    out.price.push(price);
    out.blocks.push(mined.get(d) ?? lastBlocks);
  }
  return out;
}
