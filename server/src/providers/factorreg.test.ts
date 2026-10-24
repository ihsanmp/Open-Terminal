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

describe("forex rate gap and the SAS export", () => {
  it("builds a pair's rate-differential factor from its two countries' short yields", async () => {
    const { rateDiffFactor, spreadSeries } = await import("./factorreg.js");
    expect(rateDiffFactor(["EUR", "USD"])).toMatchObject({ key: "ratediff", unit: "bp", base: "EUR", quote: "USD", label: "Selisih yield 2 th EUR−USD" });
    expect(rateDiffFactor(["USD", "IDR"])!.label).toBe("Selisih yield 2 th/3 th USD−IDR");
    expect(rateDiffFactor(["USD", "MXN"])).toBeNull();
    expect(rateDiffFactor(["CNY", "CNH"])).toBeNull();
    // A spread can go below zero (it isn't a price).
    const s = spreadSeries(new Map([["2026-10-20", 3.0], ["2026-10-21", 3.1]]), new Map([["2026-10-20", 4.5], ["2026-10-22", 4.4]]));
    expect([...s.entries()]).toEqual([["2026-10-20", -1.5]]);
  });

  it("writes the fit's data as CSV and a SAS program that reruns it", async () => {
    const { regressionCsv, sasProgram } = await import("./factorreg.js");
    const r = rng(5);
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    const pair: Series = new Map();
    const closes: Record<string, Series> = { spx: new Map(), dxy: new Map(), us10y: new Map(), vix: new Map(), gold: new Map(), oil: new Map(), btc: new Map() };
    const lv: Record<string, number> = { spx: 5000, dxy: 100, us10y: 4, vix: 15, gold: 2000, oil: 80, btc: 60000 };
    let p = 1.1;
    for (const d of days) {
      for (const k of Object.keys(lv)) {
        lv[k] = k === "us10y" ? lv[k] + 0.05 * gauss(r) : lv[k] * Math.exp(0.01 * gauss(r));
        closes[k].set(d, lv[k]);
      }
      p *= Math.exp(0.004 * gauss(r));
      pair.set(d, p);
    }
    const out = analyse("EURUSD=X", "EUR/USD", pair, closes, "daily")!;
    const csv = regressionCsv(out).trim().split("\r\n");
    expect(csv[0]).toBe("date,pair,spx,dxy,us10y,vix,gold,oil,btc");
    expect(csv.length).toBe(out.n + 1);
    expect(csv[1].split(",")).toHaveLength(9);
    const sas = sasProgram(out, "regresi.csv");
    expect(sas).toContain("model pair = spx dxy us10y vix gold oil btc / vif;");
    expect(sas).toContain(`kernel=(bart, ${out.nwLags}, 0)`);
    expect(sas).toContain(String.raw`datafile="C:\Users\Anda\Downloads\regresi.csv"`);
    // Without OHLCV no prediction part; with it, the columns and the out-of-sample test.
    expect(sas).not.toContain("proc esm");
    out.rows!.ohlcv = out.rows!.dates.map((_, i) => ({ open: 1 + i, high: 2 + i, low: i, close: 1.5 + i, volume: 100 }));
    expect(regressionCsv(out).split("\r\n")[0]).toBe("date,open,high,low,close,volume,pair,spx,dxy,us10y,vix,gold,oil,btc");
    expect(regressionCsv(out).split("\r\n")[1].split(",")[1]).toBe("1");
    const full = sasProgram(out, "regresi.csv");
    expect(full).toContain("model pair_next = pair range body dlvol spx dxy us10y vix gold oil btc;");
    expect(full).toContain("proc esm data=work.reg");
  });
});

describe("overfitting checks", () => {
  it("tells overfitting (a simpler model holds up) from a relationship that changed (both drop)", async () => {
    const { overfitChecks } = await import("./factorreg.js");
    const r = rng(33);
    const dates = Array.from({ length: 300 }, (_, i) => `d${String(i).padStart(3, "0")}`);
    // Changed: y follows a in the first 70%, then stops following it.
    const Xs: number[][] = [];
    const Ys: number[] = [];
    for (let i = 0; i < 300; i++) {
      const row = [gauss(r), gauss(r)];
      Xs.push(row);
      Ys.push((i < 210 ? 1 : 0) * row[0] + 0.3 * gauss(r));
    }
    expect(overfitChecks(Xs, Ys, dates, ["a", "b"])!.verdict).toBe("shift");
    // Overfitted: one real factor plus 25 noise factors on 120 rows.
    const Xo: number[][] = [];
    const Yo: number[] = [];
    for (let i = 0; i < 120; i++) {
      const row = Array.from({ length: 26 }, () => gauss(r));
      Xo.push(row);
      Yo.push(row[0] + 1.2 * gauss(r));
    }
    const o = overfitChecks(Xo, Yo, dates.slice(0, 120), Array.from({ length: 26 }, (_, j) => `x${j}`))!;
    expect(o.gap).toBeGreaterThan(0.1);
    expect(o.verdict).toBe("overfit");
  });

  it("passes a true linear model and prefers the simpler model when the extra factors are noise", async () => {
    const { overfitChecks } = await import("./factorreg.js");
    const r = rng(21);
    const X: number[][] = [];
    const Y: number[] = [];
    const dates: string[] = [];
    for (let i = 0; i < 600; i++) {
      const row = Array.from({ length: 6 }, () => gauss(r));
      X.push(row);
      Y.push(1.5 * row[0] - 0.8 * row[1] + 0.5 * gauss(r));
      dates.push(new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    }
    const o = overfitChecks(X, Y, dates, ["a", "b", "n1", "n2", "n3", "n4"])!;
    expect(o.verdict).toBe("ok");
    expect(Math.abs(o.gap)).toBeLessThan(0.05);
    expect(o.cv.folds).toHaveLength(5);
    expect(o.cv.meanTest).toBeGreaterThan(0.8);
    // The real factors stay; most of the noise goes (one may pass p < 0.05 by chance, as in real data).
    expect(o.complexity.simple!.keys).toEqual(expect.arrayContaining(["a", "b"]));
    expect(o.complexity.simple!.keys.length).toBeLessThan(6);
    expect(o.complexity.simple!.bic).toBeLessThan(o.complexity.full.bic);
    expect(o.complexity.preferred).toBe("simple");
  });

  it("flags a model with many noise factors on few rows", async () => {
    const { overfitChecks } = await import("./factorreg.js");
    const r = rng(8);
    const X: number[][] = [];
    const Y: number[] = [];
    const dates: string[] = [];
    for (let i = 0; i < 90; i++) {
      X.push(Array.from({ length: 15 }, () => gauss(r)));
      Y.push(gauss(r));
      dates.push(`d${String(i).padStart(3, "0")}`);
    }
    const o = overfitChecks(X, Y, dates, Array.from({ length: 15 }, (_, j) => `x${j}`))!;
    expect(o.trainR2).toBeGreaterThan(0.1);
    expect(o.testR2).toBeLessThan(0);
    // Pure noise: no simpler model holds up either, so it reads as no stable relationship.
    expect(["overfit", "shift"]).toContain(o.verdict);
  });
});
