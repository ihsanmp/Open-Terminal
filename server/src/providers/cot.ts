// Who holds what in the futures markets, from the CFTC's weekly Commitments of Traders (positions
// as of each Tuesday, published Friday): for financial futures the Traders in Financial Futures
// report (asset managers, leveraged funds — hedge funds and CTAs — and dealers), for commodities
// the Disaggregated report (managed money, producers/merchants, swap dealers). No key needed.
//
// Crowding is read as the COT index: where the speculators' net position sits between its lowest
// and highest of the last three years (0 … 100). Near 100 the long side is crowded (little fresh
// buying left, a sharp drop if it unwinds), near 0 the short side is.

import { cached } from "../cache.js";

export type CotReport = "tff" | "dis";

export type CotMarket = { id: string; label: string; code: string; report: CotReport; group: string };

export const COT_MARKETS: CotMarket[] = [
  { id: "es", label: "S&P 500 (E-mini)", code: "13874A", report: "tff", group: "Indeks saham" },
  { id: "nq", label: "Nasdaq 100 (mini)", code: "209742", report: "tff", group: "Indeks saham" },
  { id: "rty", label: "Russell 2000 (E-mini)", code: "239742", report: "tff", group: "Indeks saham" },
  { id: "vx", label: "VIX", code: "1170E1", report: "tff", group: "Indeks saham" },
  { id: "zt", label: "Obligasi AS 2 tahun", code: "042601", report: "tff", group: "Suku bunga" },
  { id: "zn", label: "Obligasi AS 10 tahun", code: "043602", report: "tff", group: "Suku bunga" },
  { id: "sr3", label: "SOFR 3 bulan", code: "134741", report: "tff", group: "Suku bunga" },
  { id: "dx", label: "Indeks dolar (DXY)", code: "098662", report: "tff", group: "Mata uang" },
  { id: "6e", label: "Euro", code: "099741", report: "tff", group: "Mata uang" },
  { id: "6j", label: "Yen", code: "097741", report: "tff", group: "Mata uang" },
  { id: "6b", label: "Pound", code: "096742", report: "tff", group: "Mata uang" },
  { id: "btc", label: "Bitcoin (CME)", code: "133741", report: "tff", group: "Kripto" },
  { id: "eth", label: "Ether (CME)", code: "146021", report: "tff", group: "Kripto" },
  { id: "gc", label: "Emas", code: "088691", report: "dis", group: "Logam" },
  { id: "si", label: "Perak", code: "084691", report: "dis", group: "Logam" },
  { id: "hg", label: "Tembaga", code: "085692", report: "dis", group: "Logam" },
  { id: "pl", label: "Platinum", code: "076651", report: "dis", group: "Logam" },
  { id: "cl", label: "Minyak WTI", code: "067651", report: "dis", group: "Energi" },
  { id: "ng", label: "Gas alam", code: "023651", report: "dis", group: "Energi" },
  { id: "zc", label: "Jagung", code: "002602", report: "dis", group: "Pertanian" },
  { id: "zs", label: "Kedelai", code: "005602", report: "dis", group: "Pertanian" },
  { id: "zw", label: "Gandum", code: "001602", report: "dis", group: "Pertanian" },
  { id: "kc", label: "Kopi", code: "083731", report: "dis", group: "Pertanian" },
  { id: "cc", label: "Kakao", code: "073732", report: "dis", group: "Pertanian" },
  { id: "sb", label: "Gula", code: "080732", report: "dis", group: "Pertanian" },
];

/** One week: each group's net (long − short) in contracts, and the open interest. */
export type CotWeek = {
  date: string;
  openInterest: number;
  /** The speculators: leveraged funds (financials) or managed money (commodities). */
  spec: number;
  /** The other large holders: asset managers (financials) or swap dealers (commodities). */
  other: number;
  /** The hedgers: dealers (financials) or producers/merchants (commodities). */
  hedgers: number;
};

export type CotSeries = CotMarket & {
  /** The groups' names for this report. */
  names: { spec: string; other: string; hedgers: string };
  weeks: CotWeek[];
  latest: CotWeek | null;
  /** The speculators' net change over the latest week. */
  specChange: number | null;
  /** The speculators' net as a share of open interest, in percent. */
  specPctOi: number | null;
  /** 0 … 100: the speculators' net between its 3-year low and high. */
  cotIndex: number | null;
  crowding: "crowded-long" | "crowded-short" | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const NAMES: Record<CotReport, CotSeries["names"]> = {
  tff: { spec: "Leveraged funds", other: "Asset managers", hedgers: "Dealers" },
  dis: { spec: "Managed money", other: "Swap dealers", hedgers: "Produsen/pedagang" },
};

/** A report row as a week. */
export function weekOf(report: CotReport, r: Record<string, unknown>): CotWeek | null {
  const date = String(r.report_date_as_yyyy_mm_dd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (report === "tff")
    return {
      date,
      openInterest: num(r.open_interest_all),
      spec: num(r.lev_money_positions_long) - num(r.lev_money_positions_short),
      other: num(r.asset_mgr_positions_long) - num(r.asset_mgr_positions_short),
      hedgers: num(r.dealer_positions_long_all) - num(r.dealer_positions_short_all),
    };
  return {
    date,
    openInterest: num(r.open_interest_all),
    spec: num(r.m_money_positions_long_all) - num(r.m_money_positions_short_all),
    other: num(r.swap_positions_long_all) - num(r.swap__positions_short_all),
    hedgers: num(r.prod_merc_positions_long) - num(r.prod_merc_positions_short),
  };
}

/** A market's weeks, oldest first, read into its crowding. */
export function seriesOf(m: CotMarket, weeks: CotWeek[]): CotSeries {
  const sorted = [...weeks].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;
  const window = sorted.slice(-156);
  let cotIndex: number | null = null;
  if (latest && window.length >= 26) {
    const lo = Math.min(...window.map((w) => w.spec));
    const hi = Math.max(...window.map((w) => w.spec));
    cotIndex = hi > lo ? Math.round(((latest.spec - lo) / (hi - lo)) * 100) : 50;
  }
  return {
    ...m,
    names: NAMES[m.report],
    weeks: sorted,
    latest,
    specChange: latest && prev ? latest.spec - prev.spec : null,
    specPctOi: latest && latest.openInterest > 0 ? Math.round((latest.spec / latest.openInterest) * 1000) / 10 : null,
    cotIndex,
    crowding: cotIndex == null ? null : cotIndex >= 85 ? "crowded-long" : cotIndex <= 15 ? "crowded-short" : null,
  };
}

const DATASET: Record<CotReport, string> = { tff: "gpe5-46if", dis: "72hh-3qpy" };

async function fetchReport(report: CotReport, since: string): Promise<Array<Record<string, unknown>>> {
  const codes = COT_MARKETS.filter((m) => m.report === report).map((m) => `'${m.code}'`).join(",");
  const where = encodeURIComponent(`cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000'`);
  const url = `https://publicreporting.cftc.gov/resource/${DATASET[report]}.json?$limit=50000&$where=${where}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`cftc ${res.status}`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

/** Every market's last three years; an hour in the cache (weekly, but Friday's report is picked up within the hour). */
export function cotBoard(now = Date.now()): Promise<CotSeries[]> {
  return cached("cot:board", 3_600_000, async () => {
    const since = new Date(now - 3 * 366 * 86_400_000).toISOString().slice(0, 10);
    const [tff, dis] = await Promise.all([fetchReport("tff", since), fetchReport("dis", since)]);
    const byCode = new Map<string, CotWeek[]>();
    for (const [report, rows] of [["tff", tff], ["dis", dis]] as const)
      for (const r of rows) {
        const w = weekOf(report, r);
        const code = String(r.cftc_contract_market_code ?? "");
        if (!w || !code) continue;
        (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(w);
      }
    return COT_MARKETS.map((m) => seriesOf(m, byCode.get(m.code) ?? []));
  });
}
