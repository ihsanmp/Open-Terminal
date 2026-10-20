import { describe, expect, it } from "vitest";
import { fitGbm, predictGbm } from "./gbm.js";
import { fitLogistic, predict } from "./model.js";

/** Rows of two features where the outcome is an interaction a straight line can't draw (XOR-like), and noise. */
function xorData(n: number, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const X: number[][] = [];
  const y: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = r() * 2 - 1;
    const b = r() * 2 - 1;
    X.push([a, b, r()]);
    y.push((a > 0) !== (b > 0) ? (r() < 0.8 ? 1 : 0) : r() < 0.2 ? 1 : 0);
  }
  return { X, y };
}

const accuracy = (p: number[], y: number[]) => p.filter((v, k) => (v > 0.5 ? 1 : 0) === y[k]).length / y.length;

describe("boosted trees", () => {
  it("learn an interaction the logistic regression can't", () => {
    const train = xorData(3000);
    const test = xorData(2000, 99);
    const gbm = fitGbm(train.X, train.y, [0, 1, 2], { depth: 2, eta: 0.1, lambda: 1, minChild: 5, subsample: 0.8, colsample: 1, maxRounds: 150, patience: 30, bins: 32 });
    const lr = fitLogistic(train.X, train.y, [0, 1, 2], 1);
    expect(accuracy(test.X.map((x) => predictGbm(gbm, x)), test.y)).toBeGreaterThan(0.75);
    expect(accuracy(test.X.map((x) => predict(lr, x).p), test.y)).toBeLessThan(0.6);
  });

  it("stop early on noise, keeping the base rate", () => {
    let s = 5;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const X = Array.from({ length: 2000 }, () => [r(), r(), r()]);
    const y = X.map(() => (r() < 0.55 ? 1 : 0));
    const vX = Array.from({ length: 500 }, () => [r(), r(), r()]);
    const vy = vX.map(() => (r() < 0.55 ? 1 : 0));
    const fit = fitGbm(X, y, [0, 1, 2], undefined, { X: vX, y: vy });
    expect(fit.best).toBeLessThan(150);
    const p = vX.map((x) => predictGbm(fit, x));
    // Close to the 55% base rate, not confident either way.
    expect(Math.max(...p.map((v) => Math.abs(v - 0.55)))).toBeLessThan(0.12);
  });

  it("is deterministic", () => {
    const d = xorData(800);
    const a = fitGbm(d.X, d.y, [0, 1, 2], { depth: 2, eta: 0.1, lambda: 1, minChild: 5, subsample: 0.7, colsample: 0.7, maxRounds: 30, patience: 30, bins: 16 });
    const b = fitGbm(d.X, d.y, [0, 1, 2], { depth: 2, eta: 0.1, lambda: 1, minChild: 5, subsample: 0.7, colsample: 0.7, maxRounds: 30, patience: 30, bins: 16 });
    expect(predictGbm(a, [0.3, -0.2, 0.5])).toBe(predictGbm(b, [0.3, -0.2, 0.5]));
  });
});
