import { describe, expect, it } from "vitest";
import * as ta from "../core";
import type { Bars } from "../core";
import { demaFlow, rollingMedian } from "../indicators/community2";
import { INDICATOR_BY_ID } from "../index";

const bars = (closes: number[]): Bars => ({
  time: closes.map((_, i) => i * 86_400),
  open: closes,
  high: closes.map((c) => c + 1),
  low: closes.map((c) => c - 1),
  close: closes,
  volume: closes.map(() => 0),
  length: closes.length,
});
const p = (over: Record<string, number | boolean> = {}) => ({
  demaLength: 5, hlFilterLength: 4, atrLength: 3, upperAtrMult: 2.1, lowerAtrMult: 1.5, showBands: false, showLabels: false, colorCandles: true, ...over,
});

describe("DEMA Flow [Alpha Extract]", () => {
  it("is in the catalogue as an overlay, with the script's defaults", () => {
    const def = INDICATOR_BY_ID.get("dema-flow-alpha-extract");
    expect(def?.name).toBe("DEMA Flow [Alpha Extract]");
    expect(def?.overlay).toBe(true);
    const d = Object.fromEntries(def!.inputs.map((i) => [i.key, i.default]));
    expect(d).toMatchObject({ demaLength: 23, hlFilterLength: 4, atrLength: 14, upperAtrMult: 2.1, lowerAtrMult: 1.5 });
  });

  it("takes the median of the last values, the middle two's mean for an even window", () => {
    expect(rollingMedian([5, 1, 3, 9, 7], 3)).toEqual([NaN, NaN, 3, 3, 7]);
    expect(rollingMedian([1, 4, 2, 8], 4)[3]).toBe(3);
  });

  it("is the median of the DEMA, with the bands at +2.1 and −1.5 ATR", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const r = demaFlow(bars(closes), p({ showBands: true }));
    const smooth = rollingMedian(ta.dema(closes, 5), 4);
    const atr = ta.atr(bars(closes), 3);
    expect(r.plots.trend[30]).toBeCloseTo(smooth[30]);
    expect(r.plots.upper[30]).toBeCloseTo(smooth[30] + 2.1 * atr[30]);
    expect(r.plots.lower[30]).toBeCloseTo(smooth[30] - 1.5 * atr[30]);
  });

  it("turns bullish above the upper band, holds, and turns bearish only below the lower one", () => {
    const closes = [...Array(20).fill(100), ...Array(10).fill(130), ...Array(5).fill(129), ...Array(10).fill(80)];
    const r = demaFlow(bars(closes), p({ showLabels: true }));
    const colors = r.barColors!;
    expect(colors[0]).not.toBe("#00ff88");
    expect(colors[20]).toBe("#00ff88");
    expect(colors[32]).toBe("#00ff88");
    expect(colors.at(-1)).toBe("#ff0066");
    expect(r.markers?.map((m) => m.text)).toEqual(["Bullish", "Bearish"]);
    expect(r.plots.upper).toBeUndefined();
  });
});
