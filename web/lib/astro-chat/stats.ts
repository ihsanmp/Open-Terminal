// The numbers the Astro Calendar's chat answers with, from the daily closes the calendar already
// keeps (GOLD and DXY since 1990, BTC since 2011; lib/astro-calendar/impact.ts): a close on a day,
// a span's performance, volatility, drawdowns, streaks, seasonality, correlation, and how prices
// moved during or after sky events against how they move on ordinary days.

import type { Series } from "../astro-calendar/impact";

/** The last trading day on or before `day` (its index), −1 when none. */
export function onOrBefore(s: Series, day: number): number {
  let lo = 0;
  let hi = s.days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

const ln = Math.log;
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const sd = (v: number[]) => {
  const m = mean(v);
  return v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : NaN;
};
export const pctOf = (logRet: number) => (Math.exp(logRet) - 1) * 100;

/** Trading days a year: every day for bitcoin, ~252 for the rest. */
export const yearDays = (s: Series) => {
  const n = Math.min(s.days.length - 1, 500);
  const span = s.days[s.days.length - 1] - s.days[s.days.length - 1 - n];
  return span > 0 && n / span > 0.9 ? 365 : 252;
};

export type Close = { day: number; close: number; prev: { day: number; close: number } | null };

export function closeOn(s: Series, day: number): Close | null {
  const i = onOrBefore(s, day);
  if (i < 0) return null;
  return { day: s.days[i], close: s.close[i], prev: i > 0 ? { day: s.days[i - 1], close: s.close[i - 1] } : null };
}

/** The indices of a span: from the close before it begins (the base) to its last close. */
export function spanIdx(s: Series, from: number, to: number): { base: number; first: number; last: number } | null {
  const last = onOrBefore(s, to);
  const first = Math.max(0, onOrBefore(s, from - 1) + 1);
  if (last < 0 || first > last) return null;
  return { base: Math.max(0, first - 1), first, last };
}

export type Performance = {
  fromDay: number;
  toDay: number;
  startClose: number;
  endClose: number;
  retPct: number;
  high: { day: number; close: number };
  low: { day: number; close: number };
  maxDrawdownPct: number;
  volPct: number;
  upDaysPct: number;
  days: number;
};

export function performance(s: Series, from: number, to: number): Performance | null {
  const r = spanIdx(s, from, to);
  if (!r || r.last - r.base < 1) return null;
  let hi = r.first;
  let lo = r.first;
  let peak = s.close[r.base];
  let mdd = 0;
  const rets: number[] = [];
  for (let i = r.first; i <= r.last; i++) {
    if (s.close[i] > s.close[hi]) hi = i;
    if (s.close[i] < s.close[lo]) lo = i;
    peak = Math.max(peak, s.close[i]);
    mdd = Math.min(mdd, s.close[i] / peak - 1);
    rets.push(ln(s.close[i] / s.close[i - 1]));
  }
  return {
    fromDay: s.days[r.base],
    toDay: s.days[r.last],
    startClose: s.close[r.base],
    endClose: s.close[r.last],
    retPct: (s.close[r.last] / s.close[r.base] - 1) * 100,
    high: { day: s.days[hi], close: s.close[hi] },
    low: { day: s.days[lo], close: s.close[lo] },
    maxDrawdownPct: mdd * 100,
    volPct: sd(rets) * Math.sqrt(yearDays(s)) * 100,
    upDaysPct: (rets.filter((x) => x > 0).length / rets.length) * 100,
    days: rets.length,
  };
}

export type Drawdown = { pct: number; peakDay: number; peak: number; troughDay: number; trough: number; recoveredDay: number | null };

/** The deepest fall from a running peak to a later trough within a span, and when it was made up. */
export function maxDrawdown(s: Series, from: number, to: number): Drawdown | null {
  const r = spanIdx(s, from, to);
  if (!r) return null;
  let peakI = r.first;
  let best: { peak: number; trough: number; pct: number } | null = null;
  for (let i = r.first; i <= r.last; i++) {
    if (s.close[i] > s.close[peakI]) peakI = i;
    const dd = s.close[i] / s.close[peakI] - 1;
    if (!best || dd < best.pct) best = { peak: peakI, trough: i, pct: dd };
  }
  if (!best) return null;
  let rec: number | null = null;
  for (let i = best.trough + 1; i < s.days.length; i++)
    if (s.close[i] >= s.close[best.peak]) {
      rec = s.days[i];
      break;
    }
  return { pct: best.pct * 100, peakDay: s.days[best.peak], peak: s.close[best.peak], troughDay: s.days[best.trough], trough: s.close[best.trough], recoveredDay: rec };
}

export type Streak = { length: number; fromDay: number; toDay: number; movePct: number };

/** The longest runs of daily rises and of falls in a span. */
export function streaks(s: Series, from: number, to: number): { up: Streak | null; down: Streak | null } {
  const r = spanIdx(s, from, to);
  if (!r) return { up: null, down: null };
  const out: { up: Streak | null; down: Streak | null } = { up: null, down: null };
  let runStart = r.first;
  let dir = 0;
  const close = (end: number) => {
    if (!dir) return;
    const len = end - runStart + 1;
    const key = dir > 0 ? "up" : "down";
    const cur = out[key];
    if (!cur || len > cur.length) out[key] = { length: len, fromDay: s.days[runStart], toDay: s.days[end], movePct: (s.close[end] / s.close[runStart - 1] - 1) * 100 };
  };
  for (let i = Math.max(1, r.first); i <= r.last; i++) {
    const d = Math.sign(s.close[i] - s.close[i - 1]);
    if (d !== dir || d === 0) {
      close(i - 1);
      runStart = i;
      dir = d;
    }
  }
  close(r.last);
  return out;
}

/** The biggest daily rises and falls in a span. */
export function extremeDays(s: Series, from: number, to: number, n = 3): { best: Array<{ day: number; pct: number }>; worst: Array<{ day: number; pct: number }> } {
  const r = spanIdx(s, from, to);
  if (!r) return { best: [], worst: [] };
  const days: Array<{ day: number; pct: number }> = [];
  for (let i = Math.max(1, r.first); i <= r.last; i++) days.push({ day: s.days[i], pct: (s.close[i] / s.close[i - 1] - 1) * 100 });
  const sorted = [...days].sort((a, b) => b.pct - a.pct);
  return { best: sorted.slice(0, n), worst: sorted.slice(-n).reverse() };
}

export type MonthStat = { month: number; meanPct: number; medianPct: number; upYearsPct: number; years: number };

/** Each calendar month's return over the years from `fromYear` (each month from its previous month's last close). */
export function seasonality(s: Series, fromYear: number, toDay: number): MonthStat[] {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  const first = new Date(s.days[0] * 86_400_000).getUTCFullYear();
  const lastYear = new Date(toDay * 86_400_000).getUTCFullYear();
  for (let y = Math.max(fromYear, first); y <= lastYear; y++)
    for (let m = 0; m < 12; m++) {
      const start = Math.floor(Date.UTC(y, m, 1) / 86_400_000);
      const end = Math.floor(Date.UTC(y, m + 1, 0) / 86_400_000);
      if (end > toDay) continue;
      const a = onOrBefore(s, start - 1);
      const b = onOrBefore(s, end);
      if (a < 0 || b <= a || s.days[a] < start - 10) continue;
      byMonth[m].push((s.close[b] / s.close[a] - 1) * 100);
    }
  return byMonth.map((v, m) => {
    const sorted = [...v].sort((a, b) => a - b);
    return { month: m, meanPct: mean(v), medianPct: sorted[Math.floor(sorted.length / 2)] ?? NaN, upYearsPct: v.length ? (v.filter((x) => x > 0).length / v.length) * 100 : NaN, years: v.length };
  });
}

/** The correlation of two series' daily returns over the days both traded in a span. */
export function correlation(a: Series, b: Series, from: number, to: number): { r: number; n: number } {
  const ra = new Map<number, number>();
  const ia = spanIdx(a, from, to);
  if (!ia) return { r: NaN, n: 0 };
  for (let i = Math.max(1, ia.first); i <= ia.last; i++) ra.set(a.days[i], ln(a.close[i] / a.close[i - 1]));
  const x: number[] = [];
  const y: number[] = [];
  const ib = spanIdx(b, from, to);
  if (!ib) return { r: NaN, n: 0 };
  for (let i = Math.max(1, ib.first); i <= ib.last; i++) {
    const va = ra.get(b.days[i]);
    if (va === undefined) continue;
    x.push(va);
    y.push(ln(b.close[i] / b.close[i - 1]));
  }
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < x.length; k++) {
    sxy += (x[k] - mx) * (y[k] - my);
    sxx += (x[k] - mx) ** 2;
    syy += (y[k] - my) ** 2;
  }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, n: x.length };
}

export function allTimeHigh(s: Series): { day: number; close: number; fromHighPct: number } {
  let hi = 0;
  for (let i = 1; i < s.close.length; i++) if (s.close[i] > s.close[hi]) hi = i;
  return { day: s.days[hi], close: s.close[hi], fromHighPct: (s.close[s.close.length - 1] / s.close[hi] - 1) * 100 };
}

// ---------------------------------------------------------------- sky events against ordinary days

export type Study = {
  n: number;
  /** The mean and median return over the windows, %. */
  meanPct: number;
  medianPct: number;
  upPct: number;
  /** What ordinary windows of the same length did over the same years. */
  baseMeanPct: number;
  baseUpPct: number;
  /** (mean − base) in standard errors: |t| < 2 is what chance gives often. */
  t: number;
  /** Each window: when, and its return. */
  windows: Array<{ from: number; to: number; pct: number }>;
};

/** Ordinary windows of `len` trading days over the same indices, as a yardstick. */
function baseline(s: Series, firstI: number, lastI: number, len: number): { mean: number; up: number; sd: number } {
  const r: number[] = [];
  for (let i = firstI; i + len <= lastI; i++) r.push(ln(s.close[i + len] / s.close[i]));
  return { mean: mean(r), up: r.filter((x) => x > 0).length / r.length, sd: sd(r) };
}

/**
 * Returns over given spans (each from the close before it begins to its last close), against the
 * same asset's ordinary windows of the same length in the same years.
 */
export function spanStudy(s: Series, spans: Array<{ from: number; to: number }>): Study | null {
  const windows: Study["windows"] = [];
  const excess: number[] = [];
  const lens: number[] = [];
  for (const p of spans) {
    const r = spanIdx(s, p.from, p.to);
    if (!r || r.last <= r.base || s.days[r.base] < p.from - 10) continue;
    windows.push({ from: p.from, to: p.to, pct: (s.close[r.last] / s.close[r.base] - 1) * 100 });
    lens.push(r.last - r.base);
  }
  if (windows.length < 3) return null;
  const firstI = onOrBefore(s, windows[0].from);
  const lastI = onOrBefore(s, windows[windows.length - 1].to);
  // The yardstick per window: the asset's mean log return a day over the studied years × its length.
  const daily = baseline(s, Math.max(0, firstI), lastI, 1);
  const logs = windows.map((w) => ln(1 + w.pct / 100));
  logs.forEach((l, k) => excess.push(l - daily.mean * lens[k]));
  const medLen = [...lens].sort((a, b) => a - b)[Math.floor(lens.length / 2)];
  const base = baseline(s, Math.max(0, firstI), lastI, medLen);
  const se = sd(excess) / Math.sqrt(excess.length);
  const sorted = windows.map((w) => w.pct).sort((a, b) => a - b);
  return {
    n: windows.length,
    meanPct: pctOf(mean(logs)),
    medianPct: sorted[Math.floor(sorted.length / 2)],
    upPct: (windows.filter((w) => w.pct > 0).length / windows.length) * 100,
    baseMeanPct: pctOf(daily.mean * mean(lens)),
    baseUpPct: base.up * 100,
    t: se > 0 ? mean(excess) / se : 0,
    windows,
  };
}

/** Returns over `h` trading days after each moment (unix seconds), from the close before it. */
export function afterStudy(s: Series, times: number[], h: number): Study | null {
  const spans: Array<{ from: number; to: number }> = [];
  for (const t of times) {
    const day = Math.floor(t / 86_400);
    const i = onOrBefore(s, day - 1);
    if (i < 0 || i + h >= s.days.length) continue;
    spans.push({ from: s.days[i] + 1, to: s.days[i + h] });
  }
  return spanStudy(s, spans);
}
