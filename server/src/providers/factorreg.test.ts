import { describe, expect, it } from "vitest";
import { alignedReturns, analyse, dayOf, invert, normalCdf, ols, vifs, weekOf, type Series } from "./factorreg.js";

// A small deterministic generator, so the tests don't depend on chance.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

describe("least squares", () => {
  it("inverts a matrix", () => {
    const inv = invert([
      [4, 7],
      [2, 6],
    ])!;
    expect(inv[0][0]).toBeCloseTo(0.6);
    expect(inv[0][1]).toBeCloseTo(-0.7);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
  });

  it("recovers known coefficients, with t-statistics that tell the real from the noise", () => {
    const r = rng(7);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 600; i++) {
      const a = gauss(r);
      const b = gauss(r);
      const c = gauss(r);
      X.push([a, b, c]);
      y.push(0.5 + 2 * a - 1 * b + 0 * c + 0.5 * gauss(r));
    }
    const fit = ols(X, y)!;
    expect(fit.coef[0]).toBeCloseTo(0.5, 1);
    expect(fit.coef[1]).toBeCloseTo(2, 1);
    expect(fit.coef[2]).toBeCloseTo(-1, 1);
    expect(Math.abs(fit.coef[3])).toBeLessThan(0.1);
    expect(Math.abs(fit.t[1])).toBeGreaterThan(20);
    expect(fit.p[3]).toBeGreaterThan(0.01);
    expect(fit.r2).toBeGreaterThan(0.9);
  });

  it("gives the normal distribution's tails", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("flags factors too alike to tell apart", () => {
    const r = rng(3);
    const X = Array.from({ length: 300 }, () => {
      const a = gauss(r);
      return [a, a + 0.05 * gauss(r), gauss(r)];
    });
    const v = vifs(X);
    expect(v[0]).toBeGreaterThan(50);
    expect(v[2]).toBeLessThan(1.5);
  });
});

describe("the data", () => {
  it("files each market's daily bar under its trading day", () => {
    expect(dayOf(Date.UTC(2026, 9, 19, 22) / 1000)).toBe("2026-10-20"); // a future's evening open
    expect(dayOf(Date.UTC(2026, 9, 20, 13, 30) / 1000)).toBe("2026-10-20"); // New York
    expect(dayOf(Date.UTC(2026, 9, 20, 14, 30) / 1000)).toBe("2026-10-20"); // New York, winter
    expect(dayOf(Date.UTC(2026, 9, 20, 0) / 1000)).toBe("2026-10-20"); // crypto
  });

  it("names ISO weeks", () => {
    expect(weekOf("2026-10-21")).toBe("2026-W43");
    expect(weekOf("2026-01-01")).toBe("2026-W01");
  });

  it("returns on shared dates only: log percent, a yield in basis points", () => {
    const a: Series = new Map([["2026-10-19", 100], ["2026-10-20", 110], ["2026-10-21", 121]]);
    const y: Series = new Map([["2026-10-19", 4.0], ["2026-10-21", 4.1]]);
    const { dates, returns } = alignedReturns({ a, y }, { a: "%", y: "bp" }, "daily");
    expect(dates).toEqual(["2026-10-21"]);
    expect(returns.a[0]).toBeCloseTo(Math.log(1.21) * 100);
    expect(returns.y[0]).toBeCloseTo(10);
  });
});

describe("the analysis", () => {
  it("finds the pair's betas, leaves out the factor that is the pair, and reads the last day", () => {
    const r = rng(11);
    const days = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    const level: Record<string, number> = { spx: 5000, dxy: 100, us10y: 4, vix: 15, gold: 2000, oil: 80, btc: 60000 };
    const closes: Record<string, Series> = Object.fromEntries(Object.keys(level).map((k) => [k, new Map()]));
    const pair: Series = new Map();
    let p = 1.1;
    for (const d of days) {
      const moves: Record<string, number> = {};
      for (const k of Object.keys(level)) {
        moves[k] = k === "us10y" ? 0.05 * gauss(r) : 0.01 * gauss(r);
        level[k] = k === "us10y" ? level[k] + moves[k] : level[k] * Math.exp(moves[k]);
        closes[k].set(d, level[k]);
      }
      // A euro-like pair: down 0.8% for each 1% on the dollar, nothing else, plus noise.
      p *= Math.exp(-0.8 * moves.dxy + 0.003 * gauss(r));
      pair.set(d, p);
    }
    // Gold copied as the pair itself: it must be left out.
    closes.gold = new Map(pair);
    const out = analyse("EURUSD=X", "EUR/USD", pair, closes, "daily")!;
    expect(out.dropped.map((d) => d.key)).toContain("gold");
    const dxy = out.factors.find((f) => f.key === "dxy")!;
    expect(dxy.beta).toBeCloseTo(-0.8, 1);
    expect(dxy.p).toBeLessThan(0.001);
    expect(out.factors.find((f) => f.key === "spx")!.p).toBeGreaterThan(0.001);
    expect(out.r2).toBeGreaterThan(0.8);
    expect(out.latest!.date).toBe(days.at(-1));
    expect(out.predictive!.oosR2).toBeLessThan(0.05);
  });
});
