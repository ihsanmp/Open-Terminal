// SEC EDGAR — insider transactions (Form 4), straight from the primary source.
// Free, no key, no rate-limit games (SEC just asks for an identifying User-Agent
// and stays under ~10 req/s, both trivially satisfied here).
import { XMLParser } from "fast-xml-parser";

// SEC rejects requests whose User-Agent doesn't look like "<app/company> <contact-email>" —
// a bare product name or URL gets a flat 403, so this exact shape matters. SEC uses it to
// reach whoever's operating a deployment if their traffic misbehaves, so self-hosters should
// set SEC_EDGAR_CONTACT to their own email; this default is just enough to pass the check.
const UA = `OpenTerminal ${process.env.SEC_EDGAR_CONTACT ?? "ertassellireplay@gmail.com"}`;
const parser = new XMLParser({ ignoreAttributes: false });

async function edgarFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`sec edgar ${res.status} for ${url}`);
  return res.json();
}

let tickerMap: Map<string, string> | null = null;

/** Ticker -> zero-padded 10-digit CIK, from SEC's full company list (cached in-process). */
async function resolveCik(symbol: string): Promise<string | null> {
  if (!tickerMap) {
    const data = await edgarFetch("https://www.sec.gov/files/company_tickers.json");
    tickerMap = new Map();
    for (const row of Object.values(data) as Array<{ ticker: string; cik_str: number }>) {
      tickerMap.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
    }
  }
  return tickerMap.get(symbol.toUpperCase()) ?? null;
}

export type InsiderTransaction = {
  filingDate: string; // ISO
  transactionDate: string; // ISO
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionCode: string;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
};

type FilingRef = { accessionNumber: string; filingDate: string; primaryDocument: string };

async function recentForm4Filings(cik: string, limit: number): Promise<FilingRef[]> {
  const data = await edgarFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const recent = data?.filings?.recent;
  if (!recent) return [];
  const out: FilingRef[] = [];
  for (let i = 0; i < recent.form.length && out.length < limit; i++) {
    if (recent.form[i] !== "4") continue;
    out.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      primaryDocument: recent.primaryDocument[i],
    });
  }
  return out;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

async function parseForm4(cik: string, filing: FilingRef): Promise<InsiderTransaction[]> {
  const accessionNoDashes = filing.accessionNumber.replace(/-/g, "");
  // primaryDocument is the XSLT-rendered viewer path (e.g. "xslF345X06/form4.xml") —
  // the raw data XML sits at the accession folder root under its own filename.
  const filename = filing.primaryDocument.split("/").pop();
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${filename}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const xml = await res.text();
  const doc = parser.parse(xml)?.ownershipDocument;
  if (!doc) return [];

  const owner = doc.reportingOwner;
  const ownerName: string = owner?.reportingOwnerId?.rptOwnerName ?? "Unknown";
  const rel = owner?.reportingOwnerRelationship ?? {};
  const isDirector = rel.isDirector === "1" || rel.isDirector === true;
  const isOfficer = rel.isOfficer === "1" || rel.isOfficer === true;
  const isTenPercentOwner = rel.isTenPercentOwner === "1" || rel.isTenPercentOwner === true;
  const ownerTitle: string | null = rel.officerTitle || null;

  // Open-market buys/sells only (nonDerivativeTable) — grants/option exercises live in
  // derivativeTable and are routine compensation, not the signal people watch this for.
  const raw = doc.nonDerivativeTable?.nonDerivativeTransaction;
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : [raw];

  return rows.map((r: any): InsiderTransaction => {
    const shares = num(r.transactionAmounts?.transactionShares?.value);
    const price = num(r.transactionAmounts?.transactionPricePerShare?.value);
    return {
      filingDate: filing.filingDate,
      transactionDate: r.transactionDate?.value ?? filing.filingDate,
      ownerName,
      ownerTitle,
      isDirector,
      isOfficer,
      isTenPercentOwner,
      transactionCode: r.transactionCoding?.transactionCode ?? "?",
      acquiredDisposed: r.transactionAmounts?.transactionAcquiredDisposedCode?.value ?? null,
      shares,
      pricePerShare: price,
      value: shares !== null && price !== null ? shares * price : null,
      sharesOwnedAfter: num(r.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value),
    };
  });
}

/** Most recent open-market insider transactions for a symbol, newest first. */
export async function insiderTransactions(symbol: string, filingLimit = 20): Promise<InsiderTransaction[]> {
  const cik = await resolveCik(symbol);
  if (!cik) return [];
  const filings = await recentForm4Filings(cik, filingLimit);
  const parsed = await Promise.all(filings.map((f) => parseForm4(cik, f).catch(() => [])));
  return parsed.flat().sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}

// ---- annual financial statements from XBRL company facts (US filers) ----

// Field -> us-gaap tags in priority order. `sign: -1` flips cash outflows to match
// Yahoo's convention (capex, dividends and buybacks are reported as negatives there).
const GAAP_TAGS: Record<string, { tags: string[]; sign?: 1 | -1; instant?: boolean; unit?: string }> = {
  TotalRevenue: { tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"] },
  CostOfRevenue: { tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"] },
  GrossProfit: { tags: ["GrossProfit"] },
  ResearchAndDevelopment: { tags: ["ResearchAndDevelopmentExpense"] },
  SellingGeneralAndAdministration: { tags: ["SellingGeneralAndAdministrativeExpense"] },
  OperatingIncome: { tags: ["OperatingIncomeLoss"] },
  InterestExpense: { tags: ["InterestExpense", "InterestExpenseNonoperating"] },
  PretaxIncome: { tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"] },
  TaxProvision: { tags: ["IncomeTaxExpenseBenefit"] },
  NetIncome: { tags: ["NetIncomeLoss", "ProfitLoss"] },
  BasicEPS: { tags: ["EarningsPerShareBasic"], unit: "USD/shares" },
  DilutedEPS: { tags: ["EarningsPerShareDiluted"], unit: "USD/shares" },
  DilutedAverageShares: { tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
  CashAndCashEquivalents: { tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], instant: true },
  AccountsReceivable: { tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], instant: true },
  Inventory: { tags: ["InventoryNet"], instant: true },
  CurrentAssets: { tags: ["AssetsCurrent"], instant: true },
  NetPPE: { tags: ["PropertyPlantAndEquipmentNet"], instant: true },
  TotalAssets: { tags: ["Assets"], instant: true },
  CurrentLiabilities: { tags: ["LiabilitiesCurrent"], instant: true },
  LongTermDebt: { tags: ["LongTermDebtNoncurrent", "LongTermDebt"], instant: true },
  TotalLiabilitiesNetMinorityInterest: { tags: ["Liabilities"], instant: true },
  RetainedEarnings: { tags: ["RetainedEarningsAccumulatedDeficit"], instant: true },
  StockholdersEquity: { tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], instant: true },
  OrdinarySharesNumber: { tags: ["CommonStockSharesOutstanding"], instant: true, unit: "shares" },
  OperatingCashFlow: { tags: ["NetCashProvidedByUsedInOperatingActivities"] },
  CapitalExpenditure: { tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], sign: -1 },
  DepreciationAndAmortization: { tags: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"] },
  StockBasedCompensation: { tags: ["ShareBasedCompensation"] },
  CashDividendsPaid: { tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], sign: -1 },
  RepurchaseOfCapitalStock: { tags: ["PaymentsForRepurchaseOfCommonStock"], sign: -1 },
  // Summed into TotalDebt below.
  _LongTermDebtTotal: { tags: ["LongTermDebt"], instant: true },
  _LongTermDebtCurrent: { tags: ["LongTermDebtCurrent"], instant: true },
  _ShortTermBorrowings: { tags: ["ShortTermBorrowings", "CommercialPaper"], instant: true },
};

type Fact = { start?: string; end: string; val: number; form: string; fp: string; filed: string };

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** Same shape as yahoo.fundamentals, built from 10-K XBRL facts. */
export async function annualFundamentals(symbol: string): Promise<{ currency: string; years: Array<{ date: string; values: Record<string, number | null> }> }> {
  const cik = await resolveCik(symbol.replace("-", "."));
  if (!cik) throw new Error(`sec edgar: no CIK for ${symbol}`);
  const facts = (await edgarFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`))?.facts?.["us-gaap"] ?? {};

  // For each field, the first tag that has annual data wins; within it the latest filing per period end.
  const byField = new Map<string, Map<string, number>>();
  for (const [field, spec] of Object.entries(GAAP_TAGS)) {
    for (const tag of spec.tags) {
      const series: Fact[] = facts[tag]?.units?.[spec.unit ?? "USD"] ?? [];
      const annual = series.filter(
        (f) => f.form === "10-K" && f.fp === "FY" && (spec.instant ? !f.start : f.start && days(f.start, f.end) > 330 && days(f.start, f.end) < 400)
      );
      if (annual.length === 0) continue;
      const byEnd = new Map<string, Fact>();
      for (const f of annual) {
        const prev = byEnd.get(f.end);
        if (!prev || f.filed > prev.filed) byEnd.set(f.end, f);
      }
      byField.set(field, new Map([...byEnd].map(([end, f]) => [end, f.val * (spec.sign ?? 1)])));
      break;
    }
  }

  const ends = [...(byField.get("TotalAssets")?.keys() ?? byField.get("NetIncome")?.keys() ?? [])].sort().slice(-5);
  if (ends.length === 0) throw new Error(`sec edgar: no annual facts for ${symbol}`);
  // Fiscal years don't always end on the same calendar day; match flows within a few days of each balance date.
  const at = (field: string, end: string): number | null => {
    const m = byField.get(field);
    if (!m) return null;
    if (m.has(end)) return m.get(end)!;
    for (const [e, v] of m) if (Math.abs(days(e, end)) <= 7) return v;
    return null;
  };

  const years = ends.map((end) => {
    const values: Record<string, number | null> = {};
    for (const field of Object.keys(GAAP_TAGS)) if (!field.startsWith("_")) values[field] = at(field, end);
    const ocf = values.OperatingCashFlow;
    const capex = values.CapitalExpenditure;
    values.FreeCashFlow = ocf !== null ? ocf + (capex ?? 0) : null;
    values.GrossProfit ??= values.TotalRevenue !== null && values.CostOfRevenue !== null ? values.TotalRevenue - values.CostOfRevenue : null;
    values.WorkingCapital = values.CurrentAssets !== null && values.CurrentLiabilities !== null ? values.CurrentAssets - values.CurrentLiabilities : null;
    const ltdTotal = at("_LongTermDebtTotal", end) ?? (values.LongTermDebt !== null ? values.LongTermDebt + (at("_LongTermDebtCurrent", end) ?? 0) : null);
    values.TotalDebt = ltdTotal !== null ? ltdTotal + (at("_ShortTermBorrowings", end) ?? 0) : null;
    values.EBIT = null;
    values.EBITDA =
      values.OperatingIncome !== null && values.DepreciationAndAmortization !== null ? values.OperatingIncome + values.DepreciationAndAmortization : null;
    return { date: end, values };
  });
  return { currency: "USD", years };
}
