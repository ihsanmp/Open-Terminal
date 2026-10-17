// The quant forecaster's markets: what it forecasts and what it reads besides, as daily closes from
// TradingView's chart feed, kept on disk and topped up with the days since (the first read asks for
// each market's whole daily history, then only the bars since the last).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { bars, type TvBar } from "../providers/tvchart.js";

export type MarketKey = "xau" | "btc" | "eth" | "dxy" | "oil" | "spx" | "ndx" | "eurusd" | "usdjpy" | "us10y" | "vix" | "us2y";

export type Market = { key: MarketKey; label: string; tv: string; symbol: string; group: string; forecast: boolean; unit: "%" | "bp" };

/** The forecast markets, and the context ones (the VIX, the 2-year yield) they are read with. */
export const MARKETS: Market[] = [
  { key: "xau", label: "Emas (XAU/USD)", tv: "OANDA:XAUUSD", symbol: "XAUUSD=X", group: "Komoditas", forecast: true, unit: "%" },
  { key: "oil", label: "Minyak WTI", tv: "TVC:USOIL", symbol: "CL=F", group: "Komoditas", forecast: true, unit: "%" },
  { key: "btc", label: "Bitcoin", tv: "BITSTAMP:BTCUSD", symbol: "BTC-USD", group: "Crypto", forecast: true, unit: "%" },
  { key: "eth", label: "Ether", tv: "BITSTAMP:ETHUSD", symbol: "ETH-USD", group: "Crypto", forecast: true, unit: "%" },
  { key: "spx", label: "S&P 500", tv: "TVC:SPX", symbol: "^GSPC", group: "Saham", forecast: true, unit: "%" },
  { key: "ndx", label: "Nasdaq 100", tv: "NASDAQ:NDX", symbol: "^NDX", group: "Saham", forecast: true, unit: "%" },
  { key: "dxy", label: "Dollar Index (DXY)", tv: "TVC:DXY", symbol: "DX-Y.NYB", group: "Forex", forecast: true, unit: "%" },
  { key: "eurusd", label: "EUR/USD", tv: "FX:EURUSD", symbol: "EURUSD=X", group: "Forex", forecast: true, unit: "%" },
  { key: "usdjpy", label: "USD/JPY", tv: "FX:USDJPY", symbol: "USDJPY=X", group: "Forex", forecast: true, unit: "%" },
  { key: "us10y", label: "Yield US 10Y", tv: "TVC:US10Y", symbol: "^TNX", group: "Obligasi", forecast: true, unit: "bp" },
  { key: "vix", label: "VIX", tv: "TVC:VIX", symbol: "^VIX", group: "Konteks", forecast: false, unit: "%" },
  { key: "us2y", label: "Yield US 2Y", tv: "TVC:US02Y", symbol: "TVC:US02Y", group: "Konteks", forecast: false, unit: "bp" },
];

export type Closes = { days: number[]; close: number[] };

/**
 * The UTC day a daily bar closes on: a bar is stamped when its session opens, forex, gold, oil and
 * yields the evening before (21:00–23:00 UTC), crypto at midnight, US stocks at 13:30.
 */
export const sessionDay = (time: number) => Math.floor(time / 86_400) + (time % 86_400 >= 18 * 3600 ? 1 : 0);
type Store = { at: number; bars: Record<string, TvBar[]> };

const dir = join(dataDir, "quant");
const file = join(dir, "bars-1D.json");
const FULL = 8000;

let store: Store | null = null;
let refreshing: Promise<Store> | null = null;

function readStore(): Store {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Store;
  } catch {
    // a broken file is read again from scratch
  }
  return { at: 0, bars: {} };
}

async function refresh(s: Store, now: number): Promise<Store> {
  const last = Math.min(...MARKETS.map((m) => s.bars[m.tv]?.at(-1)?.time ?? 0));
  const count = last > 0 ? Math.min(FULL, Math.ceil((now / 1000 - last) / 86_400) + 10) : FULL;
  const fresh = await bars(
    MARKETS.map((m) => m.tv),
    "1D",
    count,
    60_000,
  ).catch(() => ({}) as Record<string, TvBar[] | null>);
  for (const m of MARKETS) {
    const merged = new Map<number, TvBar>();
    for (const b of s.bars[m.tv] ?? []) merged.set(b.time, b);
    for (const b of fresh[m.tv] ?? []) merged.set(b.time, b);
    s.bars[m.tv] = [...merged.values()].sort((a, b) => a.time - b.time);
  }
  s.at = now;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(s));
  return s;
}

/** Each market's daily closes by UTC day number, refreshed when older than `maxAgeMs`. */
export async function dailyCloses(maxAgeMs = 3 * 3600_000, now = Date.now()): Promise<Record<MarketKey, Closes>> {
  store ??= readStore();
  const s = store;
  if (now - s.at >= maxAgeMs || MARKETS.some((m) => !s.bars[m.tv]?.length)) {
    refreshing ??= refresh(s, now).finally(() => (refreshing = null));
    await refreshing;
  }
  const out = {} as Record<MarketKey, Closes>;
  for (const m of MARKETS) {
    const days: number[] = [];
    const close: number[] = [];
    for (const b of s.bars[m.tv] ?? []) {
      if (!(b.close > 0)) continue;
      const d = sessionDay(b.time);
      // One close a day (a feed stamped twice in a day keeps the later).
      if (days.length && days[days.length - 1] === d) close[close.length - 1] = b.close;
      else {
        days.push(d);
        close.push(b.close);
      }
    }
    out[m.key] = { days, close };
  }
  return out;
}
