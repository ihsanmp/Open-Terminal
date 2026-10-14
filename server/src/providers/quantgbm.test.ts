import { describe, expect, it } from "vitest";
import { fitBand, fitQuantile, predict, predictBand, quantile } from "./quantgbm.js";

// A fixed pseudo-random sequence, so the test is the same every run.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

describe("quantile gradient boosting", () => {
  it("interpolates quantiles", () => {
    expect([quantile([1, 2, 3, 4, 5], 0.5), quantile([1, 2, 3, 4, 5], 0.1), quantile([0, 10], 0.9)]).toEqual([3, 1.4, 9]);
  });

  it("learns a step and the spread around it", () => {
    const r = rng(7);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = r();
      X.push([x, r()]);
      // 1 below x = 0.5, 3 above it, ±1 uniform noise.
      y.push((x < 0.5 ? 1 : 3) + (r() * 2 - 1));
    }
    const m = fitQuantile(X, y, 0.5);
    expect(predict(m, [0.2, 0.5])).toBeCloseTo(1, 0);
    expect(predict(m, [0.8, 0.5])).toBeCloseTo(3, 0);
    const band = fitBand(X, y);
    const [lo, mid, hi] = predictBand(band, [0.8, 0.5]);
    expect(lo).toBeLessThan(mid);
    expect(hi).toBeGreaterThan(mid);
    // The 10–90 band of uniform ±1 noise is 1.6 wide.
    expect(hi - lo).toBeGreaterThan(1.2);
    expect(hi - lo).toBeLessThan(2.0);
    // About 80% of fresh rows land inside it.
    let inside = 0;
    for (let i = 0; i < 400; i++) {
      const x = r();
      const v = (x < 0.5 ? 1 : 3) + (r() * 2 - 1);
      const [a, , b] = predictBand(band, [x, r()]);
      if (v >= a && v <= b) inside++;
    }
    expect(inside / 400).toBeGreaterThan(0.7);
    expect(inside / 400).toBeLessThan(0.9);
  });
});
