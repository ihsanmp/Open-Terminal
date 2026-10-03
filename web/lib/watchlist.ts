// The chart page's watchlist panel (TradingView's right-hand Watchlist): symbols grouped by kind,
// how each is shown, its performance over the usual periods, and whether its market is open.

import { forexClosed } from "./candle-time";
import { isCryptoSymbol, usSessionActive } from "./refresh";

export type Section = "indices" | "stocks" | "futures" | "forex" | "crypto";

export const SECTIONS: Array<[Section, string]> = [
  ["indices", "INDICES"],
  ["stocks", "STOCKS"],
  ["futures", "FUTURES"],
  ["forex", "FOREX"],
  ["crypto", "CRYPTO"],
];

/** Which section a symbol is listed under. */
export function sectionOf(symbol: string): Section {
  const s = symbol.toUpperCase();
  if (s.startsWith("^")) return "indices";
  if (s.endsWith("=F")) return "futures";
  if (s.endsWith("=X")) return "forex";
  if (isCryptoSymbol(s)) return "crypto";
  return "stocks";
}

/** The watchlist by section, in section order, each keeping the list's own order. */
export function groupBySection(symbols: string[]): Array<{ section: Section; label: string; symbols: string[] }> {
  return SECTIONS.map(([section, label]) => ({ section, label, symbols: symbols.filter((s) => sectionOf(s) === section) })).filter((g) => g.symbols.length > 0);
}

/** As TradingView writes it: BTC-USD → BTCUSD, EURUSD=X → EURUSD, GC=F → GC, ^GSPC → GSPC. */
export function displaySymbol(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/^\^/, "")
    .replace(/=[XF]$/, "")
    .replace(/-(USDT?)$/, "$1");
}

/** Up to two letters for a symbol's round badge, and a steady color for it. */
export function badgeOf(symbol: string): { text: string; color: string } {
  const text = displaySymbol(symbol).replace(/[^A-Z0-9]/g, "").slice(0, sectionOf(symbol) === "crypto" ? 1 : 2) || "?";
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { text, color: `hsl(${h % 360} 55% 42%)` };
}

export type PerfPeriod = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y";
export const PERF_PERIODS: PerfPeriod[] = ["1W", "1M", "3M", "6M", "YTD", "1Y"];

/** Where a period starts, counting back from `now` (Unix seconds). */
function periodStart(p: PerfPeriod, now: number): number {
  const d = new Date(now * 1000);
  const back = (months: number) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate()) / 1000;
  switch (p) {
    case "1W":
      return now - 7 * 86_400;
    case "1M":
      return back(1);
    case "3M":
      return back(3);
    case "6M":
      return back(6);
    case "YTD":
      return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
    case "1Y":
      return back(12);
  }
}

/**
 * Percent change over each period, from daily closes (ascending): the latest close against the last
 * close before the period started, as TradingView's Performance tiles. Null when the data doesn't
 * reach back that far.
 */
export function performance(candles: Array<{ time: number; close: number }>, now = Date.now() / 1000): Record<PerfPeriod, number | null> {
  const out = {} as Record<PerfPeriod, number | null>;
  const last = candles.at(-1)?.close;
  for (const p of PERF_PERIODS) {
    const start = periodStart(p, now);
    let ref: number | undefined;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].time < start) {
        ref = candles[i].close;
        break;
      }
    }
    out[p] = last !== undefined && ref !== undefined && ref > 0 ? (last / ref - 1) * 100 : null;
  }
  return out;
}

/** Whether the symbol's market trades now: crypto always, forex on weekdays, the rest in the US session. */
export function marketOpen(symbol: string, marketState: string | null | undefined, now = new Date()): boolean {
  const section = sectionOf(symbol);
  if (section === "crypto") return true;
  if (section === "forex" || section === "futures") return !forexClosed(Math.floor(now.getTime() / 1000));
  if (marketState) return /REGULAR|OPEN/i.test(marketState);
  const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const part = (t: string) => ny.find((x) => x.type === t)?.value ?? "";
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  return usSessionActive(now) && !["Sat", "Sun"].includes(part("weekday")) && minutes >= 570 && minutes < 960;
}

/**
 * Decimals for a symbol's price and its change, the same for both as on TradingView: forex to the
 * pip (4, or 3 for yen-like pairs above 20), small prices to more places, the rest to the cent.
 */
export function priceDigits(symbol: string, price: number | null | undefined): number {
  const abs = Math.abs(price ?? 0);
  if (sectionOf(symbol) === "forex") return abs >= 20 ? 3 : abs >= 0.5 ? 4 : 5;
  if (abs === 0 || abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return Math.min(10, Math.ceil(-Math.log10(abs)) + 3);
}

/** The kinds of market the watchlist follows: the chart's decides which list shows. */
export type MarketKind = "crypto" | "stocks" | "commodities";

export const MARKET_KINDS: Array<[MarketKind, string]> = [
  ["crypto", "Crypto"],
  ["stocks", "Stocks & indices"],
  ["commodities", "Commodities & forex"],
];

const SECTION_MARKET: Record<Section, MarketKind> = { crypto: "crypto", stocks: "stocks", indices: "stocks", futures: "commodities", forex: "commodities" };

/** Which kind of market a symbol belongs to (a Solana chart → crypto, gold or EURUSD → commodities). */
export const marketOf = (symbol: string): MarketKind => SECTION_MARKET[sectionOf(symbol)];

/** What a kind's list starts with the first time it is shown; it is the user's own list from then on. */
export const MARKET_DEFAULTS: Record<MarketKind, string[]> = {
  crypto: ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "AVAX-USD", "LINK-USD"],
  stocks: ["^GSPC", "^IXIC", "^DJI", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META"],
  commodities: ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F", "EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X"],
};

/** The watchlist's sections for one kind of market (all of them for "all"). */
export function sectionsFor(kind: MarketKind | "all"): Section[] {
  return SECTIONS.map(([s]) => s).filter((s) => kind === "all" || SECTION_MARKET[s] === kind);
}
