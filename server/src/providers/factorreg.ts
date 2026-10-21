// Multi-factor regression of the chart's pair on the market's big drivers: how much of the pair's
// daily (or weekly) move goes with the S&P 500, the dollar, the 10-year yield, the VIX, gold, oil
// and bitcoin, each holding the others fixed.
//
//   pair return_t = a + b1·S&P_t + b2·DXY_t + b3·Δyield_t + … + e_t      (ordinary least squares)
//
// Returns are log returns in percent, the yield its change in basis points, on the days every
// series traded. Standard errors are Newey-West (heteroskedasticity- and autocorrelation-robust),
// so a t-statistic isn't flattered by the volatility clustering every market has; VIF flags
// factors too alike to tell apart. Read honestly, this is a sensitivity (what moves WITH the pair
// the same day), not a forecast: the same factors a day earlier are tested separately, out of
// sample, and the result is shown as it comes out.

import { cached } from "../cache.js";
import { tvHistory } from "../tvhistory.js";
import { pairContext } from "./paircontext.js";
import * as tvchart from "./tvchart.js";

export type Factor = { key: string; label: string; tv: string; unit: "%" | "bp" };

export const FACTORS: Factor[] = [
  { key: "spx", label: "S&P 500", tv: "TVC:SPX", unit: "%" },
  { key: "dxy", label: "Indeks dolar (DXY)", tv: "TVC:DXY", unit: "%" },
  { key: "us10y", label: "Yield AS 10 tahun", tv: "TVC:US10Y", unit: "bp" },
  { key: "vix", label: "VIX", tv: "TVC:VIX", unit: "%" },
  { key: "gold", label: "Emas", tv: "OANDA:XAUUSD", unit: "%" },
  { key: "oil", label: "Minyak WTI", tv: "TVC:USOIL", unit: "%" },
  { key: "btc", label: "Bitcoin", tv: "BITSTAMP:BTCUSD", unit: "%" },
];

// ---------------------------------------------------------------- linear algebra (small k)

/** The inverse of a small symmetric positive-definite matrix (Gauss-Jordan with pivoting); null if singular. */
export function invert(m: number[][]): number[][] | null {
  const k = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * k; j++) a[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * k; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(k));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

/** The standard normal distribution function (Abramowitz & Stegun 26.2.17, error < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export type Ols = {
  /** Intercept first, then one per column of X. */
  coef: number[];
  se: number[];
  t: number[];
  p: number[];
  r2: number;
  adjR2: number;
  residSd: number;
  n: number;
  resid: number[];
};

/**
 * Ordinary least squares of y on X (an intercept is added), with Newey-West standard errors over
 * `lags` lags (Bartlett weights); `lags` defaults to the usual 4·(n/100)^(2/9).
 */
export function ols(X: number[][], y: number[], lags?: number): Ols | null {
  const n = y.length;
  const k = (X[0]?.length ?? 0) + 1;
  if (n <= k + 2) return null;
  const Z = X.map((row) => [1, ...row]);
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: k }, (_, i) => Z.reduce((s, r, t) => s + r[i] * y[t], 0));
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const resid = Z.map((r, t) => y[t] - r.reduce((s, v, j) => s + v * coef[j], 0));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const ym = mean(y);
  const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 0;

  // Newey-West: the "meat" S = Σ e² x xᵀ + Σ_l w_l Σ e_t e_{t−l} (x_t x_{t−l}ᵀ + x_{t−l} x_tᵀ).
  const L = lags ?? Math.floor(4 * (n / 100) ** (2 / 9));
  const S = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let t = 0; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += resid[t] * resid[t] * Z[t][i] * Z[t][j];
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    for (let t = l; t < n; t++) {
      const ee = resid[t] * resid[t - l] * w;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += ee * (Z[t][i] * Z[t - l][j] + Z[t - l][i] * Z[t][j]);
    }
  }
  const scale = n / (n - k);
  const cov = inv.map((row, i) => inv.map((_, j) => row.reduce((s, a, r) => s + a * S[r].reduce((s2, b, c) => s2 + b * inv[c][j], 0), 0) * scale));
  const se = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const t = coef.map((c, i) => (se[i] > 0 ? c / se[i] : 0));
  return {
    coef,
    se,
    t,
    p: t.map((v) => 2 * (1 - normalCdf(Math.abs(v)))),
    r2,
    adjR2: 1 - ((1 - r2) * (n - 1)) / (n - k),
    residSd: Math.sqrt(sse / (n - k)),
    n,
    resid,
  };
}

/** Each column's variance inflation factor: 1 / (1 − R² of it on the others); above ~5 the factors overlap. */
export function vifs(X: number[][]): number[] {
  const k = X[0]?.length ?? 0;
  return Array.from({ length: k }, (_, j) => {
    if (k < 2) return 1;
    const fit = ols(
      X.map((r) => r.filter((_, c) => c !== j)),
      X.map((r) => r[j]),
      0,
    );
    return fit && fit.r2 < 1 ? 1 / (1 - fit.r2) : Infinity;
  });
}

// ---------------------------------------------------------------- data

/** A bar's trading day: its time plus nine hours, so a session opening the evening before (futures, forex) or late in UTC (US stocks) lands on its own date. */
export const dayOf = (sec: number) => new Date(sec * 1000 + 9 * 3_600_000).toISOString().slice(0, 10);

/** ISO week of a date (YYYY-Www), for weekly returns. */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Series = Map<string, number>;

/**
 * The returns of each series between consecutive dates that every series has (weekly: the last such
 * date of each week); a yield's as its change in basis points, the rest as log returns in percent.
 */
export function alignedReturns(series: Record<string, Series>, units: Record<string, "%" | "bp">, freq: "daily" | "weekly"): { dates: string[]; returns: Record<string, number[]> } {
  const keys = Object.keys(series);
  let dates = [...series[keys[0]].keys()].filter((d) => keys.every((k) => series[k].has(d))).sort();
  if (freq === "weekly") {
    const lastOfWeek = new Map<string, string>();
    for (const d of dates) lastOfWeek.set(weekOf(d), d);
    dates = [...lastOfWeek.values()].sort();
  }
  const returns: Record<string, number[]> = {};
  for (const k of keys) {
    const s = series[k];
    returns[k] = dates.slice(1).map((d, i) => {
      const a = s.get(dates[i])!;
      const b = s.get(d)!;
      return units[k] === "bp" ? (b - a) * 100 : Math.log(b / a) * 100;
    });
  }
  return { dates: dates.slice(1), returns };
}

export type FactorRow = Factor & { beta: number; se: number; t: number; p: number; stdBeta: number; vif: number; betaEarly: number | null; betaLate: number | null };

export type Regression = {
  symbol: string;
  label: string;
  freq: "daily" | "weekly";
  n: number;
  from: string;
  to: string;
  factors: FactorRow[];
  dropped: Array<{ key: string; label: string; why: string }>;
  intercept: { value: number; t: number; p: number };
  r2: number;
  adjR2: number;
  residSd: number;
  /** Fitted on the first 70%, the R² it keeps on the last 30% (how stable the sensitivity is). */
  oosR2: number | null;
  /** The same factors one period earlier (and the pair's own last move) for the next period's move, out of sample. */
  predictive: { oosR2: number; hit: number; baseHit: number; n: number } | null;
  /** The last period: the pair's move, what the factors' moves account for, factor by factor. */
  latest: { date: string; actual: number; fitted: number; parts: Array<{ key: string; label: string; move: number; contribution: number }> } | null;
  asOf: number;
};

const SAME_ASSET = 0.97;

/** The whole analysis from the pair's and the factors' closes (exported for the tests). */
export function analyse(symbol: string, label: string, pair: Series, factorCloses: Record<string, Series>, freq: "daily" | "weekly", now = Date.now()): Regression | null {
  const dropped: Regression["dropped"] = [];
  let usable = FACTORS.filter((f) => {
    const s = factorCloses[f.key];
    if (!s || s.size < 60) {
      dropped.push({ key: f.key, label: f.label, why: "data tidak tersedia" });
      return false;
    }
    return true;
  });
  const units: Record<string, "%" | "bp"> = { y: "%", ...Object.fromEntries(usable.map((f) => [f.key, f.unit])) };
  let { dates, returns } = alignedReturns({ y: pair, ...Object.fromEntries(usable.map((f) => [f.key, factorCloses[f.key]])) }, units, freq);
  // A factor that is the pair itself (gold for XAUUSD) explains it trivially: left out.
  const corr = (a: number[], b: number[]) => {
    const ma = mean(a);
    const mb = mean(b);
    const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
    return cov / Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0));
  };
  usable = usable.filter((f) => {
    if (Math.abs(corr(returns.y, returns[f.key])) > SAME_ASSET) {
      dropped.push({ key: f.key, label: f.label, why: "sama dengan pair ini (korelasi > 0,97)" });
      return false;
    }
    return true;
  });
  const y = returns.y;
  if (y.length < 40 || usable.length === 0) return null;
  // Days with a broken print (a roll, a gap) would dominate least squares: beyond 8 robust deviations, out.
  const mad = (xs: number[]) => {
    const m = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    return [...xs.map((x) => Math.abs(x - m))].sort((a, b) => a - b)[Math.floor(xs.length / 2)] * 1.4826 || 1;
  };
  const limits = Object.fromEntries(["y", ...usable.map((f) => f.key)].map((k) => [k, 8 * mad(returns[k])]));
  const keep = y.map((_, i) => ["y", ...usable.map((f) => f.key)].every((k) => Math.abs(returns[k][i]) <= limits[k]));
  const idx = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  dates = idx.map((i) => dates[i]);
  returns = Object.fromEntries(Object.entries(returns).map(([k, v]) => [k, idx.map((i) => v[i])]));

  const Y = returns.y;
  const X = Y.map((_, i) => usable.map((f) => returns[f.key][i]));
  const fit = ols(X, Y);
  if (!fit) return null;
  const vif = vifs(X);
  const half = Math.floor(Y.length / 2);
  const early = ols(X.slice(0, half), Y.slice(0, half));
  const late = ols(X.slice(half), Y.slice(half));
  const sdY = sd(Y);

  // Out of sample: the same-period fit's R² on the last 30%.
  const cut = Math.floor(Y.length * 0.7);
  const train = ols(X.slice(0, cut), Y.slice(0, cut));
  let oosR2: number | null = null;
  if (train && Y.length - cut >= 20) {
    const yTrain = mean(Y.slice(0, cut));
    let sse = 0;
    let sst = 0;
    for (let i = cut; i < Y.length; i++) {
      const f = train.coef[0] + X[i].reduce((s, v, j) => s + v * train.coef[j + 1], 0);
      sse += (Y[i] - f) ** 2;
      sst += (Y[i] - yTrain) ** 2;
    }
    oosR2 = sst > 0 ? 1 - sse / sst : null;
  }

  // Predictive: yesterday's factor moves and the pair's own, for today's move.
  let predictive: Regression["predictive"] = null;
  const PX = X.slice(0, -1).map((row, i) => [...row, Y[i]]);
  const PY = Y.slice(1);
  const pcut = Math.floor(PY.length * 0.7);
  const ptrain = ols(PX.slice(0, pcut), PY.slice(0, pcut));
  if (ptrain && PY.length - pcut >= 20) {
    const base = mean(PY.slice(0, pcut));
    let sse = 0;
    let sst = 0;
    let hits = 0;
    let ups = 0;
    for (let i = pcut; i < PY.length; i++) {
      const f = ptrain.coef[0] + PX[i].reduce((s, v, j) => s + v * ptrain.coef[j + 1], 0);
      sse += (PY[i] - f) ** 2;
      sst += (PY[i] - base) ** 2;
      if (Math.sign(f) === Math.sign(PY[i])) hits++;
      if (PY[i] > 0) ups++;
    }
    const m = PY.length - pcut;
    predictive = { oosR2: sst > 0 ? 1 - sse / sst : 0, hit: (hits / m) * 100, baseHit: (Math.max(ups, m - ups) / m) * 100, n: m };
  }

  const last = X.length - 1;
  const parts = usable.map((f, j) => ({ key: f.key, label: f.label, move: X[last][j], contribution: fit.coef[j + 1] * X[last][j] }));
  return {
    symbol,
    label,
    freq,
    n: Y.length,
    from: dates[0],
    to: dates[last],
    factors: usable.map((f, j) => ({
      ...f,
      beta: fit.coef[j + 1],
      se: fit.se[j + 1],
      t: fit.t[j + 1],
      p: fit.p[j + 1],
      stdBeta: sdY > 0 ? (fit.coef[j + 1] * sd(X.map((r) => r[j]))) / sdY : 0,
      vif: vif[j],
      betaEarly: early ? early.coef[j + 1] : null,
      betaLate: late ? late.coef[j + 1] : null,
    })),
    dropped,
    intercept: { value: fit.coef[0], t: fit.t[0], p: fit.p[0] },
    r2: fit.r2,
    adjR2: fit.adjR2,
    residSd: fit.residSd,
    oosR2,
    predictive,
    latest: { date: dates[last], actual: Y[last], fitted: fit.coef[0] + parts.reduce((s, p) => s + p.contribution, 0), parts },
    asOf: now,
  };
}

const toSeries = (bars: Array<{ time: number; close: number }> | null | undefined): Series => {
  const m: Series = new Map();
  for (const b of bars ?? []) if (Number.isFinite(b.close) && b.close > 0) m.set(dayOf(b.time), b.close);
  return m;
};

/** The pair's regression over about three years of daily closes (weekly: the same years by week);
 *  five minutes in the cache, so the latest move (today's bar, still forming) stays current. */
export function factorRegression(symbol: string, freq: "daily" | "weekly"): Promise<Regression> {
  const s = symbol.toUpperCase();
  return cached(`factorreg:${s}:${freq}`, 5 * 60_000, async () => {
    const [ctx, pairBars, factorBars] = await Promise.all([
      pairContext(s).catch(() => null),
      tvHistory(s, "1D"),
      tvchart.bars(FACTORS.map((f) => f.tv), "1D", 1200, 20_000),
    ]);
    // About three years: enough days to be sure of a beta, recent enough to still describe the pair.
    const since = Date.now() / 1000 - 3 * 365 * 86_400;
    const pair = toSeries(pairBars.filter((b) => b.time >= since));
    if (pair.size < 60) throw new Error(`riwayat harian ${s} terlalu pendek untuk regresi`);
    const closes = Object.fromEntries(FACTORS.map((f) => [f.key, toSeries((factorBars[f.tv] ?? []).filter((b) => b.time >= since))]));
    const out = analyse(s, ctx?.label ?? s, pair, closes, freq);
    if (!out) throw new Error("data bersama terlalu sedikit untuk regresi");
    return out;
  });
}
