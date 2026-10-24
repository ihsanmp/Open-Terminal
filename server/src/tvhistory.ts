// Chart history from TradingView's own chart feed, so a chart holds as much history as
// TradingView shows: decades of daily bars for stocks, indices, FX and futures, a coin's
// whole life on its exchanges, and TradingView's intraday depth.
//
// Our symbols are Yahoo-style (AAPL, BBCA.JK, ^GSPC, BTC-USD, EURUSD=X, GC=F); each maps to
// one or more TradingView tickers, all requested on one websocket, and the listing with the
// longest history wins (the earlier candidate on a tie). For coins, only listings that report
// volume compete while any does: TradingView's CRYPTO index reaches furthest back but has none.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";
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

/** Crypto exchanges whose tickers name a coin alone for a derivative (COINBASE:ZEC, Coinbase's Zcash perpetual). */
const CRYPTO_EXCHANGES = new Set(["BINANCE", "COINBASE", "BYBIT", "OKX", "BITGET", "KUCOIN", "GATEIO", "MEXC", "BITSTAMP", "KRAKEN", "BITFINEX", "CRYPTO", "DERIBIT", "HTX", "BINGX", "PHEMEX", "POLONIEX", "GEMINI"]);

/**
 * A crypto exchange's ticker that names only the coin (the search lists COINBASE:ZEC, a perpetual
 * TradingView has no chart bars for): the exchange's own USD and USDT pairs, then the coin's
 * usual venues, so the chart still shows the coin.
 */
export function coinOnlyAlternates(s: string): string[] {
  const [exchange, code] = s.split(":");
  if (!CRYPTO_EXCHANGES.has(exchange) || !/^[A-Z0-9]{2,10}$/.test(code) || /(USDT|USDC|USD|BUSD|EUR|PERP)$/.test(code)) return [];
  return [`${exchange}:${code}USD`, `${exchange}:${code}USDT`, ...CRYPTO_VENUES.map((v) => v(code))];
}

/** TradingView tickers that may carry a symbol's chart, most likely first. */
export function tvCandidates(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const base = cryptoBase(s);
  let out: string[];
  if (isTvPair(s)) out = [s, ...coinOnlyAlternates(s)];
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

/**
 * The listing chosen for each symbol and interval, kept on disk for a week: after a restart a chart
 * asks that one listing for its history, not every exchange (a coin's ten, a megabyte each, ~1 s).
 */
const PICK_MS = 7 * 86_400_000;
const picksFile = join(dataDir, "cache", "tv-picks.json");
let picks: Record<string, { ticker: string; at: number }> | null = null;
let picksTimer: NodeJS.Timeout | null = null;

function loadPicks(): Record<string, { ticker: string; at: number }> {
  if (picks) return picks;
  try {
    picks = existsSync(picksFile) ? (JSON.parse(readFileSync(picksFile, "utf8")) as typeof picks) : {};
  } catch {
    picks = {};
  }
  return picks!;
}

function savePick(key: string, ticker: string): void {
  const p = loadPicks();
  p[key] = { ticker, at: Date.now() };
  // Written once a burst of charts has settled.
  if (picksTimer) return;
  picksTimer = setTimeout(() => {
    picksTimer = null;
    try {
      const old = Date.now() - PICK_MS;
      for (const [k, v] of Object.entries(p)) if (v.at < old) delete p[k];
      mkdirSync(join(dataDir, "cache"), { recursive: true });
      writeFileSync(picksFile, JSON.stringify(p));
    } catch {
      // the picks are only a shortcut
    }
  }, 2_000);
  picksTimer.unref();
}

const toCandles = (bars: tvchart.TvBar[]): Candle[] =>
  bars
    .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite))
    .map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));

/**
 * `seed`: the history an earlier run saved (the disk cache), so a refresh after a restart asks the
 * chosen listing for only the bars since, not all of them again.
 */
export async function tvHistory(symbol: string, interval: Interval, fetchBars = tvchart.bars, tokenPairOf = tokenCandidates, seed?: Candle[]): Promise<Candle[]> {
  // Only TradingView's own feed is refreshed this way (tests pass their own).
  const live = fetchBars === tvchart.bars;
  const key = `${symbol}|${interval}`;
  if (live && !known.has(key) && seed?.length) {
    const pick = loadPicks()[key];
    if (pick && Date.now() - pick.at < PICK_MS) known.set(key, { ticker: pick.ticker, bars: seed.map((c) => ({ ...c })), at: Date.now() });
  }
  const kept = live ? known.get(key) : undefined;
  if (kept && Date.now() - kept.at < REPICK_MS && kept.bars.length) {
    const last = kept.bars[kept.bars.length - 1].time;
    // The chart kept open pushes its bars: read them when they join what's held (no request at all).
    const streamed = tvchart.liveBars(kept.ticker, TV_RESOLUTION[interval]);
    if (streamed?.length && streamed[0].time <= last) {
      const byTime = new Map(kept.bars.map((b) => [b.time, b]));
      for (const b of streamed) byTime.set(b.time, b);
      kept.bars = [...byTime.values()].sort((x, y) => x.time - y.time).slice(-TV_DEPTH[interval]);
      return toCandles(kept.bars);
    }
    const behind = Math.ceil((Date.now() / 1000 - last) / BAR_SECONDS[interval]) + 3;
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
  const remember = (ticker: string, bars: tvchart.TvBar[]) => {
    known.delete(key);
    known.set(key, { ticker, bars, at: Date.now() });
    if (known.size > MAX_KNOWN) known.delete(known.keys().next().value!);
  };
  // The listing chosen before (this run or an earlier one): only it is asked.
  const pick = live ? loadPicks()[key] : undefined;
  if (pick && Date.now() - pick.at < PICK_MS) {
    const got = (await fetchBars([pick.ticker], TV_RESOLUTION[interval], TV_DEPTH[interval], 10_000))[pick.ticker];
    if (got?.length) {
      remember(pick.ticker, got);
      return toCandles(got);
    }
  }
  const candidates = tvCandidates(symbol);
  if (candidates.length === 0) throw new Error(`tradingview: no ticker for ${symbol}`);
  // A token off the ranked board is charted on its own pair first: on the big exchanges its
  // ticker may belong to another token, and the chart must be of the token the quote is. The
  // exchanges are asked meanwhile (finding out it's off the board can take half a second), and
  // their answer is used only when the pair has nothing.
  const onExchanges = fetchBars(candidates, TV_RESOLUTION[interval], TV_DEPTH[interval], 10_000);
  onExchanges.catch(() => undefined);
  const own = await tokenPairOf(symbol);
  let best: tvchart.TvBar[] | null = null;
  let ticker: string | null = null;
  for (const list of own.length ? [own, candidates] : [candidates]) {
    const found = list === candidates ? await onExchanges : await fetchBars(list, TV_RESOLUTION[interval], TV_DEPTH[interval], 10_000);
    // A ticker asked for by name is charted as itself whenever it has bars; its stand-ins only when it has none.
    const exact = list === candidates && isTvPair(symbol) ? found[symbol.toUpperCase()] : null;
    best = exact?.length ? exact : pickLongest(list, found, cryptoBase(symbol) !== null);
    ticker = list.find((t) => found[t] === best) ?? null;
    if (best) break;
  }
  if (!best) throw new Error(`tradingview: no bars for ${symbol}`);
  if (live && ticker) {
    remember(ticker, best);
    savePick(key, ticker);
  }
  return toCandles(best);
}
