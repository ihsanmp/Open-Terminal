// The macro regime: which way growth and inflation are moving, the four quadrants they make, and
// what each asset has actually done in each quadrant since 2002, so the "asset bias" is a measured
// record rather than a rule of thumb (the textbook bias is shown beside it, labelled as such).
//
//   growth momentum    = industrial production's year-on-year growth now against three months
//                        before (published with a month's lag, so last month's), with the copper
//                        to gold ratio's three-month change (the market's read of the cycle);
//   inflation momentum = CPI's year-on-year rate now against three months before (also lagged a
//                        month), with oil's three-month change.
//
//   growth ↑ inflation ↓  Goldilocks      growth ↑ inflation ↑  Reflasi
//   growth ↓ inflation ↑  Stagflasi       growth ↓ inflation ↓  Deflasi / perlambatan
//
// Each month since 2002 is classified with what was known at its end; the next month's return of
// every asset is filed under that month's regime. FRED serves today's revised figures rather than
// the first prints, so the record is a little kinder than real time would have been: it says so.
// A risk overlay (VIX, high-yield spreads, the 2s10s curve, the dollar) reads stress now.

import { cached } from "../cache.js";
import * as fred from "./fred.js";
import * as tradingview from "./tradingview.js";
import * as tvchart from "./tvchart.js";

export type Quadrant = "goldilocks" | "reflation" | "stagflation" | "deflation";

export const QUADRANTS: Record<Quadrant, { label: string; growth: "up" | "down"; inflation: "up" | "down"; note: string }> = {
  goldilocks: { label: "Goldilocks", growth: "up", inflation: "down", note: "Pertumbuhan menguat, inflasi melandai: biasanya paling ramah bagi saham, terutama teknologi, dan aset berisiko." },
  reflation: { label: "Reflasi", growth: "up", inflation: "up", note: "Pertumbuhan dan inflasi sama-sama naik: komoditas, energi, saham siklikal dan keuangan lazim unggul; obligasi tertekan." },
  stagflation: { label: "Stagflasi", growth: "down", inflation: "up", note: "Pertumbuhan melemah tapi inflasi naik: emas, komoditas dan sektor defensif lazim bertahan; saham dan obligasi sama-sama tertekan." },
  deflation: { label: "Deflasi / perlambatan", growth: "down", inflation: "down", note: "Pertumbuhan dan inflasi sama-sama turun: obligasi pemerintah, dolar dan sektor defensif lazim unggul; komoditas dan saham siklikal tertekan." },
};

export type RegimeAsset = { key: string; label: string; tv: string; textbook: Record<Quadrant, -1 | 0 | 1> };

const T = (goldilocks: -1 | 0 | 1, reflation: -1 | 0 | 1, stagflation: -1 | 0 | 1, deflation: -1 | 0 | 1) => ({ goldilocks, reflation, stagflation, deflation });

export const ASSETS: RegimeAsset[] = [
  { key: "spx", label: "S&P 500", tv: "TVC:SPX", textbook: T(1, 1, -1, -1) },
  { key: "ndx", label: "Nasdaq 100", tv: "NASDAQ:NDX", textbook: T(1, 0, -1, -1) },
  { key: "rut", label: "Russell 2000", tv: "TVC:RUT", textbook: T(1, 1, -1, -1) },
  { key: "eem", label: "Pasar berkembang (EEM)", tv: "AMEX:EEM", textbook: T(1, 1, -1, -1) },
  { key: "xlk", label: "Sektor teknologi (XLK)", tv: "AMEX:XLK", textbook: T(1, 0, -1, -1) },
  { key: "xlf", label: "Sektor keuangan (XLF)", tv: "AMEX:XLF", textbook: T(1, 1, -1, -1) },
  { key: "xle", label: "Sektor energi (XLE)", tv: "AMEX:XLE", textbook: T(0, 1, 1, -1) },
  { key: "xlu", label: "Utilitas (XLU)", tv: "AMEX:XLU", textbook: T(0, -1, 1, 1) },
  { key: "xlp", label: "Barang pokok (XLP)", tv: "AMEX:XLP", textbook: T(0, -1, 1, 1) },
  { key: "tlt", label: "Obligasi AS 20 th+ (TLT)", tv: "NASDAQ:TLT", textbook: T(0, -1, -1, 1) },
  { key: "gold", label: "Emas", tv: "COMEX:GC1!", textbook: T(-1, 1, 1, 0) },
  { key: "silver", label: "Perak", tv: "COMEX:SI1!", textbook: T(0, 1, 1, -1) },
  { key: "copper", label: "Tembaga", tv: "COMEX:HG1!", textbook: T(1, 1, 0, -1) },
  { key: "oil", label: "Minyak WTI", tv: "TVC:USOIL", textbook: T(0, 1, 1, -1) },
  { key: "dxy", label: "Indeks dolar (DXY)", tv: "TVC:DXY", textbook: T(-1, -1, 1, 1) },
  { key: "eurusd", label: "EUR/USD", tv: "FX:EURUSD", textbook: T(1, 1, -1, -1) },
  { key: "usdjpy", label: "USD/JPY", tv: "FX:USDJPY", textbook: T(1, 1, 0, -1) },
  { key: "btc", label: "Bitcoin", tv: "BITSTAMP:BTCUSD", textbook: T(1, 1, -1, -1) },
];

type Monthly = Map<string, number>;

const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
export const shiftMonth = (key: string, by: number) => {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** The latest value at or before a month. */
function atOrBefore(s: Monthly, key: string, maxBack = 3): number | null {
  for (let k = 0; k <= maxBack; k++) {
    const v = s.get(shiftMonth(key, -k));
    if (v != null) return v;
  }
  return null;
}

/** Year-on-year growth in percent at the latest month at or before `key` that has it. */
function yoyAt(s: Monthly, key: string): number | null {
  for (let k = 0; k <= 3; k++) {
    const at = shiftMonth(key, -k);
    const now = s.get(at);
    const then = s.get(shiftMonth(at, -12));
    if (now != null && then != null && then !== 0) return (now / then - 1) * 100;
  }
  return null;
}

const change = (s: Monthly, key: string, months: number) => {
  const now = atOrBefore(s, key, 0);
  const then = atOrBefore(s, shiftMonth(key, -months), 0);
  return now != null && then != null && then !== 0 ? now / then - 1 : null;
};

export type Inputs = { indpro: Monthly; cpi: Monthly; copper: Monthly; gold: Monthly; oil: Monthly };

export type Reading = {
  month: string;
  growth: number;
  inflation: number;
  quadrant: Quadrant;
  parts: { indproMomentum: number; copperGold3m: number; cpiMomentum: number; oil3m: number };
};

/** The regime at the end of a month, from what was known then (the official data a month late). */
export function readingAt(inp: Inputs, month: string): Reading | null {
  const lagged = shiftMonth(month, -1);
  const indNow = yoyAt(inp.indpro, lagged);
  const indThen = yoyAt(inp.indpro, shiftMonth(lagged, -3));
  const cpiNow = yoyAt(inp.cpi, lagged);
  const cpiThen = yoyAt(inp.cpi, shiftMonth(lagged, -3));
  const cu = atOrBefore(inp.copper, month, 0);
  const au = atOrBefore(inp.gold, month, 0);
  const cu3 = atOrBefore(inp.copper, shiftMonth(month, -3), 0);
  const au3 = atOrBefore(inp.gold, shiftMonth(month, -3), 0);
  const oil3m = change(inp.oil, month, 3);
  if (indNow == null || indThen == null || cpiNow == null || cpiThen == null || !cu || !au || !cu3 || !au3 || oil3m == null) return null;
  const indproMomentum = indNow - indThen;
  const copperGold3m = cu / au / (cu3 / au3) - 1;
  const cpiMomentum = cpiNow - cpiThen;
  const growth = 0.5 * Math.tanh(indproMomentum / 1.0) + 0.5 * Math.tanh(copperGold3m / 0.06);
  const inflation = 0.6 * Math.tanh(cpiMomentum / 0.3) + 0.4 * Math.tanh(oil3m / 0.15);
  const quadrant: Quadrant = growth > 0 ? (inflation > 0 ? "reflation" : "goldilocks") : inflation > 0 ? "stagflation" : "deflation";
  return { month, growth, inflation, quadrant, parts: { indproMomentum, copperGold3m, cpiMomentum, oil3m } };
}

export type Stat = { n: number; mean: number; hit: number; t: number };

/** Mean, share of rises and t-statistic of a list of monthly returns (in percent). */
export function statOf(xs: number[]): Stat | null {
  if (xs.length < 3) return null;
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { n, mean, hit: (xs.filter((x) => x > 0).length / n) * 100, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0 };
}

export type AssetRow = {
  key: string;
  label: string;
  price: number | null;
  /** Price against its 10-month average: above is an uptrend. */
  aboveSma10: boolean | null;
  change1m: number | null;
  change3m: number | null;
  /** Next-month returns in each regime since 2002 (or the asset's start). */
  byRegime: Record<Quadrant, Stat | null>;
  /** Unconditional: every month. */
  all: Stat | null;
  textbook: -1 | 0 | 1;
  /** The measured bias in the current regime: its mean beats the asset's usual month with t ≥ 2. */
  measured: "positive" | "negative" | "none";
};

export type Risk = {
  vix: number | null;
  vixMedian1y: number | null;
  hySpread: number | null;
  hyMedian1y: number | null;
  hyChange3m: number | null;
  curve2s10s: number | null;
  dxy3m: number | null;
  score: number;
  label: "risk-on" | "netral" | "risk-off";
  notes: string[];
};

export type Regime = {
  current: Reading;
  previous: Reading | null;
  /** Months in a row in the current quadrant. */
  streak: number;
  history: Reading[];
  /** How often each quadrant has come since 2002, and how long it lasts on average. */
  frequency: Record<Quadrant, { months: number; share: number; avgRun: number }>;
  assets: AssetRow[];
  shortlist: { long: Array<{ key: string; label: string; why: string }>; avoid: Array<{ key: string; label: string; why: string }> };
  risk: Risk;
  sinceMonth: string;
  /** How recent each input is: the official data's last month, the daily series' last day. */
  sources: { indpro: string | null; cpi: string | null; vix: string | null; hy: string | null; curve: string | null; markets: string | null };
  asOf: number;
  caveat: string;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function riskOf(vix: fred.SeriesPoint[], hy: fred.SeriesPoint[], t10y2y: fred.SeriesPoint[], dxy3m: number | null): Risk {
  const last = (s: fred.SeriesPoint[]) => s.at(-1)?.value ?? null;
  const yearOf = (s: fred.SeriesPoint[]) => s.slice(-252).map((p) => p.value);
  const v = last(vix);
  const vMed = median(yearOf(vix));
  const h = last(hy);
  const hMed = median(yearOf(hy));
  const h3 = hy.length > 63 ? hy[hy.length - 64].value : null;
  const c = last(t10y2y);
  let score = 0;
  const notes: string[] = [];
  if (v != null && vMed != null) {
    if (v > 25 || v > vMed * 1.3) (score -= 1), notes.push(`VIX ${v.toFixed(1)} di atas biasanya (median setahun ${vMed.toFixed(1)}): pasar cemas.`);
    else if (v < vMed * 0.9) (score += 1), notes.push(`VIX ${v.toFixed(1)} di bawah median setahun ${vMed.toFixed(1)}: pasar tenang.`);
    else notes.push(`VIX ${v.toFixed(1)} dekat median setahun ${vMed.toFixed(1)}.`);
  }
  if (h != null && hMed != null) {
    const widening = h3 != null ? h - h3 : null;
    if (h > hMed + 0.5 || (widening != null && widening > 0.75)) (score -= 1), notes.push(`Spread obligasi high-yield ${h.toFixed(2)}% melebar (median setahun ${hMed.toFixed(2)}%): kredit tertekan.`);
    else if (h < hMed && (widening == null || widening <= 0)) (score += 1), notes.push(`Spread high-yield ${h.toFixed(2)}% sempit/menyempit: kredit tenang.`);
    else notes.push(`Spread high-yield ${h.toFixed(2)}% (median setahun ${hMed.toFixed(2)}%).`);
  }
  if (c != null) notes.push(c < 0 ? `Kurva 2s10s terbalik (${c.toFixed(2)} pp): pasar obligasi memperhitungkan perlambatan.` : `Kurva 2s10s ${c.toFixed(2)} pp (tidak terbalik).`);
  if (dxy3m != null) {
    if (dxy3m > 0.04) (score -= 1), notes.push(`Dolar menguat ${(dxy3m * 100).toFixed(1)}% dalam 3 bulan: likuiditas global mengetat.`);
    else if (dxy3m < -0.03) (score += 1), notes.push(`Dolar melemah ${(dxy3m * 100).toFixed(1)}% dalam 3 bulan: likuiditas global melonggar.`);
  }
  return { vix: v, vixMedian1y: vMed, hySpread: h, hyMedian1y: hMed, hyChange3m: h != null && h3 != null ? h - h3 : null, curve2s10s: c, dxy3m, score, label: score >= 1 ? "risk-on" : score <= -1 ? "risk-off" : "netral", notes };
}

const toMonthly = (points: Array<{ date: string; value: number }>): Monthly => {
  const m: Monthly = new Map();
  for (const p of points) m.set(p.date.slice(0, 7), p.value);
  return m;
};
/** Monthly bars by month: a bar opens with its session, which for a future can be the evening
 *  before the month's first day (UTC), so a few days are added before reading its month. */
export const barsMonthly = (bars: tvchart.TvBar[] | null | undefined): Monthly => {
  const m: Monthly = new Map();
  for (const b of bars ?? []) m.set(monthKey(b.time * 1000 + 5 * 86_400_000), b.close);
  return m;
};

/** The whole reading: the regime now, its history and record, the shortlist and the risk overlay. */
export function analyse(inp: Inputs, closes: Record<string, Monthly>, risk: Risk, now = Date.now(), sources: Regime["sources"] = { indpro: null, cpi: null, vix: null, hy: null, curve: null, markets: null }): Regime | null {
  const thisMonth = monthKey(now);
  const start = "2002-01";
  const history: Reading[] = [];
  for (let m = start; m <= thisMonth; m = shiftMonth(m, 1)) {
    const r = readingAt(inp, m);
    if (r) history.push(r);
  }
  const current = history.at(-1);
  if (!current) return null;
  const previous = history.at(-2) ?? null;
  let streak = 0;
  for (let k = history.length - 1; k >= 0 && history[k].quadrant === current.quadrant; k--) streak++;

  const frequency = {} as Regime["frequency"];
  for (const q of Object.keys(QUADRANTS) as Quadrant[]) {
    const months = history.filter((h) => h.quadrant === q).length;
    let runs = 0;
    for (let k = 0; k < history.length; k++) if (history[k].quadrant === q && (k === 0 || history[k - 1].quadrant !== q)) runs++;
    frequency[q] = { months, share: history.length ? (months / history.length) * 100 : 0, avgRun: runs ? months / runs : 0 };
  }

  const assets: AssetRow[] = ASSETS.map((a) => {
    const c = closes[a.key] ?? new Map();
    const returns: Record<Quadrant, number[]> = { goldilocks: [], reflation: [], stagflation: [], deflation: [] };
    const all: number[] = [];
    for (const h of history) {
      const next = shiftMonth(h.month, 1);
      if (next >= thisMonth) continue; // the month under way isn't a full month yet
      const p0 = c.get(h.month);
      const p1 = c.get(next);
      if (p0 == null || p1 == null || p0 === 0) continue;
      const r = (p1 / p0 - 1) * 100;
      returns[h.quadrant].push(r);
      all.push(r);
    }
    const byRegime = { goldilocks: statOf(returns.goldilocks), reflation: statOf(returns.reflation), stagflation: statOf(returns.stagflation), deflation: statOf(returns.deflation) };
    const cur = byRegime[current.quadrant];
    const base = statOf(all);
    let measured: AssetRow["measured"] = "none";
    if (cur && base && cur.n >= 12) {
      // Against the asset's own usual month, not against zero: a rising asset rises in every regime.
      const xs = returns[current.quadrant];
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - cur.mean) ** 2, 0) / (xs.length - 1));
      const tVsBase = sd > 0 ? (cur.mean - base.mean) / (sd / Math.sqrt(xs.length)) : 0;
      if (tVsBase >= 2 && cur.mean > 0) measured = "positive";
      else if (tVsBase <= -2 && cur.mean < base.mean) measured = "negative";
    }
    const months = [...c.keys()].sort();
    const lastKey = months.at(-1);
    const price = lastKey ? (c.get(lastKey) ?? null) : null;
    const sma = months.length >= 10 ? months.slice(-10).reduce((s, k) => s + (c.get(k) ?? 0), 0) / 10 : null;
    const ch = (k: number) => (lastKey ? change(c, lastKey, k) : null);
    const c1 = ch(1);
    const c3 = ch(3);
    return {
      key: a.key,
      label: a.label,
      price,
      aboveSma10: price != null && sma != null ? price > sma : null,
      change1m: c1 == null ? null : c1 * 100,
      change3m: c3 == null ? null : c3 * 100,
      byRegime,
      all: base,
      textbook: a.textbook[current.quadrant],
      measured,
    };
  });

  const long: Regime["shortlist"]["long"] = [];
  const avoid: Regime["shortlist"]["avoid"] = [];
  for (const a of assets) {
    const s = a.byRegime[current.quadrant];
    const rec = s ? `rata-rata ${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(2)}%/bln, naik ${s.hit.toFixed(0)}% dari ${s.n} bulan` : "";
    if (a.measured === "positive" && a.aboveSma10) long.push({ key: a.key, label: a.label, why: `Terukur unggul di ${QUADRANTS[current.quadrant].label} (${rec}) dan trennya naik (di atas rata-rata 10 bulan).` });
    else if (a.measured === "none" && a.textbook === 1 && a.aboveSma10 && (a.change3m ?? 0) > 0) long.push({ key: a.key, label: a.label, why: `Teori regime mendukung dan trennya naik; catatan historisnya belum signifikan (${rec}).` });
    if (a.measured === "negative" && a.aboveSma10 === false) avoid.push({ key: a.key, label: a.label, why: `Terukur tertinggal di ${QUADRANTS[current.quadrant].label} (${rec}) dan trennya turun.` });
    else if (a.measured === "none" && a.textbook === -1 && a.aboveSma10 === false && (a.change3m ?? 0) < 0) avoid.push({ key: a.key, label: a.label, why: `Teori regime tidak mendukung dan trennya turun; catatan historisnya belum signifikan (${rec}).` });
  }

  return {
    current,
    previous,
    streak,
    history: history.slice(-36),
    frequency,
    assets,
    shortlist: { long, avoid },
    risk,
    sinceMonth: history[0].month,
    sources,
    asOf: now,
    caveat:
      "Data industri dan CPI dari FRED adalah angka yang sudah direvisi, bukan rilis pertama, jadi rekam jejak sedikit lebih baik daripada yang bisa dicapai saat itu. Rata-rata bulanan bukan janji: rentangnya lebar dan satu bulan bisa jauh dari rata-rata.",
  };
}

/** The regime now; a quarter of an hour in the cache (the official inputs change monthly, the markets by the minute). */
export function regime(now = Date.now()): Promise<Regime> {
  return cached("regime:now", 15 * 60_000, async () => {
    const [indpro, cpi, vixHist, hy, curveHist, bars, live] = await Promise.all([
      fred.series("INDPRO", 400),
      fred.series("CPIAUCSL", 400),
      fred.series("VIXCLS", 400),
      fred.series("BAMLH0A0HYM2", 400),
      fred.series("T10Y2Y", 400),
      tvchart.bars(ASSETS.map((a) => a.tv), "1M", 300, 30_000),
      // FRED posts the VIX and the 2s10s a day or two late: today's from TradingView, on top of its history.
      tradingview.batchQuotes(["TVC:VIX", "TVC:US10Y", "TVC:US02Y"], (s) => [s]).catch(() => new Map()),
    ]);
    const today = new Date(now).toISOString().slice(0, 10);
    const withToday = (s: fred.SeriesPoint[], v: number | null | undefined) => (v != null && Number.isFinite(v) ? [...s.filter((p) => p.date < today), { date: today, value: v }] : s);
    const vix = withToday(vixHist, live.get("TVC:VIX")?.price);
    const y10 = live.get("TVC:US10Y")?.price;
    const y2 = live.get("TVC:US02Y")?.price;
    const curve = withToday(curveHist, y10 != null && y2 != null ? Math.round((y10 - y2) * 100) / 100 : null);
    const closes: Record<string, Monthly> = {};
    for (const a of ASSETS) closes[a.key] = barsMonthly(bars[a.tv]);
    const dxyKey = [...closes.dxy.keys()].sort().at(-1);
    const dxy3m = dxyKey ? change(closes.dxy, dxyKey, 3) : null;
    const inputs: Inputs = { indpro: toMonthly(indpro), cpi: toMonthly(cpi), copper: closes.copper, gold: closes.gold, oil: closes.oil };
    const lastMonth = (s: fred.SeriesPoint[]) => s.at(-1)?.date.slice(0, 7) ?? null;
    const lastBar = Object.values(bars).flatMap((b) => (b?.length ? [b[b.length - 1].time] : [])).sort((a, b) => b - a)[0];
    const sources: Regime["sources"] = {
      indpro: lastMonth(indpro),
      cpi: lastMonth(cpi),
      vix: vix.at(-1)?.date ?? null,
      hy: hy.at(-1)?.date ?? null,
      curve: curve.at(-1)?.date ?? null,
      markets: lastBar ? new Date(now).toISOString().slice(0, 10) : null,
    };
    const out = analyse(inputs, closes, riskOf(vix, hy, curve, dxy3m), now, sources);
    if (!out) throw new Error("regime: not enough data");
    return out;
  });
}
