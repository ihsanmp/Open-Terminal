import { isCryptoSymbol } from "./refresh";

// Chart ranges and candle intervals. As on TradingView, picking a range also picks its usual
// interval (shown in the interval menu), which can then be changed freely.

export const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type Range = (typeof RANGES)[number];

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const;
export type ChartInterval = (typeof INTERVALS)[number];

export const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1D": 86_400,
  "1W": 604_800,
  "1M": 2_592_000,
};

/** The interval a range opens with. Crypto trades around the clock, so its 6M uses 4h candles. */
export function defaultInterval(range: Range, symbol: string): ChartInterval {
  switch (range) {
    case "1D":
      return "5m";
    case "5D":
      return "15m";
    case "1M":
      return "1h";
    case "6M":
      return isCryptoSymbol(symbol) ? "4h" : "1D";
    case "5Y":
      return "1W";
    case "MAX":
      return "1M";
    default:
      return "1D";
  }
}

/** Fewest bars in view when a range opens, so a short range at a long interval (5D at 1D)
 *  still draws candles at a readable width. */
export const MIN_VISIBLE_BARS = 40;

const DAY = 86_400;

/** Index of the first bar inside a range: for 1D/5D the last 24 hours or five days on
 *  around-the-clock markets, else the last one or five sessions with data (a stock on a Sunday
 *  still shows Friday); the calendar window for longer ranges. */
export function rangeStartIndex(times: number[], range: Range, now = Date.now() / 1000, continuous = false): number {
  if (times.length === 0) return 0;
  if (range === "MAX") return 0;
  if (continuous && (range === "1D" || range === "5D")) {
    const since = times[times.length - 1] - (range === "1D" ? 1 : 5) * DAY;
    const i = times.findIndex((t) => t > since);
    return i < 0 ? 0 : i;
  }
  if (range === "1D" || range === "5D") {
    const days = [...new Set(times.map((t) => Math.floor(t / DAY)))].slice(range === "1D" ? -1 : -5);
    const first = days[0] * DAY;
    const i = times.findIndex((t) => t >= first);
    return i < 0 ? 0 : i;
  }
  const d = new Date(now * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const start =
    range === "1M" ? Date.UTC(y, m - 1, day)
    : range === "6M" ? Date.UTC(y, m - 6, day)
    : range === "YTD" ? Date.UTC(y, 0, 1)
    : range === "1Y" ? Date.UTC(y - 1, m, day)
    : Date.UTC(y - 5, m, day);
  const i = times.findIndex((t) => t >= start / 1000);
  return i < 0 ? times.length - 1 : i;
}

/** Logical range to open a chart on: the range's window (at least MIN_VISIBLE_BARS wide), with
 *  the rest of the history loaded to the left. */
export function initialVisibleRange(times: number[], range: Range, now = Date.now() / 1000, continuous = false): { from: number; to: number } {
  const last = times.length - 1;
  const from = Math.max(0, Math.min(rangeStartIndex(times, range, now, continuous), last - MIN_VISIBLE_BARS + 1));
  return { from: from - 0.5, to: last + 2 };
}

/** A saved range/interval pair, falling back to 6M and the range's own interval. */
export function resolveChartView(savedRange: string | undefined, savedInterval: string | undefined, symbol: string) {
  const range: Range = (RANGES as readonly string[]).includes(savedRange ?? "") ? (savedRange as Range) : "6M";
  const interval: ChartInterval = (INTERVALS as readonly string[]).includes(savedInterval ?? "")
    ? (savedInterval as ChartInterval)
    : defaultInterval(range, symbol);
  return { range, interval };
}
