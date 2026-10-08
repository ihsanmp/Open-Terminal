import { describe, expect, it } from "vitest";
import { assemble, GLOBAL_10Y, lastAndChange, macroSymbols, MARKETS, spreadsOf, US_CURVE } from "./macro.js";

const bar = (close: number, day: number) => ({ time: day * 86_400, open: close, high: close, low: close, close, volume: null });

describe("macro page", () => {
  it("takes each symbol's last value and its move since the close before", () => {
    expect(lastAndChange([bar(100, 1), bar(102, 2)])).toEqual({ value: 102, change: 2, changePct: 2 });
    expect(lastAndChange([bar(5, 1)])).toEqual({ value: 5, change: null, changePct: null });
    expect(lastAndChange(null)).toEqual({ value: null, change: null, changePct: null });
  });

  it("builds the US curve from 1 month to 30 years, the 2Y, 10Y and 30Y among them, with moves in basis points", () => {
    expect(US_CURVE.map((c) => c.tenor)).toEqual(["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]);
    const bars = Object.fromEntries(US_CURVE.map((c, i) => [c.symbol, [bar(4 + i * 0.1, 1), bar(4 + i * 0.1 + 0.05, 2)]]));
    const m = assemble(bars);
    const ten = m.curve.find((c) => c.tenor === "10Y")!;
    expect(ten.value).toBeCloseTo(4.85, 9);
    expect(ten.changeBp).toBe(5); // +0.05 percentage points
    // 10Y − 2Y = 0.4 pp = 40 bp, both up 5 bp: unchanged.
    expect(m.spreads[0]).toEqual({ label: "2s10s", value: 40, changeBp: 0 });
    // Symbols with no data are shown empty, not dropped.
    expect(m.markets[0].items[0]).toMatchObject({ label: "S&P 500", value: null, spark: [] });
    // Each row carries its closes for its small chart.
    expect(ten.spark).toEqual([4.8, 4.85]);
  });

  it("measures the spreads that matter, an inverted curve negative", () => {
    const curve = [
      { tenor: "3M", symbol: "", value: 5.3, changeBp: 1 },
      { tenor: "2Y", symbol: "", value: 4.8, changeBp: 2 },
      { tenor: "5Y", symbol: "", value: 4.5, changeBp: 0 },
      { tenor: "10Y", symbol: "", value: 4.6, changeBp: -3 },
      { tenor: "30Y", symbol: "", value: 4.75, changeBp: -1 },
    ];
    expect(spreadsOf(curve)).toEqual([
      { label: "2s10s", value: -20, changeBp: -5 },
      { label: "3M10Y", value: -70, changeBp: -4 },
      { label: "5s30s", value: 25, changeBp: -1 },
    ]);
  });

  it("asks TradingView for every symbol once", () => {
    const all = macroSymbols();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining(["TVC:US02Y", "TVC:US10Y", "TVC:US30Y", "TVC:DXY", "TVC:GOLD", "FX_IDC:USDIDR"]));
    expect(all.length).toBe(US_CURVE.length + GLOBAL_10Y.length - 1 + MARKETS.reduce((n, g) => n + g.items.length, 0)); // US10Y is in both
  });
});
