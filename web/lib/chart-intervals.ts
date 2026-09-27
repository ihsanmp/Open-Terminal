// Candle intervals, as TradingView's interval menu has them: grouped, each with a star to put
// it on the toolbar as a favorite. There are no date-range buttons: a chart loads the symbol's
// history at the interval and opens on the latest bars, with the rest to scroll back into.

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

/** Toolbar labels, as TradingView writes them. */
export const INTERVAL_LABEL: Record<ChartInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "D",
  "1W": "W",
  "1M": "M",
};

/** Names in the interval menu. */
export const INTERVAL_NAME: Record<ChartInterval, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1D": "1 day",
  "1W": "1 week",
  "1M": "1 month",
};

export const INTERVAL_GROUPS: Array<[string, ChartInterval[]]> = [
  ["MINUTES", ["1m", "5m", "15m"]],
  ["HOURS", ["1h", "4h"]],
  ["DAYS", ["1D", "1W", "1M"]],
];

export const isChartInterval = (v: unknown): v is ChartInterval => (INTERVALS as readonly unknown[]).includes(v);

/** A saved interval, or daily candles. */
export const resolveInterval = (saved: string | undefined): ChartInterval => (isChartInterval(saved) ? saved : "1D");

/** Favorites in menu order, whatever order they were starred in. */
export const orderedFavorites = (favorites: readonly string[]): ChartInterval[] => INTERVALS.filter((i) => favorites.includes(i));

/** The history span the server is asked for (it loads at least 1000 bars, and TradingView's
 *  feed gives all of it at daily and longer intervals). */
export type LoadRange = "5D" | "1Y" | "5Y" | "MAX";
export function loadRange(interval: ChartInterval): LoadRange {
  const s = INTERVAL_SECONDS[interval];
  return s < 3600 ? "5D" : s < 86_400 ? "1Y" : s < 604_800 ? "5Y" : "MAX";
}

/** Fewest bars in view when a chart opens. */
export const MIN_VISIBLE_BARS = 40;
/** Candle spacing a chart opens at, in pixels (TradingView's default zoom is about this). */
export const OPEN_BAR_SPACING = 7;

/** Logical range a chart opens on: the latest bars at a readable width, a small margin on the
 *  right, the rest of the history to the left. */
export function latestBarsView(count: number, plotWidthPx: number): { from: number; to: number } {
  const last = count - 1;
  const shown = Math.max(MIN_VISIBLE_BARS, Math.round(plotWidthPx / OPEN_BAR_SPACING));
  return { from: last - shown + 1.5, to: last + 2 };
}
