// Chart history from TradingView's own chart feed, so a chart holds as much history as
// TradingView shows: decades of daily bars for stocks, indices, FX and futures, a coin's
// whole life on its exchanges, and TradingView's intraday depth.
//
// Our symbols are Yahoo-style (AAPL, BBCA.JK, ^GSPC, BTC-USD, EURUSD=X, GC=F); each maps to
// one or more TradingView tickers, all requested on one websocket, and the listing with the
// longest history wins (the earlier candidate on a tie). For coins, only listings that report
// volume compete while any does: TradingView's CRYPTO index reaches furthest back but has none.

import * as tvchart from "./providers/tvchart.js";
import { tvTickers } from "./providers/tradingview.js";
import { INDEX_TV_TICKER } from "./indices.js";
import { cryptoBase } from "./symbols.js";
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
const FUTURES: Record<string, string> = {
  ES: "CME_MINI:ES1!", NQ: "CME_MINI:NQ1!", RTY: "CME_MINI:RTY1!", YM: "CBOT_MINI:YM1!",
  GC: "COMEX:GC1!", SI: "COMEX:SI1!", HG: "COMEX:HG1!", PL: "NYMEX:PL1!", PA: "NYMEX:PA1!",
  CL: "NYMEX:CL1!", NG: "NYMEX:NG1!", RB: "NYMEX:RB1!", HO: "NYMEX:HO1!", BZ: "NYMEX:BB1!",
  ZC: "CBOT:ZC1!", ZW: "CBOT:ZW1!", ZS: "CBOT:ZS1!", ZN: "CBOT:ZN1!", ZB: "CBOT:ZB1!", ZF: "CBOT:ZF1!",
  KC: "ICEUS:KC1!", SB: "ICEUS:SB1!", CC: "ICEUS:CC1!", CT: "ICEUS:CT1!",
  "6E": "CME:6E1!", "6J": "CME:6J1!", "6B": "CME:6B1!", BTC: "CME:BTC1!",
};

/** TradingView tickers that may carry a symbol's chart, most likely first. */
export function tvCandidates(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const base = cryptoBase(s);
  let out: string[];
  if (base) out = CRYPTO_VENUES.map((v) => v(base));
  else if (INDEX_TV_TICKER.has(s)) {
    // TVC's copy of an index often reaches much further back than the exchange's own.
    const tv = INDEX_TV_TICKER.get(s)!;
    out = [tv, `TVC:${tv.split(":")[1]}`];
  } else if (s.startsWith("^")) out = [`TVC:${s.slice(1)}`];
  else if (/^[A-Z]{6}=X$/.test(s)) out = [`FX_IDC:${s.slice(0, 6)}`, `FX:${s.slice(0, 6)}`];
  else if (/^[A-Z]{3}=X$/.test(s)) out = [`FX_IDC:USD${s.slice(0, 3)}`];
  else if (s === "DX-Y.NYB") out = ["TVC:DXY"];
  else if (/=F$/.test(s)) out = FUTURES[s.slice(0, -2)] ? [FUTURES[s.slice(0, -2)]] : [];
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

export async function tvHistory(symbol: string, interval: Interval, fetchBars = tvchart.bars): Promise<Candle[]> {
  const candidates = tvCandidates(symbol);
  if (candidates.length === 0) throw new Error(`tradingview: no ticker for ${symbol}`);
  const found = await fetchBars(candidates, TV_RESOLUTION[interval], TV_DEPTH[interval], 10_000);
  const best = pickLongest(candidates, found, cryptoBase(symbol) !== null);
  if (!best) throw new Error(`tradingview: no bars for ${symbol}`);
  return best
    .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite))
    .map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
}
