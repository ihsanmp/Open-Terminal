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

/** A saved range/interval pair, falling back to 6M and the range's own interval. */
export function resolveChartView(savedRange: string | undefined, savedInterval: string | undefined, symbol: string) {
  const range: Range = (RANGES as readonly string[]).includes(savedRange ?? "") ? (savedRange as Range) : "6M";
  const interval: ChartInterval = (INTERVALS as readonly string[]).includes(savedInterval ?? "")
    ? (savedInterval as ChartInterval)
    : defaultInterval(range, symbol);
  return { range, interval };
}
