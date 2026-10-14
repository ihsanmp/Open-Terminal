// The macro nowcasting engine (blueprint stage 4): our own P10/P50/P90 for the next US releases
// that move markets (CPI, core CPI, PPI, payrolls, unemployment, PCE, retail sales, GDP, jobless
// claims, ISM manufacturing), by quantile gradient boosting (quantgbm.ts) on point-in-time data.
//
// What's predicted is the surprise (actual − consensus), what markets move on; the band is the
// consensus plus the surprise's quantiles. Every input is as it was known before the release: the
// first print and the consensus as the calendar showed them on the day (TradingView's economic
// calendar keeps them since 2013; revisions come later and aren't used), releases out before this
// one, the Atlanta Fed's last GDPNow, retail gasoline over the month measured (FRED). Each model is
// tested walk-forward (trained only on the releases before each one it predicts), so the track
// record shown is out of sample; inputs that didn't hold up there were dropped (see TARGETS).
//
// Live: the engine refreshes the next release's band as data comes in, and keeps the band it had
// 30 minutes before the release (H-30) to score afterwards. The latest Fed Sentiment Index from a
// Fed broadcast (layers 1–3) nudges the median, by a quarter of the surprise's usual size at ±1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import type { TVRaw } from "./econcalendar.js";
import * as fred from "./fred.js";
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
  "Core PCE Price Index MoM",
  "PCE Price Index MoM",
  "Retail Sales MoM",
  "GDP Growth Rate QoQ Adv",
  "Continuing Jobless Claims",
  "ISM Manufacturing PMI",
  "ISM Services PMI",
  "Unemployment Rate",
  "NY Empire State Manufacturing Index",
  "Philadelphia Fed Manufacturing Index",
  "Chicago PMI",
  "S&P Global Manufacturing PMI Flash",
  "S&P Global Services PMI Flash",
  "Redbook YoY",
  "Michigan Consumer Sentiment Prel",
]);
/** The titles kept: a quarter read with another list is read again. */
const TITLES_SIG = [...TITLES].sort().join("|");

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
  const store = readJson<Record<string, { at: number; sig?: string; events: Release[] }>>(file) ?? {};
  let changed = false;
  const end = monthKey(now + 45 * 86_400_000);
  for (let from = monthKey(START); from <= end; from = addMonths(from, 3)) {
    const to = addMonths(from, 3);
    const kept = store[from];
    const settled = Date.parse(`${to}-01T00:00:00Z`) < now - 180 * 86_400_000;
    if (kept && kept.sig === TITLES_SIG && (settled || kept.at > now - 12 * 3_600_000)) continue;
    const url = `https://economic-calendar.tradingview.com/events?from=${from}-01T00:00:00.000Z&to=${to}-01T00:00:00.000Z&countries=US`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`tradingview calendar ${res.status}`);
    const body = (await res.json()) as { status?: string; result?: TVRaw[] };
    if (body.status !== "ok" || !Array.isArray(body.result)) throw new Error("tradingview calendar: unexpected reply");
    store[from] = {
      at: now,
      sig: TITLES_SIG,
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

export type Inputs = { releases: Release[]; markets: Record<string, fred.SeriesPoint[]> };

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** A series' average over a month, from points dated before `before`. */
function monthAvg(points: fred.SeriesPoint[], month: string, before: string): number {
  return avg(points.filter((p) => p.date.startsWith(month) && p.date < before).map((p) => p.value));
}

/** % change of a series' monthly average, month on month. */
const pctChange = (points: fred.SeriesPoint[], month: string, before: string) => {
  const a = monthAvg(points, addMonths(month, -1), before);
  const b = monthAvg(points, month, before);
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : NaN;
};

/** A weekly release's prints averaged over the weeks of a month, as out before `before`. */
function weeklyAvg(inputs: Inputs, title: string, month: string, before: string): number {
  return avg(inputs.releases.filter((e) => e.title === title && e.ref.startsWith(month) && e.date < before && e.actual !== null).map((e) => e.actual!));
}

/** GDPNow's last nowcast for a quarter (FRED dates it by the quarter's first day). */
function gdpNow(inputs: Inputs, quarterEnd: string): number {
  const y = Number(quarterEnd.slice(0, 4));
  const q = Math.floor((Number(quarterEnd.slice(5, 7)) - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  return inputs.markets.GDPNOW?.find((p) => p.date === start)?.value ?? NaN;
}

/** A feature: its value for the release `e` (measuring `month`, out at `before`, consensus `c`). */
type Feature = { name: string; label: string; value: (inputs: Inputs, month: string, before: string, consensus: number, e: Release) => number };

const GASOLINE: Feature = { name: "gas", label: "Bensin eceran Δ%", value: (i, m, b) => pctChange(i.markets.GASREGW ?? [], m, b) };

export type Unit = "%" | "K" | "pt";

export type Target = {
  key: string;
  label: string;
  title: string;
  unit: Unit;
  /** A gap from the consensus this big or more calls a side. */
  hot: number;
  /** +1 when a print above the consensus is hawkish (inflation, jobs), −1 when it's dovish
   *  (unemployment, jobless claims). */
  hawk: 1 | -1;
  features: Feature[];
};

// The features each target keeps: those that cut the walk-forward miss (2016–2026) by 1% or more,
// added one at a time, best first. Tried and not kept, as they added nothing over the consensus:
//   CPI: Cleveland nowcast gap, PPI surprise, gasoline, WTI, ISM prices, dollar, 2Y, breakevens;
//   core CPI: Cleveland, ISM services prices, PPI; payrolls: ADP surprise, claims, ISM employment,
//   JOLTS; PCE and core PCE: Cleveland, CPI and PPI surprises; retail sales: gasoline, Redbook,
//   Michigan sentiment; claims: last week's surprise, 4-week average, continuing claims; ISM
//   manufacturing: Empire, Philly, Chicago, S&P Global flash.
// With none kept, the band is the consensus plus the surprise's spread over the years: still the
// honest range of where the print can land. ISM services (42 releases) is too short to test.
const target = (key: string, label: string, title: string, unit: Unit, hot: number, features: Feature[] = [], hawk: 1 | -1 = 1): Target => ({ key, label, title, unit, hot, hawk, features });

export const TARGETS: Target[] = [
  target("cpi_mom", "CPI MoM", "Inflation Rate MoM", "%", 0.05),
  target("core_cpi_mom", "Core CPI MoM", "Core Inflation Rate MoM", "%", 0.05),
  target("ppi_mom", "PPI MoM", "PPI MoM", "%", 0.1, [GASOLINE]),
  target("nfp", "Non Farm Payrolls", "Non Farm Payrolls", "K", 25),
  target("unemployment", "Unemployment Rate", "Unemployment Rate", "%", 0.1, [
    {
      name: "cont",
      label: "Klaim lanjutan Δ rata-rata (K)",
      value: (i, m, b) => weeklyAvg(i, "Continuing Jobless Claims", m, b) - weeklyAvg(i, "Continuing Jobless Claims", addMonths(m, -1), b),
    },
  ], -1),
  target("core_pce_mom", "Core PCE MoM", "Core PCE Price Index MoM", "%", 0.05),
  target("pce_mom", "PCE MoM", "PCE Price Index MoM", "%", 0.05),
  target("retail", "Retail Sales MoM", "Retail Sales MoM", "%", 0.2),
  target("gdp", "GDP QoQ (Adv)", "GDP Growth Rate QoQ Adv", "%", 0.3, [{ name: "gdpnow", label: "GDPNow − konsensus", value: (i, _m, _b, c, e) => gdpNow(i, e.ref) - c }]),
  target("claims", "Initial Jobless Claims", "Initial Jobless Claims", "K", 8, [], -1),
  target("ism_mfg", "ISM Manufacturing PMI", "ISM Manufacturing PMI", "pt", 1),
];

function featureRow(t: Target, inputs: Inputs, month: string, before: string, consensus: number, e: Release): number[] {
  return t.features.map((f) => f.value(inputs, month, before, consensus, e));
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
      return { date: e.date, month, x: featureRow(t, inputs, month, e.date, e.forecast!, e), consensus: e.forecast!, actual: e.actual! };
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

export type Prediction = { date: string; month: string; consensus: number; actual: number; lo: number; mid: number; hi: number };

/**
 * Walk-forward: from the 36th release on, each predicted by models trained only on the releases
 * before it (refitted every six releases, or every twentieth for a weekly one; between refits the
 * last fit is used). Surprises.
 */
export function walkForward(data: Row[], params: GbmParams = ENGINE_PARAMS): Prediction[] {
  // The same releases give the same predictions: the engine, the reactions and the H-30 test all
  // ask for them, every few minutes.
  const key = `${JSON.stringify(params)}|${data.length}|${data[0]?.date}|${data.at(-1)?.date}|${data.at(-1)?.x.join(",")}|${data.at(-1)?.actual}`;
  const hit = walkMemo.get(key);
  if (hit) return hit;
  const out = walkForwardFresh(data, params);
  walkMemo.set(key, out);
  if (walkMemo.size > 64) walkMemo.delete(walkMemo.keys().next().value!);
  return out;
}

const walkMemo = new Map<string, Prediction[]>();

function walkForwardFresh(data: Row[], params: GbmParams): Prediction[] {
  const out: Prediction[] = [];
  // Refitted every six releases, or every twentieth of them for a weekly one (jobless claims).
  const every = Math.max(6, Math.round(data.length / 20));
  let band: ReturnType<typeof fitBand> | null = null;
  let medians: number[] = [];
  for (let i = 36; i < data.length; i++) {
    if (!band || (i - 36) % every === 0) {
      const train = impute(data.slice(0, i).map((r) => r.x));
      medians = train.medians;
      band = fitBand(train.X, data.slice(0, i).map((r) => r.actual - r.consensus), params);
    }
    const r = data[i];
    const [lo, mid, hi] = predictBand(band, fill(r.x, medians));
    out.push({ date: r.date, month: r.month, consensus: r.consensus, actual: r.actual, lo, mid, hi });
  }
  return out;
}

/** The engine's side for a surprise: hawkish, dovish or neither, on the gap as shown. */
export function biasOf(t: Target, surprise: number): Bias {
  // Called on the gap as shown (to 0.01 pp, or 1K): 0.599 against 0.5 reads as 0.60, a 0.1 gap.
  const shown = t.unit === "K" ? Math.round(surprise) : Math.round(surprise * 100) / 100;
  const signed = shown * t.hawk;
  return signed >= t.hot ? "hawkish" : signed <= -t.hot ? "dovish" : "neutral";
}

export function backtest(t: Target, data: Row[], params: GbmParams = ENGINE_PARAMS): Backtest {
  const preds = walkForward(data, params);
  let eEng = 0;
  let eCon = 0;
  let inside = 0;
  let calls = 0;
  let hits = 0;
  for (const p of preds) {
    const s = p.actual - p.consensus;
    eEng += Math.abs(s - p.mid);
    eCon += Math.abs(s);
    if (s >= p.lo && s <= p.hi) inside++;
    if (Math.abs(p.mid) >= t.hot && s !== 0) {
      calls++;
      if (Math.sign(p.mid) === Math.sign(s)) hits++;
    }
  }
  const n = preds.length;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    months: n,
    from: preds[0]?.month ?? null,
    maeEngine: r3(n ? eEng / n : 0),
    maeConsensus: r3(n ? eCon / n : 0),
    coverage: r3(n ? inside / n : 0),
    calls,
    hits,
    medianSpread: r3(quantile(preds.map((p) => p.hi - p.lo), 0.5)),
  };
}

export type Bias = "hawkish" | "dovish" | "neutral";
export type Snapshot = { at: string; p10: number; p50: number; p90: number; adjusted: number; consensus: number; sentiment: number | null };

export type EngineRow = {
  key: string;
  label: string;
  unit: Unit;
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
  waiting: Array<{ key: string; label: string; unit: Unit; period: string; release: string; backtest: Backtest }>; recent: Array<{ key: string; label: string; unit: Unit; period: string; release: string; consensus: number; actual: number; h30: Snapshot }> ; source: string };

const round = (v: number, unit: Unit) => (unit === "K" ? Math.round(v) : Math.round(v * 1000) / 1000);

function loadSnapshots(): Record<string, Snapshot> {
  return readJson<Record<string, Snapshot>>(join(dir, "h30.json")) ?? {};
}

/**
 * The next release of each target: its band now, with the inputs as they stand (and the band kept
 * at H-30 once inside the last half hour), and the targets' out-of-sample track records.
 */
/** Inputs set by hand (the CLI's --set name=value), by feature name, for every target that has it. */
export type Overrides = Record<string, number>;

export function runEngine(inputs: Inputs, sentiment: { index: number; at: string; title: string } | null, now = Date.now(), overrides: Overrides = {}): Engine {
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
      if (due) waiting.push({ key: t.key, label: t.label, unit: t.unit, period: due.ref.slice(0, 7), release: due.date, backtest: bt });
      continue;
    }
    const month = next.ref.slice(0, 7);
    const before = new Date(Math.min(now, Date.parse(next.date))).toISOString();
    const x = featureRow(t, inputs, month, before, next.forecast!, next).map((v, j) => overrides[t.features[j].name] ?? v);
    const [lo, mid, hi] = predictBand(band, fill(x, train.medians));
    const spread = hi - lo;
    const sd = Math.sqrt(data.reduce((n, r) => n + (r.actual - r.consensus) ** 2, 0) / data.length);
    const fresh = sentiment && now - Date.parse(sentiment.at) < 14 * 86_400_000 ? sentiment : null;
    // A hawkish Fed leans the print the hawkish way (up for inflation, down for unemployment).
    const adjustment = fresh ? fresh.index * 0.25 * sd * t.hawk : 0;
    const adjustedSurprise = mid + adjustment;
    const bias = biasOf(t, adjustedSurprise);
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
    source: "Quantile gradient boosting (P10/P50/P90) on point-in-time data: TradingView economic calendar (first prints, consensus) since 2013, Atlanta Fed GDPNow and retail gasoline (FRED)",
  };
}

export const MARKET_IDS = ["GASREGW", "GDPNOW"];

/** The engine's data: the releases and the market series, as kept on disk. */
export async function engineInputs(now = Date.now()): Promise<Inputs> {
  const [releases, markets] = await Promise.all([usReleases(now), marketSeries(MARKET_IDS, now)]);
  return { releases, markets };
}

export async function engine(sentiment: { index: number; at: string; title: string } | null, now = Date.now()): Promise<Engine> {
  return runEngine(await engineInputs(now), sentiment, now);
}

/**
 * Keeps the H-30 bands without anyone looking: every five minutes, when a target's release is due
 * within 35 minutes, the engine runs (and keeps the band once inside the last half hour).
 */
export function startEngineWatch(sentiment: () => { index: number; at: string; title: string } | null, also?: (engine: Engine, inputs: Inputs) => Promise<unknown>): void {
  const check = () => {
    const store = readJson<Record<string, { events: Release[] }>>(join(dir, "us-releases.json"));
    if (!store) return;
    const now = Date.now();
    const titles = new Set(TARGETS.map((t) => t.title));
    const due = Object.values(store).some((c) => c.events.some((e) => titles.has(e.title) && e.forecast !== null && Date.parse(e.date) > now && Date.parse(e.date) - now <= 35 * 60_000));
    if (!due) return;
    engineInputs()
      .then(async (inputs) => {
        const e = runEngine(inputs, sentiment());
        if (also) await also(e, inputs);
      })
      .catch((err) => console.warn("macro engine:", err instanceof Error ? err.message : err));
  };
  setInterval(check, 5 * 60_000).unref();
}
