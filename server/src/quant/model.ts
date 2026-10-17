// The quant forecaster: for each market, the chance it is higher in 5, 10 and 20 trading days, from
// three kinds of evidence read the same way for every market:
//
//   - the markets: its own momentum, trend, volatility and range, and the others' (the dollar,
//     yields and the curve, the VIX, stocks, oil, gold, bitcoin), each in units of its own volatility;
//   - the US data: the week's and the month's surprises (macrofeatures.ts, the Live TV's reading);
//   - the sky: what the astrology calendar marks (astrofeatures.ts).
//
// A logistic regression (L2-regularised, on standardised features) per market and horizon, tested
// walk-forward a year at a time: each year forecast by a model fit only on the days whose outcome
// was known before that year began. The same test is run without the sky and without the US data,
// so what each adds (or takes away) out of sample is measured, not assumed.
//
// A forecast counts as a signal only when, out of sample, it beat the plain bet on the market's
// usual side (up, for gold or stocks) by enough not to be chance (one-sided z ≥ 1.64 on the
// independent calls, days ÷ horizon) and scored better than that bet's probability (Brier skill > 0).

import type { Closes, MarketKey } from "./data.js";
import { ASTRO_FEATURES } from "./astrofeatures.js";
import { MACRO_FEATURES } from "./macrofeatures.js";

export const HORIZONS = [5, 10, 20] as const;
export type Horizon = (typeof HORIZONS)[number];
export type FeatureGroup = "market" | "macro" | "astro";
export type Variant = "all" | "noAstro" | "noMacro";

/** The markets read as context for every forecast (each one's own series is read as its own). */
const CONTEXT: MarketKey[] = ["dxy", "us10y", "spx", "oil", "xau", "btc"];
/** Days of history a feature row needs (the 200-day average). */
const WARMUP = 200;

const ln = Math.log;

/** Per index of a series: its 60-day volatility of daily log returns (NaN before there's enough). */
function volatility(c: number[], w = 60): Float64Array {
  const out = new Float64Array(c.length).fill(NaN);
  let s = 0;
  let s2 = 0;
  for (let i = 1; i < c.length; i++) {
    const r = ln(c[i] / c[i - 1]);
    s += r;
    s2 += r * r;
    if (i > w) {
      const old = ln(c[i - w] / c[i - w - 1]);
      s -= old;
      s2 -= old * old;
    }
    if (i >= w) out[i] = Math.sqrt(Math.max(1e-12, s2 / w - (s / w) ** 2));
  }
  return out;
}

/** The last index whose day is on or before `d` (−1 when none). */
export function atOrBefore(days: number[], d: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= d) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

const mean = (c: number[], from: number, to: number) => {
  let s = 0;
  for (let k = from; k <= to; k++) s += c[k];
  return s / (to - from + 1);
};

/** A series' return over `n` days to index i, in units of its volatility over that span. */
const moveZ = (c: number[], vol: Float64Array, i: number, n: number) => (i - n >= 0 && vol[i] > 0 ? ln(c[i] / c[i - n]) / (vol[i] * Math.sqrt(n)) : NaN);

export type Dataset = {
  days: number[];
  close: number[];
  /** Rows by the target's trading days (from WARMUP on), features in `names` order. */
  rows: Array<{ i: number; x: number[] }>;
  names: string[];
  groups: FeatureGroup[];
};

/** The feature rows for one market, by its own trading days. */
export function dataset(target: MarketKey, closes: Record<MarketKey, Closes>, macro: Map<number, number[]>, astro: Map<number, number[]>): Dataset {
  const { days, close: c } = closes[target];
  const vol = volatility(c);
  const ctx = CONTEXT.filter((k) => k !== target).map((k) => ({ k, s: closes[k], vol: volatility(closes[k].close) }));
  const vix = closes.vix;
  const us2y = closes.us2y;
  const us10y = closes.us10y;

  const names = [
    "Momentum 5 hari", "Momentum 20 hari", "Momentum 60 hari", "Momentum 120 hari",
    "Jarak ke rata-rata 50 hari", "Jarak ke rata-rata 200 hari", "Volatilitas 20 vs 120 hari", "Posisi dalam rentang 20 hari",
    ...ctx.map((x) => `Momentum 20 hari ${LABEL[x.k]}`),
    "VIX (level vs 1 tahun)", "VIX 5 hari", "Kurva 10Y−2Y (perubahan 20 hari)",
    ...MACRO_FEATURES, ...ASTRO_FEATURES,
  ];
  const groups: FeatureGroup[] = [
    ...Array<FeatureGroup>(8 + ctx.length + 3).fill("market"),
    ...Array<FeatureGroup>(MACRO_FEATURES.length).fill("macro"),
    ...Array<FeatureGroup>(ASTRO_FEATURES.length).fill("astro"),
  ];

  const rows: Dataset["rows"] = [];
  for (let i = WARMUP; i < c.length; i++) {
    const d = days[i];
    if (!(vol[i] > 0)) continue;
    const r = (n: number) => moveZ(c, vol, i, n);
    let sd20 = 0;
    let sd120 = 0;
    for (let k = i - 19; k <= i; k++) sd20 += ln(c[k] / c[k - 1]) ** 2;
    for (let k = i - 119; k <= i; k++) sd120 += ln(c[k] / c[k - 1]) ** 2;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = i - 19; k <= i; k++) {
      lo = Math.min(lo, c[k]);
      hi = Math.max(hi, c[k]);
    }
    const own = [
      r(5), r(20), r(60), r(120),
      ln(c[i] / mean(c, i - 49, i)) / vol[i],
      ln(c[i] / mean(c, i - 199, i)) / vol[i],
      Math.sqrt(sd20 / 20) / Math.sqrt(sd120 / 120) - 1,
      hi > lo ? (c[i] - lo) / (hi - lo) - 0.5 : 0,
    ];
    const cross = ctx.map(({ s, vol: v }) => {
      const j = atOrBefore(s.days, d);
      return j >= 0 && d - s.days[j] <= 5 ? moveZ(s.close, v, j, 20) : NaN;
    });
    const jv = atOrBefore(vix.days, d);
    let vixZ = NaN;
    let vix5 = NaN;
    if (jv >= 250 && d - vix.days[jv] <= 5) {
      const window = vix.close.slice(jv - 249, jv + 1).map(ln);
      const m = window.reduce((a, b) => a + b, 0) / window.length;
      const sd = Math.sqrt(window.reduce((a, b) => a + (b - m) ** 2, 0) / window.length) || 1;
      vixZ = (ln(vix.close[jv]) - m) / sd;
      vix5 = ln(vix.close[jv] / vix.close[jv - 5]);
    }
    const j10 = atOrBefore(us10y.days, d);
    const j2 = atOrBefore(us2y.days, d);
    const curve = j10 >= 20 && j2 >= 20 && d - us10y.days[j10] <= 5 && d - us2y.days[j2] <= 5 ? us10y.close[j10] - us2y.close[j2] - (us10y.close[j10 - 20] - us2y.close[j2 - 20]) : NaN;
    const x = [...own, ...cross, vixZ, vix5, curve, ...(macro.get(d) ?? MACRO_FEATURES.map(() => 0)), ...(astro.get(d) ?? ASTRO_FEATURES.map(() => NaN))];
    if (x.some((v) => !Number.isFinite(v))) continue;
    rows.push({ i, x });
  }
  return { days, close: c, rows, names, groups };
}

const LABEL: Record<MarketKey, string> = {
  xau: "emas", btc: "bitcoin", eth: "ether", dxy: "DXY", oil: "minyak", spx: "S&P 500", ndx: "Nasdaq 100",
  eurusd: "EUR/USD", usdjpy: "USD/JPY", us10y: "yield 10Y", vix: "VIX", us2y: "yield 2Y",
};

// ---------------------------------------------------------------- logistic regression

export type Fit = { w: Float64Array; mu: Float64Array; sd: Float64Array; cols: number[] };

/** Newton's method on the L2-penalised log loss (the intercept unpenalised). */
export function fitLogistic(X: number[][], y: number[], cols: number[], lambda = 5, warm?: Float64Array): Fit {
  const n = X.length;
  const d = cols.length + 1;
  const mu = new Float64Array(cols.length);
  const sd = new Float64Array(cols.length);
  cols.forEach((c, j) => {
    let s = 0;
    for (const row of X) s += row[c];
    mu[j] = s / n;
    let v = 0;
    for (const row of X) v += (row[c] - mu[j]) ** 2;
    sd[j] = Math.sqrt(v / n) || 1;
  });
  const Z = new Float64Array(n * d);
  for (let r = 0; r < n; r++) {
    Z[r * d] = 1;
    for (let j = 0; j < cols.length; j++) Z[r * d + j + 1] = (X[r][cols[j]] - mu[j]) / sd[j];
  }
  const w = warm && warm.length === d ? Float64Array.from(warm) : new Float64Array(d);
  const g = new Float64Array(d);
  const H = new Float64Array(d * d);
  for (let it = 0; it < 12; it++) {
    g.fill(0);
    H.fill(0);
    for (let r = 0; r < n; r++) {
      let z = 0;
      for (let j = 0; j < d; j++) z += Z[r * d + j] * w[j];
      const p = 1 / (1 + Math.exp(-z));
      const e = p - y[r];
      const q = p * (1 - p);
      for (let j = 0; j < d; j++) {
        const zj = Z[r * d + j];
        g[j] += e * zj;
        for (let k = j; k < d; k++) H[j * d + k] += q * zj * Z[r * d + k];
      }
    }
    for (let j = 1; j < d; j++) {
      g[j] += lambda * w[j];
      H[j * d + j] += lambda;
    }
    for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) H[j * d + k] = H[k * d + j];
    const step = solve(H, g, d);
    let biggest = 0;
    for (let j = 0; j < d; j++) {
      w[j] -= step[j];
      biggest = Math.max(biggest, Math.abs(step[j]));
    }
    if (biggest < 1e-6) break;
  }
  return { w, mu, sd, cols };
}

/** Solves H x = g by Gaussian elimination with partial pivoting. */
function solve(H: Float64Array, g: Float64Array, d: number): Float64Array {
  const A = Float64Array.from(H);
  const b = Float64Array.from(g);
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r * d + c]) > Math.abs(A[p * d + c])) p = r;
    if (p !== c) {
      for (let k = 0; k < d; k++) [A[c * d + k], A[p * d + k]] = [A[p * d + k], A[c * d + k]];
      [b[c], b[p]] = [b[p], b[c]];
    }
    const piv = A[c * d + c] || 1e-12;
    for (let r = c + 1; r < d; r++) {
      const f = A[r * d + c] / piv;
      if (!f) continue;
      for (let k = c; k < d; k++) A[r * d + k] -= f * A[c * d + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(d);
  for (let r = d - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < d; k++) s -= A[r * d + k] * x[k];
    x[r] = s / (A[r * d + r] || 1e-12);
  }
  return x;
}

/** The fitted chance that row x goes up, and each feature's pull on it (log-odds, standardised). */
export function predict(fit: Fit, x: number[]): { p: number; pulls: number[] } {
  let z = fit.w[0];
  const pulls = fit.cols.map((c, j) => {
    const v = fit.w[j + 1] * ((x[c] - fit.mu[j]) / fit.sd[j]);
    z += v;
    return v;
  });
  return { p: 1 / (1 + Math.exp(-z)), pulls };
}

// ---------------------------------------------------------------- the walk-forward test

export type Score = {
  /** Out-of-sample calls with a known outcome, and how many went the way the model leaned. */
  n: number;
  acc: number;
  /** The plain bet on the side the training years favoured: its hit rate on the same days. */
  baseAcc: number;
  /** Brier skill against that bet's probability (the training years' up rate); > 0 is better. */
  bss: number;
  /** (acc − baseAcc) in standard errors, the calls counted as days ÷ horizon. */
  z: number;
  proven: boolean;
};

export type WalkForward = {
  /** The out-of-sample chance of a rise, by row (NaN before the first test year). */
  p: Float64Array;
  score: Score;
};

const columnsOf = (groups: FeatureGroup[], v: Variant) =>
  groups.flatMap((g, j) => ((v === "noAstro" && g === "astro") || (v === "noMacro" && g === "macro") ? [] : [j]));

/** How hard the fits are pulled toward the base rate: from a light touch to nearly all the way. */
export const LAMBDAS = [10, 100, 1000, 10000, 100000];

/**
 * The penalty for a training span, chosen on its own last two years (fit on the years before them,
 * a gap of the horizon between): the one with the lowest log loss there. A strong penalty leaves
 * the model at the base rate, which is where it belongs when the features say nothing.
 */
export function chooseLambda(X: number[][], y: number[], cols: number[], h: number): number {
  const valid = Math.min(500, Math.floor(X.length / 4));
  const cut = X.length - valid - h;
  if (cut < 300) return LAMBDAS[LAMBDAS.length - 1];
  let best = LAMBDAS[LAMBDAS.length - 1];
  let bestLoss = Infinity;
  for (const lambda of LAMBDAS) {
    const fit = fitLogistic(X.slice(0, cut), y.slice(0, cut), cols, lambda);
    let loss = 0;
    for (let k = X.length - valid; k < X.length; k++) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, predict(fit, X[k]).p));
      loss -= y[k] ? Math.log(p) : Math.log(1 - p);
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      best = lambda;
    }
  }
  return best;
}

/** Yields the event loop now and then: a long test shouldn't stall the server's requests. */
const breathe = () => new Promise<void>((r) => setImmediate(r));

export async function walkForward(ds: Dataset, h: Horizon, variant: Variant, firstYear = 2016): Promise<WalkForward> {
  const cols = columnsOf(ds.groups, variant);
  const { rows, days, close } = ds;
  const p = new Float64Array(rows.length).fill(NaN);
  const outcome = rows.map((r) => (r.i + h < close.length ? (close[r.i + h] > close[r.i] ? 1 : 0) : -1));
  const yearOf = (d: number) => new Date(d * 86_400_000).getUTCFullYear();
  const lastYear = yearOf(days[days.length - 1]);
  let hits = 0;
  let baseHits = 0;
  let n = 0;
  let brier = 0;
  let brierBase = 0;
  let warm: Float64Array | undefined;
  for (let year = firstYear; year <= lastYear; year++) {
    const start = Date.UTC(year, 0, 1) / 86_400_000;
    // Trained on the rows whose outcome day came before the year began.
    const train = rows.flatMap((r, k) => (outcome[k] >= 0 && days[r.i + h] < start ? [k] : []));
    const test = rows.flatMap((r, k) => (yearOf(days[r.i]) === year ? [k] : []));
    if (train.length < 500 || !test.length) continue;
    const y = train.map((k) => outcome[k]);
    const lambda = chooseLambda(
      train.map((k) => rows[k].x),
      y,
      cols,
      h,
    );
    const fit = fitLogistic(
      train.map((k) => rows[k].x),
      y,
      cols,
      lambda,
      warm,
    );
    warm = fit.w;
    const upRate = y.reduce((a: number, b) => a + b, 0) / y.length;
    for (const k of test) {
      p[k] = predict(fit, rows[k].x).p;
      if (outcome[k] < 0) continue;
      n++;
      if ((p[k] > 0.5 ? 1 : 0) === outcome[k]) hits++;
      if ((upRate >= 0.5 ? 1 : 0) === outcome[k]) baseHits++;
      brier += (p[k] - outcome[k]) ** 2;
      brierBase += (upRate - outcome[k]) ** 2;
    }
    await breathe();
  }
  const acc = n ? hits / n : NaN;
  const baseAcc = n ? baseHits / n : NaN;
  const bss = brierBase > 0 ? 1 - brier / brierBase : 0;
  const z = n ? (acc - baseAcc) / Math.sqrt(0.25 / (n / h)) : 0;
  return { p, score: { n, acc, baseAcc, bss, z, proven: n > 0 && bss > 0 && z >= 1.64 } };
}
