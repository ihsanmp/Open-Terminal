import { describe, expect, it } from "vitest";
import { curveThen, moveBp, shapeOf, spread, startOf, timeLeft, type Tenor } from "./bonds";

const curve: Tenor[] = [
  { tenor: "3M", symbol: "TVC:US03MY", value: 4.1, changeBp: -1, refs: { "1D": 4.11, "1M": 4.3 } },
  { tenor: "2Y", symbol: "TVC:US02Y", value: 3.6, changeBp: 2, refs: { "1D": 3.58, "1M": 3.9 } },
  { tenor: "10Y", symbol: "TVC:US10Y", value: 4.15, changeBp: 3, refs: { "1D": 4.12, "1M": 4.0 } },
  { tenor: "30Y", symbol: "TVC:US30Y", value: 4.7, changeBp: null, refs: {} },
];

describe("US bonds", () => {
  it("measures each tenor's move over the period in basis points", () => {
    expect(moveBp(curve[2], "1D")).toBe(3);
    expect(moveBp(curve[2], "1M")).toBe(15);
    expect(moveBp(curve[1], "1M")).toBe(-30);
    expect(moveBp(curve[3], "1M")).toBeNull();
    // Without the day's reference close, the day's change from the server.
    expect(startOf({ ...curve[1], refs: {} }, "1D")).toBeCloseTo(3.58, 10);
  });

  it("measures spreads and their moves", () => {
    expect(spread(curve, "2Y", "10Y", "1D")).toEqual({ value: 55, move: 1 });
    expect(spread(curve, "2Y", "10Y", "1M")).toEqual({ value: 55, move: 45 }); // from -10 to 55
    expect(spread(curve, "10Y", "30Y", "1M")).toEqual({ value: 55, move: null });
    expect(spread(curve, "1Y", "10Y", "1D")).toEqual({ value: null, move: null });
  });

  it("draws the curve as it was, and names its shape", () => {
    expect(curveThen(curve, "1M").map((p) => p.then)).toEqual([4.3, 3.9, 4.0, null]);
    expect(shapeOf(curve)).toBe("Normal (menanjak)");
    expect(shapeOf([{ ...curve[0], value: 4.5 }, { ...curve[1], value: 4.3 }, curve[2]])).toBe("Terbalik (inverted)");
  });

  it("says how long until maturity", () => {
    const now = Date.UTC(2026, 9, 10);
    expect(timeLeft("2056-08-15", now)).toBe("29 thn 10 bln");
    expect(timeLeft("2028-09-30", now)).toBe("1 thn 11 bln");
    expect(timeLeft("2036-10-10", now)).toBe("10 thn");
    expect(timeLeft("2026-11-10", now)).toBe("1 bln");
    expect(timeLeft("2026-12-15", now)).toBe("2 bln 5 hr");
    expect(timeLeft("2026-10-22", now)).toBe("12 hr");
    expect(timeLeft("2026-10-01", now)).toBe("jatuh tempo");
  });
});
