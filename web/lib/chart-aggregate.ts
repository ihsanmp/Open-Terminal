// The chart intervals the API doesn't serve, built from those it does (chart-intervals'
// INTERVAL_SOURCE): H2 and H6 from hourly bars, D2 … D5 from daily ones, and range bars from
// 1-minute ones.

import type { Candle } from "./api";

export type MarketKind = "crypto" | "forex" | "stock" | "index";

const DAY = 86_400;

function merge(group: Candle[]): Candle {
  return {
    time: group[0].time,
    open: group[0].open,
    high: Math.max(...group.map((c) => c.high)),
    low: Math.min(...group.map((c) => c.low)),
    close: group[group.length - 1].close,
    volume: group.reduce((s, c) => s + (c.volume || 0), 0),
  };
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
/** Seconds the time zone is ahead of UTC at a moment. */
function zoneOffset(t: number, timeZone: string): number {
  let f = offsetFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    offsetFormats.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t * 1000))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - t;
}

/**
 * Hourly bars in groups of n within each trading day, as TradingView's H2 / H6: by the clock for
 * markets that trade round the clock (00:00, 02:00 … UTC), from the day's first bar for exchanges
 * (a US stock's H2 bars open at 09:30, 11:30, 13:30, 15:30).
 */
export function groupHours(candles: Candle[], n: number, market: MarketKind, timeZone: string): Candle[] {
  const out: Candle[] = [];
  let group: Candle[] = [];
  let key = "";
  let day = NaN;
  let index = 0;
  const offset = market === "crypto" || market === "forex" ? () => 0 : (t: number) => zoneOffset(t, timeZone);
  for (const c of candles) {
    const local = c.time + offset(c.time);
    const d = Math.floor(local / DAY);
    if (d !== day) {
      day = d;
      index = 0;
    } else index++;
    const slot = market === "crypto" || market === "forex" ? Math.floor((local - d * DAY) / (3600 * n)) : Math.floor(index / n);
    const k = `${d}:${slot}`;
    if (k !== key && group.length) {
      out.push(merge(group));
      group = [];
    }
    key = k;
    group.push(c);
  }
  if (group.length) out.push(merge(group));
  return out;
}

/** Monday 5 January 1970, from which trading days are counted. */
const FIRST_MONDAY = 4;

/**
 * Daily bars in groups of n, at fixed places so a bar doesn't change as history scrolls: calendar
 * days from the Unix epoch for markets open every day, weekdays for the rest.
 */
export function groupDays(candles: Candle[], n: number, market: MarketKind): Candle[] {
  const out: Candle[] = [];
  let group: Candle[] = [];
  let key = NaN;
  for (const c of candles) {
    const day = Math.floor(c.time / DAY + 0.5); // daily bars may be stamped a few hours off midnight
    let k: number;
    if (market === "crypto") k = Math.floor(day / n);
    else {
      const since = day - FIRST_MONDAY;
      const weekdays = Math.floor(since / 7) * 5 + Math.min(((since % 7) + 7) % 7, 4);
      k = Math.floor(weekdays / n);
    }
    if (k !== key && group.length) {
      out.push(merge(group));
      group = [];
    }
    key = k;
    group.push(c);
  }
  if (group.length) out.push(merge(group));
  return out;
}

/**
 * Range bars, as TradingView's: each closes once it spans `size` (so many ticks) from its low to
 * its high, and the next opens where it closed. Built from 1-minute bars, walking each one's path
 * (open, then low and high in the order its color implies, then close). Only the newest `maxBars`
 * are made: the walk starts as far back as that needs. A bar takes the time of the minute it
 * started in (later bars in the same minute a second on, as times must rise).
 */
export function rangeBars(candles: Candle[], size: number, maxBars = 5000): Candle[] {
  if (!(size > 0) || candles.length === 0) return [];
  const path = (c: Candle) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
  // Where to start: about maxBars of movement before the end.
  let start = candles.length - 1;
  let travel = 0;
  while (start > 0 && travel < size * maxBars * 1.2) {
    const p = path(candles[start]);
    travel += Math.abs(p[1] - p[0]) + Math.abs(p[2] - p[1]) + Math.abs(p[3] - p[2]);
    start--;
  }
  const out: Candle[] = [];
  let lastTime = -Infinity;
  const stamp = (t: number) => (lastTime = Math.max(t, lastTime + 1));
  const first = candles[start];
  let bar: Candle = { time: stamp(first.time), open: first.open, high: first.open, low: first.open, close: first.open, volume: 0 };
  const eps = size * 1e-9;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    for (const target of path(c)) {
      for (;;) {
        if (target > bar.high) {
          if (target - bar.low >= size - eps) {
            const top = bar.low + size;
            out.push({ ...bar, high: top, close: top });
            bar = { time: stamp(c.time), open: top, high: top, low: top, close: top, volume: 0 };
            if (target - top <= eps) break;
            continue;
          }
          bar.high = target;
        } else if (target < bar.low) {
          if (bar.high - target >= size - eps) {
            const bottom = bar.high - size;
            out.push({ ...bar, low: bottom, close: bottom });
            bar = { time: stamp(c.time), open: bottom, high: bottom, low: bottom, close: bottom, volume: 0 };
            if (bottom - target <= eps) break;
            continue;
          }
          bar.low = target;
        }
        bar.close = target;
        break;
      }
    }
    bar.volume += c.volume || 0;
  }
  out.push(bar); // the one still forming
  return out.slice(-maxBars);
}
