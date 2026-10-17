// The forecaster's ranges, made aware of the calendar: a market's usual move over a span (its P10,
// P50 and P90 over three years) widened when the span holds more of the big US days than usual,
// and narrowed when it holds fewer, after the research the forecaster follows ("Astronomi, Makro,
// dan Pergerakan Market", Oct 2026). Its table of each release day's absolute move against an
// ordinary day's is the multipliers below, for the markets it measured; the others read the
// nearest one's (ether bitcoin's, the Nasdaq the S&P's, the currencies and the 10-year yield the
// dollar's). Bitcoin is wilder in winter (9 of 13 years), a ratio measured from its own past.
//
// Each day carries a weight, its expected squared move against an ordinary day's (a release day's
// multiplier squared, a winter day's ratio squared for bitcoin); the band scales by the square
// root of the span's mean weight against the mean weight over the three years it was read from.

import { FOMC_MEETINGS } from "../providers/fedwatch.js";
import type { Release } from "../providers/macroengine.js";
import type { MarketKey } from "./data.js";
import type { Season } from "./astrofeatures.js";

export type EventKind = "cpi" | "nfp" | "ism" | "fomc";

export const EVENT_LABEL: Record<EventKind, string> = { cpi: "CPI", nfp: "NFP", ism: "ISM", fomc: "FOMC" };

type Measured = "btc" | "oil" | "dxy" | "spx" | "xau";

/** A release day's absolute move against an ordinary day's (FOMC: its day and the next). */
export const VOL_MULT: Record<Measured, Record<EventKind, number>> = {
  btc: { cpi: 1.34, nfp: 0.96, ism: 1.12, fomc: 1.16 },
  oil: { cpi: 0.91, nfp: 1.08, ism: 1.19, fomc: 1.21 },
  dxy: { cpi: 1.28, nfp: 1.3, ism: 1.18, fomc: 1.46 },
  spx: { cpi: 1.12, nfp: 1.29, ism: 1.14, fomc: 1.22 },
  xau: { cpi: 0.95, nfp: 1.3, ism: 1.31, fomc: 1.43 },
};

const NEAREST: Partial<Record<MarketKey, Measured>> = { eth: "btc", ndx: "spx", eurusd: "dxy", usdjpy: "dxy", us10y: "dxy" };

export const multipliersFor = (key: MarketKey): Record<EventKind, number> | null => VOL_MULT[key as Measured] ?? (NEAREST[key] ? VOL_MULT[NEAREST[key]!] : null);

const EVENT_TITLES: Record<string, EventKind> = {
  "Inflation Rate MoM": "cpi",
  "Core Inflation Rate MoM": "cpi",
  "Non Farm Payrolls": "nfp",
  "ISM Manufacturing PMI": "ism",
  "Fed Interest Rate Decision": "fomc",
};

const DAY_MS = 86_400_000;

/** The UTC days of the big US releases (past and scheduled), and each FOMC decision's next day. */
export function eventDays(releases: Release[]): Map<number, EventKind[]> {
  const out = new Map<number, EventKind[]>();
  const add = (d: number, k: EventKind) => {
    if (!Number.isFinite(d)) return;
    const list = out.get(d) ?? [];
    if (!list.includes(k)) list.push(k);
    out.set(d, list);
  };
  const fomc = new Set<number>(FOMC_MEETINGS.map((s) => Date.parse(`${s}T00:00:00Z`) / DAY_MS));
  for (const r of releases) {
    const k = EVENT_TITLES[r.title];
    if (!k) continue;
    const d = Math.floor(Date.parse(r.date) / DAY_MS);
    if (k === "fomc") fomc.add(d);
    else add(d, k);
  }
  for (const d of fomc) {
    add(d, "fomc");
    // The decision comes after the US close (and after gold's): the next session carries it too.
    add(d + 1, "fomc");
  }
  return out;
}

/** A day's weight: its expected squared move against an ordinary day's. */
export type DayWeight = (day: number) => number;

/** The weight of a day for a market: its biggest release multiplier, and bitcoin's winter ratio. */
export function dayWeight(key: MarketKey, events: Map<number, EventKind[]>, season?: { of: Map<number, Season>; ratio: Record<"winter" | "other", number> }): DayWeight {
  const mult = multipliersFor(key);
  return (day) => {
    const kinds = events.get(day);
    // The day's biggest multiplier (below 1 when its releases calm the market, as CPI does oil).
    const m = mult && kinds?.length ? Math.max(...kinds.map((k) => mult[k])) : 1;
    let w = m * m;
    if (season) w *= season.ratio[season.of.get(day) === "winter" ? "winter" : "other"] ** 2;
    return w;
  };
}

/**
 * Bitcoin's winter ratio from its own daily moves before `beforeIndex`: winter's mean absolute
 * move, and the other seasons', each against the whole mean.
 */
export function winterRatio(days: number[], close: number[], beforeIndex: number, of: Map<number, Season>): Record<"winter" | "other", number> {
  let sw = 0;
  let nw = 0;
  let so = 0;
  let no = 0;
  for (let i = 1; i < beforeIndex && i < close.length; i++) {
    const a = Math.abs(Math.log(close[i] / close[i - 1]));
    if (!Number.isFinite(a)) continue;
    if (of.get(days[i]) === "winter") {
      sw += a;
      nw++;
    } else {
      so += a;
      no++;
    }
  }
  // Too little of either to tell: no seasonal adjustment.
  if (nw < 200 || no < 600) return { winter: 1, other: 1 };
  const all = (sw + so) / (nw + no);
  return { winter: sw / nw / all, other: so / no / all };
}

/** The factor a band's spread around its median is scaled by: the span's mean weight against the lookback's. */
export function bandFactor(weight: DayWeight, spanDays: number[], lookbackDays: number[]): number {
  if (!spanDays.length || !lookbackDays.length) return 1;
  const mean = (ds: number[]) => ds.reduce((s, d) => s + weight(d), 0) / ds.length;
  return Math.sqrt(mean(spanDays) / mean(lookbackDays));
}

/** The next `n` trading days after `day`: every day for crypto, weekdays otherwise. */
export function nextTradingDays(day: number, n: number, everyDay: boolean): number[] {
  const out: number[] = [];
  for (let d = day + 1; out.length < n; d++) {
    const wd = new Date(d * DAY_MS).getUTCDay();
    if (everyDay || (wd !== 0 && wd !== 6)) out.push(d);
  }
  return out;
}

/** The band's quantiles with the spread around the median scaled by `f`. */
export const scaleBand = (b: { p10: number; p50: number; p90: number }, f: number) => ({ p10: b.p50 + (b.p10 - b.p50) * f, p50: b.p50, p90: b.p50 + (b.p90 - b.p50) * f });
