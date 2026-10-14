// The macro nowcasting engine (blueprint stage 4): our own P10/P50/P90 for the next CPI, core CPI,
// PPI and payrolls prints, by quantile gradient boosting (quantgbm.ts) on point-in-time data.
//
// What's predicted is the surprise (actual − consensus), what markets move on; the band is the
// consensus plus the surprise's quantiles. Every input is as it was known before the release:
//   - the first print, the consensus and the previous as the calendar showed them on the day
//     (TradingView's economic calendar keeps them since 2013; revisions come later and aren't used);
//   - releases out before this one: ADP before payrolls, ISM prices before CPI, PPI before CPI when
//     it came first, jobless claims weekly;
//   - the Cleveland Fed's inflation nowcast for the month, its last value before the release;
//   - markets over the month measured, which are never revised: WTI, retail gasoline, the broad
//     dollar, the 2-year yield and 5-year breakeven inflation (FRED).
// Each model is tested walk-forward (trained only on the releases before each one it predicts), so
// the track record shown is out of sample.
//
// Live: the engine refreshes the next release's band as data comes in, and keeps the band it had
// 30 minutes before the release (H-30) to score afterwards. The latest Fed Sentiment Index from a
// Fed broadcast (layer 1–3) nudges the median, by a quarter of the surprise's usual size at ±1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import type { TVRaw } from "./econcalendar.js";
import * as fred from "./fred.js";
import { clevelandFile, type MonthNowcast } from "./nowcast.js";
import { fitBand, predictBand, quantile, type GbmParams } from "./quantgbm.js";

const dir = join(dataDir, "macro-engine");
const START = Date.UTC(2013, 0, 1);

/** A calendar event as the engine keeps it: numbers, not formatted readings. */
export type Release = { title: string; date: string; ref: string; actual: number | null; forecast: number | null; previous: number | null };

const TITLES = new Set([
  "Inflation Rate MoM",
  "Core Inflation Rate MoM",
  "PPI MoM",
  "Non Farm Payrolls",
  "ADP Employment Change",
  "Initial Jobless Claims",
  "ISM Manufacturing Prices",
  "ISM Manufacturing Employment",
  "ISM Services Prices",
  "JOLTs Job Openings",
]);

// ---------------------------------------------------------------- the data, kept on disk

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);
const addMonths = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return monthKey(d.getTime());
};

/**
 * The US releases the engine reads, since 2013, three months a call. A quarter more than six
 * months old is kept for good once read; newer ones are read again after twelve hours.
 */
export async function usReleases(now = Date.now()): Promise<Release[]> {
  const file = join(dir, "us-releases.json");
  const store = readJson<Record<string, { at: number; events: Release[] }>>(file) ?? {};
  let changed = false;
  const end = monthKey(now + 45 * 86_400_000);
  for (let from = monthKey(START); from <= end; from = addMonths(from, 3)) {
    const to = addMonths(from, 3);
    const kept = store[from];
    const settled = Date.parse(`${to}-01T00:00:00Z`) < now - 180 * 86_400_000;
    if (kept && (settled || kept.at > now - 12 * 3_600_000)) continue;
    const url = `https://economic-calendar.tradingview.com/events?from=${from}-01T00:00:00.000Z&to=${to}-01T00:00:00.000Z&countries=US`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`tradingview calendar ${res.status}`);
    const body = (await res.json()) as { status?: string; result?: TVRaw[] };
    if (body.status !== "ok" || !Array.isArray(body.result)) throw new Error("tradingview calendar: unexpected reply");
    store[from] = {
      at: now,
      events: body.result
        .filter((e) => TITLES.has(e.title))
        .map((e) => ({
          title: e.title,
          date: new Date(e.date).toISOString(),
          ref: (e.referenceDate ?? e.date).slice(0, 10),
          actual: e.actual ?? null,
          forecast: e.forecast ?? null,
          previous: e.previous ?? null,
        })),
    };
    changed = true;
  }
  if (changed) writeJson(file, store);
  const seen = new Set<string>();
  return Object.values(store)
    .flatMap((c) => c.events)
    .filter((e) => (seen.has(`${e.title}|${e.date}`) ? false : (seen.add(`${e.title}|${e.date}`), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily (or weekly) market series from FRED, whole, read again after twelve hours. */
export async function marketSeries(ids: string[], now = Date.now()): Promise<Record<string, fred.SeriesPoint[]>> {
  const file = join(dir, "markets.json");
  const store = readJson<{ at: number; series: Record<string, fred.SeriesPoint[]> }>(file);
  if (store && store.at > now - 12 * 3_600_000 && ids.every((id) => store.series[id]?.length)) return store.series;
  const series: Record<string, fred.SeriesPoint[]> = {};
  for (const id of ids) series[id] = await fred.series(id, 100_000).catch(() => store?.series[id] ?? []);
  writeJson(file, { at: now, series });
  return series;
}

// ---------------------------------------------------------------- features, as known at a moment

export type Inputs = { releases: Release[]; markets: Record<string, fred.SeriesPoint[]>; cleveland: MonthNowcast[] };

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** A series' average over a month, from points dated before `before`. */
function monthAvg(points: fred.SeriesPoint[], month: string, before: string): number {
  return avg(points.filter((p) => p.date.startsWith(month) && p.date < before).map((p) => p.value));
}
function monthLast(points: fred.SeriesPoint[], month: string, before: string): number {
  const v = points.filter((p) => p.date.startsWith(month) && p.date < before);
  return v.length ? v[v.length - 1].value : NaN;
}

/** % change of a series' monthly average, month on month. */
const pctChange = (points: fred.SeriesPoint[], month: string, before: string) => {
  const a = monthAvg(points, addMonths(month, -1), before);
  const b = monthAvg(points, month, before);
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : NaN;
};
/** Change of a series' month-end level, month on month. */
const levelChange = (points: fred.SeriesPoint[], month: string, before: string) => monthLast(points, month, before) - monthLast(points, addMonths(month, -1), before);

/** Another release for the same month (`month`), if it was out before `before`. */
function sameMonth(inputs: Inputs, title: string, month: string, before: string): Release | undefined {
  return inputs.releases.find((e) => e.title === title && e.ref.startsWith(month) && e.date < before && e.actual !== null);
}
const surprise = (e: Release | undefined) => (e && e.actual !== null && e.forecast !== null ? e.actual - e.forecast : NaN);

/** Initial jobless claims averaged over a month (weeks ending in it), as printed before `before`. */
function claimsAvg(inputs: Inputs, month: string, before: string): number {
  return avg(inputs.releases.filter((e) => e.title === "Initial Jobless Claims" && e.ref.startsWith(month) && e.date < before && e.actual !== null).map((e) => e.actual!));
}

/** The latest JOLTS openings out before `before`, and its change from the print before. */
function joltsChange(inputs: Inputs, before: string): number {
  const v = inputs.releases.filter((e) => e.title === "JOLTs Job Openings" && e.date < before && e.actual !== null);
  const last = v.at(-1);
  return last && last.previous !== null ? last.actual! - last.previous : NaN;
}

function clevelandFor(inputs: Inputs, series: string, month: string): number {
  return inputs.cleveland.find((m) => m.month === month)?.nowcast[series] ?? NaN;
}

type Feature = { name: string; label: string; value: (inputs: Inputs, month: string, before: string, consensus: number) => number };

const MARKET_FEATURES: Feature[] = [
  { name: "wti", label: "WTI Δ% bulan itu", value: (i, m, b) => pctChange(i.markets.DCOILWTICO ?? [], m, b) },
  { name: "gas", label: "Bensin eceran Δ%", value: (i, m, b) => pctChange(i.markets.GASREGW ?? [], m, b) },
  { name: "usd", label: "Dolar (broad) Δ%", value: (i, m, b) => pctChange(i.markets.DTWEXBGS ?? [], m, b) },
  { name: "y2", label: "Yield 2Y Δ (pp)", value: (i, m, b) => levelChange(i.markets.DGS2 ?? [], m, b) },
  { name: "be5", label: "Breakeven 5Y Δ (pp)", value: (i, m, b) => levelChange(i.markets.T5YIE ?? [], m, b) },
];

export type Target = {
  key: string;
  label: string;
  title: string;
  unit: "%" | "K";
  /** A gap from the consensus this big or more calls a side. */
  hot: number;
  features: Feature[];
};

// The features each target keeps: the few that held up out of sample (walk-forward, 2016–2026).
// With ~160 releases, more features made every model worse than the consensus it adjusts; the
// consensus and previous print themselves added nothing (the target is already the surprise).
const MARKET = Object.fromEntries(MARKET_FEATURES.map((f) => [f.name, f]));

export const TARGETS: Target[] = [
  {
    key: "cpi_mom",
    label: "CPI MoM",
    title: "Inflation Rate MoM",
    unit: "%",
    hot: 0.05,
    features: [
      { name: "clev", label: "Nowcast Cleveland − konsensus", value: (i, m, _b, c) => clevelandFor(i, "CPI Inflation", m) - c },
      { name: "ppi", label: "Kejutan PPI (bila rilis lebih dulu)", value: (i, m, b) => surprise(sameMonth(i, "PPI MoM", m, b)) },
      MARKET.gas,
    ],
  },
  {
    key: "core_cpi_mom",
    label: "Core CPI MoM",
    title: "Core Inflation Rate MoM",
    unit: "%",
    hot: 0.05,
    features: [{ name: "ism_s", label: "ISM Services Prices", value: (i, m, b) => sameMonth(i, "ISM Services Prices", m, b)?.actual ?? NaN }],
  },
  {
    key: "ppi_mom",
    label: "PPI MoM",
    title: "PPI MoM",
    unit: "%",
    hot: 0.1,
    features: [{ name: "cpi", label: "Kejutan CPI (bila rilis lebih dulu)", value: (i, m, b) => surprise(sameMonth(i, "Inflation Rate MoM", m, b)) }, MARKET.gas],
  },
  {
    key: "nfp",
    label: "Non Farm Payrolls",
    title: "Non Farm Payrolls",
    unit: "K",
    hot: 25,
    features: [{ name: "adp", label: "Kejutan ADP (K)", value: (i, m, b) => surprise(sameMonth(i, "ADP Employment Change", m, b)) }],
  },
];

function featureRow(t: Target, inputs: Inputs, month: string, before: string, consensus: number): number[] {
  return t.features.map((f) => f.value(inputs, month, before, consensus));
}
const featureNames = (t: Target) => t.features.map((f) => f.label);

/** Missing values (a feature not out yet, or not before 2018) as the training median. */
function impute(X: number[][]): { X: number[][]; medians: number[] } {
  const medians = X[0].map((_, j) => {
    const v = X.map((r) => r[j]).filter(Number.isFinite);
    return v.length ? quantile(v, 0.5) : 0;
  });
  return { X: X.map((r) => r.map((v, j) => (Number.isFinite(v) ? v : medians[j]))), medians };
}
const fill = (row: number[], medians: number[]) => row.map((v, j) => (Number.isFinite(v) ? v : medians[j]));

// ---------------------------------------------------------------- training, testing, predicting

/**
 * Stumps (one split a tree), 100 of them at rate 0.05, leaves of at least 15 releases. The
 * blueprint's 150 trees of depth 3 fitted ~160 releases too closely: out of sample its median
 * missed by more than the consensus (CPI 0.101 vs 0.087) and its P10–P90 held 67% of prints, not 80%.
 */
export const ENGINE_PARAMS: GbmParams = { trees: 100, depth: 1, learningRate: 0.05, minLeaf: 15 };

export type Row = { date: string; month: string; x: number[]; consensus: number; actual: number };

export function rows(t: Target, inputs: Inputs): Row[] {
  return inputs.releases
    .filter((e) => e.title === t.title && e.actual !== null && e.forecast !== null)
    .map((e) => {
      const month = e.ref.slice(0, 7);
      return { date: e.date, month, x: featureRow(t, inputs, month, e.date, e.forecast!), consensus: e.forecast!, actual: e.actual! };
    });
}

export type Backtest = {
  months: number;
  from: string | null;
  /** Mean absolute miss of the engine's median and of the consensus. */
  maeEngine: number;
  maeConsensus: number;
  /** Share of releases inside P10–P90 (≈80% when the band is honest). */
  coverage: number;
  /** When the median was a clear side of the consensus: how often the print landed that side. */
  calls: number;
  hits: number;
  medianSpread: number;
};

/**
 * Walk-forward: from the 36th release on, each predicted by models trained only on the releases
 * before it (refitted every six releases; between refits the last fit is used).
 */
export function backtest(t: Target, data: Row[], params: GbmParams = ENGINE_PARAMS): Backtest {
  let n = 0;
  let eEng = 0;
  let eCon = 0;
  let inside = 0;
  let calls = 0;
  let hits = 0;
  const spreads: number[] = [];
  let band: ReturnType<typeof fitBand> | null = null;
  let medians: number[] = [];
  for (let i = 36; i < data.length; i++) {
    if (!band || (i - 36) % 6 === 0) {
      const train = impute(data.slice(0, i).map((r) => r.x));
      medians = train.medians;
      band = fitBand(train.X, data.slice(0, i).map((r) => r.actual - r.consensus), params);
    }
    const r = data[i];
    const [lo, mid, hi] = predictBand(band, fill(r.x, medians));
    const s = r.actual - r.consensus;
    n++;
    eEng += Math.abs(s - mid);
    eCon += Math.abs(s);
    if (s >= lo && s <= hi) inside++;
    spreads.push(hi - lo);
    if (Math.abs(mid) >= t.hot && s !== 0) {
      calls++;
      if (Math.sign(mid) === Math.sign(s)) hits++;
    }
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    months: n,
    from: data[36]?.month ?? null,
    maeEngine: r3(n ? eEng / n : 0),
    maeConsensus: r3(n ? eCon / n : 0),
    coverage: r3(n ? inside / n : 0),
    calls,
    hits,
    medianSpread: r3(quantile(spreads, 0.5)),
  };
}

export type Bias = "hawkish" | "dovish" | "neutral";
export type Snapshot = { at: string; p10: number; p50: number; p90: number; adjusted: number; consensus: number; sentiment: number | null };

export type EngineRow = {
  key: string;
  label: string;
  unit: "%" | "K";
  period: string;
  release: string;
  consensus: number;
  previous: number | null;
  actual: number | null;
  p10: number;
  p50: number;
  p90: number;
  /** P90 − P10, and how sure the engine is next to its usual spread (50% at the usual). */
  spread: number;
  confidence: number;
  /** The latest Fed Sentiment Index from a Fed broadcast, and what it moved the median by. */
  sentiment: { index: number; at: string; title: string } | null;
  adjustment: number;
  adjusted: number;
  bias: Bias;
  inputs: Array<{ name: string; value: number | null }>;
  backtest: Backtest;
  /** The band 30 minutes before the release, kept to be scored against the print. */
  h30: Snapshot | null;
};

export type Engine = {
  asOf: string;
  rows: EngineRow[];
  /** Releases due whose consensus isn't out yet. */
  waiting: Array<{ key: string; label: string; period: string; release: string; backtest: Backtest }>; recent: Array<{ key: string; label: string; unit: "%" | "K"; period: string; release: string; consensus: number; actual: number; h30: Snapshot }> ; source: string };

const round = (v: number, unit: "%" | "K") => (unit === "K" ? Math.round(v) : Math.round(v * 1000) / 1000);

function loadSnapshots(): Record<string, Snapshot> {
  return readJson<Record<string, Snapshot>>(join(dir, "h30.json")) ?? {};
}

/**
 * The next release of each target: its band now, with the inputs as they stand (and the band kept
 * at H-30 once inside the last half hour), and the targets' out-of-sample track records.
 */
export function runEngine(inputs: Inputs, sentiment: { index: number; at: string; title: string } | null, now = Date.now()): Engine {
  const snapshots = loadSnapshots();
  let snapped = false;
  const out: EngineRow[] = [];
  const waiting: Engine["waiting"] = [];
  for (const t of TARGETS) {
    const data = rows(t, inputs);
    if (data.length < 40) continue;
    const bt = backtest(t, data);
    const train = impute(data.map((r) => r.x));
    const band = fitBand(train.X, data.map((r) => r.actual - r.consensus), ENGINE_PARAMS);
    // The next release with a consensus (or one out in the last two hours, to show against).
    const next = inputs.releases.find((e) => e.title === t.title && e.forecast !== null && Date.parse(e.date) > now - 2 * 3_600_000);
    if (!next) {
      // Scheduled, but its consensus isn't out yet: the band needs it.
      const due = inputs.releases.find((e) => e.title === t.title && Date.parse(e.date) > now);
      if (due) waiting.push({ key: t.key, label: t.label, period: due.ref.slice(0, 7), release: due.date, backtest: bt });
      continue;
    }
    const month = next.ref.slice(0, 7);
    const before = new Date(Math.min(now, Date.parse(next.date))).toISOString();
    const x = featureRow(t, inputs, month, before, next.forecast!);
    const [lo, mid, hi] = predictBand(band, fill(x, train.medians));
    const spread = hi - lo;
    const sd = Math.sqrt(data.reduce((n, r) => n + (r.actual - r.consensus) ** 2, 0) / data.length);
    const fresh = sentiment && now - Date.parse(sentiment.at) < 14 * 86_400_000 ? sentiment : null;
    const adjustment = fresh ? fresh.index * 0.25 * sd : 0;
    const adjustedSurprise = mid + adjustment;
    // Called on the gap as shown (to 0.01 pp, or 1K): 0.599 against 0.5 reads as 0.60, a 0.1 gap.
    const shownGap = t.unit === "K" ? Math.round(adjustedSurprise) : Math.round(adjustedSurprise * 100) / 100;
    const bias: Bias = shownGap >= t.hot ? "hawkish" : shownGap <= -t.hot ? "dovish" : "neutral";
    const c = next.forecast!;
    const id = `${t.key}|${next.date}`;
    const releaseAt = Date.parse(next.date);
    // Keep the band from the last half hour before the release (the first look inside it).
    if (!snapshots[id] && now >= releaseAt - 30 * 60_000 && now < releaseAt) {
      snapshots[id] = { at: new Date(now).toISOString(), p10: round(c + lo, t.unit), p50: round(c + mid, t.unit), p90: round(c + hi, t.unit), adjusted: round(c + adjustedSurprise, t.unit), consensus: c, sentiment: fresh?.index ?? null };
      snapped = true;
    }
    out.push({
      key: t.key,
      label: t.label,
      unit: t.unit,
      period: month,
      release: next.date,
      consensus: c,
      previous: next.previous,
      actual: next.actual,
      p10: round(c + lo, t.unit),
      p50: round(c + mid, t.unit),
      p90: round(c + hi, t.unit),
      spread: round(spread, t.unit),
      confidence: Math.round(Math.max(0, Math.min(1, 1 - spread / (2 * Math.max(bt.medianSpread, 1e-9)) + 0)) * 100),
      sentiment: fresh,
      adjustment: round(adjustment, t.unit),
      adjusted: round(c + adjustedSurprise, t.unit),
      bias,
      inputs: featureNames(t).map((name, j) => ({ name, value: Number.isFinite(x[j]) ? Math.round(x[j] * 1000) / 1000 : null })),
      backtest: bt,
      h30: snapshots[id] ?? null,
    });
  }
  if (snapped) writeJson(join(dir, "h30.json"), snapshots);
  // The H-30 bands of releases already out (the last 120 days), against their prints.
  const recent = Object.entries(snapshots)
    .map(([id, s]) => {
      const [key, date] = id.split("|");
      const t = TARGETS.find((x) => x.key === key);
      const e = inputs.releases.find((r) => r.title === t?.title && r.date === date);
      return t && e && e.actual !== null && Date.parse(date) > now - 120 * 86_400_000 ? { key, label: t.label, unit: t.unit, period: e.ref.slice(0, 7), release: date, consensus: s.consensus, actual: e.actual, h30: s } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => b.release.localeCompare(a.release));
  return {
    asOf: new Date(now).toISOString(),
    rows: out,
    waiting,
    recent,
    source: "Quantile gradient boosting (P10/P50/P90) on point-in-time data: TradingView economic calendar (first prints, consensus) since 2013, Cleveland Fed nowcast, FRED markets",
  };
}

export const MARKET_IDS = ["DCOILWTICO", "GASREGW", "DTWEXBGS", "DGS2", "T5YIE"];

export async function engine(sentiment: { index: number; at: string; title: string } | null, now = Date.now()): Promise<Engine> {
  const [releases, markets, cleveland] = await Promise.all([usReleases(now), marketSeries(MARKET_IDS, now), clevelandFile("month").catch(() => [] as MonthNowcast[])]);
  return runEngine({ releases, markets, cleveland }, sentiment, now);
}

/**
 * Keeps the H-30 bands without anyone looking: every five minutes, when a target's release is due
 * within 35 minutes, the engine runs (and keeps the band once inside the last half hour).
 */
export function startEngineWatch(sentiment: () => { index: number; at: string; title: string } | null): void {
  const check = () => {
    const store = readJson<Record<string, { events: Release[] }>>(join(dir, "us-releases.json"));
    if (!store) return;
    const now = Date.now();
    const titles = new Set(TARGETS.map((t) => t.title));
    const due = Object.values(store).some((c) => c.events.some((e) => titles.has(e.title) && e.forecast !== null && Date.parse(e.date) > now && Date.parse(e.date) - now <= 35 * 60_000));
    if (due) engine(sentiment()).catch((err) => console.warn("macro engine:", err instanceof Error ? err.message : err));
  };
  setInterval(check, 5 * 60_000).unref();
}
