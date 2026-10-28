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
import { coreOf, pairContext } from "./paircontext.js";
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

/**
 * For a currency pair, the main driver the US-centred factors miss: the gap between its two
 * countries' short rates. Money goes where it earns more, so the base currency's 2-year yield
 * rising against the quote currency's tends to lift the pair. Each currency's 2-year government
 * yield on TradingView (the euro area's as Germany's, Indonesia's 3-year where no 2-year is listed).
 */
export const YIELD_2Y: Record<string, { tv: string; tenor: string }> = {
  USD: { tv: "TVC:US02Y", tenor: "2 th" }, EUR: { tv: "TVC:DE02Y", tenor: "2 th" }, GBP: { tv: "TVC:GB02Y", tenor: "2 th" },
  JPY: { tv: "TVC:JP02Y", tenor: "2 th" }, AUD: { tv: "TVC:AU02Y", tenor: "2 th" }, CAD: { tv: "TVC:CA02Y", tenor: "2 th" },
  CHF: { tv: "TVC:CH02Y", tenor: "2 th" }, NZD: { tv: "TVC:NZ02Y", tenor: "2 th" }, CNY: { tv: "TVC:CN02Y", tenor: "2 th" },
  CNH: { tv: "TVC:CN02Y", tenor: "2 th" }, SGD: { tv: "TVC:SG02Y", tenor: "2 th" }, INR: { tv: "TVC:IN02Y", tenor: "2 th" },
  KRW: { tv: "TVC:KR02Y", tenor: "2 th" }, HKD: { tv: "TVC:HK02Y", tenor: "2 th" }, IDR: { tv: "TVC:ID03Y", tenor: "3 th" },
};

/** The pair's rate-differential factor (base − quote), or null when it isn't a pair of two listed currencies. */
export function rateDiffFactor(currencies: string[]): (Factor & { base: string; quote: string }) | null {
  if (currencies.length !== 2) return null;
  const [base, quote] = currencies;
  const a = YIELD_2Y[base];
  const b = YIELD_2Y[quote];
  if (!a || !b || a.tv === b.tv) return null;
  const tenor = a.tenor === b.tenor ? a.tenor : `${a.tenor}/${b.tenor}`;
  return { key: "ratediff", label: `Selisih yield ${tenor} ${base}−${quote}`, tv: `${a.tv}-${b.tv}`, unit: "bp", base, quote };
}

/** One yield minus another on the days both have (in percent; a level, negative allowed). */
export function spreadSeries(a: Series, b: Series): Series {
  const out: Series = new Map();
  for (const [d, v] of a) {
    const w = b.get(d);
    if (w != null) out.set(d, v - w);
  }
  return out;
}

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

export type Fold = { from: string; to: string; n: number; trainR2: number; testR2: number; testR2Simple: number | null };
export type ModelSize = { keys: string[]; k: number; aic: number; bic: number; adjR2: number; trainR2: number | null; testR2: number | null; cvR2: number | null };
export type Overfit = {
  /** Fitted on the first 70%: its R² there, and on the 30% after. */
  trainR2: number;
  testR2: number;
  gap: number;
  /** ok: the test holds up; watch: some drop; overfit: the full model drops where a simpler one holds;
   *  shift: both drop alike, so the relationship itself changed (not too many factors). */
  verdict: "ok" | "watch" | "overfit" | "shift";
  /** Expanding-window (walk-forward) cross-validation: train on everything before a block, test on the block. */
  cv: { folds: Fold[]; meanTest: number; sdTest: number; meanTestSimple: number | null };
  /** The full model against one with only the factors significant in the training data. */
  complexity: { full: ModelSize; simple: ModelSize | null; preferred: "full" | "simple" };
};

export type Ohlcv = { open: number; high: number; low: number; close: number; volume: number };

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
  /** Is the fit overfitted? Training against testing R², walk-forward cross-validation, and the full model against a simpler one. */
  overfit: Overfit | null;
  /** Plain OLS against winsorizing, Huber's robust fit and volatility-weighted WLS, walk-forward. */
  transforms: Transforms | null;
  /** Each factor's beta over a moving window: how the sensitivity has changed. */
  rolling: RollingBetas | null;
  /** Newey-West lags used for the standard errors (for the SAS script to match). */
  nwLags: number;
  /** The data the fit used, period by period (for the CSV download; not sent with the JSON). */
  rows?: { dates: string[]; y: number[]; x: Record<string, number[]>; ohlcv?: Array<Ohlcv | null> };
  asOf: number;
};

const SAME_ASSET = 0.97;

/** The whole analysis from the pair's and the factors' closes (exported for the tests). */
export function analyse(symbol: string, label: string, pair: Series, factorCloses: Record<string, Series>, freq: "daily" | "weekly", now = Date.now(), factors: Factor[] = FACTORS): Regression | null {
  const dropped: Regression["dropped"] = [];
  let usable = factors.filter((f) => {
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
    overfit: overfitChecks(X, Y, dates, usable.map((f) => f.key)),
    transforms: transformChecks(X, Y, usable.map((f) => f.key)),
    // About half a year of days (every 5th day), or a year of weeks.
    rolling: freq === "weekly" ? rollingBetas(X, Y, dates, usable.map((f) => f.key), 52, 1) : rollingBetas(X, Y, dates, usable.map((f) => f.key), 120, 5),
    nwLags: Math.floor(4 * (Y.length / 100) ** (2 / 9)),
    rows: { dates, y: Y, x: Object.fromEntries(usable.map((f, j) => [f.key, X.map((r) => r[j])])) },
    asOf: now,
  };
}

// ---------------------------------------------------------------- overfitting checks

const predictRow = (coef: number[], row: number[], cols: number[]) => coef[0] + cols.reduce((s2, c, j) => s2 + coef[j + 1] * row[c], 0);
const pick = (X: number[][], cols: number[]) => X.map((r) => cols.map((c) => r[c]));

/** R² of a fit on other data, against a given mean (the training mean, for a test set). */
function r2On(coef: number[], X: number[][], Y: number[], cols: number[], ref: number): number {
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < Y.length; i++) {
    sse += (Y[i] - predictRow(coef, X[i], cols)) ** 2;
    sst += (Y[i] - ref) ** 2;
  }
  return sst > 0 ? 1 - sse / sst : 0;
}

/** The columns significant (p < 0.05, Newey-West) in a fit on this data; all of them if none is. */
function significantCols(X: number[][], Y: number[], cols: number[]): number[] {
  const fit = ols(pick(X, cols), Y);
  if (!fit) return cols;
  const sig = cols.filter((_, j) => fit.p[j + 1] < 0.05);
  return sig.length ? sig : cols;
}

/** A fit's AIC and BIC (Gaussian, from its residuals; k counts the intercept). */
export function infoCriteria(sse: number, n: number, k: number): { aic: number; bic: number } {
  const ll = n * Math.log(Math.max(sse, 1e-12) / n);
  return { aic: ll + 2 * k, bic: ll + k * Math.log(n) };
}

/**
 * Overfitting checks on a fit's data (rows in time order): training vs testing R² on a 70/30
 * split, walk-forward cross-validation in `folds` blocks after the first, and the full model
 * against a simpler one keeping only the factors significant in the training data (chosen inside
 * each training set, so the test never helps choose).
 */
export function overfitChecks(X: number[][], Y: number[], dates: string[], keys: string[], folds = 5): Overfit | null {
  const n = Y.length;
  const all = keys.map((_, j) => j);
  const cut = Math.floor(n * 0.7);
  if (n - cut < 20 || cut < all.length + 10) return null;
  const train = ols(pick(X.slice(0, cut), all), Y.slice(0, cut));
  if (!train) return null;
  const trainMean = mean(Y.slice(0, cut));
  const testR2 = r2On(train.coef, X.slice(cut), Y.slice(cut), all, trainMean);
  const gap = train.r2 - testR2;

  // Walk-forward: blocks 1 … folds, each tested on a model trained on everything before it.
  const size = Math.floor(n / (folds + 1));
  const foldRows: Fold[] = [];
  for (let k = 1; k <= folds; k++) {
    const a = k * size;
    const b = k === folds ? n : (k + 1) * size;
    if (b - a < 10 || a < all.length + 10) continue;
    const Xt = X.slice(0, a);
    const Yt = Y.slice(0, a);
    const fit = ols(pick(Xt, all), Yt);
    if (!fit) continue;
    const m = mean(Yt);
    const simpleCols = significantCols(Xt, Yt, all);
    const simple = simpleCols.length < all.length ? ols(pick(Xt, simpleCols), Yt) : null;
    foldRows.push({
      from: dates[a],
      to: dates[b - 1],
      n: b - a,
      trainR2: fit.r2,
      testR2: r2On(fit.coef, X.slice(a, b), Y.slice(a, b), all, m),
      testR2Simple: simple ? r2On(simple.coef, X.slice(a, b), Y.slice(a, b), simpleCols, m) : null,
    });
  }
  const tests = foldRows.map((f) => f.testR2);
  const meanTest = tests.length ? mean(tests) : 0;
  const simpleTests = foldRows.map((f) => f.testR2Simple ?? f.testR2);
  const anySimple = foldRows.some((f) => f.testR2Simple != null);

  // The full model and the simple one on the whole sample (AIC/BIC), and on the 70/30 split.
  const sizeOf = (cols: number[], cvR2: number | null): ModelSize | null => {
    const fit = ols(pick(X, cols), Y);
    const tr = ols(pick(X.slice(0, cut), cols), Y.slice(0, cut));
    if (!fit) return null;
    const sse = fit.resid.reduce((s2, e) => s2 + e * e, 0);
    const k = cols.length + 1;
    return {
      keys: cols.map((c) => keys[c]),
      k,
      ...infoCriteria(sse, n, k),
      adjR2: fit.adjR2,
      trainR2: tr ? tr.r2 : null,
      testR2: tr ? r2On(tr.coef, X.slice(cut), Y.slice(cut), cols, trainMean) : null,
      cvR2,
    };
  };
  const full = sizeOf(all, tests.length ? meanTest : null)!;
  const simpleCols = significantCols(X.slice(0, cut), Y.slice(0, cut), all);
  const simple = simpleCols.length < all.length ? sizeOf(simpleCols, anySimple ? mean(simpleTests) : null) : null;
  const preferred = simple && simple.bic < full.bic && (simple.cvR2 ?? -Infinity) >= (full.cvR2 ?? -Infinity) - 0.005 ? "simple" : "full";
  // A big drop is overfitting only if a simpler model holds up better on the same test data;
  // if it drops just as much, the market's relationship changed.
  const simpleHolds =
    simple?.testR2 != null && simple.trainR2 != null && simple.testR2 > testR2 + 0.03 && simple.trainR2 - simple.testR2 < gap / 2;
  const verdict: Overfit["verdict"] = testR2 < 0 || gap > 0.15 ? (simpleHolds ? "overfit" : "shift") : gap > 0.05 ? (simpleHolds ? "overfit" : "watch") : "ok";

  return {
    trainR2: train.r2,
    testR2,
    gap,
    verdict,
    cv: { folds: foldRows, meanTest, sdTest: tests.length > 1 ? sd(tests) : 0, meanTestSimple: anySimple ? mean(simpleTests) : null },
    complexity: { full, simple, preferred },
  };
}

// ---------------------------------------------------------------- transformations and rolling betas

export type TransformKey = "ols" | "winsor" | "huber" | "wls";

export const TRANSFORMS: Array<{ key: TransformKey; label: string; note: string }> = [
  { key: "ols", label: "OLS biasa", note: "Kuadrat terkecil apa adanya: yang dipakai tabel beta di atas." },
  { key: "winsor", label: "Winsorize 1%/99%", note: "Return di luar persentil 1 dan 99 data latih dipotong ke batas itu, jadi hari ekstrem tidak menarik beta." },
  { key: "huber", label: "Robust (Huber)", note: "Hari dengan sisa besar diberi bobot lebih kecil (IRLS, c = 1,345): tahan pencilan tanpa membuangnya." },
  { key: "wls", label: "WLS bobot volatilitas", note: "Tiap periode diberi bobot 1/σ², σ = simpangan baku pair 20 periode sebelumnya, jadi masa bergejolak tidak mendominasi." },
];

export type TransformRow = { key: TransformKey; label: string; note: string; cvR2: number; wins: number; folds: number; betas: Record<string, number> };
export type Transforms = {
  rows: TransformRow[];
  /** The best by walk-forward R², and whether it beat plain OLS consistently enough to prefer. */
  best: TransformKey;
  better: boolean;
};

export type RollingBetas = { window: number; step: number; dates: string[]; betas: Record<string, number[]>; r2: number[] };

/** Weighted least squares coefficients (intercept first); null when singular. */
export function wlsCoef(X: number[][], y: number[], w: number[]): number[] | null {
  const k = (X[0]?.length ?? 0) + 1;
  const Z = X.map((row) => [1, ...row]);
  const a = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r, t) => s + w[t] * r[i] * r[j], 0)));
  const inv = invert(a);
  if (!inv) return null;
  const b = Array.from({ length: k }, (_, i) => Z.reduce((s, r, t) => s + w[t] * r[i] * y[t], 0));
  return inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]) => quantile(xs, 0.5);

/** A fitted transformation: its coefficients, and how a row of factors is prepared before predicting with them. */
type Fitted = { coef: number[]; prep: (row: number[]) => number[] };

/** Fits y on X the given way (on training data only: the clips and weights come from it). */
export function fitTransform(key: TransformKey, X: number[][], Y: number[]): Fitted | null {
  const same = (row: number[]) => row;
  if (key === "ols") {
    const f = ols(X, Y, 0);
    return f ? { coef: f.coef, prep: same } : null;
  }
  if (key === "winsor") {
    const k = X[0]?.length ?? 0;
    const lo = Array.from({ length: k }, (_, j) => quantile(X.map((r) => r[j]), 0.01));
    const hi = Array.from({ length: k }, (_, j) => quantile(X.map((r) => r[j]), 0.99));
    const prep = (row: number[]) => row.map((v, j) => clip(v, lo[j], hi[j]));
    const yLo = quantile(Y, 0.01);
    const yHi = quantile(Y, 0.99);
    const f = ols(X.map(prep), Y.map((v) => clip(v, yLo, yHi)), 0);
    return f ? { coef: f.coef, prep } : null;
  }
  if (key === "huber") {
    // Iteratively reweighted least squares: residuals beyond c·σ (σ from their median absolute
    // deviation) weigh c·σ/|e| of a normal one.
    const start = ols(X, Y, 0);
    if (!start) return null;
    let coef = start.coef;
    for (let it = 0; it < 50; it++) {
      const r = Y.map((v, t) => v - predictRow(coef, X[t], X[0].map((_, j) => j)));
      const m = median(r);
      const s = median(r.map((e) => Math.abs(e - m))) * 1.4826 || 1;
      const w = r.map((e) => Math.min(1, (1.345 * s) / Math.max(1e-12, Math.abs(e))));
      const next = wlsCoef(X, Y, w);
      if (!next) break;
      const moved = Math.max(...next.map((c, i) => Math.abs(c - coef[i])));
      coef = next;
      if (moved < 1e-7) break;
    }
    return { coef, prep: same };
  }
  // WLS: each period weighed by 1/σ², σ the pair's volatility over the 20 periods before it.
  const WIN = 20;
  const first = sd(Y.slice(0, Math.min(WIN, Y.length))) || 1;
  const w = Y.map((_, t) => {
    const s = t >= WIN ? sd(Y.slice(t - WIN, t)) : first;
    return 1 / Math.max(s * s, 1e-8);
  });
  const coef = wlsCoef(X, Y, w);
  return coef ? { coef, prep: same } : null;
}

/**
 * The transformations against plain OLS on the same walk-forward blocks as the overfitting check
 * (each trained on everything before its block), each judged on the pair's raw returns there: a
 * transformation that only flatters the fit doesn't win. "Better" needs a mean gain of at least
 * 0.01 and a win in most blocks, so one lucky block doesn't decide it.
 */
export function transformChecks(X: number[][], Y: number[], keys: string[], folds = 5): Transforms | null {
  const n = Y.length;
  const size = Math.floor(n / (folds + 1));
  const blocks: Array<[number, number]> = [];
  for (let k = 1; k <= folds; k++) {
    const a = k * size;
    const b = k === folds ? n : (k + 1) * size;
    if (b - a >= 10 && a >= keys.length + 20) blocks.push([a, b]);
  }
  if (blocks.length < 2) return null;
  const scores = new Map<TransformKey, number[]>();
  for (const t of TRANSFORMS) {
    const s: number[] = [];
    for (const [a, b] of blocks) {
      const fit = fitTransform(t.key, X.slice(0, a), Y.slice(0, a));
      if (!fit) {
        s.push(NaN);
        continue;
      }
      const ref = mean(Y.slice(0, a));
      let sse = 0;
      let sst = 0;
      for (let i = a; i < b; i++) {
        const row = fit.prep(X[i]);
        sse += (Y[i] - predictRow(fit.coef, row, row.map((_, j) => j))) ** 2;
        sst += (Y[i] - ref) ** 2;
      }
      s.push(sst > 0 ? 1 - sse / sst : 0);
    }
    scores.set(t.key, s);
  }
  const base = scores.get("ols")!;
  const rows: TransformRow[] = TRANSFORMS.map((t) => {
    const s = scores.get(t.key)!;
    const ok = s.filter(Number.isFinite);
    const full = fitTransform(t.key, X, Y);
    return {
      ...t,
      cvR2: ok.length ? mean(ok) : NaN,
      wins: t.key === "ols" ? 0 : s.filter((v, i) => Number.isFinite(v) && v > base[i] + 0.001).length,
      folds: blocks.length,
      betas: Object.fromEntries(keys.map((k, j) => [k, full ? full.coef[j + 1] : NaN])),
    };
  });
  const ranked = rows.filter((r) => Number.isFinite(r.cvR2)).sort((a, b) => b.cvR2 - a.cvR2);
  const top = ranked[0];
  const plain = rows[0];
  const better = top.key !== "ols" && top.cvR2 - plain.cvR2 >= 0.01 && top.wins > blocks.length / 2;
  return { rows, best: better ? top.key : "ols", better };
}

/** Each factor's beta over a moving window (the multi-factor fit, every `step` periods): how the sensitivity has changed. */
export function rollingBetas(X: number[][], Y: number[], dates: string[], keys: string[], window: number, step: number): RollingBetas | null {
  const n = Y.length;
  if (n < window + 20 || window <= keys.length + 10) return null;
  const out: RollingBetas = { window, step, dates: [], betas: Object.fromEntries(keys.map((k) => [k, []])), r2: [] };
  const ends: number[] = [];
  for (let end = window; end <= n; end += step) ends.push(end);
  if (ends[ends.length - 1] !== n) ends.push(n);
  for (const end of ends) {
    const fit = ols(X.slice(end - window, end), Y.slice(end - window, end), 0);
    if (!fit) continue;
    out.dates.push(dates[end - 1]);
    keys.forEach((k, j) => out.betas[k].push(fit.coef[j + 1]));
    out.r2.push(fit.r2);
  }
  return out.dates.length ? out : null;
}

// ---------------------------------------------------------------- export for SAS (and Excel, R, Python)

const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "");

/** The fit's data as CSV: one row per period, the pair's return and each factor's, short SAS-safe column names. */
export function regressionCsv(r: Regression): string {
  if (!r.rows) return "";
  const keys = r.factors.map((f) => f.key);
  const bars = r.rows.ohlcv;
  const lines = [["date", ...(bars ? ["open", "high", "low", "close", "volume"] : []), "pair", ...keys].join(",")];
  r.rows.dates.forEach((d, i) => {
    const b = bars?.[i];
    const ohlcv = bars ? (b ? [b.open, b.high, b.low, b.close, b.volume].map(num) : ["", "", "", "", ""]) : [];
    lines.push([d, ...ohlcv, num(r.rows!.y[i]), ...keys.map((k) => num(r.rows!.x[k][i]))].join(","));
  });
  return lines.join("\r\n") + "\r\n";
}

/** A SAS program for the CSV: the same OLS (PROC REG, with VIF) and the same Newey-West errors (PROC MODEL, GMM with a Bartlett kernel). */
export function sasProgram(r: Regression, csvName: string): string {
  const keys = r.factors.map((f) => f.key);
  const desc = r.factors.map((f) => `     ${f.key.padEnd(9)} ${f.label} (${f.unit === "bp" ? "perubahan, bp" : "return log, %"})`).join("\n");
  return [
    `/* Regresi multifaktor ${r.symbol} (${r.label}) dari OpenTerminal`,
    `   ${r.freq === "daily" ? "Harian" : "Mingguan"}, ${r.n} periode, ${r.from} s.d. ${r.to}.`,
    `   pair      return log ${r.label}, %`,
    desc,
    `   Ganti path di bawah ke tempat file CSV disimpan. */`,
    ``,
    `proc import datafile="C:\\Users\\Anda\\Downloads\\${csvName}"`,
    `  out=work.reg dbms=csv replace;`,
    `  getnames=yes;`,
    `run;`,
    ``,
    `/* 1. OLS biasa, dengan VIF: koefisien sama dengan di aplikasi. */`,
    `proc reg data=work.reg;`,
    `  model pair = ${keys.join(" ")} / vif;`,
    `run;`,
    `quit;`,
    ``,
    `/* 2. Standar error Newey-West (${r.nwLags} lag, bobot Bartlett), seperti di aplikasi.`,
    `      Hasil t bisa beda sedikit: aplikasi memakai koreksi sampel kecil n/(n-k). */`,
    `proc model data=work.reg;`,
    `  parms b0 ${keys.map((k) => `b_${k}`).join(" ")};`,
    `  pair = b0 + ${keys.map((k) => `b_${k}*${k}`).join(" + ")};`,
    `  fit pair / gmm kernel=(bart, ${r.nwLags}, 0);`,
    `  instruments ${keys.join(" ")};`,
    `run;`,
    `quit;`,
    ``,
    ...overfitSas(keys),
    ...(r.rows?.ohlcv ? predictionSas(r, keys) : []),
  ].join("\r\n");
}

/**
 * The SAS part that checks for overfitting: training vs validation R² on the same time-ordered
 * 70/30 split as the app, and PROC GLMSELECT choosing the factors by SBC (BIC) on the training
 * part with the validation part as the judge, then again with 5-fold blocked cross-validation.
 */
function overfitSas(keys: string[]): string[] {
  return [
    `/* 2b. Cek overfitting.`,
    `      a) Error data latih vs data uji (ASE Train vs ASE Validate): 70% awal melatih, 30% akhir menguji (urut waktu).`,
    `         Overfitting: ASE Validate jauh di atas ASE Train.`,
    `      b) Pilih faktor (stepwise, kriteria SBC/BIC) dengan data uji sebagai penilai.`,
    `      c) Validasi silang 5 blok berurutan (blocked CV; aplikasi memakai walk-forward,`,
    `         jadi angkanya bisa sedikit berbeda, arahnya seharusnya sama). */`,
    `proc sql noprint;`,
    `  select floor(count(*) * 0.7) into :cut70 trimmed from work.reg;`,
    `quit;`,
    `data work.part;`,
    `  set work.reg;`,
    `  length role $8;`,
    `  if _n_ <= &cut70 then role = "TRAIN"; else role = "VALIDATE";`,
    `run;`,
    `proc glmselect data=work.part plots=none;`,
    `  partition rolevar=role(train="TRAIN" validate="VALIDATE");`,
    `  model pair = ${keys.join(" ")} / selection=none stats=(adjrsq aic sbc);`,
    `run;`,
    `proc glmselect data=work.part plots=(criteria);`,
    `  partition rolevar=role(train="TRAIN" validate="VALIDATE");`,
    `  model pair = ${keys.join(" ")} / selection=stepwise(select=sbc choose=validate) stats=(adjrsq aic sbc);`,
    `run;`,
    `proc glmselect data=work.reg plots=none;`,
    `  model pair = ${keys.join(" ")} / selection=stepwise(select=sbc choose=cv) cvmethod=block(5) stats=(adjrsq aic sbc press);`,
    `run;`,
    ``,
  ];
}

/**
 * The SAS part that predicts: features from today's candle (OHLCV) and the factors, the next
 * period's return as the target, fitted on the first 70% and scored on the last 30% (hit rate
 * and out-of-sample R² against the training mean), and a damped-trend forecast of the close.
 */
function predictionSas(r: Regression, keys: string[]): string[] {
  // Forex trades over the counter: no volume reported (all zeros), so no volume feature.
  const hasVolume = Boolean(r.rows?.ohlcv?.some((b) => b && b.volume > 0));
  const features = ["pair", "range", "body", ...(hasVolume ? ["dlvol"] : []), ...keys];
  return [
    `/* 3. Prediksi dari data OHLCV + faktor: return periode berikutnya.`,
    `      Fitur dari candle hari ini: return, rentang high-low, badan candle, perubahan volume.`,
    `      Dilatih di 70% awal, diuji di 30% akhir (di luar sampel). Di aplikasi, uji serupa`,
    `      belum pernah menunjukkan daya ramal yang nyata: anggap ini sebagai uji, bukan sinyal.`,
    ...(hasVolume ? [] : [`      Volume: pasar ini (forex, OTC) tidak melaporkan volume (kolom bernilai 0), jadi tidak dipakai.`]),
    `   */`,
    `data work.pred;`,
    `  merge work.reg work.reg(firstobs=2 keep=pair rename=(pair=pair_next));`,
    `  range = (high - low) / close * 100;       /* rentang high-low, % */`,
    `  body  = (close - open) / open * 100;      /* badan candle, % */`,
    `  lvol  = log(max(volume, 1));`,
    `  dlvol = dif(lvol);                        /* perubahan log volume */`,
    `  if pair_next = . then delete;`,
    `run;`,
    ``,
    `proc sql noprint;`,
    `  select floor(count(*) * 0.7) into :cut trimmed from work.pred;`,
    `quit;`,
    `data work.train work.test;`,
    `  set work.pred;`,
    `  if _n_ <= &cut then output work.train; else output work.test;`,
    `run;`,
    ``,
    `proc reg data=work.train outest=work.est noprint;`,
    `  model pair_next = ${features.join(" ")};`,
    `run;`,
    `quit;`,
    `proc score data=work.test score=work.est out=work.scored type=parms;`,
    `  var ${features.join(" ")};`,
    `run;`,
    ``,
    `proc sql noprint;`,
    `  select mean(pair_next) into :mtrain trimmed from work.train;`,
    `quit;`,
    `data work.eval;`,
    `  set work.scored;`,
    `  hit  = (sign(MODEL1) = sign(pair_next));   /* arah tepat? */`,
    `  e2   = (pair_next - MODEL1)**2;`,
    `  e2b  = (pair_next - &mtrain)**2;          /* tebakan rata-rata (pembanding) */`,
    `run;`,
    `proc sql;`,
    `  title "Uji di luar sampel: arah tepat dan R2 terhadap tebakan rata-rata";`,
    `  select count(*) as periode, mean(hit) as arah_tepat format=percent8.1,`,
    `         1 - sum(e2) / sum(e2b) as r2_luar_sampel format=8.4`,
    `  from work.eval;`,
    `quit;`,
    `title;`,
    ``,
    `/* 4. Tren harga ke depan: exponential smoothing (damped trend), ${r.freq === "daily" ? "20 hari bursa" : "8 minggu"}. */`,
    `proc esm data=work.reg out=work.forecast lead=${r.freq === "daily" ? 20 : 8} plot=forecasts;`,
    `  id date interval=${r.freq === "daily" ? "weekday" : "week"};`,
    `  forecast close / model=damptrend;`,
    `run;`,
    ``,
  ];
}

const toSeries = (bars: Array<{ time: number; close: number }> | null | undefined): Series => {
  const m: Series = new Map();
  for (const b of bars ?? []) if (Number.isFinite(b.close) && b.close > 0) m.set(dayOf(b.time), b.close);
  return m;
};

/**
 * The pair's daily bars. A currency or metal pair picked from a listing with no history of its own
 * (an exchange's EURUSD futures, say) is read from the forex feeds instead.
 */
async function pairHistory(s: string, kind: string | null) {
  const own = await tvHistory(s, "1D").catch(() => []);
  const core = coreOf(s).core;
  if (own.length >= 60 || !(kind === "fx" || kind === "metal") || !/^[A-Z]{6}$/.test(core)) return own;
  for (const alt of [`FX:${core}`, `OANDA:${core}`, `FX_IDC:${core}`]) {
    const bars = await tvHistory(alt, "1D").catch(() => []);
    if (bars.length >= 60) return bars;
  }
  return own;
}

/** The pair's regression over about three years of daily closes (weekly: the same years by week);
 *  five minutes in the cache, so the latest move (today's bar, still forming) stays current. */
export function factorRegression(symbol: string, freq: "daily" | "weekly"): Promise<Regression> {
  const s = symbol.toUpperCase();
  return cached(`factorreg:${s}:${freq}`, 5 * 60_000, async () => {
    const ctx = await pairContext(s).catch(() => null);
    // A currency pair also gets its two countries' rate gap.
    const diff = ctx?.kind === "fx" ? rateDiffFactor(ctx.currencies) : null;
    const yields = diff ? [YIELD_2Y[diff.base].tv, YIELD_2Y[diff.quote].tv] : [];
    const [pairBars, factorBars] = await Promise.all([pairHistory(s, ctx?.kind ?? null), tvchart.bars([...FACTORS.map((f) => f.tv), ...yields], "1D", 1200, 20_000)]);
    // About three years: enough days to be sure of a beta, recent enough to still describe the pair.
    const since = Date.now() / 1000 - 3 * 365 * 86_400;
    const pair = toSeries(pairBars.filter((b) => b.time >= since));
    if (pair.size < 60) throw new Error(`riwayat harian ${s} terlalu pendek untuk regresi`);
    const closes: Record<string, Series> = Object.fromEntries(FACTORS.map((f) => [f.key, toSeries((factorBars[f.tv] ?? []).filter((b) => b.time >= since))]));
    const factors: Factor[] = [...FACTORS];
    if (diff) {
      const recent = (tv: string) => toSeries((factorBars[tv] ?? []).filter((b) => b.time >= since));
      closes.ratediff = spreadSeries(recent(yields[0]), recent(yields[1]));
      factors.push(diff);
    }
    const out = analyse(s, ctx?.label ?? s, pair, closes, freq, Date.now(), factors);
    if (out?.rows) {
      // Each row's own candle for the CSV's OHLCV columns: the day's, or the week's up to that day
      // (its first open, highest high, lowest low, that day's close, the volume summed).
      const byDay = new Map(pairBars.map((b) => [dayOf(b.time), b]));
      out.rows.ohlcv = out.rows.dates.map((d) => {
        const b = byDay.get(d);
        if (!b) return null;
        if (freq === "daily") return { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
        const week = pairBars.filter((x) => weekOf(dayOf(x.time)) === weekOf(d) && dayOf(x.time) <= d);
        return { open: week[0].open, high: Math.max(...week.map((x) => x.high)), low: Math.min(...week.map((x) => x.low)), close: b.close, volume: week.reduce((sum, x) => sum + (x.volume ?? 0), 0) };
      });
    }
    if (!out) throw new Error("data bersama terlalu sedikit untuk regresi");
    return out;
  });
}
