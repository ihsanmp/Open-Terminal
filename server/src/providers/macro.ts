// The Macro page's data: the US Treasury curve (1 month … 30 years), its spreads, 10-year yields
// abroad, the main indices, the dollar and FX, commodities and crypto — live, each with its move
// since the previous close, from TradingView's chart feed — and the economy (Fed funds, inflation,
// jobs) from FRED. Should TradingView be out of reach, the curve falls back to FRED's daily yields.

import * as fred from "./fred.js";
import type { TvBar } from "./tvchart.js";

/** The last ~3 months of daily closes, oldest first, for a row's small chart. */
/** The periods a change can be over, and the close it's measured from for each (refs). */
export const PERIODS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
export type Period = (typeof PERIODS)[number];
type Refs = Partial<Record<Period, number>>;
/** The last ~3 months of daily closes for a row's small chart, and the closes its changes start from. */
type Spark = { spark: number[]; refs: Refs };
export type CurvePoint = { tenor: string; symbol: string; value: number | null; changeBp: number | null } & Partial<Spark>;
export type Spread = { label: string; value: number | null; changeBp: number | null };
export type MarketItem = { symbol: string; label: string; value: number | null; change: number | null; changePct: number | null } & Spark;
export type Yield10 = { symbol: string; label: string; value: number | null; changeBp: number | null } & Spark;

/** Daily bars shown in a small chart (about three months), and asked for (over a year: YTD and 1Y). */
export const SPARK_BARS = 66;
export const FETCH_BARS = 400;
const sparkOf = (bars: TvBar[] | null | undefined): number[] => (bars ?? []).map((b) => b.close).filter(Number.isFinite).slice(-SPARK_BARS);

const PERIOD_DAYS: Partial<Record<Period, number>> = { "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };

/**
 * The close each period's change is measured from: the day before for 1D, the last close on or
 * before that many days ago for the others, and the year's last close before it for YTD. A period
 * the bars don't reach back over is left out.
 */
export function refsOf(bars: TvBar[] | null | undefined): Refs {
  const ok = (bars ?? []).filter((b) => Number.isFinite(b.close));
  if (ok.length < 2) return {};
  const last = ok[ok.length - 1];
  const before = (t: number, inclusive: boolean) => {
    let found: number | undefined;
    for (const b of ok) if (inclusive ? b.time <= t : b.time < t) found = b.close;
    return found;
  };
  const refs: Refs = { "1D": ok[ok.length - 2].close };
  for (const [p, days] of Object.entries(PERIOD_DAYS) as Array<[Period, number]>) {
    const t = last.time - days * 86_400;
    if (ok[0].time <= t) refs[p] = before(t, true);
  }
  const yearStart = Date.UTC(new Date(last.time * 1000).getUTCFullYear(), 0, 1) / 1000;
  if (ok[0].time < yearStart) refs.YTD = before(yearStart, false);
  return refs;
}
export type EconItem = { label: string; value: string | null; date: string | null; note?: string };
export type Macro = {
  curve: CurvePoint[];
  spreads: Spread[];
  global10y: Yield10[];
  markets: Array<{ group: string; items: MarketItem[] }>;
  economy: EconItem[];
  /** Where the curve came from: TradingView (live) or FRED (the last daily fixing). */
  curveSource: "tradingview" | "fred";
};

/** The US curve on TradingView, and FRED's series for the same tenors. */
export const US_CURVE: Array<{ tenor: string; symbol: string; fred: string }> = [
  { tenor: "1M", symbol: "TVC:US01MY", fred: "DGS1MO" },
  { tenor: "3M", symbol: "TVC:US03MY", fred: "DGS3MO" },
  { tenor: "6M", symbol: "TVC:US06MY", fred: "DGS6MO" },
  { tenor: "1Y", symbol: "TVC:US01Y", fred: "DGS1" },
  { tenor: "2Y", symbol: "TVC:US02Y", fred: "DGS2" },
  { tenor: "3Y", symbol: "TVC:US03Y", fred: "DGS3" },
  { tenor: "5Y", symbol: "TVC:US05Y", fred: "DGS5" },
  { tenor: "7Y", symbol: "TVC:US07Y", fred: "DGS7" },
  { tenor: "10Y", symbol: "TVC:US10Y", fred: "DGS10" },
  { tenor: "20Y", symbol: "TVC:US20Y", fred: "DGS20" },
  { tenor: "30Y", symbol: "TVC:US30Y", fred: "DGS30" },
];

export const GLOBAL_10Y: Array<[symbol: string, label: string]> = [
  ["TVC:US10Y", "United States"],
  ["TVC:DE10Y", "Germany"],
  ["TVC:GB10Y", "United Kingdom"],
  ["TVC:JP10Y", "Japan"],
  ["TVC:CN10Y", "China"],
  ["TVC:ID10Y", "Indonesia"],
];

export const MARKETS: Array<{ group: string; items: Array<[symbol: string, label: string]> }> = [
  {
    group: "Indices",
    items: [
      ["SP:SPX", "S&P 500"],
      ["NASDAQ:NDX", "Nasdaq 100"],
      ["DJ:DJI", "Dow Jones"],
      ["TVC:RUT", "Russell 2000"],
      ["TVC:VIX", "VIX"],
      ["IDX:COMPOSITE", "IHSG"],
    ],
  },
  {
    group: "Dollar & FX",
    items: [
      ["TVC:DXY", "Dollar Index (DXY)"],
      ["FX:EURUSD", "EUR/USD"],
      ["FX:USDJPY", "USD/JPY"],
      ["FX:GBPUSD", "GBP/USD"],
      ["FX_IDC:USDIDR", "USD/IDR"],
    ],
  },
  {
    group: "Commodities",
    items: [
      ["TVC:GOLD", "Gold"],
      ["TVC:SILVER", "Silver"],
      ["TVC:USOIL", "WTI Crude"],
      ["TVC:UKOIL", "Brent Crude"],
      ["NYMEX:NG1!", "Natural Gas"],
      ["COMEX:HG1!", "Copper"],
    ],
  },
  {
    group: "Crypto",
    items: [
      ["BITSTAMP:BTCUSD", "Bitcoin"],
      ["BITSTAMP:ETHUSD", "Ethereum"],
    ],
  },
];

/** Every TradingView symbol the page needs, once. */
export const macroSymbols = (): string[] => [...new Set([...US_CURVE.map((c) => c.symbol), ...GLOBAL_10Y.map(([s]) => s), ...MARKETS.flatMap((g) => g.items.map(([s]) => s))])];

/** The last value and its move since the close before (daily bars, oldest first). */
export function lastAndChange(bars: TvBar[] | null | undefined): { value: number | null; change: number | null; changePct: number | null } {
  const ok = (bars ?? []).filter((b) => Number.isFinite(b.close));
  if (ok.length === 0) return { value: null, change: null, changePct: null };
  const last = ok[ok.length - 1].close;
  const prev = ok.length > 1 ? ok[ok.length - 2].close : null;
  if (prev === null) return { value: last, change: null, changePct: null };
  return { value: last, change: last - prev, changePct: prev !== 0 ? ((last - prev) / prev) * 100 : null };
}

const bp = (pctPoints: number | null) => (pctPoints === null ? null : Math.round(pctPoints * 1000) / 10); // percent points → basis points, 0.1 bp

/** The spreads traders watch, in basis points: 2s10s, 3M10Y (the recession one) and 5s30s. */
export function spreadsOf(curve: CurvePoint[]): Spread[] {
  const at = (tenor: string) => curve.find((c) => c.tenor === tenor);
  const spread = (label: string, short: string, long: string): Spread => {
    const [s, l] = [at(short), at(long)];
    if (s?.value == null || l?.value == null) return { label, value: null, changeBp: null };
    const value = Math.round((l.value - s.value) * 1000) / 10;
    const changeBp = s.changeBp != null && l.changeBp != null ? Math.round((l.changeBp - s.changeBp) * 10) / 10 : null;
    return { label, value, changeBp };
  };
  return [spread("2s10s", "2Y", "10Y"), spread("3M10Y", "3M", "10Y"), spread("5s30s", "5Y", "30Y")];
}

/** The curve and the markets from TradingView's daily bars (symbol → bars). */
export function assemble(bars: Record<string, TvBar[] | null>): Omit<Macro, "economy" | "curveSource"> {
  const curve = US_CURVE.map(({ tenor, symbol }) => {
    const q = lastAndChange(bars[symbol]);
    return { tenor, symbol, value: q.value, changeBp: bp(q.change), spark: sparkOf(bars[symbol]), refs: refsOf(bars[symbol]) };
  });
  return {
    curve,
    spreads: spreadsOf(curve),
    global10y: GLOBAL_10Y.map(([symbol, label]) => {
      const q = lastAndChange(bars[symbol]);
      return { symbol, label, value: q.value, changeBp: bp(q.change), spark: sparkOf(bars[symbol]), refs: refsOf(bars[symbol]) };
    }),
    markets: MARKETS.map(({ group, items }) => ({
      group,
      items: items.map(([symbol, label]) => ({ symbol, label, ...lastAndChange(bars[symbol]), spark: sparkOf(bars[symbol]), refs: refsOf(bars[symbol]) })),
    })),
  };
}

/** The curve from FRED's daily yields, for when TradingView is out of reach. */
export async function fredCurve(): Promise<CurvePoint[]> {
  const rows = await Promise.allSettled(US_CURVE.map((c) => fred.series(c.fred, 3)));
  return US_CURVE.map(({ tenor, symbol }, i) => {
    const r = rows[i];
    const pts = r.status === "fulfilled" ? r.value : [];
    const last = pts.at(-1)?.value ?? null;
    const prev = pts.length > 1 ? pts[pts.length - 2].value : null;
    return { tenor, symbol, value: last, changeBp: last !== null && prev !== null ? bp(last - prev) : null };
  });
}

/** A monthly index's change over 12 months, in percent, with its month. */
function yoy(points: fred.SeriesPoint[]): { value: number; date: string } | null {
  if (points.length < 13) return null;
  const last = points[points.length - 1];
  const yearAgo = points[points.length - 13];
  return { value: (last.value / yearAgo.value - 1) * 100, date: last.date };
}

/** The economy, from FRED: each item on its own, so one series down leaves the rest. */
export async function economy(): Promise<EconItem[]> {
  const get = (id: string, n = 2) => fred.series(id, n).catch(() => [] as fred.SeriesPoint[]);
  const [lo, hi, cpi, core, unrate, be10, mortgage, effr] = await Promise.all([
    get("DFEDTARL"), get("DFEDTARU"), get("CPIAUCSL", 13), get("CPILFESL", 13), get("UNRATE"), get("T10YIE"), get("MORTGAGE30US"), get("DFF"),
  ]);
  const last = (p: fred.SeriesPoint[]) => p.at(-1) ?? null;
  const pct = (v: number | undefined, digits = 2) => (v === undefined ? null : `${v.toFixed(digits)}%`);
  const [l, h] = [last(lo), last(hi)];
  const [c, cc] = [yoy(cpi), yoy(core)];
  return [
    { label: "Fed Funds Target", value: l && h ? `${l.value.toFixed(2)}–${h.value.toFixed(2)}%` : null, date: h?.date ?? null },
    { label: "Effective Fed Funds", value: pct(last(effr)?.value), date: last(effr)?.date ?? null },
    { label: "CPI (YoY)", value: pct(c?.value, 1), date: c?.date ?? null },
    { label: "Core CPI (YoY)", value: pct(cc?.value, 1), date: cc?.date ?? null },
    { label: "Unemployment", value: pct(last(unrate)?.value, 1), date: last(unrate)?.date ?? null },
    { label: "10Y Breakeven Inflation", value: pct(last(be10)?.value), date: last(be10)?.date ?? null },
    { label: "30Y Mortgage", value: pct(last(mortgage)?.value), date: last(mortgage)?.date ?? null },
  ];
}
