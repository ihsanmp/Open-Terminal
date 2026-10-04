// Candle intervals, as TradingView's interval menu has them: grouped, each with a star to put
// it on the toolbar as a favorite. There are no date-range buttons: a chart loads the symbol's
// history at the interval and opens on the latest bars, with the rest to scroll back into.

export const INTERVALS = [
  "1m", "5m", "15m",
  "1h", "2h", "4h", "6h",
  "1D", "2D", "3D", "4D", "5D", "1W", "1M",
  "1R", "10R", "100R", "1000R",
] as const;
export type ChartInterval = (typeof INTERVALS)[number];

/** The intervals the API serves; the others are built from them in the browser (chart-aggregate). */
export type ServerInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M";

/**
 * Where an interval's bars come from: the API's own (no grouping), so many of a finer one
 * grouped (2h from 1h, 3D from 1D), or range bars of so many ticks built from 1-minute bars.
 */
export type IntervalSource = { base: ServerInterval; group?: number; ticks?: number };

export const INTERVAL_SOURCE: Record<ChartInterval, IntervalSource> = {
  "1m": { base: "1m" }, "5m": { base: "5m" }, "15m": { base: "15m" },
  "1h": { base: "1h" }, "2h": { base: "1h", group: 2 }, "4h": { base: "4h" }, "6h": { base: "1h", group: 6 },
  "1D": { base: "1D" }, "2D": { base: "1D", group: 2 }, "3D": { base: "1D", group: 3 }, "4D": { base: "1D", group: 4 }, "5D": { base: "1D", group: 5 },
  "1W": { base: "1W" }, "1M": { base: "1M" },
  "1R": { base: "1m", ticks: 1 }, "10R": { base: "1m", ticks: 10 }, "100R": { base: "1m", ticks: 100 }, "1000R": { base: "1m", ticks: 1000 },
};

export const isRangeInterval = (i: ChartInterval) => INTERVAL_SOURCE[i].ticks !== undefined;

/** A bar's length; range bars have none of their own, so their 1-minute source's. */
export const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "1m": 60, "5m": 300, "15m": 900,
  "1h": 3600, "2h": 7200, "4h": 14_400, "6h": 21_600,
  "1D": 86_400, "2D": 172_800, "3D": 259_200, "4D": 345_600, "5D": 432_000,
  "1W": 604_800, "1M": 2_592_000,
  "1R": 60, "10R": 60, "100R": 60, "1000R": 60,
};

/** Toolbar labels: minutes as TradingView writes them, hours and days as H1 … D5. */
export const INTERVAL_LABEL: Record<ChartInterval, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m",
  "1h": "H1", "2h": "H2", "4h": "H4", "6h": "H6",
  "1D": "D1", "2D": "D2", "3D": "D3", "4D": "D4", "5D": "D5", "1W": "W", "1M": "M",
  "1R": "1R", "10R": "10R", "100R": "100R", "1000R": "1000R",
};

/** Names in the interval menu. */
export const INTERVAL_NAME: Record<ChartInterval, string> = {
  "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes",
  "1h": "1 hour (H1)", "2h": "2 hours (H2)", "4h": "4 hours (H4)", "6h": "6 hours (H6)",
  "1D": "1 day (D1)", "2D": "2 days (D2)", "3D": "3 days (D3)", "4D": "4 days (D4)", "5D": "5 days (D5)", "1W": "1 week", "1M": "1 month",
  "1R": "1 range", "10R": "10 range", "100R": "100 range", "1000R": "1000 range",
};

export const INTERVAL_GROUPS: Array<[string, ChartInterval[]]> = [
  ["MINUTES", ["1m", "5m", "15m"]],
  ["HOURS", ["1h", "2h", "4h", "6h"]],
  ["DAYS", ["1D", "2D", "3D", "4D", "5D", "1W", "1M"]],
  ["RANGES", ["1R", "10R", "100R", "1000R"]],
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
  const s = INTERVAL_SECONDS[INTERVAL_SOURCE[interval].base];
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
