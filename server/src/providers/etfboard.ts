// ETFs and breadth, the "quality" of a market move:
//   - the main US ETFs by theme (sectors, size and factors, bonds, commodities, abroad, crypto):
//     each one's moves over a day, week, month, three months and the year, its relative volume
//     (today's against its 10-day average: money arriving), and where it stands against the S&P
//     500 over one and three months, placed on a rotation map (leading, weakening, lagging,
//     improving: the relative-rotation idea);
//   - S&P 500 breadth from its members: how many are above their 50- and 200-day averages, rose
//     today, sit near a 52-week high or low, sector by sector; a rally carried by few stocks is
//     narrower (and more fragile) than one carried by most;
//   - the US spot crypto ETFs' daily net flows (Farside), summed over a week and a month.

import { cached } from "../cache.js";
import { etfFlows } from "./etfflows.js";
import * as tradingview from "./tradingview.js";

export type EtfDef = { symbol: string; tv: string; label: string };
export type EtfGroup = { id: string; label: string; etfs: EtfDef[] };

const E = (tv: string, label: string): EtfDef => ({ symbol: tv.split(":")[1], tv, label });

export const ETF_GROUPS: EtfGroup[] = [
  {
    id: "sectors",
    label: "Sektor S&P 500",
    etfs: [
      E("AMEX:XLK", "Teknologi"), E("AMEX:XLC", "Komunikasi"), E("AMEX:XLY", "Konsumen siklikal"), E("AMEX:XLF", "Keuangan"),
      E("AMEX:XLI", "Industri"), E("AMEX:XLB", "Bahan baku"), E("AMEX:XLE", "Energi"), E("AMEX:XLV", "Kesehatan"),
      E("AMEX:XLP", "Barang pokok"), E("AMEX:XLU", "Utilitas"), E("AMEX:XLRE", "Properti"),
    ],
  },
  {
    id: "style",
    label: "Indeks, ukuran & faktor",
    etfs: [
      E("AMEX:SPY", "S&P 500"), E("NASDAQ:QQQ", "Nasdaq 100"), E("AMEX:DIA", "Dow Jones"), E("AMEX:IWM", "Russell 2000 (small cap)"),
      E("AMEX:RSP", "S&P 500 bobot setara"), E("AMEX:MTUM", "Momentum"), E("AMEX:VLUE", "Value"), E("AMEX:QUAL", "Kualitas"), E("AMEX:USMV", "Volatilitas rendah"),
      E("NASDAQ:SMH", "Semikonduktor"), E("AMEX:XBI", "Bioteknologi"), E("AMEX:KRE", "Bank regional"), E("AMEX:ITB", "Pembangun rumah"),
    ],
  },
  {
    id: "bonds",
    label: "Obligasi",
    etfs: [E("NASDAQ:SHY", "AS 1–3 tahun"), E("NASDAQ:IEF", "AS 7–10 tahun"), E("NASDAQ:TLT", "AS 20 tahun+"), E("AMEX:TIP", "TIPS (terlindung inflasi)"), E("AMEX:LQD", "Korporasi investment grade"), E("AMEX:HYG", "Korporasi high yield"), E("NASDAQ:EMB", "Obligasi pasar berkembang")],
  },
  {
    id: "commodities",
    label: "Komoditas",
    etfs: [E("AMEX:GLD", "Emas"), E("AMEX:SLV", "Perak"), E("AMEX:GDX", "Penambang emas"), E("AMEX:USO", "Minyak"), E("AMEX:UNG", "Gas alam"), E("AMEX:DBA", "Pertanian"), E("AMEX:DBC", "Komoditas luas"), E("AMEX:COPX", "Penambang tembaga")],
  },
  {
    id: "global",
    label: "Internasional",
    etfs: [E("AMEX:EFA", "Negara maju ex-AS"), E("AMEX:EEM", "Pasar berkembang"), E("AMEX:FXI", "Tiongkok"), E("AMEX:EWJ", "Jepang"), E("AMEX:EWG", "Jerman"), E("AMEX:INDA", "India"), E("AMEX:EWZ", "Brasil"), E("AMEX:EIDO", "Indonesia"), E("AMEX:EWY", "Korea Selatan"), E("AMEX:EWT", "Taiwan")],
  },
  {
    id: "crypto",
    label: "Kripto",
    etfs: [E("NASDAQ:IBIT", "Bitcoin (BlackRock)"), E("AMEX:FBTC", "Bitcoin (Fidelity)"), E("AMEX:GBTC", "Bitcoin (Grayscale)"), E("NASDAQ:ETHA", "Ether (BlackRock)"), E("NASDAQ:COIN", "Coinbase (saham)"), E("NASDAQ:MSTR", "Strategy (saham)")],
  },
];

export type Rotation = "leading" | "weakening" | "lagging" | "improving";

export type EtfRow = EtfDef & {
  group: string;
  price: number | null;
  day: number | null;
  week: number | null;
  month: number | null;
  month3: number | null;
  ytd: number | null;
  relVolume: number | null;
  /** Against SPY, in percentage points. */
  rel1m: number | null;
  rel3m: number | null;
  rotation: Rotation | null;
};

/** Where an ETF sits on the rotation map: its 3-month lead over SPY and whether the last month added to it. */
export function rotationOf(rel3m: number | null, rel1m: number | null): Rotation | null {
  if (rel3m == null || rel1m == null) return null;
  // The last month's pace against the three months' average month.
  const momentum = rel1m - rel3m / 3;
  if (rel3m >= 0) return momentum >= 0 ? "leading" : "weakening";
  return momentum >= 0 ? "improving" : "lagging";
}

const COLUMNS = ["close", "change", "Perf.W", "Perf.1M", "Perf.3M", "Perf.YTD", "relative_volume_10d_calc"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function etfBoard(): Promise<EtfRow[]> {
  return cached("etf:board", 60_000, async () => {
    const all = ETF_GROUPS.flatMap((g) => g.etfs.map((e) => ({ ...e, group: g.id })));
    const data = await tradingview.scanAt("america", { symbols: { tickers: all.map((e) => e.tv) }, columns: COLUMNS });
    const by = new Map(data.map((r) => [r.s, r.d]));
    const spy = by.get("AMEX:SPY");
    const spy1m = num(spy?.[3]);
    const spy3m = num(spy?.[4]);
    return all.map((e) => {
      const d = by.get(e.tv);
      const month = num(d?.[3]);
      const month3 = num(d?.[4]);
      const rel1m = month != null && spy1m != null ? month - spy1m : null;
      const rel3m = month3 != null && spy3m != null ? month3 - spy3m : null;
      return {
        ...e,
        price: num(d?.[0]),
        day: num(d?.[1]),
        week: num(d?.[2]),
        month,
        month3,
        ytd: num(d?.[5]),
        relVolume: num(d?.[6]),
        rel1m,
        rel3m,
        rotation: e.symbol === "SPY" ? null : rotationOf(rel3m, rel1m),
      };
    });
  });
}

export type SectorBreadth = { sector: string; members: number; above50: number; above200: number; advancing: number };
export type Breadth = {
  members: number;
  above50: number;
  above200: number;
  advancing: number;
  declining: number;
  nearHigh: number;
  nearLow: number;
  sectors: SectorBreadth[];
  /** Equal-weight S&P against the cap-weighted one over a month (RSP − SPY): negative is a narrow market. */
  equalVsCap1m: number | null;
  read: string;
  asOf: number;
};

type Member = { close: number | null; sma50: number | null; sma200: number | null; change: number | null; hi52: number | null; lo52: number | null; sector: string };

const pct = (k: number, of: number) => (of ? Math.round((k / of) * 1000) / 10 : 0);

/** Breadth figures from the members (exported for the tests). */
export function breadthOf(members: Member[], equalVsCap1m: number | null, now = Date.now()): Breadth {
  const valid = members.filter((m) => m.close != null);
  const n = valid.length;
  const above50 = valid.filter((m) => m.sma50 != null && m.close! > m.sma50).length;
  const above200 = valid.filter((m) => m.sma200 != null && m.close! > m.sma200).length;
  const advancing = valid.filter((m) => (m.change ?? 0) > 0).length;
  const declining = valid.filter((m) => (m.change ?? 0) < 0).length;
  const nearHigh = valid.filter((m) => m.hi52 != null && m.close! >= m.hi52 * 0.98).length;
  const nearLow = valid.filter((m) => m.lo52 != null && m.close! <= m.lo52 * 1.02).length;
  const bySector = new Map<string, Member[]>();
  for (const m of valid) (bySector.get(m.sector) ?? bySector.set(m.sector, []).get(m.sector)!).push(m);
  const sectors = [...bySector.entries()]
    .map(([sector, ms]) => ({
      sector,
      members: ms.length,
      above50: pct(ms.filter((m) => m.sma50 != null && m.close! > m.sma50).length, ms.length),
      above200: pct(ms.filter((m) => m.sma200 != null && m.close! > m.sma200).length, ms.length),
      advancing: pct(ms.filter((m) => (m.change ?? 0) > 0).length, ms.length),
    }))
    .sort((a, b) => b.above50 - a.above50);
  const a50 = pct(above50, n);
  const a200 = pct(above200, n);
  let read: string;
  if (a200 >= 60 && a50 >= 60) read = "Partisipasi luas: mayoritas saham ikut dalam tren naik — kenaikan indeks didukung banyak saham.";
  else if (a200 >= 50 && a50 < 40) read = "Tren jangka panjang masih sehat tapi momentum jangka pendek melemah: koreksi di dalam tren naik.";
  else if (a200 < 40 && a50 >= 60) read = "Pemulihan jangka pendek yang luas dari dasar yang lemah: perlu konfirmasi apakah berlanjut.";
  else if (a200 < 40) read = "Partisipasi sempit/lemah: sebagian besar saham di bawah rata-rata 200 hari — rawan bila indeks naik hanya karena segelintir saham besar.";
  else read = "Partisipasi campuran: tidak ada konfirmasi kuat dari breadth.";
  if (equalVsCap1m != null && equalVsCap1m < -2) read += ` S&P bobot setara tertinggal ${Math.abs(equalVsCap1m).toFixed(1)} pp dari S&P biasa sebulan ini: kenaikan terkonsentrasi di saham raksasa.`;
  return { members: n, above50: a50, above200: a200, advancing, declining, nearHigh, nearLow, sectors, equalVsCap1m, read, asOf: now };
}

export function breadth(): Promise<Breadth> {
  return cached("breadth:spx", 120_000, async () => {
    const [rows, etfs] = await Promise.all([
      tradingview.scanAt("america", { symbols: { symbolset: ["SYML:SP;SPX"] }, columns: ["close", "SMA50", "SMA200", "change", "price_52_week_high", "price_52_week_low", "sector"], range: [0, 600] }),
      etfBoard().catch(() => [] as EtfRow[]),
    ]);
    const members: Member[] = rows.map((r) => ({ close: num(r.d[0]), sma50: num(r.d[1]), sma200: num(r.d[2]), change: num(r.d[3]), hi52: num(r.d[4]), lo52: num(r.d[5]), sector: String(r.d[6] ?? "Lainnya") }));
    const rsp = etfs.find((e) => e.symbol === "RSP");
    const spy = etfs.find((e) => e.symbol === "SPY");
    return breadthOf(members, rsp?.month != null && spy?.month != null ? rsp.month - spy.month : null);
  });
}

export type CryptoEtfFlows = {
  coin: string;
  days: Array<{ date: string; total: number; byFund: Record<string, number> }>;
  week: number | null;
  month: number | null;
  streak: { direction: "in" | "out"; days: number } | null;
};

/** A coin's ETF flows per day (all funds summed), the last week's and month's totals, the run of in/out days. */
export function summariseFlows(coin: string, flows: Array<{ ticker: string; date: string; usdMillions: number }>): CryptoEtfFlows {
  const byDay = new Map<string, { date: string; total: number; byFund: Record<string, number> }>();
  for (const f of flows) {
    const d = byDay.get(f.date) ?? { date: f.date, total: 0, byFund: {} };
    d.total += f.usdMillions;
    d.byFund[f.ticker] = (d.byFund[f.ticker] ?? 0) + f.usdMillions;
    byDay.set(f.date, d);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  const sum = (k: number) => (days.length >= Math.min(k, 1) ? days.slice(-k).reduce((s, d) => s + d.total, 0) : null);
  let streak: CryptoEtfFlows["streak"] = null;
  const last = days.at(-1);
  if (last && last.total !== 0) {
    const dir = last.total > 0 ? "in" : "out";
    let k = 0;
    for (let i = days.length - 1; i >= 0 && (dir === "in" ? days[i].total > 0 : days[i].total < 0); i--) k++;
    streak = { direction: dir, days: k };
  }
  return { coin, days, week: days.length ? sum(5) : null, month: days.length ? sum(21) : null, streak };
}

export async function cryptoEtfFlows(): Promise<CryptoEtfFlows[]> {
  const coins = ["BTC", "ETH", "SOL"];
  const lists = await Promise.all(coins.map((c) => etfFlows(c).catch(() => [])));
  return coins.map((c, i) => summariseFlows(c, lists[i]));
}
