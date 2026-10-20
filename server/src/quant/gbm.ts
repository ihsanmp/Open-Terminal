// Gradient-boosted trees for the quant forecaster, the way XGBoost does them, to test beside the
// logistic regression (model.ts): the log loss's gradient and hessian per row, each tree grown to a
// small depth by the split that gains most (the second-order gain, leaves shrunk by an L2 penalty),
// a learning rate, rows and features sampled per tree, and the number of trees chosen by early
// stopping on the training span's own last two years. Features are binned (at most 32 quantile
// bins each, from the training rows) so a split is found from histograms.
//
// Kept only if it beats the logistic regression out of sample (cli/quant-compare.ts).

import type { Dataset, Horizon, Score, Variant, WalkForward } from "./model.js";

export type GbmParams = {
  depth: number;
  eta: number;
  /** L2 penalty on leaf weights (XGBoost's lambda) and the least hessian a leaf may hold (min_child_weight). */
  lambda: number;
  minChild: number;
  subsample: number;
  colsample: number;
  maxRounds: number;
  /** Rounds without a better validation loss before stopping. */
  patience: number;
  bins: number;
};

export const GBM_DEFAULTS: GbmParams = { depth: 2, eta: 0.03, lambda: 10, minChild: 40, subsample: 0.7, colsample: 0.7, maxRounds: 400, patience: 40, bins: 32 };

type Node = { feature: number; threshold: number; left: number; right: number } | { leaf: number };
export type Tree = Node[];
export type GbmFit = { base: number; trees: Tree[]; eta: number; cols: number[] };

/** A small deterministic generator (mulberry32): the same fit every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each column's bin edges: up to `bins` − 1 quantiles of the training values. */
function binEdges(X: number[][], cols: number[], bins: number): number[][] {
  return cols.map((c) => {
    const v = X.map((r) => r[c]).sort((a, b) => a - b);
    const edges: number[] = [];
    for (let k = 1; k < bins; k++) {
      const e = v[Math.floor((k * v.length) / bins)];
      if (edges.length === 0 || e > edges[edges.length - 1]) edges.push(e);
    }
    return edges;
  });
}

/** The bin of a value: the number of edges at or below it. */
function binOf(edges: number[], x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function treeValue(tree: Tree, x: number[]): number {
  let k = 0;
  for (;;) {
    const n = tree[k];
    if ("leaf" in n) return n.leaf;
    k = x[n.feature] < n.threshold ? n.left : n.right;
  }
}

/** The fitted chance that row x goes up. */
export function predictGbm(fit: GbmFit, x: number[], rounds = fit.trees.length): number {
  let z = fit.base;
  for (let t = 0; t < rounds; t++) z += fit.eta * treeValue(fit.trees[t], x);
  return sigmoid(z);
}

/**
 * Boosts trees on (X, y). With validation rows, it stops when their log loss hasn't improved for
 * `patience` rounds and keeps the best number of trees (`best`).
 */
export function fitGbm(X: number[][], y: number[], cols: number[], params: GbmParams = GBM_DEFAULTS, valid?: { X: number[][]; y: number[] }, seed = 7): GbmFit & { best: number } {
  const n = X.length;
  const random = rng(seed);
  const edges = binEdges(X, cols, params.bins);
  // Binned training matrix, column-major.
  const B = cols.map((c, j) => Uint8Array.from(X, (r) => binOf(edges[j], r[c])));
  const up = y.reduce((a, b) => a + b, 0) / n;
  const base = Math.log(Math.min(0.99, Math.max(0.01, up)) / (1 - Math.min(0.99, Math.max(0.01, up))));
  const z = new Float64Array(n).fill(base);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: Tree[] = [];
  const zv = valid ? new Float64Array(valid.X.length).fill(base) : null;
  let best = 0;
  let bestLoss = Infinity;
  const nb = params.bins + 1;
  const gh = new Float64Array(nb * 2);

  for (let round = 0; round < params.maxRounds; round++) {
    for (let r = 0; r < n; r++) {
      const p = sigmoid(z[r]);
      g[r] = p - y[r];
      h[r] = Math.max(1e-6, p * (1 - p));
    }
    const rows: number[] = [];
    for (let r = 0; r < n; r++) if (random() < params.subsample) rows.push(r);
    const feats = cols.map((_, j) => j).filter(() => random() < params.colsample);
    if (!feats.length) feats.push(Math.floor(random() * cols.length));

    const tree: Tree = [];
    const grow = (idx: number[], depth: number): number => {
      let G = 0;
      let H = 0;
      for (const r of idx) {
        G += g[r];
        H += h[r];
      }
      const at = tree.length;
      tree.push({ leaf: -G / (H + params.lambda) });
      if (depth >= params.depth || H < 2 * params.minChild) return at;
      const parent = (G * G) / (H + params.lambda);
      let bestGain = 0;
      let bestJ = -1;
      let bestBin = -1;
      for (const j of feats) {
        gh.fill(0);
        const col = B[j];
        for (const r of idx) {
          gh[col[r] * 2] += g[r];
          gh[col[r] * 2 + 1] += h[r];
        }
        let GL = 0;
        let HL = 0;
        for (let b = 0; b < nb - 1; b++) {
          GL += gh[b * 2];
          HL += gh[b * 2 + 1];
          const HR = H - HL;
          if (HL < params.minChild || HR < params.minChild) continue;
          const GR = G - GL;
          const gain = (GL * GL) / (HL + params.lambda) + (GR * GR) / (HR + params.lambda) - parent;
          if (gain > bestGain) {
            bestGain = gain;
            bestJ = j;
            bestBin = b;
          }
        }
      }
      if (bestJ < 0) return at;
      const left = idx.filter((r) => B[bestJ][r] <= bestBin);
      const right = idx.filter((r) => B[bestJ][r] > bestBin);
      // Rows with bin ≤ b are those below edge b (binOf counts the edges at or below the value).
      const threshold = edges[bestJ][bestBin];
      const l = grow(left, depth + 1);
      const rr = grow(right, depth + 1);
      tree[at] = { feature: cols[bestJ], threshold, left: l, right: rr };
      return at;
    };
    grow(rows, 0);
    trees.push(tree);
    for (let r = 0; r < n; r++) z[r] += params.eta * treeValue(tree, X[r]);

    if (valid && zv) {
      let loss = 0;
      for (let k = 0; k < valid.X.length; k++) {
        zv[k] += params.eta * treeValue(tree, valid.X[k]);
        const p = Math.min(1 - 1e-6, Math.max(1e-6, sigmoid(zv[k])));
        loss -= valid.y[k] ? Math.log(p) : Math.log(1 - p);
      }
      if (loss < bestLoss - 1e-9) {
        bestLoss = loss;
        best = round + 1;
      } else if (round + 1 - best >= params.patience) break;
    }
  }
  // Without validation every tree counts; with it, a validation loss never below the base rate's
  // leaves no trees at all (the base rate).
  return { base, trees: valid ? trees.slice(0, best) : trees, eta: params.eta, cols, best: valid ? best : trees.length };
}

/**
 * The number of trees for a training span, chosen on its own last two years (fit on the years
 * before them, a gap of the horizon between), as the logistic regression's penalty is.
 */
export function chooseRounds(X: number[][], y: number[], cols: number[], h: number, params: GbmParams): number {
  const valid = Math.min(500, Math.floor(X.length / 4));
  const cut = X.length - valid - h;
  if (cut < 300) return 0;
  const fit = fitGbm(X.slice(0, cut), y.slice(0, cut), cols, params, { X: X.slice(X.length - valid), y: y.slice(y.length - valid) });
  return fit.best;
}

const columnsOf = (groups: Dataset["groups"], v: Variant) =>
  groups.flatMap((g, j) => ((v === "noAstro" && g === "astro") || (v === "noMacro" && g === "macro") ? [] : [j]));

const breathe = () => new Promise<void>((r) => setImmediate(r));

/** The same walk-forward test as model.ts's, with boosted trees: each year from a fit on the years before. */
export async function walkForwardGbm(ds: Dataset, h: Horizon, variant: Variant, params: GbmParams = GBM_DEFAULTS, firstYear = 2016): Promise<WalkForward & { rounds: number[] }> {
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
  const rounds: number[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const start = Date.UTC(year, 0, 1) / 86_400_000;
    const train = rows.flatMap((r, k) => (outcome[k] >= 0 && days[r.i + h] < start ? [k] : []));
    const test = rows.flatMap((r, k) => (yearOf(days[r.i]) === year ? [k] : []));
    if (train.length < 500 || !test.length) continue;
    const X = train.map((k) => rows[k].x);
    const y = train.map((k) => outcome[k]);
    const best = chooseRounds(X, y, cols, h, params);
    rounds.push(best);
    const fit = fitGbm(X, y, cols, { ...params, maxRounds: best });
    const upRate = y.reduce((a: number, b) => a + b, 0) / y.length;
    for (const k of test) {
      p[k] = best ? predictGbm(fit, rows[k].x) : upRate;
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
  const score: Score = { n, acc, baseAcc, bss, z, proven: n > 0 && bss > 0 && z >= 1.64 };
  return { p, score, rounds };
}
