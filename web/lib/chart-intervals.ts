// Candle intervals, as TradingView's interval menu has them: grouped, each with a star to put
// it on the toolbar as a favorite. A chart loads the symbol's history at the interval and opens on
// the latest bars, with the rest to scroll back into; typed on the chart, a number changes the
// interval (parseIntervalInput), and the date-range buttons under it pick an interval and a span
// together, as TradingView's do (RANGE_PRESETS).

export const INTERVALS = [
  "1m", "5m", "15m", "30m",
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
  "1m": { base: "1m" }, "5m": { base: "5m" }, "15m": { base: "15m" }, "30m": { base: "15m", group: 2 },
  "1h": { base: "1h" }, "2h": { base: "1h", group: 2 }, "4h": { base: "4h" }, "6h": { base: "1h", group: 6 },
  "1D": { base: "1D" }, "2D": { base: "1D", group: 2 }, "3D": { base: "1D", group: 3 }, "4D": { base: "1D", group: 4 }, "5D": { base: "1D", group: 5 },
  "1W": { base: "1W" }, "1M": { base: "1M" },
  "1R": { base: "1m", ticks: 1 }, "10R": { base: "1m", ticks: 10 }, "100R": { base: "1m", ticks: 100 }, "1000R": { base: "1m", ticks: 1000 },
};

export const isRangeInterval = (i: ChartInterval) => INTERVAL_SOURCE[i].ticks !== undefined;

/** A bar's length; range bars have none of their own, so their 1-minute source's. */
export const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14_400, "6h": 21_600,
  "1D": 86_400, "2D": 172_800, "3D": 259_200, "4D": 345_600, "5D": 432_000,
  "1W": 604_800, "1M": 2_592_000,
  "1R": 60, "10R": 60, "100R": 60, "1000R": 60,
};

/** Toolbar labels: minutes as TradingView writes them, hours and days as H1 … D5. */
export const INTERVAL_LABEL: Record<ChartInterval, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "H1", "2h": "H2", "4h": "H4", "6h": "H6",
  "1D": "D1", "2D": "D2", "3D": "D3", "4D": "D4", "5D": "D5", "1W": "W", "1M": "M",
  "1R": "1R", "10R": "10R", "100R": "100R", "1000R": "1000R",
};

/** Names in the interval menu. */
export const INTERVAL_NAME: Record<ChartInterval, string> = {
  "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
  "1h": "1 hour (H1)", "2h": "2 hours (H2)", "4h": "4 hours (H4)", "6h": "6 hours (H6)",
  "1D": "1 day (D1)", "2D": "2 days (D2)", "3D": "3 days (D3)", "4D": "4 days (D4)", "5D": "5 days (D5)", "1W": "1 week", "1M": "1 month",
  "1R": "1 range", "10R": "10 range", "100R": "100 range", "1000R": "1000 range",
};

export const INTERVAL_GROUPS: Array<[string, ChartInterval[]]> = [
  ["MINUTES", ["1m", "5m", "15m", "30m"]],
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

/** Minutes, for what a number typed on the chart can mean. */
const BY_MINUTES: Record<number, ChartInterval> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 120: "2h", 240: "4h", 360: "6h", 1440: "1D" };

/**
 * An interval typed on the chart, as TradingView's "Change interval" box reads it: a number is
 * minutes ("15", "240"), or it takes a unit — h for hours, D for days, W for weeks, M for months
 * (a lower-case m is minutes), R for range bars. Null when this chart has no such interval.
 */
export function parseIntervalInput(text: string): ChartInterval | null {
  const m = /^\s*(\d+)\s*([a-zA-Z]?)\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (!n) return null;
  if (unit === "" || unit === "m") return BY_MINUTES[n] ?? null;
  if (unit === "h" || unit === "H") return BY_MINUTES[n * 60] ?? null;
  if (unit === "d" || unit === "D") return n === 7 ? "1W" : isChartInterval(`${n}D`) ? (`${n}D` as ChartInterval) : null;
  if (unit === "w" || unit === "W") return n === 1 ? "1W" : null;
  if (unit === "M") return n === 1 ? "1M" : null;
  if (unit === "r" || unit === "R") return isChartInterval(`${n}R`) ? (`${n}R` as ChartInterval) : null;
  return null;
}

/** The date-range buttons under the chart, as TradingView's: each an interval and how far back it
 *  shows (days; "ytd" from the year's start; "all" the whole history). */
export const RANGE_PRESETS: Array<{ label: string; interval: ChartInterval; span: number | "ytd" | "all"; title: string }> = [
  { label: "1D", interval: "1m", span: 1, title: "1 day in 1 minute intervals" },
  { label: "5D", interval: "5m", span: 5, title: "5 days in 5 minutes intervals" },
  { label: "1M", interval: "30m", span: 30, title: "1 month in 30 minutes intervals" },
  { label: "3M", interval: "1h", span: 91, title: "3 months in 1 hour intervals" },
  { label: "6M", interval: "2h", span: 182, title: "6 months in 2 hours intervals" },
  { label: "YTD", interval: "1D", span: "ytd", title: "Year to day in 1 day intervals" },
  { label: "1Y", interval: "1D", span: 365, title: "1 year in 1 day intervals" },
  { label: "5Y", interval: "1W", span: 1826, title: "5 years in 1 week intervals" },
  { label: "All", interval: "1M", span: "all", title: "All data in 1 month intervals" },
];

/** The first bar index a range preset shows, of bars at these times (unix seconds, ascending). */
export function presetStart(times: readonly number[], span: number | "ytd" | "all"): number {
  if (!times.length || span === "all") return 0;
  const last = times[times.length - 1];
  const from = span === "ytd" ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000 : last - span * 86_400;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
