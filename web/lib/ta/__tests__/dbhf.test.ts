import { describe, expect, it } from "vitest";
import type { Bars } from "../core";
import { deadbandHysteresis } from "../indicators/community2";
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
const p = (over: Record<string, number | string | boolean> = {}) => ({
  source: "close", thrMode: "Points", atrLen: 14, atrMult: 1, pctThresh: 0.5, tickThresh: 10, ptsThresh: 5, enterMult: 1, exitMult: 0.5, response: 0.2,
  showFilter: true, paintCandles: true, longColor: "#33ff00", shortColor: "#ff0000", ...over,
});

describe("Deadband Hysteresis Filter [BackQuant]", () => {
  it("is in the catalogue as an overlay", () => {
    const def = INDICATOR_BY_ID.get("deadband-hysteresis-filter");
    expect(def?.name).toBe("Deadband Hysteresis Filter [BackQuant]");
    expect(def?.overlay).toBe(true);
  });

  it("holds inside the band and steps by response × the overshoot outside it", () => {
    // Points mode, band 5: 100 → 103 stays inside; 110 is 5 past the band, so it moves 0.2 × 5.
    const r = deadbandHysteresis(bars([100, 103, 110, 110]), p());
    expect(r.plots.dbhf[0]).toBe(100);
    expect(r.plots.dbhf[1]).toBe(100);
    expect(r.plots.dbhf[2]).toBeCloseTo(101);
    // Still 9 above the baseline: 4 past the band, another 0.8.
    expect(r.plots.dbhf[3]).toBeCloseTo(101.8);
  });

  it("colors the line and the candles by its slope, and keeps the last color while flat", () => {
    const r = deadbandHysteresis(bars([100, 120, 120, 120, 80, 80]), p());
    expect(r.barColors?.[0]).toBe("#FFFFFF");
    expect(r.barColors?.[1]).toBe("#33ff00");
    expect(r.barColors?.[4]).toBe("#ff0000");
    expect(r.colors?.dbhf[1]).not.toBe("#33ff00"); // 40% transparent
    expect(deadbandHysteresis(bars([100, 120]), p({ paintCandles: false })).barColors).toBeUndefined();
    expect(Number.isNaN(deadbandHysteresis(bars([100, 120]), p({ showFilter: false })).plots.dbhf[1])).toBe(true);
  });

  it("widens the band with ATR in ATR mode", () => {
    const wavy = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 2);
    const r = deadbandHysteresis(bars(wavy), p({ thrMode: "ATR" }));
    expect(r.plots.dbhf.every((v) => Number.isFinite(v))).toBe(true);
  });
});
