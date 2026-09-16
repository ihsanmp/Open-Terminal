import type { Candle, Quote } from "./yahoo.js";
import { cryptoTicker } from "../symbols.js";

const BASE = "https://api.coingecko.com/api/v3";

export type CryptoRow = {
  id: string;
  symbol: string;
  /** Symbol to load in the terminal, e.g. "PEPE-USD". */
  ticker: string;
  name: string;
  price: number;
  changePercent24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  rank: number | null;
  sparkline: number[];
  image: string | null;
};

// The keyless public API allows only a handful of calls per minute, so requests
// run one at a time and back off for a while after a 429.
let chain: Promise<unknown> = Promise.resolve();
let cooldownUntil = 0;
let lastCallAt = 0;
const MIN_SPACING_MS = 2_500;

function cgfetch(path: string): Promise<any> {
  const run = async () => {
    if (Date.now() < cooldownUntil) throw new Error("coingecko rate-limited (cooling down)");
    const wait = lastCallAt + MIN_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) cooldownUntil = Date.now() + 60_000;
    if (!res.ok) throw new Error(`coingecko ${res.status} for ${path}`);
    return res.json();
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

export async function markets(perPage = 50, page = 1): Promise<CryptoRow[]> {
  const rows: any[] = await cgfetch(
    `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=true&price_change_percentage=24h`
  );
  return rows.map((r) => {
    const symbol = (r.symbol ?? "").toUpperCase();
    return {
      id: r.id,
      symbol,
      ticker: cryptoTicker(symbol),
      name: r.name,
      price: r.current_price,
      changePercent24h: r.price_change_percentage_24h ?? null,
      marketCap: r.market_cap ?? null,
      volume24h: r.total_volume ?? null,
      rank: r.market_cap_rank ?? null,
      sparkline: r.sparkline_in_7d?.price ?? [],
      image: r.image ?? null,
    };
  });
}

export async function globalStats(): Promise<{ totalMarketCap: number; btcDominance: number; ethDominance: number; coins: number }> {
  const d = (await cgfetch("/global"))?.data;
  return {
    totalMarketCap: d?.total_market_cap?.usd ?? 0,
    btcDominance: d?.market_cap_percentage?.btc ?? 0,
    ethDominance: d?.market_cap_percentage?.eth ?? 0,
    coins: d?.active_cryptocurrencies ?? 0,
  };
}

const idCache = new Map<string, { id: string; name: string } | null>();

/**
 * CoinGecko id for a ticker (needed only for OHLC of tokens Binance doesn't list).
 * Many coins share a symbol, so the best-ranked exact match wins; one search per
 * symbol, remembered for the life of the process.
 */
export async function resolveCoin(base: string): Promise<{ id: string; name: string }> {
  const key = base.toUpperCase();
  if (!idCache.has(key)) {
    const d = await cgfetch(`/search?query=${encodeURIComponent(key)}`);
    const hits = (d?.coins ?? [])
      .filter((c: any) => String(c.symbol ?? "").toUpperCase() === key)
      .sort((a: any, b: any) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity));
    idCache.set(key, hits[0] ? { id: hits[0].id, name: hits[0].name } : null);
  }
  const hit = idCache.get(key);
  if (!hit) throw new Error(`coingecko: no coin with symbol ${key}`);
  return hit;
}

export async function quote(base: string, displaySymbol: string): Promise<Quote> {
  const { id, name } = await resolveCoin(base);
  const d = (await cgfetch(
    `/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
  ))?.[id];
  if (!d?.usd) throw new Error(`coingecko: no price for ${id}`);
  const change = d.usd_24h_change ?? null;
  const prev = change !== null ? d.usd / (1 + change / 100) : null;
  return {
    symbol: displaySymbol,
    name,
    price: d.usd,
    change: prev !== null ? d.usd - prev : null,
    changePercent: change,
    open: null,
    high: null,
    low: null,
    previousClose: prev,
    bid: null,
    ask: null,
    volume: d.usd_24h_vol ?? null,
    avgVolume: null,
    marketCap: d.usd_market_cap ?? null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "CoinGecko",
    marketState: "Open",
    time: null,
    source: "coingecko",
  };
}

// The free OHLC endpoint picks candle size from `days`: 1 → 30m, ≤30 → 4h, more → 4 days.
const RANGE_DAYS: Record<string, string> = {
  "1D": "1", "5D": "7", "1M": "30", "6M": "180", YTD: "365", "1Y": "365", "5Y": "max", MAX: "max",
};

/** Candles for tokens that aren't listed on Binance (no volume in this endpoint). */
export async function history(base: string, rangeKey: string): Promise<Candle[]> {
  const { id } = await resolveCoin(base);
  const rows: number[][] = await cgfetch(`/coins/${id}/ohlc?vs_currency=usd&days=${RANGE_DAYS[rangeKey] ?? "180"}`);
  const seen = new Set<number>();
  const candles: Candle[] = [];
  for (const [t, o, h, l, c] of rows) {
    const time = Math.round(t / 1000);
    if (seen.has(time)) continue;
    seen.add(time);
    candles.push({ time, open: o, high: h, low: l, close: c, volume: 0 });
  }
  if (rangeKey !== "YTD") return candles;
  const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  return candles.filter((c) => c.time >= jan1);
}
