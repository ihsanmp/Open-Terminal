// The US Treasury's benchmark ("on-the-run") securities: for each tenor the one auctioned last —
// when it matures, its coupon, what it sold at — and the next auction, from TreasuryDirect's
// public auction data (no key). A 10-year auctioned as a reopening ("9-Year 10-Month") is still
// the 10-year benchmark, so notes and bonds are matched on their original term; bills are
// matched on their own term, since a 13-week bill can be a reopened 26-week one.

const BASE = "https://www.treasurydirect.gov/TA_WS/securities";

/** The tenors, with the term TreasuryDirect gives them. */
export const TENOR_TERMS: Array<{ tenor: string; term: string; bill: boolean }> = [
  { tenor: "1M", term: "4-Week", bill: true },
  { tenor: "3M", term: "13-Week", bill: true },
  { tenor: "6M", term: "26-Week", bill: true },
  { tenor: "1Y", term: "52-Week", bill: true },
  { tenor: "2Y", term: "2-Year", bill: false },
  { tenor: "3Y", term: "3-Year", bill: false },
  { tenor: "5Y", term: "5-Year", bill: false },
  { tenor: "7Y", term: "7-Year", bill: false },
  { tenor: "10Y", term: "10-Year", bill: false },
  { tenor: "20Y", term: "20-Year", bill: false },
  { tenor: "30Y", term: "30-Year", bill: false },
];

export type TDSecurity = {
  cusip: string;
  securityType: string;
  securityTerm: string;
  originalSecurityTerm?: string;
  reopening?: string;
  auctionDate: string;
  /** The auction's close: what TreasuryDirect gives in place of auctionDate since October 2026. */
  competitiveAuctionCloseDate?: string | null;
  issueDate: string;
  maturityDate: string;
  interestRate?: string;
  highYield?: string;
  highInvestmentRate?: string;
  bidToCoverRatio?: string;
  tips?: string;
  floatingRate?: string;
  /** "Bill", "Note", "Bond", "TIPS", "FRN": how TIPS are told apart since October 2026. */
  type?: string;
  /** A bill's investment rate at the high price (it was highInvestmentRate). */
  investmentRate?: string;
};

export type Benchmark = {
  tenor: string;
  term: string;
  type: string;
  cusip: string;
  auctionDate: string;
  issueDate: string;
  maturityDate: string;
  /** The coupon, % a year (bills pay none). */
  coupon: number | null;
  /** The yield it sold at in its last auction. */
  auctionYield: number | null;
  bidToCover: number | null;
  reopening: boolean;
  next: { auctionDate: string; issueDate: string; maturityDate: string; reopening: boolean } | null;
};

const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);
const num = (s: string | undefined) => {
  const v = s ? Number(s) : NaN;
  return Number.isFinite(v) && s !== "" ? v : null;
};
/** Plain fixed-rate securities: no TIPS, no floating-rate notes. */
const plain = (s: TDSecurity) => s.tips !== "Yes" && s.floatingRate !== "Yes";
const YEAR_MS = 365.25 * 86_400_000;
/**
 * A note or bond first sold at this term and still near it: a reopened 10-year ("9-Year
 * 10-Month") is the 10-year, an old 5-year reopened with 2 years left is not the 5-year.
 */
function isTenor(s: TDSecurity, t: (typeof TENOR_TERMS)[number]): boolean {
  if (t.bill) return s.securityType === "Bill" && s.securityTerm === t.term;
  if ((s.originalSecurityTerm || s.securityTerm) !== t.term) return false;
  const years = (Date.parse(s.maturityDate) - Date.parse(s.issueDate)) / YEAR_MS;
  // An upcoming auction may not name its dates yet.
  return !Number.isFinite(years) || years >= parseInt(t.term, 10) - 0.5;
}

/**
 * TreasuryDirect's reply as the earlier one read: every date a string (some are null now), the
 * auction's from its close, TIPS and FRNs from their type, a bill's rate from investmentRate.
 */
export function normalize(s: TDSecurity): TDSecurity {
  return {
    ...s,
    tips: s.tips || (s.type === "TIPS" ? "Yes" : "No"),
    floatingRate: s.floatingRate || (s.type === "FRN" ? "Yes" : "No"),
    highInvestmentRate: s.highInvestmentRate || s.investmentRate,
    auctionDate: s.auctionDate || s.competitiveAuctionCloseDate || "",
    issueDate: s.issueDate ?? "",
    maturityDate: s.maturityDate ?? "",
  };
}

/** Each tenor's benchmark and its next auction. */
export function benchmarks(auctioned: TDSecurity[], upcoming: TDSecurity[]): Benchmark[] {
  const out: Benchmark[] = [];
  for (const t of TENOR_TERMS) {
    const last = auctioned
      .filter((s) => plain(s) && isTenor(s, t))
      .sort((a, b) => b.auctionDate.localeCompare(a.auctionDate) || b.issueDate.localeCompare(a.issueDate))[0];
    if (!last) continue;
    const next = upcoming.filter((s) => plain(s) && isTenor(s, t)).sort((a, b) => a.auctionDate.localeCompare(b.auctionDate))[0];
    out.push({
      tenor: t.tenor,
      term: t.term,
      type: last.securityType,
      cusip: last.cusip,
      auctionDate: day(last.auctionDate),
      issueDate: day(last.issueDate),
      maturityDate: day(last.maturityDate),
      coupon: t.bill ? null : num(last.interestRate),
      auctionYield: t.bill ? num(last.highInvestmentRate) : num(last.highYield),
      bidToCover: num(last.bidToCoverRatio),
      reopening: last.reopening === "Yes",
      next: next ? { auctionDate: day(next.auctionDate), issueDate: day(next.issueDate), maturityDate: day(next.maturityDate), reopening: next.reopening === "Yes" } : null,
    });
  }
  return out;
}

async function get(path: string): Promise<TDSecurity[]> {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`treasurydirect ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("treasurydirect: unexpected reply");
  return (body as TDSecurity[]).map(normalize);
}

export async function currentBenchmarks(): Promise<Benchmark[]> {
  // Enough auctions to reach back past each tenor's last new issue (bonds reopen twice).
  const [bills, notes, bonds, upcoming] = await Promise.all([
    get("auctioned?format=json&type=Bill&pagesize=60"),
    get("auctioned?format=json&type=Note&pagesize=60"),
    get("auctioned?format=json&type=Bond&pagesize=20"),
    get("upcoming?format=json").catch(() => [] as TDSecurity[]),
  ]);
  return benchmarks([...bills, ...notes, ...bonds], upcoming);
}
