// The market impact of an astrology event on GOLD and BTC, worked out offline from history:
// an event study, as pyAstroTrader relates each aspect to the next days' price trend, that adapts
// to the market until the day before the event (H-1).
//
// For an event, every earlier event of the same kind (Venus retrograde, Mars square Saturn, a
// full moon in Taurus …) is found, and the asset's return over the following `horizon` trading
// days is measured from the close the day before it, when a verdict would be acted on. The
// verdict is worked out "as of" a day: only prices up to that day are used, so only past events
// whose outcome was already known count, and the market's state that day decides which of them
// weigh most. Until H-1 it follows the latest close, so it can change from day to day; from H-1
// on it is final.
//
// The market's state is its momentum (the last 20 days' return) and its trend (how far it is
// from its 50-day average), both in units of its recent volatility. Past events that came in a
// similar state weigh more, as do recent ones (half-life HALF_LIFE_YEARS):
//
//   mean     = weighted mean of the returns after past events
//   expected = the same weighted mean over every day, event or not: what the market did in that
//              state and era anyway (BTC drifts up strongly, and drifted far more in its first
//              years, so neither "it rose" nor the all-history average is the right yardstick)
//   t        = (mean − expected) ÷ (weighted standard deviation ÷ √effective number of events)
//
// Bullish when t ≥ 1, bearish when t ≤ −1, neutral otherwise; the confidence follows |t| (≥ 1.65
// medium, ≥ 2.33 high). Weighing the events and the yardstick alike, the verdict is the event's
// own part: the market's state, and the era, count on both sides. Events whose windows overlap
// (a broad kind like "any square") aren't independent, so the effective number is cut by how
// much they overlap. Returns beyond three standard deviations are clipped so a single crash or
// squeeze doesn't decide the verdict.
// With fewer than MIN_SAMPLES events of that exact kind, the next broader kind is used (Mars–Saturn
// tension, then any square), and the result says which.
//
// Prices: bundled daily closes (prices.json), so this works without a connection; when the app's
// API is reachable, newer closes extend them.
//
// This describes how prices behaved around past events, not why: astrology has no demonstrated
// power to predict markets, and with this many kinds of event some will look significant by
// chance alone.

import bundled from "./prices.json";
import type { AstroEvent } from "./events";

export type Asset = "GOLD" | "BTC";
export const ASSETS: Asset[] = ["GOLD", "BTC"];
export const MIN_SAMPLES = 8;
/** How fast older events lose weight. */
export const HALF_LIFE_YEARS = 8;
/** Width of the similarity in market state, and the weight left to a dissimilar one. */
const BANDWIDTH = 1;
const FLOOR = 0.15;
const DAY = 86_400;

type Packed = { start: number; d: number[]; c: number[] };
export type Series = { days: Int32Array; close: Float64Array };

function unpack(p: Packed): Series {
  const days = new Int32Array(p.d.length);
  let day = p.start;
  p.d.forEach((dd, i) => {
    day += i === 0 ? 0 : dd;
    days[i] = day;
  });
  return { days, close: Float64Array.from(p.c) };
}

const BUNDLED: Record<Asset, Series> = { GOLD: unpack((bundled as unknown as Record<Asset, Packed>).GOLD), BTC: unpack((bundled as unknown as Record<Asset, Packed>).BTC) };
let current: Record<Asset, Series> = BUNDLED;
let version = 0;
/** Changes whenever the prices do, for recomputing what depends on them. */
export const pricesVersion = () => version;

/**
 * Adds daily closes (from the API) from the bundled ones' last day on. Called again with fresher
 * candles, it replaces the previous ones, so today's still-moving close stays current.
 */
export function extendSeries(asset: Asset, candles: Array<{ time: number; close: number }>): void {
  const base = BUNDLED[asset];
  const last = base.days[base.days.length - 1];
  // Daily candles are stamped at midnight in the exchange's zone, a few hours either side of UTC.
  const byDay = new Map<number, number>();
  for (const c of candles) if (Number.isFinite(c.close) && c.close > 0) byDay.set(Math.round(c.time / DAY), c.close);
  const extra = [...byDay].filter(([d]) => d >= last).sort((a, b) => a[0] - b[0]);
  if (!extra.length) return;
  const keep = extra[0][0] === last ? base.days.length - 1 : base.days.length;
  const days = new Int32Array(keep + extra.length);
  const close = new Float64Array(days.length);
  days.set(base.days.subarray(0, keep));
  close.set(base.close.subarray(0, keep));
  extra.forEach(([d, c], i) => {
    days[keep + i] = d;
    close[keep + i] = c;
  });
  const prev = current[asset];
  if (prev.days.length === days.length && prev.days[prev.days.length - 1] === days[days.length - 1] && prev.close[prev.close.length - 1] === close[close.length - 1]) return;
  current = { ...current, [asset]: { days, close } };
  prepared.delete(asset);
  version++;
}

export const seriesOf = (asset: Asset): Series => current[asset];
export const lastPriceDay = (asset: Asset) => current[asset].days[current[asset].days.length - 1];

/** The last trading day on or before `day` (−1 when none). */
function indexOnOrBefore(s: Series, day: number): number {
  let lo = 0;
  let hi = s.days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Whether the asset trades on a UTC day: BTC every day, gold on weekdays. */
const tradesOn = (asset: Asset, day: number) => asset === "BTC" || ![0, 6].includes((day + 4) % 7);

type Prepared = {
  s: Series;
  /** Momentum and trend in units of recent volatility (NaN before there is enough history). */
  mom: Float64Array;
  trend: Float64Array;
  /** Per horizon: the h-day log returns and their running sums, for baselines up to any day. */
  ret: Map<number, { r: Float64Array; sum: Float64Array; sq: Float64Array; up: Int32Array }>;
};
const prepared = new Map<Asset, Prepared>();

function prepare(asset: Asset): Prepared {
  const hit = prepared.get(asset);
  if (hit) return hit;
  const s = current[asset];
  const c = s.close;
  const n = c.length;
  const mom = new Float64Array(n).fill(NaN);
  const trend = new Float64Array(n).fill(NaN);
  let r1 = 0;
  let r2 = 0;
  let sma = 0;
  for (let i = 1; i < n; i++) {
    const r = Math.log(c[i] / c[i - 1]);
    r1 += r;
    r2 += r * r;
    if (i > 60) {
      const old = Math.log(c[i - 60] / c[i - 61]);
      r1 -= old;
      r2 -= old * old;
    }
    sma += c[i];
    if (i >= 50) sma -= c[i - 50];
    if (i < 60) continue;
    const m = r1 / 60;
    const sd = Math.sqrt(Math.max(0, r2 / 60 - m * m));
    if (!(sd > 0)) continue;
    mom[i] = Math.log(c[i] / c[i - 20]) / (sd * Math.sqrt(20));
    // A random walk sits about √17 days' volatility from its 50-day average.
    trend[i] = Math.log(c[i] / (sma / 50)) / (sd * Math.sqrt(17));
  }
  const p: Prepared = { s, mom, trend, ret: new Map() };
  prepared.set(asset, p);
  return p;
}

function returns(p: Prepared, h: number) {
  const hit = p.ret.get(h);
  if (hit) return hit;
  const c = p.s.close;
  const m = Math.max(0, c.length - h);
  const r = new Float64Array(m);
  const sum = new Float64Array(m + 1);
  const sq = new Float64Array(m + 1);
  const up = new Int32Array(m + 1);
  for (let j = 0; j < m; j++) {
    r[j] = Math.log(c[j + h] / c[j]);
    sum[j + 1] = sum[j] + r[j];
    sq[j + 1] = sq[j] + r[j] * r[j];
    up[j + 1] = up[j] + (r[j] > 0 ? 1 : 0);
  }
  const value = { r, sum, sq, up };
  p.ret.set(h, value);
  return value;
}

export type Verdict = "Bullish" | "Bearish" | "Netral";
export type Sample = { time: number; ret: number; /** 0 … 1: how much it counts (similar state, recent). */ w: number; /** The close it's measured from. */ i: number };
export type MarketState = { mom: number; trend: number };
export type Impact = {
  asset: Asset;
  verdict: Verdict;
  confidence: "rendah" | "sedang" | "tinggi" | null;
  /** The kind of event the statistics come from (the event's own, or a broader one). */
  basis: string;
  basisLevel: number;
  horizon: number;
  n: number;
  /** The effective number of events once weighted. */
  neff: number;
  /** Means as simple percentages: after the events, over all periods, and what the market's state
   *  and era would expect (the yardstick of the verdict). */
  meanPct: number;
  baselinePct: number;
  expectedPct: number;
  excessPct: number;
  /** The excess split: what the market's state alone would explain, and what is left to the event. */
  marketPct: number;
  astroPct: number;
  upRate: number;
  baselineUpRate: number;
  t: number;
  samples: Sample[];
  /** The last close used (UTC day number), the market's state then, and whether it can still change. */
  asOfDay: number;
  state: MarketState | null;
  final: boolean;
};

/** Past events by key, for looking up an event's precedents. */
export function indexByKey(events: AstroEvent[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const e of events) for (const k of e.keys) (m.get(k) ?? m.set(k, []).get(k)!).push(e.time);
  return m;
}

const pct = (logRet: number) => (Math.exp(logRet) - 1) * 100;

/**
 * The impact of `event` on `asset` as of `asOfDay` (UTC day number; by default the latest close,
 * at most the day before the event), from the events of its kind whose outcome was known by then.
 */
export function impactOf(event: AstroEvent, byKey: Map<string, number[]>, asset: Asset, asOfDay?: number, today = Math.floor(Date.now() / 1000 / DAY)): Impact {
  const p = prepare(asset);
  const s = p.s;
  const h = event.horizon;
  const eventDay = Math.floor(event.time / DAY);
  const h1 = eventDay - 1;
  const lastDay = s.days[s.days.length - 1];
  const end = indexOnOrBefore(s, Math.min(asOfDay ?? h1, h1));
  let final = h1 < today;
  for (let d = lastDay + 1; final && d <= h1; d++) if (tradesOn(asset, d)) final = false;

  const R = returns(p, h);
  const count = end - h + 1; // h-day returns already over by `end`
  const empty: Impact = {
    asset, verdict: "Netral", confidence: null, basis: event.keys[0], basisLevel: 0, horizon: h, n: 0, neff: 0, meanPct: 0, baselinePct: 0, expectedPct: 0, excessPct: 0,
    marketPct: 0, astroPct: 0, upRate: 0, baselineUpRate: 0, t: 0, samples: [], asOfDay: end >= 0 ? s.days[end] : h1, state: null, final,
  };
  if (end < 60 || count < 60) return empty;

  const baseMean = R.sum[count] / count;
  const baseSd = Math.sqrt(Math.max(0, R.sq[count] / count - baseMean * baseMean));
  const baseUp = R.up[count] / count;
  const clip = (r: number) => Math.max(baseMean - 3 * baseSd, Math.min(baseMean + 3 * baseSd, r));
  const state: MarketState | null = Number.isFinite(p.mom[end]) ? { mom: p.mom[end], trend: p.trend[end] } : null;
  const asOf = s.days[end];
  const weight = (j: number) => {
    const recency = 0.5 ** ((asOf - s.days[j]) / (365.25 * HALF_LIFE_YEARS));
    if (!state || !Number.isFinite(p.mom[j])) return FLOOR * recency;
    const d2 = (p.mom[j] - state.mom) ** 2 + (p.trend[j] - state.trend) ** 2;
    return (FLOOR + (1 - FLOOR) * Math.exp(-d2 / (2 * BANDWIDTH * BANDWIDTH))) * recency;
  };

  const samplesFor = (key: string): Sample[] => {
    const out: Sample[] = [];
    for (const time of byKey.get(key) ?? []) {
      if (time >= event.time) continue;
      const day = Math.floor(time / DAY);
      const i = indexOnOrBefore(s, day - 1); // the close the day before it
      if (i < 1 || i + h > end) continue; // before the data, or its outcome not known yet
      if (day - 1 - s.days[i] > 5) continue; // a gap in the data
      out.push({ time, ret: R.r[i], w: weight(i), i });
    }
    return out;
  };

  let level = 0;
  let samples = samplesFor(event.keys[0]);
  while (samples.length < MIN_SAMPLES && level < event.keys.length - 1) samples = samplesFor(event.keys[++level]);
  const n = samples.length;
  let W = 0;
  let W2 = 0;
  let sum = 0;
  let up = 0;
  for (const x of samples) {
    W += x.w;
    W2 += x.w * x.w;
    sum += x.w * clip(x.ret);
    if (x.ret > 0) up += x.w;
  }
  const mean = W > 0 ? sum / W : 0;
  // Overlapping windows count once: the days they cover against the days they'd cover apart.
  let covered = 0;
  let reach = -Infinity;
  for (const x of [...samples].sort((p1, p2) => p1.i - p2.i)) {
    covered += Math.min(h, x.i + h - Math.max(x.i, reach));
    reach = Math.max(reach, x.i + h);
  }
  const overlap = covered > 0 ? (n * h) / covered : 1;
  const neff = W2 > 0 ? (W * W) / W2 / overlap : 0;
  let v = 0;
  for (const x of samples) v += x.w * (clip(x.ret) - mean) ** 2;
  const sd = W > 0 && neff > 1 ? Math.sqrt((v / W) * (neff / (neff - 1))) : 0;

  // What any day in a similar state did next, events or not.
  let sw = 0;
  let sm = 0;
  for (let j = 1; j < count; j++) {
    const w = weight(j);
    sw += w;
    sm += w * clip(R.r[j]);
  }
  const stateMean = sw > 0 ? sm / sw : baseMean;

  // The event's own part: against what the market did anyway, weighed the same way.
  const excess = mean - stateMean;
  const t = n >= 2 && sd > 0 && neff > 0 ? excess / (sd / Math.sqrt(neff)) : 0;
  const enough = n >= MIN_SAMPLES;
  const verdict: Verdict = !enough ? "Netral" : t >= 1 ? "Bullish" : t <= -1 ? "Bearish" : "Netral";
  const confidence = !enough || verdict === "Netral" ? null : Math.abs(t) >= 2.33 ? "tinggi" : Math.abs(t) >= 1.65 ? "sedang" : "rendah";
  return {
    asset,
    verdict,
    confidence,
    basis: event.keys[level],
    basisLevel: level,
    horizon: h,
    n,
    neff,
    meanPct: pct(mean),
    baselinePct: pct(baseMean),
    expectedPct: pct(stateMean),
    excessPct: pct(mean) - pct(baseMean),
    marketPct: pct(stateMean) - pct(baseMean),
    astroPct: pct(mean) - pct(stateMean),
    upRate: W > 0 ? up / W : 0,
    baselineUpRate: baseUp,
    t,
    samples,
    asOfDay: asOf,
    state,
    final,
  };
}

/** The verdict as of each of the last `count` trading days up to H-1 (or the latest close). */
export function verdictTrail(event: AstroEvent, byKey: Map<string, number[]>, asset: Asset, count = 15): Array<{ day: number; verdict: Verdict; t: number }> {
  const s = prepare(asset).s;
  const end = indexOnOrBefore(s, Math.floor(event.time / DAY) - 1);
  const out: Array<{ day: number; verdict: Verdict; t: number }> = [];
  for (let k = Math.max(0, end - count + 1); k <= end; k++) {
    const im = impactOf(event, byKey, asset, s.days[k]);
    out.push({ day: s.days[k], verdict: im.verdict, t: im.t });
  }
  return out;
}

/**
 * How the H-1 verdicts on earlier events of this kind turned out: of those that weren't neutral,
 * how many moved the way they said (against the asset's ordinary return).
 */
export function trackRecord(event: AstroEvent, byKey: Map<string, number[]>, events: AstroEvent[], asset: Asset): { calls: number; right: number } {
  const s = prepare(asset).s;
  const key = event.keys[0];
  let calls = 0;
  let right = 0;
  for (const time of byKey.get(key) ?? []) {
    if (time >= event.time) break;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    let past: AstroEvent | undefined;
    for (let k = lo; k < events.length && events[k].time === time && !past; k++) if (events[k].keys[0] === key) past = events[k];
    if (!past) continue;
    const im = impactOf(past, byKey, asset);
    const i = indexOnOrBefore(s, Math.floor(time / DAY) - 1);
    if (im.verdict === "Netral" || i < 0 || i + past.horizon >= s.close.length) continue;
    // Right when it moved the way the verdict said, against the same yardstick.
    const excess = pct(Math.log(s.close[i + past.horizon] / s.close[i])) - im.expectedPct;
    calls++;
    if (im.verdict === "Bullish" ? excess > 0 : excess < 0) right++;
  }
  return { calls, right };
}

/** "naik kuat, di atas rata-rata 50 hari" and so on, for the market's state. */
export function describeState(state: MarketState | null): string {
  if (!state) return "belum cukup data";
  const m = state.mom;
  const move = m >= 1.5 ? "naik kuat" : m >= 0.5 ? "naik" : m > -0.5 ? "datar" : m > -1.5 ? "turun" : "turun kuat";
  return `${move} 20 hari terakhir, ${state.trend >= 0 ? "di atas" : "di bawah"} rata-rata 50 hari`;
}

/** "aspect:Mars-Saturn:hard" → "Mars–Saturn tegang" and so on, for showing the basis. */
export function describeKey(key: string): string {
  const [kind, a, b] = key.split(":");
  const nature: Record<string, string> = { hard: "aspek tegang (square/opposition)", soft: "aspek harmonis (sextile/trine)", conj: "konjungsi" };
  switch (kind) {
    case "rx":
      return `${a} retrograde`;
    case "direct":
      return `${a} direct`;
    case "ingress":
      return b ? `${a} masuk ${["Api", "Tanah", "Udara", "Air"].includes(b) ? `tanda ${b}` : b}` : `${a} pindah tanda`;
    case "aspect":
      return a?.includes("-") ? `${a.replace("-", "–")} ${nature[b] ?? b}` : `semua ${a}${b === "slow" ? " antar planet lambat" : ""}`;
    case "lunation":
      return `${a === "new" ? "bulan baru" : "purnama"}${b ? ` di ${["Api", "Tanah", "Udara", "Air"].includes(b) ? `tanda ${b}` : b}` : ""}`;
    case "eclipse":
      return a ? `gerhana ${a === "solar" ? "matahari" : "bulan"}` : "semua gerhana";
    default:
      return key;
  }
}
