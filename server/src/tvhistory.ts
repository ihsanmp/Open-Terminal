// Chart history from TradingView's own chart feed, so a chart holds as much history as
// TradingView shows: decades of daily bars for stocks, indices, FX and futures, a coin's
// whole life on its exchanges, and TradingView's intraday depth.
//
// Our symbols are Yahoo-style (AAPL, BBCA.JK, ^GSPC, BTC-USD, EURUSD=X, GC=F); each maps to
// one or more TradingView tickers, all requested on one websocket, and the listing with the
// longest history wins (the earlier candidate on a tie). For coins, only listings that report
// volume compete while any does: TradingView's CRYPTO index reaches furthest back but has none.

import { fxTickers } from "./providers/forex.js";
import { futuresTickers } from "./providers/futures.js";
import * as tvchart from "./providers/tvchart.js";
import { offBoardPair, tvTickers } from "./providers/tradingview.js";
import { INDEX_TV_TICKER } from "./indices.js";
import { cryptoBase, isTvPair } from "./symbols.js";
import type { Interval } from "./intervals.js";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export const TV_RESOLUTION: Record<Interval, string> = {
  "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1D": "1D", "1W": "1W", "1M": "1M",
};

/** Bars asked for per interval: all of TradingView's daily history, its intraday depth. */
export const TV_DEPTH: Record<Interval, number> = {
  "1m": 5000, "5m": 5000, "15m": 5000, "1h": 5000, "4h": 5000, "1D": 20000, "1W": 5000, "1M": 2000,
};

/** Exchanges tried for a coin, in order of preference on a tie. */
const CRYPTO_VENUES = [
  (b: string) => `BINANCE:${b}USDT`,
  (b: string) => `COINBASE:${b}USD`,
  (b: string) => `BYBIT:${b}USDT`,
  (b: string) => `OKX:${b}USDT`,
  (b: string) => `BITGET:${b}USDT`,
  (b: string) => `KUCOIN:${b}USDT`,
  (b: string) => `GATEIO:${b}USDT`,
  (b: string) => `MEXC:${b}USDT`,
  (b: string) => `BITSTAMP:${b}USD`,
  (b: string) => `CRYPTO:${b}USD`,
];

/** Continuous front-month contracts for Yahoo's futures symbols. */

/** TradingView tickers that may carry a symbol's chart, most likely first. */
export function tvCandidates(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const base = cryptoBase(s);
  let out: string[];
  if (isTvPair(s)) out = [s];
  else if (base) out = CRYPTO_VENUES.map((v) => v(base));
  else if (INDEX_TV_TICKER.has(s)) {
    // TVC's copy of an index often reaches much further back than the exchange's own.
    const tv = INDEX_TV_TICKER.get(s)!;
    out = [tv, `TVC:${tv.split(":")[1]}`];
  } else if (s.startsWith("^")) out = [`TVC:${s.slice(1)}`];
  else if (fxTickers(s)) out = fxTickers(s)!;
  else if (s === "DX-Y.NYB") out = ["TVC:DXY"];
  else if (/=F$/.test(s)) out = futuresTickers(s) ?? [];
  else out = tvTickers(s);
  return [...new Set(out)].filter((t) => tvchart.SYMBOL_RE.test(t));
}

const hasVolume = (bars: tvchart.TvBar[]) => bars.some((b) => (b.volume ?? 0) > 0);

/** Of the listings that answered, the one with the most bars (earlier candidate on a tie);
 *  with `preferVolume`, among those that report volume when any does. */
export function pickLongest(candidates: string[], found: Record<string, tvchart.TvBar[] | null>, preferVolume = false): tvchart.TvBar[] | null {
  const answered = candidates.map((c) => found[c]).filter((b): b is tvchart.TvBar[] => Boolean(b && b.length > 0));
  const withVolume = preferVolume ? answered.filter(hasVolume) : [];
  let best: tvchart.TvBar[] | null = null;
  for (const bars of withVolume.length ? withVolume : answered) if (!best || bars.length > best.length) best = bars;
  return best;
}

/** A token off the ranked board: the pair its quote comes from (see offBoardPair). */
async function tokenCandidates(symbol: string): Promise<string[]> {
  const base = cryptoBase(symbol);
  if (!base) return [];
  return (await offBoardPair(base)).filter((t) => tvchart.SYMBOL_RE.test(t));
}

/** A bar's length, for how many bars have closed since the last one kept. */
const BAR_SECONDS: Record<Interval, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1D": 86_400, "1W": 604_800, "1M": 2_592_000,
};

/**
 * Histories read in full, kept with the listing chosen: a refresh asks that listing for only the
 * bars since (a handful), not every listing for all of it (up to 20,000 bars each, a megabyte). The
 * choice is made again in full every six hours.
 */
const known = new Map<string, { ticker: string; bars: tvchart.TvBar[]; at: number }>();
const REPICK_MS = 6 * 3_600_000;
const MAX_KNOWN = 300;

const toCandles = (bars: tvchart.TvBar[]): Candle[] =>
  bars
    .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite))
    .map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));

export async function tvHistory(symbol: string, interval: Interval, fetchBars = tvchart.bars, tokenPairOf = tokenCandidates): Promise<Candle[]> {
  // Only TradingView's own feed is refreshed this way (tests pass their own).
  const live = fetchBars === tvchart.bars;
  const key = `${symbol}|${interval}`;
  const kept = live ? known.get(key) : undefined;
  if (kept && Date.now() - kept.at < REPICK_MS && kept.bars.length) {
    const behind = Math.ceil((Date.now() / 1000 - kept.bars[kept.bars.length - 1].time) / BAR_SECONDS[interval]) + 3;
    if (behind < 500) {
      const fresh = (await fetchBars([kept.ticker], TV_RESOLUTION[interval], behind, 10_000))[kept.ticker];
      if (fresh?.length) {
        const byTime = new Map(kept.bars.map((b) => [b.time, b]));
        for (const b of fresh) byTime.set(b.time, b);
        kept.bars = [...byTime.values()].sort((x, y) => x.time - y.time).slice(-TV_DEPTH[interval]);
        return toCandles(kept.bars);
      }
    }
  }
  const candidates = tvCandidates(symbol);
  if (candidates.length === 0) throw new Error(`tradingview: no ticker for ${symbol}`);
  // A token off the ranked board is charted on its own pair first: on the big exchanges its
  // ticker may belong to another token, and the chart must be of the token the quote is.
  const own = await tokenPairOf(symbol);
  let best: tvchart.TvBar[] | null = null;
  let ticker: string | null = null;
  for (const list of own.length ? [own, candidates] : [candidates]) {
    const found = await fetchBars(list, TV_RESOLUTION[interval], TV_DEPTH[interval], 10_000);
    best = pickLongest(list, found, cryptoBase(symbol) !== null);
    ticker = list.find((t) => found[t] === best) ?? null;
    if (best) break;
  }
  if (!best) throw new Error(`tradingview: no bars for ${symbol}`);
  if (live && ticker) {
    known.delete(key);
    known.set(key, { ticker, bars: best, at: Date.now() });
    if (known.size > MAX_KNOWN) known.delete(known.keys().next().value!);
  }
  return toCandles(best);
}
