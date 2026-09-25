import type { Candle } from "./providers/yahoo.js";

// Candle interval chosen separately from the date range, like TradingView's interval menu.
// "auto" keeps each range's own interval (5m for 1D … 1M for MAX).

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const;
export type Interval = (typeof INTERVALS)[number];

export const isInterval = (v: unknown): v is Interval => typeof v === "string" && (INTERVALS as readonly string[]).includes(v);

export const INTERVAL_SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1D": 86_400,
  "1W": 604_800,
  "1M": 2_592_000,
};

/** Most bars one chart loads, as TradingView does; long ranges at fine intervals keep the newest. */
export const MAX_BARS = 5000;
/** Fewest bars a chart loads whatever its range: the range only sets what's in view, as on
 *  TradingView, so a 5D range at 1D still has history to scroll back into and indicators
 *  (SMA 200…) have bars to warm up on. */
export const MIN_BARS = 1000;

const DAY = 86_400;

/** Start of a range in unix seconds; null for MAX. 1D and 5D reach back far enough to cover
 *  weekends and holidays (the chart shows their last one or five sessions). */
export function rangeStart(rangeKey: string, now = Date.now() / 1000): number | null {
  const d = new Date(now * 1000);
  switch (rangeKey) {
    case "1D":
      return now - 5 * DAY;
    case "5D":
      return now - 12 * DAY;
    case "1M":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()) / 1000;
    case "6M":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 6, d.getUTCDate()) / 1000;
    case "YTD":
      return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
    case "1Y":
      return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()) / 1000;
    case "5Y":
      return Date.UTC(d.getUTCFullYear() - 5, d.getUTCMonth(), d.getUTCDate()) / 1000;
    default:
      return null;
  }
}

// Yahoo only keeps fine intervals for a while: 1m for 7 days (and only the last 30),
// 5m/15m for 60 days, 1h for 730 days.
const YAHOO: Record<Interval, { interval: string; lookback: number | null; group?: number }> = {
  "1m": { interval: "1m", lookback: 7 * DAY },
  "5m": { interval: "5m", lookback: 59 * DAY },
  "15m": { interval: "15m", lookback: 59 * DAY },
  "1h": { interval: "60m", lookback: 729 * DAY },
  "4h": { interval: "60m", lookback: 729 * DAY, group: 4 },
  "1D": { interval: "1d", lookback: null },
  "1W": { interval: "1wk", lookback: null },
  "1M": { interval: "1mo", lookback: null },
};

/** Where to start loading: the range's start, or earlier so at least MIN_BARS bars arrive.
 *  `continuous`: trades around the clock (crypto); stocks need more calendar time per bar. */
export function loadStart(rangeKey: string, interval: Interval, continuous: boolean, now = Date.now() / 1000): number | null {
  // Around-the-clock markets have no weekends to reach over: 1D and 5D are exactly that long.
  const start = continuous && (rangeKey === "1D" || rangeKey === "5D") ? now - (rangeKey === "1D" ? 1 : 5) * DAY : rangeStart(rangeKey, now);
  if (start === null) return null;
  const perBar = INTERVAL_SECONDS[interval];
  // Just under MIN_BARS for crypto, so one 1000-kline Binance page covers it.
  const calendarPerBar = continuous ? 0.99 : perBar < DAY ? (24 / 6.5) * (7 / 5) * 1.1 : (7 / 5) * 1.1;
  return Math.min(start, now - MIN_BARS * perBar * calendarPerBar);
}

/** What to ask Yahoo for: its interval and the period it can actually serve. */
export function yahooPlan(rangeKey: string, interval: Interval, now = Date.now() / 1000, continuous = false) {
  const plan = YAHOO[interval];
  const start = loadStart(rangeKey, interval, continuous, now);
  const earliest = plan.lookback === null ? null : now - plan.lookback;
  const from = start === null ? earliest : earliest === null ? start : Math.max(start, earliest);
  return { interval: plan.interval, from, to: Math.ceil(now), group: plan.group };
}

export const BINANCE_INTERVAL: Record<Interval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1M",
};

/** 4h bars from 1h ones: four at a time within a session, restarting after any gap, so a US
 *  session gives 09:30 and 13:30 bars as on TradingView. */
export function groupCandles(candles: Candle[], size: number, barSeconds: number): Candle[] {
  const out: Candle[] = [];
  let count = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const gap = i > 0 && c.time - candles[i - 1].time > barSeconds * 1.5;
    const last = out[out.length - 1];
    if (!last || gap || count === size) {
      out.push({ ...c });
      count = 1;
    } else {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
      count++;
    }
  }
  return out;
}

/** Weekly (Monday-start) or monthly candles from daily ones, for daily-only sources. */
export function aggregateByPeriod(candles: Candle[], period: "week" | "month"): Candle[] {
  const key = (t: number) => {
    const d = new Date(t * 1000);
    if (period === "month") return d.getUTCFullYear() * 12 + d.getUTCMonth();
    return Math.floor((Math.floor(t / DAY) + 3) / 7); // 1970-01-01 was a Thursday
  };
  const out: Candle[] = [];
  let last: number | null = null;
  for (const c of candles) {
    const k = key(c.time);
    const cur = out[out.length - 1];
    if (!cur || k !== last) {
      out.push({ ...c });
      last = k;
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return out;
}

/** The newest MAX_BARS; the range itself is applied by the chart as what's in view. */
export function clip(candles: Candle[]): Candle[] {
  return candles.slice(-MAX_BARS);
}
