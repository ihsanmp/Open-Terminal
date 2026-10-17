import { describe, expect, it } from "vitest";
import { chooseLambda, fitLogistic, predict, walkForward, type Dataset } from "./model.js";

/** A seeded uniform random number in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

describe("the logistic fit", () => {
  it("finds a real effect, and stays near the base rate when told to", () => {
    const r = rng(1);
    const X = Array.from({ length: 3000 }, () => [gauss(r), gauss(r)]);
    const y = X.map(([a]) => (r() < 1 / (1 + Math.exp(-1.5 * a)) ? 1 : 0));
    const fit = fitLogistic(X, y, [0, 1], 1);
    expect(fit.w[1]).toBeGreaterThan(1.2);
    expect(Math.abs(fit.w[2])).toBeLessThan(0.15);
    expect(predict(fit, [2, 0]).p).toBeGreaterThan(0.9);
    const shrunk = fitLogistic(X, y, [0, 1], 1e7);
    expect(Math.abs(predict(shrunk, [2, 0]).p - 0.5)).toBeLessThan(0.05);
  });

  it("chooses a strong penalty for noise and a light one for a signal", () => {
    const r = rng(2);
    const X = Array.from({ length: 2500 }, () => [gauss(r), gauss(r), gauss(r)]);
    const noise = X.map(() => (r() < 0.5 ? 1 : 0));
    const signal = X.map(([a]) => (r() < 1 / (1 + Math.exp(-2 * a)) ? 1 : 0));
    expect(chooseLambda(X, noise, [0, 1, 2], 5)).toBeGreaterThanOrEqual(1000);
    expect(chooseLambda(X, signal, [0, 1, 2], 5)).toBeLessThanOrEqual(100);
  });
});

/** A market whose next move follows feature 0 (or nothing), a row a day from 2008. */
function synthetic(signal: boolean, seed: number): Dataset {
  const r = rng(seed);
  const days: number[] = [];
  const close: number[] = [100];
  const xs: number[][] = [];
  const start = Date.UTC(2008, 0, 1) / 86_400_000;
  for (let k = 0; k < 6000; k++) {
    days.push(start + k);
    const x = [gauss(r), gauss(r)];
    xs.push(x);
    const drift = signal ? 0.004 * x[0] : 0;
    close.push(close[close.length - 1] * Math.exp(drift + 0.01 * gauss(r)));
  }
  days.push(start + 6000);
  return { days, close, rows: xs.map((x, i) => ({ i, x })), names: ["a", "b"], groups: ["market", "astro"] };
}

describe("the walk-forward test", () => {
  it("proves a real edge, out of sample", async () => {
    const wf = await walkForward(synthetic(true, 3), 5, "all", 2012);
    expect(wf.score.acc).toBeGreaterThan(wf.score.baseAcc + 0.03);
    expect(wf.score.proven).toBe(true);
  });

  it("finds none in noise, and forecasts each year only from the years before it", async () => {
    const ds = synthetic(false, 4);
    const wf = await walkForward(ds, 5, "all", 2012);
    expect(wf.score.proven).toBe(false);
    // Nothing forecast before the first test year.
    const first = ds.rows.findIndex((row) => ds.days[row.i] >= Date.UTC(2012, 0, 1) / 86_400_000);
    expect([...wf.p.slice(0, first)].every(Number.isNaN)).toBe(true);
    expect(Number.isFinite(wf.p[first])).toBe(true);
  });

  it("drops a feature group when asked (the test without the sky)", async () => {
    const wf = await walkForward(synthetic(true, 5), 5, "noAstro", 2012);
    expect(wf.score.proven).toBe(true);
  });
});
