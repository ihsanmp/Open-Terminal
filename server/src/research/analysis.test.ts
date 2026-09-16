import { describe, expect, it } from "vitest";
import { altmanZ, beneish, cagr, consensusLabel, grahamNumber, piotroski, yearRatios, type Values } from "./analysis.js";

const base: Values = {
  TotalRevenue: 1000, CostOfRevenue: 600, GrossProfit: 400, SellingGeneralAndAdministration: 150, OperatingIncome: 200,
  EBIT: 200, InterestExpense: 20, NetIncome: 120, DilutedEPS: 2, OperatingCashFlow: 180, FreeCashFlow: 100,
  DepreciationAndAmortization: 50, AccountsReceivable: 100, Inventory: 50, CurrentAssets: 400, NetPPE: 300,
  TotalAssets: 1000, CurrentLiabilities: 200, LongTermDebt: 200, TotalDebt: 250, TotalLiabilitiesNetMinorityInterest: 500,
  RetainedEarnings: 200, StockholdersEquity: 500, WorkingCapital: 200, OrdinarySharesNumber: 60,
};

describe("yearRatios", () => {
  it("computes margins, liquidity and leverage", () => {
    const r = yearRatios(base);
    expect(r.grossMargin).toBeCloseTo(0.4);
    expect(r.netMargin).toBeCloseTo(0.12);
    expect(r.currentRatio).toBeCloseTo(2);
    expect(r.quickRatio).toBeCloseTo(1.75);
    expect(r.debtToEquity).toBeCloseTo(0.5);
    expect(r.interestCoverage).toBeCloseTo(10);
  });

  it("satisfies the DuPont identity with average balances", () => {
    const prev = { ...base, TotalAssets: 900, StockholdersEquity: 400, TotalRevenue: 800 };
    const r = yearRatios(base, prev);
    expect(r.netMargin! * r.assetTurnover! * r.equityMultiplier!).toBeCloseTo(r.roe!, 10);
    expect(r.roe).toBeCloseTo(120 / 450);
    expect(r.revenueGrowth).toBeCloseTo(0.25);
  });
});

describe("piotroski", () => {
  it("scores 9/9 for a company improving on every test", () => {
    const prev: Values = { ...base, NetIncome: 60, TotalAssets: 1000, LongTermDebt: 300, CurrentAssets: 300, OrdinarySharesNumber: 65, GrossProfit: 300, TotalRevenue: 900 };
    const cur: Values = { ...base, TotalAssets: 1000 };
    const { score, evaluated } = piotroski(cur, prev);
    expect(evaluated).toBe(9);
    expect(score).toBe(9);
  });

  it("scores 0 for a company deteriorating on every test", () => {
    const prev: Values = { ...base };
    const cur: Values = {
      ...base, NetIncome: -50, OperatingCashFlow: -80, LongTermDebt: 400, CurrentAssets: 250, OrdinarySharesNumber: 80,
      GrossProfit: 300, TotalRevenue: 900, TotalAssets: 1000,
    };
    expect(piotroski(cur, prev).score).toBe(0);
  });

  it("marks tests with missing inputs as not evaluated instead of failed", () => {
    const cur: Values = { ...base, CurrentAssets: null };
    const res = piotroski(cur, base);
    expect(res.checks.find((c) => c.name === "Higher current ratio")!.passed).toBeNull();
    expect(res.evaluated).toBe(8);
  });
});

describe("altmanZ", () => {
  it("weights the five ratios with the 1968 coefficients", () => {
    // X1=0.1 X2=0.2 X3=0.15 X4=1.5 X5=1.0 -> 0.12 + 0.28 + 0.495 + 0.9 + 1.0 = 2.795
    const v: Values = { ...base, WorkingCapital: 100, RetainedEarnings: 200, EBIT: 150, TotalLiabilitiesNetMinorityInterest: 400, TotalRevenue: 1000 };
    const res = altmanZ(v, 600);
    expect(res.z).toBeCloseTo(2.795, 10);
    expect("zone" in res && res.zone).toBe("grey");
  });

  it("classifies zones at 1.81 and 2.99", () => {
    expect(altmanZ({ ...base, TotalRevenue: 3000 }, 2000)).toMatchObject({ zone: "safe" });
    expect(altmanZ({ ...base, TotalRevenue: 100, EBIT: -100, RetainedEarnings: -300 }, 50)).toMatchObject({ zone: "distress" });
  });

  it("reports which inputs are missing", () => {
    expect(altmanZ({ ...base, RetainedEarnings: null }, 600)).toEqual({ z: null, missing: ["retained earnings"] });
  });
});

describe("beneish", () => {
  it("returns the model intercept plus unit indices for an unchanged company", () => {
    const res = beneish({ ...base, OperatingCashFlow: base.NetIncome }, base);
    // -4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 - 0.327 (TATA = 0)
    expect(res.m).toBeCloseTo(-2.48, 10);
    expect("likelyManipulator" in res && res.likelyManipulator).toBe(false);
  });

  it("flags receivables and accruals racing ahead of sales", () => {
    const cur: Values = { ...base, AccountsReceivable: 300, TotalRevenue: 1400, CostOfRevenue: 900, GrossProfit: 500, NetIncome: 250, OperatingCashFlow: 20 };
    const res = beneish(cur, base);
    expect(res.m).toBeGreaterThan(-1.78);
    expect("likelyManipulator" in res && res.likelyManipulator).toBe(true);
  });
});

describe("helpers", () => {
  it("grahamNumber", () => {
    expect(grahamNumber(2, 20)).toBeCloseTo(30);
    expect(grahamNumber(-1, 20)).toBeNull();
  });

  it("cagr", () => {
    expect(cagr([100, 110, 121])).toBeCloseTo(0.1);
    expect(cagr([null, 100, 121])).toBeCloseTo(0.21);
    expect(cagr([-5, 100])).toBeNull();
  });

  it("consensusLabel", () => {
    expect(consensusLabel(1.13)).toBe("Strong Buy");
    expect(consensusLabel(1.56)).toBe("Buy");
    expect(consensusLabel(3)).toBe("Hold");
    expect(consensusLabel(null)).toBeNull();
  });
});
