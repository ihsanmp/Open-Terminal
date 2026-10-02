// The market impact of an astrology event on GOLD and BTC, worked out offline from history:
// an event study, as pyAstroTrader relates each aspect to the next days' price trend.
//
// For an event, every earlier event of the same kind (Venus retrograde, Mars square Saturn, a
// full moon in Taurus …) is found, and the asset's return over the following `horizon` trading
// days is measured from the close on (or after) its day. Their average is compared with the
// asset's ordinary return over any `horizon` days in the same history (BTC drifts up strongly,
// so "it rose" alone would call almost everything bullish):
//
//   excess = mean(returns after the events) − mean(all returns)
//   t      = excess ÷ (standard deviation of the event returns ÷ √n)
//
// Bullish when t ≥ 1, bearish when t ≤ −1, neutral otherwise; the confidence follows |t| (≥ 1.65
// medium, ≥ 2.33 high). Returns beyond three standard deviations are clipped so a single crash or
// squeeze doesn't decide the verdict. With fewer than MIN_SAMPLES events of that exact kind, the
// next broader kind is used (Mars–Saturn tension, then any square), and the result says which.
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

/** Adds newer daily closes (from the API) after the bundled ones. */
export function extendSeries(asset: Asset, candles: Array<{ time: number; close: number }>): void {
  const base = current[asset];
  const last = base.days[base.days.length - 1];
  const extra = candles.filter((c) => Math.floor(c.time / 86_400) > last && Number.isFinite(c.close));
  if (!extra.length) return;
  const days = new Int32Array(base.days.length + extra.length);
  days.set(base.days);
  extra.forEach((c, i) => (days[base.days.length + i] = Math.floor(c.time / 86_400)));
  const close = new Float64Array(days.length);
  close.set(base.close);
  extra.forEach((c, i) => (close[base.close.length + i] = c.close));
  current = { ...current, [asset]: { days, close } };
  baselineCache.clear();
}

export const seriesOf = (asset: Asset): Series => current[asset];
export const lastPriceDay = (asset: Asset) => current[asset].days[current[asset].days.length - 1];

/** The first trading day on or after `day`. */
function indexOnOrAfter(s: Series, day: number): number {
  let lo = 0;
  let hi = s.days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const baselineCache = new Map<string, { mean: number; sd: number; up: number }>();
/** The asset's ordinary h-day log return over its whole history. */
function baseline(asset: Asset, h: number) {
  const key = `${asset}:${h}`;
  const hit = baselineCache.get(key);
  if (hit) return hit;
  const s = current[asset];
  let sum = 0;
  let sq = 0;
  let up = 0;
  let n = 0;
  for (let i = 0; i + h < s.close.length; i++) {
    const r = Math.log(s.close[i + h] / s.close[i]);
    sum += r;
    sq += r * r;
    if (r > 0) up++;
    n++;
  }
  const mean = sum / n;
  const value = { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)), up: up / n };
  baselineCache.set(key, value);
  return value;
}

export type Verdict = "Bullish" | "Bearish" | "Netral";
export type Sample = { time: number; ret: number };
export type Impact = {
  asset: Asset;
  verdict: Verdict;
  confidence: "rendah" | "sedang" | "tinggi" | null;
  /** The kind of event the statistics come from (the event's own, or a broader one). */
  basis: string;
  basisLevel: number;
  horizon: number;
  n: number;
  /** Means as simple percentages. */
  meanPct: number;
  baselinePct: number;
  excessPct: number;
  upRate: number;
  baselineUpRate: number;
  t: number;
  samples: Sample[];
};

/** Past events by key, for looking up an event's precedents. */
export function indexByKey(events: AstroEvent[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const e of events) for (const k of e.keys) (m.get(k) ?? m.set(k, []).get(k)!).push(e.time);
  return m;
}

const pct = (logRet: number) => (Math.exp(logRet) - 1) * 100;

/** The impact of `event` on `asset`, from the events of its kind before it. */
export function impactOf(event: AstroEvent, byKey: Map<string, number[]>, asset: Asset): Impact {
  const s = current[asset];
  const h = event.horizon;
  const base = baseline(asset, h);
  const clip = (r: number) => Math.max(base.mean - 3 * base.sd, Math.min(base.mean + 3 * base.sd, r));

  const samplesFor = (key: string): Sample[] => {
    const out: Sample[] = [];
    for (const time of byKey.get(key) ?? []) {
      if (time >= event.time - 86_400) continue; // only events before this one
      const i = indexOnOrAfter(s, Math.floor(time / 86_400));
      if (i >= s.close.length - h || i === 0) continue; // before the data, or its outcome not known yet
      if (s.days[i] - Math.floor(time / 86_400) > 5) continue; // a gap in the data
      out.push({ time, ret: Math.log(s.close[i + h] / s.close[i]) });
    }
    return out;
  };

  let level = 0;
  let samples = samplesFor(event.keys[0]);
  while (samples.length < MIN_SAMPLES && level < event.keys.length - 1) samples = samplesFor(event.keys[++level]);
  const n = samples.length;
  const rs = samples.map((x) => clip(x.ret));
  const mean = n ? rs.reduce((a, r) => a + r, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1)) : 0;
  const excess = mean - base.mean;
  const t = n >= 2 && sd > 0 ? excess / (sd / Math.sqrt(n)) : 0;
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
    meanPct: pct(mean),
    baselinePct: pct(base.mean),
    excessPct: pct(mean) - pct(base.mean),
    upRate: n ? samples.filter((x) => x.ret > 0).length / n : 0,
    baselineUpRate: base.up,
    t,
    samples,
  };
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
