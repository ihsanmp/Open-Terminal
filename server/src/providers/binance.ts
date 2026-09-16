import type { CryptoRow } from "./coingecko.js";
import type { Quote, Candle } from "./yahoo.js";
import { cryptoTicker } from "../symbols.js";

// data-api.binance.vision is Binance's official market-data-only mirror. It is
// tried first because api.binance.com is blocked by some ISPs (e.g. Indonesia
// resolves it to a block page), which silently broke every crypto quote/chart.
const BASES = ["https://data-api.binance.vision", "https://api.binance.com"];

async function bfetch(path: string): Promise<any> {
  let lastErr: unknown = new Error("binance: no endpoint reachable");
  for (const base of BASES) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`binance ${res.status} for ${path}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

let universe: { bases: Set<string>; fetched: number } | null = null;

/** Every base asset with an actively trading USDT spot pair (~500), refreshed every 6h. */
export async function usdtBases(): Promise<Set<string>> {
  if (universe && Date.now() - universe.fetched < 6 * 3_600_000) return universe.bases;
  const info = await bfetch("/api/v3/exchangeInfo?permissions=SPOT");
  const bases = new Set<string>();
  for (const s of info.symbols ?? []) {
    if (s.quoteAsset === "USDT" && s.status === "TRADING") bases.add(s.baseAsset);
  }
  if (bases.size === 0) throw new Error("binance: empty exchangeInfo");
  universe = { bases, fetched: Date.now() };
  return bases;
}

/** Whole USDT board from 24h tickers, most traded first (CoinGecko fallback). */
export async function markets(): Promise<CryptoRow[]> {
  const [bases, rows] = await Promise.all([usdtBases(), bfetch("/api/v3/ticker/24hr") as Promise<any[]>]);
  return rows
    .filter((r) => r.symbol.endsWith("USDT") && bases.has(r.symbol.slice(0, -4)))
    .map((r) => {
      const base = r.symbol.slice(0, -4);
      return {
        id: r.symbol,
        symbol: base,
        ticker: cryptoTicker(base),
        name: base,
        price: +r.lastPrice,
        changePercent24h: +r.priceChangePercent,
        marketCap: null,
        volume24h: +r.quoteVolume,
        rank: null,
        sparkline: [],
        image: null,
      };
    })
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function orderBook(base: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const d = await bfetch(`/api/v3/depth?symbol=${base.toUpperCase()}USDT&limit=${limit}`);
  return { bids: d.bids ?? [], asks: d.asks ?? [] };
}

/** 24h quote for a base asset, reported under the requested display symbol (e.g. "PEPE-USD"). */
export async function quote(base: string, displaySymbol: string): Promise<Quote> {
  const d = await bfetch(`/api/v3/ticker/24hr?symbol=${base.toUpperCase()}USDT`);
  return {
    symbol: displaySymbol,
    name: base.toUpperCase(),
    price: +d.lastPrice,
    change: +d.priceChange,
    changePercent: +d.priceChangePercent,
    open: +d.openPrice,
    high: +d.highPrice,
    low: +d.lowPrice,
    previousClose: +d.prevClosePrice,
    bid: +d.bidPrice || null,
    ask: +d.askPrice || null,
    volume: +d.volume,
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "Binance",
    marketState: "Open",
    time: null,
    source: "binance",
  };
}

// Binance caps klines at 1000 per request.
const RANGE_TO_KLINE: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "4h", limit: 1000 },
  YTD: { interval: "1d", limit: 400 },
  "1Y": { interval: "1d", limit: 365 },
  "5Y": { interval: "1w", limit: 260 },
  MAX: { interval: "1M", limit: 200 },
};

export async function history(base: string, rangeKey: string): Promise<Candle[]> {
  const { interval, limit } = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  const rows: any[] = await bfetch(`/api/v3/klines?symbol=${base.toUpperCase()}USDT&interval=${interval}&limit=${limit}`);
  const candles = rows.map((r) => ({
    time: Math.round(r[0] / 1000),
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
  if (rangeKey !== "YTD") return candles;
  const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  return candles.filter((c) => c.time >= jan1);
}
