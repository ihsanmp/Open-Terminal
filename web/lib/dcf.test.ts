import { describe, expect, it } from "vitest";
import { discountedCashFlow } from "./dcf";

describe("discountedCashFlow", () => {
  it("matches a hand-computed two-stage valuation", () => {
    // FCF 100 growing 10% for 2 years at r = 10%: each year's PV is exactly 100.
    // Terminal: 121 × 1.02 / (0.10 − 0.02) = 1542.75, PV = 1542.75 / 1.21 = 1275.
    const res = discountedCashFlow({ freeCashFlow: 100, growth: 0.1, discountRate: 0.1, terminalGrowth: 0.02, years: 2, netDebt: 75, shares: 10 })!;
    expect(res.flows.map((f) => f.presentValue)).toEqual([expect.closeTo(100, 9), expect.closeTo(100, 9)]);
    expect(res.terminalValue).toBeCloseTo(1542.75, 9);
    expect(res.presentValueOfTerminal).toBeCloseTo(1275, 9);
    expect(res.enterpriseValue).toBeCloseTo(1475, 9);
    expect(res.perShare).toBeCloseTo(140, 9);
  });

  it("is undefined when the discount rate does not exceed terminal growth", () => {
    expect(discountedCashFlow({ freeCashFlow: 100, growth: 0.05, discountRate: 0.03, terminalGrowth: 0.03, years: 5, netDebt: 0, shares: 1 })).toBeNull();
  });

  it("rejects missing share counts", () => {
    expect(discountedCashFlow({ freeCashFlow: 100, growth: 0.05, discountRate: 0.09, terminalGrowth: 0.02, years: 5, netDebt: 0, shares: 0 })).toBeNull();
  });
});
