import { describe, expect, it } from "vitest";
import { clvFlows, inPeriod, summarize, takerFlows } from "./moneyflow.js";

const bar = (time: number, high: number, low: number, close: number, volume: number) => ({ time, open: low, high, low, close, volume });

describe("money flow", () => {
  it("splits a bar's turnover by where it closed in its range", () => {
    const [top, bottom, mid, flat, none] = clvFlows([bar(1, 12, 9, 12, 100), bar(2, 12, 9, 9, 100), bar(3, 12, 8, 10, 30), bar(4, 10, 10, 10, 50), bar(5, 10, 9, 9.5, 0)]);
    expect(top).toEqual({ time: 1, inflow: 1100, outflow: 0 }); // (12+9+12)/3 × 100, all in
    expect(bottom).toEqual({ time: 2, inflow: 0, outflow: 1000 });
    expect(mid.inflow).toBeCloseTo(150, 10); // turnover 300, closed halfway
    expect(mid.outflow).toBeCloseTo(150, 10);
    expect(flat).toEqual({ time: 4, inflow: 250, outflow: 250 });
    expect(none).toEqual({ time: 5, inflow: 0, outflow: 0 });
  });

  it("reads Binance's taker buys as inflow and the rest as outflow", () => {
    expect(takerFlows([[1, 1000, 620], [2, 500, 500]])).toEqual([
      { time: 1, inflow: 620, outflow: 380 },
      { time: 2, inflow: 500, outflow: 0 },
    ]);
  });

  it("keeps a period's bars: a session for a market that closes, 24 hours for a coin", () => {
    const H = 3600;
    // Yesterday's session ended at 16:00 (t = 0); today's ran 09:30 … 16:00 (t = 17.5 h … 24 h).
    const bars = [0, 17.5 * H, 20 * H, 24 * H].map((time) => ({ time, inflow: 1, outflow: 1 }));
    expect(inPeriod(bars, { key: "1D", seconds: 86_400 }, false).map((b) => b.time / H)).toEqual([17.5, 20, 24]);
    expect(inPeriod(bars, { key: "1D", seconds: 86_400 }, true).map((b) => b.time / H)).toEqual([17.5, 20, 24]);
    expect(inPeriod(bars, { key: "1W", seconds: 7 * 86_400 }, false)).toHaveLength(4);
    expect(inPeriod([], { key: "1D", seconds: 86_400 }, true)).toEqual([]);
  });

  it("sums a period", () => {
    expect(summarize([{ time: 1, inflow: 60, outflow: 40 }, { time: 2, inflow: 15, outflow: 35 }])).toEqual({ inflow: 75, outflow: 75, net: 0, buyShare: 0.5 });
    expect(summarize([])).toEqual({ inflow: 0, outflow: 0, net: 0, buyShare: null });
  });
});
