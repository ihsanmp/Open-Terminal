import { describe, expect, it } from "vitest";
import { barStart, bigTradeFloor, withTrades, type FlowPeriod } from "./binance-stream";

const period = (interval: string, bars: Array<[number, number, number]>): FlowPeriod => {
  const inflow = bars.reduce((a, b) => a + b[1], 0);
  const outflow = bars.reduce((a, b) => a + b[2], 0);
  return { period: "1D", interval, bars: bars.map(([time, i, o]) => ({ time, inflow: i, outflow: o })), inflow, outflow, net: inflow - outflow, buyShare: inflow / (inflow + outflow), error: null };
};

describe("money flow kept up to date from the trade stream", () => {
  it("finds the bar a moment falls in", () => {
    expect(barStart(1_000_000, "15m")).toBe(999_900);
    expect(barStart(1_000_000, "1h")).toBe(997_200);
    // Weeks start on Monday 00:00 UTC: Monday 2026-10-12.
    expect(barStart(Date.UTC(2026, 9, 15, 13) / 1000, "1w")).toBe(Date.UTC(2026, 9, 12) / 1000);
    expect(barStart(Date.UTC(2026, 9, 12) / 1000, "1w")).toBe(Date.UTC(2026, 9, 12) / 1000);
    expect(barStart(5, "3m")).toBeNull();
  });

  it("adds each new trade to its bar, buys in and sells out, and begins the next bar", () => {
    const p = period("15m", [[0, 100, 50], [900, 10, 10]]);
    const asOf = 1_000_000; // ms
    const out = withTrades(
      [p],
      [
        { id: 1, time: 999_000, price: 10, qty: 100, buyerMaker: false }, // read already
        { id: 2, time: 1_001_000, price: 10, qty: 2, buyerMaker: false }, // 20 in, bar 900
        { id: 3, time: 1_002_000, price: 10, qty: 3, buyerMaker: true }, // 30 out, bar 900
        { id: 4, time: 1_800_000, price: 5, qty: 2, buyerMaker: false }, // 10 in, a new bar at 1800
      ],
      asOf
    )[0];
    expect(out.bars).toEqual([
      { time: 0, inflow: 100, outflow: 50 },
      { time: 900, inflow: 30, outflow: 40 },
      { time: 1800, inflow: 10, outflow: 0 },
    ]);
    expect([out.inflow, out.outflow, out.net]).toEqual([140, 90, 50]);
    expect(out.buyShare).toBeCloseTo(140 / 230, 10);
    // The period read is left as it was.
    expect(p.bars[1]).toEqual({ time: 900, inflow: 10, outflow: 10 });
    // Nothing newer than what was read: the same periods back.
    const same = [p];
    expect(withTrades(same, [{ id: 1, time: 5, price: 1, qty: 1, buyerMaker: false }], asOf)).toBe(same);
  });

  it("keeps the biggest trades: the top 2%, at least $10,000", () => {
    expect(bigTradeFloor([])).toBe(10_000);
    const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 1000); // $1k … $100k
    expect(bigTradeFloor(values)).toBe(99_000);
    expect(bigTradeFloor([500, 600, 700])).toBe(10_000);
  });
});
