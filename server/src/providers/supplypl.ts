import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

// Daily BTC supply in profit / loss and MVRV, for the "BTC Spl-P/L & MVRV RoC" indicator.
//
// - Supply in profit and in loss (BTC) come from BGeometrics' free API (bitcoin-data.com): no key,
//   but 8 requests an hour, 15 a day and only the last 4 years. Each fetch is merged into a file in
//   data/ and refreshed at most every 12 hours, so the history grows past the 4-year window and the
//   app needs about four requests a day.
// - MVRV comes from Coin Metrics' community API (CapMVRVCur), free with full history.
//
// IntoTheBlock's series on TradingView (BTC_INOUTMONEY…, BTC_MVRV) stopped updating in Aug 2025.

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type SupplyMvrv = {
  /** Share of the supply in profit, 0 … 1, per UTC day. */
  supply: { time: number[]; inProfit: number[] };
  mvrv: { time: number[]; value: number[] };
};

type SupplyFile = { fetchedAt: number; failedAt?: number; rows: Record<string, [profit: number, loss: number]> };

const BGEO = "https://bitcoin-data.com/v1";
const COINMETRICS = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
const REFRESH_MS = 12 * 3_600_000;
const RETRY_MS = 3_600_000;
const supplyFile = join(dataDir, "btc-supply-pl.json");

const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "OpenTerminal" } });

function readSupplyFile(): SupplyFile {
  try {
    if (existsSync(supplyFile)) return JSON.parse(readFileSync(supplyFile, "utf8")) as SupplyFile;
  } catch {
    // start over
  }
  return { fetchedAt: 0, rows: {} };
}

/** Merge BGeometrics' profit and loss rows (by day) into the stored ones. */
export function mergeSupply(
  stored: SupplyFile["rows"],
  profit: Array<{ unixTs: number; supplyProfitBtc: number }>,
  loss: Array<{ unixTs: number; supplyLossBtc: number }>
): SupplyFile["rows"] {
  const lossAt = new Map(loss.map((r) => [r.unixTs, r.supplyLossBtc]));
  const out = { ...stored };
  for (const r of profit) {
    const l = lossAt.get(r.unixTs);
    if (Number.isFinite(r.supplyProfitBtc) && l !== undefined && Number.isFinite(l)) out[String(r.unixTs)] = [r.supplyProfitBtc, l];
  }
  return out;
}

export function supplySeries(rows: SupplyFile["rows"]): SupplyMvrv["supply"] {
  const days = Object.keys(rows).map(Number).sort((a, b) => a - b);
  return {
    time: days,
    inProfit: days.map((d) => {
      const [p, l] = rows[String(d)];
      return p + l > 0 ? p / (p + l) : NaN;
    }),
  };
}

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

/** Supply in profit/loss, from disk when fresh; a failed refresh keeps the stored days. */
export async function btcSupplyPL(f: Fetch = defaultFetch, now = Date.now()): Promise<SupplyMvrv["supply"]> {
  const file = readSupplyFile();
  const stale = now - file.fetchedAt > REFRESH_MS;
  const retrying = file.failedAt !== undefined && now - file.failedAt < RETRY_MS;
  if (stale && !retrying) {
    try {
      const [profit, loss] = await Promise.all([
        getJson<Array<{ unixTs: number; supplyProfitBtc: number }>>(f, `${BGEO}/supply-profit`),
        getJson<Array<{ unixTs: number; supplyLossBtc: number }>>(f, `${BGEO}/supply-loss`),
      ]);
      file.rows = mergeSupply(file.rows, profit, loss);
      file.fetchedAt = now;
      delete file.failedAt;
    } catch (err) {
      file.failedAt = now;
      if (Object.keys(file.rows).length === 0) {
        writeFileSync(supplyFile, JSON.stringify(file));
        throw err;
      }
    }
    writeFileSync(supplyFile, JSON.stringify(file));
  }
  return supplySeries(file.rows);
}

/** Daily MVRV since 2010, following Coin Metrics' pages. */
export async function btcMvrv(f: Fetch = defaultFetch): Promise<SupplyMvrv["mvrv"]> {
  const time: number[] = [];
  const value: number[] = [];
  let url: string | null = `${COINMETRICS}?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=2010-01-01&page_size=10000`;
  for (let page = 0; url && page < 10; page++) {
    const body: { data?: Array<{ time: string; CapMVRVCur?: string }>; next_page_url?: string } = await getJson(f, url);
    for (const r of body.data ?? []) {
      const v = Number(r.CapMVRVCur);
      if (!Number.isFinite(v)) continue;
      time.push(Math.floor(Date.parse(r.time) / 1000));
      value.push(v);
    }
    url = body.next_page_url ?? null;
  }
  if (time.length === 0) throw new Error("coinmetrics: no MVRV");
  return { time, value };
}

export async function btcSupplyMvrv(f: Fetch = defaultFetch): Promise<SupplyMvrv> {
  const [supply, mvrv] = await Promise.all([btcSupplyPL(f), btcMvrv(f)]);
  return { supply, mvrv };
}
