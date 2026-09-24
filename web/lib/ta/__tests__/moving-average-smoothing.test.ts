import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, INDICATORS, candlesToBars, defaultParams, matchesQuery } from "../index";
import * as ta from "../core";

const bars = candlesToBars(
  Array.from({ length: 80 }, (_, i) => {
    const close = 100 + Math.sin(i / 5) * 8 + i * 0.1;
    return { time: 1_700_000_000 + i * 86_400, open: close, high: close + 1, low: close - 1, close, volume: 1_000 + i };
  })
);

describe("Moving Average Exponential / Simple smoothing", () => {
  const ema = INDICATOR_BY_ID.get("ema")!;
  const run = (params: Record<string, string | number>) => ema.compute(bars, { ...defaultParams(ema), ...params });

  it("plots only the average by default", () => {
    const out = run({});
    expect(out.plots.ma.at(-1)).toBeCloseTo(ta.ema(bars.close, 9).at(-1)!, 12);
    expect(out.plots.smoothing).toBeUndefined();
  });

  it("smooths the average with the chosen MA", () => {
    const out = run({ smoothing: "WMA", smoothingLength: 10 });
    expect(out.plots.smoothing.at(-1)).toBeCloseTo(ta.wma(ta.ema(bars.close, 9), 10).at(-1)!, 12);
    expect(out.plots.upper).toBeUndefined();
  });

  it("adds Bollinger Bands around an SMA of the average", () => {
    const out = run({ smoothing: "SMA + Bollinger Bands", smoothingLength: 14, bbMult: 2 });
    const e = ta.ema(bars.close, 9);
    const mid = ta.sma(e, 14).at(-1)!;
    const dev = ta.stdev(e, 14).at(-1)! * 2;
    expect(out.plots.smoothing.at(-1)).toBeCloseTo(mid, 12);
    expect(out.plots.upper.at(-1)).toBeCloseTo(mid + dev, 12);
    expect(out.plots.lower.at(-1)).toBeCloseTo(mid - dev, 12);
    expect(out.fills).toHaveLength(1);
  });
});

describe("indicator search", () => {
  const find = (q: string) => INDICATORS.filter((d) => matchesQuery(d, q)).map((d) => d.id);

  it("matches words in any order and aliases", () => {
    expect(find("Exponential Moving Average")).toContain("ema");
    expect(find("moving average exponential")).toContain("ema");
    expect(find("simple moving average")).toContain("sma");
    expect(find("volume")).toContain("volume");
    expect(find("thermocap")).toEqual(["btcthermocap"]);
  });
});
