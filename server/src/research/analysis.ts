// Fundamental scoring models computed from annual statement lines. Formulas
// follow the original papers: Piotroski (2000), Altman (1968), Beneish (1999),
// Graham's "Intelligent Investor" number, and the DuPont identity.
import type { FiscalYear } from "../providers/yahoo.js";

export type Values = FiscalYear["values"];
type N = number | null;

const ok = (x: N | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const ratio = (a: N | undefined, b: N | undefined): N => (ok(a) && ok(b) && b !== 0 ? a / b : null);
const avg = (cur: Values, prev: Values | undefined, key: string): N => {
  const c = cur[key];
  const p = prev?.[key];
  return ok(c) && ok(p) ? (c + p) / 2 : ok(c) ? c : null;
};
const ebit = (v: Values): N => (ok(v.EBIT) ? v.EBIT : ok(v.OperatingIncome) ? v.OperatingIncome : null);
const growth = (cur: N | undefined, prev: N | undefined): N => (ok(cur) && ok(prev) && prev !== 0 ? (cur - prev) / Math.abs(prev) : null);

export type YearRatios = {
  grossMargin: N; operatingMargin: N; netMargin: N; fcfMargin: N; roe: N; roa: N; assetTurnover: N;
  equityMultiplier: N; currentRatio: N; quickRatio: N; debtToEquity: N; interestCoverage: N;
  revenueGrowth: N; netIncomeGrowth: N; epsGrowth: N;
};

/** Ratios for one fiscal year; return/turnover ratios use average balances when the prior year exists. */
export function yearRatios(cur: Values, prev?: Values): YearRatios {
  const rev = cur.TotalRevenue;
  const interest = ok(cur.InterestExpense) ? Math.abs(cur.InterestExpense) : null;
  return {
    grossMargin: ratio(cur.GrossProfit, rev),
    operatingMargin: ratio(cur.OperatingIncome, rev),
    netMargin: ratio(cur.NetIncome, rev),
    fcfMargin: ratio(cur.FreeCashFlow, rev),
    roe: ratio(cur.NetIncome, avg(cur, prev, "StockholdersEquity")),
    roa: ratio(cur.NetIncome, avg(cur, prev, "TotalAssets")),
    // DuPont: ROE = net margin × asset turnover × equity multiplier (same average balances throughout).
    assetTurnover: ratio(rev, avg(cur, prev, "TotalAssets")),
    equityMultiplier: ratio(avg(cur, prev, "TotalAssets"), avg(cur, prev, "StockholdersEquity")),
    currentRatio: ratio(cur.CurrentAssets, cur.CurrentLiabilities),
    quickRatio: ok(cur.CurrentAssets) ? ratio(cur.CurrentAssets - (cur.Inventory ?? 0), cur.CurrentLiabilities) : null,
    debtToEquity: ratio(cur.TotalDebt, cur.StockholdersEquity),
    interestCoverage: interest ? ratio(ebit(cur), interest) : null,
    revenueGrowth: growth(rev, prev?.TotalRevenue),
    netIncomeGrowth: growth(cur.NetIncome, prev?.NetIncome),
    epsGrowth: growth(cur.DilutedEPS, prev?.DilutedEPS),
  };
}

export type Check = { name: string; passed: boolean | null; detail: string };

const pct = (x: N) => (ok(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const fx = (x: N, d = 2) => (ok(x) ? x.toFixed(d) : "n/a");

/**
 * Piotroski F-Score: nine binary tests of profitability, leverage/liquidity and
 * operating efficiency. `prev2` (two years back) lets the prior-year ROA use its
 * own beginning assets; without it the year's own assets stand in.
 */
export function piotroski(cur: Values, prev: Values, prev2?: Values): { score: number; evaluated: number; checks: Check[] } {
  const roa = ratio(cur.NetIncome, prev.TotalAssets ?? cur.TotalAssets);
  const roaPrev = ratio(prev.NetIncome, prev2?.TotalAssets ?? prev.TotalAssets);
  const lev = ratio(cur.LongTermDebt ?? 0, cur.TotalAssets);
  const levPrev = ratio(prev.LongTermDebt ?? 0, prev.TotalAssets);
  const cr = ratio(cur.CurrentAssets, cur.CurrentLiabilities);
  const crPrev = ratio(prev.CurrentAssets, prev.CurrentLiabilities);
  const shares = cur.OrdinarySharesNumber ?? cur.DilutedAverageShares;
  const sharesPrev = prev.OrdinarySharesNumber ?? prev.DilutedAverageShares;
  const gm = ratio(cur.GrossProfit, cur.TotalRevenue);
  const gmPrev = ratio(prev.GrossProfit, prev.TotalRevenue);
  const at = ratio(cur.TotalRevenue, prev.TotalAssets ?? cur.TotalAssets);
  const atPrev = ratio(prev.TotalRevenue, prev2?.TotalAssets ?? prev.TotalAssets);
  const test = (cond: boolean, ...inputs: N[]) => (inputs.every(ok) ? cond : null);

  const checks: Check[] = [
    { name: "Positive return on assets", passed: test(ok(roa) && roa > 0, roa), detail: `ROA ${pct(roa)}` },
    { name: "Positive operating cash flow", passed: test(ok(cur.OperatingCashFlow) && cur.OperatingCashFlow > 0, cur.OperatingCashFlow), detail: "" },
    { name: "Improving return on assets", passed: test(ok(roa) && ok(roaPrev) && roa > roaPrev, roa, roaPrev), detail: `${pct(roaPrev)} → ${pct(roa)}` },
    {
      name: "Cash flow exceeds net income (quality of earnings)",
      passed: test(ok(cur.OperatingCashFlow) && ok(cur.NetIncome) && cur.OperatingCashFlow > cur.NetIncome, cur.OperatingCashFlow, cur.NetIncome),
      detail: "",
    },
    { name: "Lower long-term leverage", passed: test(ok(lev) && ok(levPrev) && lev < levPrev, lev, levPrev), detail: `${pct(levPrev)} → ${pct(lev)} of assets` },
    { name: "Higher current ratio", passed: test(ok(cr) && ok(crPrev) && cr > crPrev, cr, crPrev), detail: `${fx(crPrev)} → ${fx(cr)}` },
    { name: "No new shares issued", passed: test(ok(shares) && ok(sharesPrev) && shares <= sharesPrev, shares, sharesPrev), detail: "" },
    { name: "Higher gross margin", passed: test(ok(gm) && ok(gmPrev) && gm > gmPrev, gm, gmPrev), detail: `${pct(gmPrev)} → ${pct(gm)}` },
    { name: "Higher asset turnover", passed: test(ok(at) && ok(atPrev) && at > atPrev, at, atPrev), detail: `${fx(atPrev)} → ${fx(at)}` },
  ];
  return {
    score: checks.filter((c) => c.passed === true).length,
    evaluated: checks.filter((c) => c.passed !== null).length,
    checks,
  };
}

export type AltmanResult = { z: number; zone: "safe" | "grey" | "distress"; parts: Record<string, number> } | { z: null; missing: string[] };

/** Original Altman Z-Score for public companies. Not designed for banks/insurers. */
export function altmanZ(v: Values, marketValueEquity: N): AltmanResult {
  const ta = v.TotalAssets;
  const wc = ok(v.WorkingCapital) ? v.WorkingCapital : ok(v.CurrentAssets) && ok(v.CurrentLiabilities) ? v.CurrentAssets - v.CurrentLiabilities : null;
  const inputs: Record<string, N | undefined> = {
    "working capital": wc, "retained earnings": v.RetainedEarnings, EBIT: ebit(v), "market value of equity": marketValueEquity,
    "total liabilities": v.TotalLiabilitiesNetMinorityInterest, revenue: v.TotalRevenue, "total assets": ta,
  };
  const missing = Object.entries(inputs).filter(([, x]) => !ok(x)).map(([k]) => k);
  if (missing.length > 0 || !ok(ta) || ta === 0) return { z: null, missing };
  const parts = {
    "X1 working capital / assets": wc! / ta,
    "X2 retained earnings / assets": v.RetainedEarnings! / ta,
    "X3 EBIT / assets": ebit(v)! / ta,
    "X4 market equity / liabilities": marketValueEquity! / v.TotalLiabilitiesNetMinorityInterest!,
    "X5 sales / assets": v.TotalRevenue! / ta,
  };
  const [x1, x2, x3, x4, x5] = Object.values(parts);
  const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
  return { z, zone: z > 2.99 ? "safe" : z >= 1.81 ? "grey" : "distress", parts };
}

export type BeneishResult = { m: number; likelyManipulator: boolean; parts: Record<string, number> } | { m: null; missing: string[] };

/** Beneish eight-variable M-Score; above -1.78 flags a likely earnings manipulator. */
export function beneish(cur: Values, prev: Values): BeneishResult {
  const need = ["AccountsReceivable", "TotalRevenue", "CurrentAssets", "NetPPE", "TotalAssets", "DepreciationAndAmortization",
    "SellingGeneralAndAdministration", "CurrentLiabilities", "NetIncome"] as const;
  const missing = new Set<string>();
  for (const k of need) {
    if (!ok(cur[k])) missing.add(k);
    if (!ok(prev[k])) missing.add(k);
  }
  const cogs = (v: Values): N => (ok(v.CostOfRevenue) ? v.CostOfRevenue : ok(v.GrossProfit) && ok(v.TotalRevenue) ? v.TotalRevenue - v.GrossProfit : null);
  if (!ok(cogs(cur)) || !ok(cogs(prev))) missing.add("CostOfRevenue");
  if (!ok(cur.OperatingCashFlow)) missing.add("OperatingCashFlow");
  if (missing.size > 0) return { m: null, missing: [...missing] };

  const g = (v: Values) => (v.TotalRevenue! - cogs(v)!) / v.TotalRevenue!;
  const quality = (v: Values) => 1 - (v.CurrentAssets! + v.NetPPE!) / v.TotalAssets!;
  const depRate = (v: Values) => v.DepreciationAndAmortization! / (v.DepreciationAndAmortization! + v.NetPPE!);
  const leverage = (v: Values) => (v.CurrentLiabilities! + (v.LongTermDebt ?? 0)) / v.TotalAssets!;
  const parts = {
    DSRI: (cur.AccountsReceivable! / cur.TotalRevenue!) / (prev.AccountsReceivable! / prev.TotalRevenue!),
    GMI: g(prev) / g(cur),
    AQI: quality(cur) / quality(prev),
    SGI: cur.TotalRevenue! / prev.TotalRevenue!,
    DEPI: depRate(prev) / depRate(cur),
    SGAI: (cur.SellingGeneralAndAdministration! / cur.TotalRevenue!) / (prev.SellingGeneralAndAdministration! / prev.TotalRevenue!),
    LVGI: leverage(cur) / leverage(prev),
    TATA: (cur.NetIncome! - cur.OperatingCashFlow!) / cur.TotalAssets!,
  };
  const m =
    -4.84 + 0.92 * parts.DSRI + 0.528 * parts.GMI + 0.404 * parts.AQI + 0.892 * parts.SGI + 0.115 * parts.DEPI -
    0.172 * parts.SGAI + 4.679 * parts.TATA - 0.327 * parts.LVGI;
  if (!Number.isFinite(m)) return { m: null, missing: ["non-finite ratio (zero denominator)"] };
  return { m, likelyManipulator: m > -1.78, parts };
}

/** Graham Number: the most a defensive investor should pay, sqrt(22.5 × EPS × book value per share). */
export function grahamNumber(eps: N, bookValuePerShare: N): N {
  return ok(eps) && ok(bookValuePerShare) && eps > 0 && bookValuePerShare > 0 ? Math.sqrt(22.5 * eps * bookValuePerShare) : null;
}

/** Compound annual growth rate between the first and last positive values. */
export function cagr(values: N[]): N {
  const pts = values.filter(ok);
  if (pts.length < 2 || pts[0] <= 0 || pts[pts.length - 1] <= 0) return null;
  return Math.pow(pts[pts.length - 1] / pts[0], 1 / (pts.length - 1)) - 1;
}

export function consensusLabel(mark: N): string | null {
  if (!ok(mark)) return null;
  return mark <= 1.5 ? "Strong Buy" : mark <= 2.5 ? "Buy" : mark <= 3.5 ? "Hold" : mark <= 4.5 ? "Sell" : "Strong Sell";
}
