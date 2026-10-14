// Gradient boosting for a quantile (Friedman's gradient boosting with the pinball loss, as
// scikit-learn's GradientBoostingRegressor(loss="quantile") does it): shallow regression trees fitted
// to the loss's gradient, each leaf then set to the alpha-quantile of the residuals that fall in it.
// Made for small tables (a release a month since 2013: ~150 rows, ~10 features): exhaustive splits,
// no sampling, so a model trains in milliseconds and the same data gives the same model.

export type GbmParams = { trees: number; depth: number; learningRate: number; minLeaf: number };
export const DEFAULT_PARAMS: GbmParams = { trees: 150, depth: 3, learningRate: 0.05, minLeaf: 5 };

type Node = { leaf: number } | { feature: number; threshold: number; left: Node; right: Node };

export type QuantileModel = { alpha: number; init: number; learningRate: number; trees: Node[] };

/** The alpha-quantile of values (linear interpolation between order statistics). */
export function quantile(values: number[], alpha: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * alpha;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * A least-squares regression tree on `target`, over the rows flagged in `member`. `orders` holds
 * every row sorted by each feature, made once per fit: a node walks them keeping its own rows, so no
 * node sorts.
 */
function grow(X: number[][], target: number[], orders: number[][], member: Uint8Array, count: number, depth: number, minLeaf: number): Node {
  let total = 0;
  for (let i = 0; i < member.length; i++) if (member[i]) total += target[i];
  const mean = total / count;
  if (depth === 0 || count < 2 * minLeaf) return { leaf: mean };
  let bestGain = (total * total) / count + 1e-12;
  let bestFeature = -1;
  let bestThreshold = 0;
  for (let f = 0; f < orders.length; f++) {
    const order = orders[f];
    let leftSum = 0;
    let nl = 0;
    let prev = -1;
    for (const i of order) {
      if (!member[i]) continue;
      if (prev >= 0 && nl >= minLeaf && count - nl >= minLeaf && X[prev][f] !== X[i][f]) {
        const gain = (leftSum * leftSum) / nl + ((total - leftSum) * (total - leftSum)) / (count - nl);
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = (X[prev][f] + X[i][f]) / 2;
        }
      }
      leftSum += target[i];
      nl++;
      prev = i;
    }
  }
  if (bestFeature < 0) return { leaf: mean };
  const left = new Uint8Array(member.length);
  const right = new Uint8Array(member.length);
  let nLeft = 0;
  for (let i = 0; i < member.length; i++) {
    if (!member[i]) continue;
    if (X[i][bestFeature] <= bestThreshold) {
      left[i] = 1;
      nLeft++;
    } else right[i] = 1;
  }
  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: grow(X, target, orders, left, nLeft, depth - 1, minLeaf),
    right: grow(X, target, orders, right, count - nLeft, depth - 1, minLeaf),
  };
}

/** The rows that reach each leaf, by the leaf object. */
function leaves(node: Node, X: number[][], idx: number[], out: Map<Node, number[]>): void {
  if ("leaf" in node) {
    out.set(node, idx);
    return;
  }
  leaves(node.left, X, idx.filter((i) => X[i][node.feature] <= node.threshold), out);
  leaves(node.right, X, idx.filter((i) => X[i][node.feature] > node.threshold), out);
}

function predictTree(node: Node, x: number[]): number {
  while (!("leaf" in node)) node = x[node.feature] <= node.threshold ? node.left : node.right;
  return node.leaf;
}

export function fitQuantile(X: number[][], y: number[], alpha: number, params: GbmParams = DEFAULT_PARAMS): QuantileModel {
  const init = quantile(y, alpha);
  const F = y.map(() => init);
  const all = y.map((_, i) => i);
  const everyone = new Uint8Array(y.length).fill(1);
  const orders = (X[0] ?? []).map((_, f) => [...all].sort((a, b) => X[a][f] - X[b][f]));
  const trees: Node[] = [];
  for (let m = 0; m < params.trees; m++) {
    // The pinball loss's negative gradient: alpha above the current prediction, alpha − 1 below.
    const g = y.map((v, i) => (v > F[i] ? alpha : alpha - 1));
    const tree = grow(X, g, orders, everyone, y.length, params.depth, params.minLeaf);
    // Each leaf: the alpha-quantile of the residuals in it (the loss's own line search).
    const byLeaf = new Map<Node, number[]>();
    leaves(tree, X, all, byLeaf);
    for (const [leaf, rows] of byLeaf) (leaf as { leaf: number }).leaf = rows.length ? quantile(rows.map((i) => y[i] - F[i]), alpha) : 0;
    for (let i = 0; i < y.length; i++) F[i] += params.learningRate * predictTree(tree, X[i]);
    trees.push(tree);
  }
  return { alpha, init, learningRate: params.learningRate, trees };
}

export function predict(model: QuantileModel, x: number[]): number {
  return model.trees.reduce((f, t) => f + model.learningRate * predictTree(t, x), model.init);
}

/** P10, P50 and P90 models on one table. */
export function fitBand(X: number[][], y: number[], params: GbmParams = DEFAULT_PARAMS) {
  return { p10: fitQuantile(X, y, 0.1, params), p50: fitQuantile(X, y, 0.5, params), p90: fitQuantile(X, y, 0.9, params) };
}

/** The three quantiles for a row, sorted so they never cross. */
export function predictBand(band: ReturnType<typeof fitBand>, x: number[]): [number, number, number] {
  return [predict(band.p10, x), predict(band.p50, x), predict(band.p90, x)].sort((a, b) => a - b) as [number, number, number];
}
