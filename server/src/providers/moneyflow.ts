// Money flow: how much money went into an asset and how much came out, over a day, a week, a
// month, three months and a year, bar by bar.
//
//  - A coin traded on Binance: its trades split by who started them. Buys that took a seller's
//    order ("taker buy") are money coming in; sells that took a buyer's are money going out
//    (Binance's klines give both in USDT).
//  - Anything else (stocks, ETFs, indices): estimated from its bars, as Chaikin's money flow does.
//    Each bar's turnover (typical price × volume) is split by where it closed in its range: at
//    the high all of it counts as inflow, at the low all as outflow, halfway half and half.

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type FlowBar = { time: number; inflow: number; outflow: number };
export type FlowSummary = { inflow: number; outflow: number; net: number; buyShare: number | null };

/** The periods shown, each with the bars it's made of (chart feed, Binance) and how many. */
export const FLOW_PERIODS = [
  { key: "1D", seconds: 86_400, interval: "15m", binance: "15m", bars: 96, range: "5D" },
  { key: "1W", seconds: 7 * 86_400, interval: "1h", binance: "1h", bars: 168, range: "1M" },
  { key: "1M", seconds: 30 * 86_400, interval: "1D", binance: "4h", bars: 180, range: "6M" },
  { key: "3M", seconds: 91 * 86_400, interval: "1D", binance: "1d", bars: 91, range: "6M" },
  { key: "1Y", seconds: 365 * 86_400, interval: "1W", binance: "1w", bars: 53, range: "5Y" },
] as const;
export type FlowPeriod = (typeof FLOW_PERIODS)[number];

/** Inflow and outflow estimated from bars (close location in the bar's range × turnover). */
export function clvFlows(candles: Candle[]): FlowBar[] {
  return candles.map((c) => {
    const turnover = ((c.high + c.low + c.close) / 3) * c.volume;
    if (!(turnover > 0)) return { time: c.time, inflow: 0, outflow: 0 };
    const share = c.high > c.low ? Math.min(1, Math.max(0, (c.close - c.low) / (c.high - c.low))) : 0.5;
    return { time: c.time, inflow: turnover * share, outflow: turnover * (1 - share) };
  });
}

/** Binance klines as [open time (s), quote volume, taker buy quote volume]: buys in, sells out. */
export function takerFlows(rows: Array<[number, number, number]>): FlowBar[] {
  return rows.map(([time, quote, takerBuy]) => ({ time, inflow: takerBuy, outflow: Math.max(0, quote - takerBuy) }));
}

/**
 * The bars of the period, counted back from the latest. A day of a market that closes is its
 * last session (the bars within 20 hours of its last one); a coin's is the last 24 hours.
 */
export function inPeriod(bars: FlowBar[], period: Pick<FlowPeriod, "key" | "seconds">, roundTheClock: boolean): FlowBar[] {
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1].time;
  const span = period.key === "1D" && !roundTheClock ? 20 * 3600 : period.seconds;
  return bars.filter((b) => b.time > last - span);
}

export function summarize(bars: FlowBar[]): FlowSummary {
  let inflow = 0;
  let outflow = 0;
  for (const b of bars) {
    inflow += b.inflow;
    outflow += b.outflow;
  }
  const total = inflow + outflow;
  return { inflow, outflow, net: inflow - outflow, buyShare: total > 0 ? inflow / total : null };
}
