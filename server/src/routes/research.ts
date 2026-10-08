import { Router } from "express";
import { cached, cacheGet, cacheStore } from "../cache.js";
import * as yahoo from "../providers/yahoo.js";
import * as tradingview from "../providers/tradingview.js";
import * as fred from "../providers/fred.js";
import * as secedgar from "../providers/secedgar.js";
import { cryptoBase, isIndex } from "../symbols.js";
import { altmanZ, beneish, cagr, consensusLabel, grahamNumber, piotroski, yearRatios } from "../research/analysis.js";

export const researchRouter = Router();

const LABELS: Record<string, string> = {
  TotalRevenue: "Revenue", CostOfRevenue: "Cost of revenue", GrossProfit: "Gross profit", ResearchAndDevelopment: "R&D",
  SellingGeneralAndAdministration: "SG&A", OperatingIncome: "Operating income", EBIT: "EBIT", EBITDA: "EBITDA",
  InterestExpense: "Interest expense", PretaxIncome: "Pretax income", TaxProvision: "Income tax", NetIncome: "Net income",
  BasicEPS: "EPS (basic)", DilutedEPS: "EPS (diluted)", DilutedAverageShares: "Diluted shares",
  CashAndCashEquivalents: "Cash & equivalents", AccountsReceivable: "Receivables", Inventory: "Inventory",
  CurrentAssets: "Current assets", NetPPE: "Net PP&E", TotalAssets: "Total assets", CurrentLiabilities: "Current liabilities",
  LongTermDebt: "Long-term debt", TotalDebt: "Total debt", TotalLiabilitiesNetMinorityInterest: "Total liabilities",
  RetainedEarnings: "Retained earnings", StockholdersEquity: "Shareholders' equity", WorkingCapital: "Working capital",
  OrdinarySharesNumber: "Shares outstanding", OperatingCashFlow: "Operating cash flow", CapitalExpenditure: "Capital expenditure",
  FreeCashFlow: "Free cash flow", DepreciationAndAmortization: "Depreciation & amortization",
  StockBasedCompensation: "Stock-based compensation", CashDividendsPaid: "Dividends paid", RepurchaseOfCapitalStock: "Share buybacks",
};

const PER_SHARE = new Set(["BasicEPS", "DilutedEPS"]);
const ERP = 0.055; // equity risk premium used for the CAPM discount-rate default

/**
 * The CAPM risk-free rate is the 10-year government bond of the money the cash flows are in:
 * an IDR company's are discounted at Indonesia's yield, not the US one.
 */
const BOND_BY_CURRENCY: Record<string, [country: string, label: string]> = {
  IDR: ["ID", "Indonesia"], JPY: ["JP", "Japan"], GBP: ["GB", "UK"], CHF: ["CH", "Switzerland"], CNY: ["CN", "China"],
  INR: ["IN", "India"], KRW: ["KR", "Korea"], AUD: ["AU", "Australia"], CAD: ["CA", "Canada"], BRL: ["BR", "Brazil"],
  HKD: ["HK", "Hong Kong"], SGD: ["SG", "Singapore"], MYR: ["MY", "Malaysia"], TWD: ["TW", "Taiwan"], MXN: ["MX", "Mexico"],
  THB: ["TH", "Thailand"], ZAR: ["ZA", "South Africa"], SEK: ["SE", "Sweden"], NOK: ["NO", "Norway"], DKK: ["DK", "Denmark"],
  PLN: ["PL", "Poland"], TRY: ["TR", "Turkey"], PHP: ["PH", "Philippines"], NZD: ["NZ", "New Zealand"], ILS: ["IL", "Israel"],
};
/** Euro area: the company's own country's bond where it's quoted, else Germany's. */
const EURO_BONDS: Record<string, string> = { France: "FR", Italy: "IT", Spain: "ES", Netherlands: "NL" };

async function riskFreeFor(currency: string | null, country: string | null): Promise<{ rate: number; source: string }> {
  const us = async () => ({ rate: ((await cached("fred:DGS10", 3_600_000, () => fred.latest("DGS10")))?.value ?? 4) / 100, source: "US 10Y" });
  let bond: [string, string] | undefined = currency ? BOND_BY_CURRENCY[currency] : undefined;
  if (currency === "EUR") bond = country && EURO_BONDS[country] ? [EURO_BONDS[country], country] : ["DE", "Germany"];
  if (!bond) return us().catch(() => ({ rate: 0.04, source: "assumed" }));
  const [code, label] = bond;
  try {
    const rows = await cached(`rf:${code}`, 3_600_000, () => tradingview.scanAt("global", { symbols: { tickers: [`TVC:${code}10Y`] }, columns: ["close"] }));
    const y = rows[0]?.d[0];
    if (typeof y === "number" && Number.isFinite(y)) return { rate: y / 100, source: `${label} 10Y` };
  } catch {
    // the US yield below, named as such
  }
  return us().catch(() => ({ rate: 0.04, source: "assumed" }));
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const settled = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);

async function buildResearch(symbol: string) {
  const [fundR, profR] = await Promise.allSettled([
    // Yahoo covers every market; SEC XBRL is the official US fallback when Yahoo is rate-limited.
    yahoo.fundamentals(symbol).catch((err) => (symbol.includes(".") ? Promise.reject(err) : secedgar.annualFundamentals(symbol))),
    tradingview.researchProfile(symbol),
  ]);
  const fund = settled(fundR);
  const prof = settled(profR);
  if (!fund && !prof) throw new Error(`no fundamentals or profile data for ${symbol}`);
  const warnings: string[] = [];
  if (!fund) warnings.push("Annual financial statements are unavailable for this symbol.");
  if (!prof) warnings.push("Profile, analyst and peer data are unavailable for this symbol.");

  let price: number | null = prof?.close ?? null;
  let currency: string | null = prof?.currency ?? null;
  let name: string = prof?.description ?? symbol;
  if (price === null) {
    const q = await yahoo.quoteFromChart(symbol).catch(() => null);
    price = q?.price ?? null;
    currency = q?.currency ?? currency;
    name = q?.name ?? name;
  }

  // Statement currency and TradingView's fundamental currency (USD for non-US names) can
  // both differ from the trading currency, so everything shown next to price is converted.
  const statementCurrency = fund?.currency ?? currency;
  const rate = async (from: string | null) =>
    from && currency ? tradingview.fxRate(from, currency).catch(() => yahoo.fxRate(from, currency!)).catch(() => null) : 1;
  const [stmtToTrading, fundamentalToTrading, riskFree] = await Promise.all([
    rate(statementCurrency),
    rate(prof?.fundamental_currency_code ?? currency),
    riskFreeFor(statementCurrency, prof?.country ?? null),
  ]);

  const years = fund?.years ?? [];
  const values = years.map((y) => y.values);
  const latest = values[values.length - 1];
  const prev = values[values.length - 2];
  const prev2 = values[values.length - 3];

  const section = (keys: readonly string[]) =>
    keys
      .map((key) => ({ key, label: LABELS[key] ?? key, perShare: PER_SHARE.has(key), values: values.map((v) => v[key]) }))
      .filter((row) => row.values.some((x) => x !== null));

  const shares = latest?.OrdinarySharesNumber ?? prof?.total_shares_outstanding ?? null;
  const marketCapStatement = price !== null && shares && stmtToTrading ? (price * shares) / stmtToTrading : null;
  const isFinancial = prof?.sector === "Finance";
  if (isFinancial)
    warnings.push("Financial company: Altman Z, Beneish M and DCF are designed for non-financial firms — use the justified P/B model under Valuation instead.");

  const bvps = latest?.StockholdersEquity && shares ? latest.StockholdersEquity / shares : null;
  const graham = grahamNumber(latest?.DilutedEPS ?? null, bvps);

  const beta = prof?.beta_1_year ?? 1;
  const rf = riskFree.rate;
  const discountRate = clamp(rf + beta * ERP, 0.05, 0.4);
  // Banks and insurers are valued on their book: P/B = (ROE − g) / (r − g), with ROE averaged
  // over the last three years and g what's kept of it (ROE × retention), held under r.
  const roes = values.slice(-3).map((v) => (v.NetIncome != null && v.StockholdersEquity ? v.NetIncome / v.StockholdersEquity : null)).filter((x): x is number => x !== null);
  const avgRoe = roes.length ? roes.reduce((a, b) => a + b, 0) / roes.length : null;
  const payout = latest?.CashDividendsPaid != null && latest?.NetIncome ? clamp(Math.abs(latest.CashDividendsPaid) / latest.NetIncome, 0, 1) : null;
  const revenueCagr = cagr(values.map((v) => v.TotalRevenue));
  const convert = (x: number | null | undefined, k: number | null) => (x !== null && x !== undefined && k ? x * k : null);

  return {
    symbol,
    name,
    price,
    currency,
    statementCurrency,
    stmtToTrading,
    profile: prof && {
      tvTicker: prof.ticker, exchange: prof.exchange, sector: prof.sector, industry: prof.industry, country: prof.country,
      employees: prof.number_of_employees,
    },
    ttm: prof && {
      marketCap: convert(prof.market_cap_basic, fundamentalToTrading), enterpriseValue: convert(prof.enterprise_value_fq, fundamentalToTrading),
      pe: prof.price_earnings_ttm, pb: prof.price_book_fq, ps: prof.price_revenue_ttm, evEbitda: prof.enterprise_value_ebitda_ttm,
      grossMargin: prof.gross_margin_ttm, operatingMargin: prof.operating_margin_ttm, netMargin: prof.net_margin_ttm,
      roe: prof.return_on_equity_fq, roa: prof.return_on_assets_fq, roic: prof.return_on_invested_capital_fq,
      revenueGrowth: prof.total_revenue_yoy_growth_ttm, epsGrowth: prof.earnings_per_share_diluted_yoy_growth_ttm,
      dividendYield: prof.dividends_yield_current, payoutRatio: prof.dividend_payout_ratio_ttm, beta: prof.beta_1_year,
      currentRatio: prof.current_ratio_fq, debtToEquity: prof.debt_to_equity_fq, eps: prof.earnings_per_share_diluted_ttm,
    },
    analysts: prof?.recommendation_total
      ? {
          strongBuy: prof.recommendation_buy ?? 0, buy: prof.recommendation_over ?? 0, hold: prof.recommendation_hold ?? 0,
          sell: prof.recommendation_under ?? 0, strongSell: prof.recommendation_sell ?? 0, total: prof.recommendation_total,
          score: prof.recommendation_mark, consensus: consensusLabel(prof.recommendation_mark),
          targetLow: convert(prof.price_target_low, fundamentalToTrading),
          targetAverage: convert(prof.price_target_average, fundamentalToTrading),
          targetHigh: convert(prof.price_target_high, fundamentalToTrading),
        }
      : null,
    statements: {
      years: years.map((y) => y.date),
      income: section(yahoo.STATEMENT_FIELDS.income),
      balance: section(yahoo.STATEMENT_FIELDS.balance),
      cashflow: section(yahoo.STATEMENT_FIELDS.cashflow),
    },
    ratios: values.map((v, i) => ({ date: years[i].date, ...yearRatios(v, values[i - 1]) })),
    scores: {
      piotroski: latest && prev ? piotroski(latest, prev, prev2) : null,
      altman: latest ? altmanZ(latest, marketCapStatement) : null,
      beneish: latest && prev ? beneish(latest, prev) : null,
      graham: graham !== null && stmtToTrading ? { value: graham * stmtToTrading, eps: latest?.DilutedEPS ?? null, bookValuePerShare: bvps } : null,
    },
    dcf: latest && {
      freeCashFlow: latest.FreeCashFlow,
      netDebt: (latest.TotalDebt ?? 0) - (latest.CashAndCashEquivalents ?? 0),
      shares,
      growth: clamp(revenueCagr ?? 0.05, -0.05, 0.25),
      discountRate,
      terminalGrowth: 0.025,
      years: 5,
      riskFree: rf,
      riskFreeSource: riskFree.source,
      beta,
      equityRiskPremium: ERP,
      revenueCagr,
    },
    bookModel:
      isFinancial && bvps !== null && avgRoe !== null
        ? {
            bookValuePerShare: bvps,
            roe: avgRoe,
            roeYears: roes.length,
            payout,
            growth: clamp(avgRoe * (1 - (payout ?? 0.5)), 0, discountRate - 0.01),
            costOfEquity: discountRate,
          }
        : null,
    warnings,
  };
}

researchRouter.get("/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (cryptoBase(symbol) || isIndex(symbol)) {
    return res.status(400).json({ error: "Equity research covers individual stocks — pick a company ticker (e.g. AAPL, BBCA.JK)." });
  }
  try {
    const key = `research:${symbol}`;
    let data = cacheGet<Awaited<ReturnType<typeof buildResearch>>>(key);
    if (!data) {
      data = await buildResearch(symbol);
      // A partial result (a provider was down) is only kept briefly so it can heal.
      cacheStore(key, data, data.warnings.some((w) => w.includes("unavailable")) ? 10 * 60_000 : 6 * 3_600_000);
    }
    res.json(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[research]", symbol, detail);
    res.status(502).json({ error: "Research data is temporarily unavailable for this symbol.", detail });
  }
});

researchRouter.get("/:symbol/peers", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`peers:${symbol}`, 6 * 3_600_000, async () => tradingview.peers(await tradingview.researchProfile(symbol)));
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Peer data is unavailable for this symbol.", detail: err instanceof Error ? err.message : String(err) });
  }
});
