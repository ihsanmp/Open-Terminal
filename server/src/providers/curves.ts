// Futures forward curves: each listed contract month of a market, front to back, priced in one
// TradingView scanner request (NYMEX:CLZ2026, NYMEX:CLF2027 …). A curve rising into the future is
// in contango (storage and financing priced in, a calm market), one falling in backwardation
// (the near month bid up: scarce supply, or fear now). For the money markets (SOFR 3-month, Fed
// funds) a contract's price is 100 minus the rate the market expects for its period, so the curve
// turned over is the path of rates the market prices.

import { cached } from "../cache.js";
import * as tradingview from "./tradingview.js";

const MONTH_CODES = "FGHJKMNQUVXZ";
const MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export type CurveKind = "price" | "rate";
export type CurveGroup = "energy" | "metal" | "index" | "rates" | "volatility" | "crypto" | "currency" | "agri";

export type CurveProduct = {
  id: string;
  label: string;
  group: CurveGroup;
  /** TradingView's root, with its exchange: NYMEX:CL. */
  root: string;
  /** The continuous front contract (NYMEX:CL1!), to find where the live curve starts. */
  front: string;
  /** The month letters listed (F … Z). */
  months: string;
  /** How many contracts to show. */
  count: number;
  unit: string;
  kind: CurveKind;
};

const ALL = MONTH_CODES;
const QUARTERLY = "HMUZ";

export const PRODUCTS: CurveProduct[] = [
  { id: "cl", label: "Minyak WTI", group: "energy", root: "NYMEX:CL", front: "NYMEX:CL1!", months: ALL, count: 12, unit: "$/barel", kind: "price" },
  { id: "bz", label: "Minyak Brent", group: "energy", root: "NYMEX:BB", front: "NYMEX:BB1!", months: ALL, count: 12, unit: "$/barel", kind: "price" },
  { id: "ng", label: "Gas alam", group: "energy", root: "NYMEX:NG", front: "NYMEX:NG1!", months: ALL, count: 12, unit: "$/MMBtu", kind: "price" },
  { id: "gc", label: "Emas", group: "metal", root: "COMEX:GC", front: "COMEX:GC1!", months: "GJMQVZ", count: 8, unit: "$/oz", kind: "price" },
  { id: "si", label: "Perak", group: "metal", root: "COMEX:SI", front: "COMEX:SI1!", months: "HKNUZ", count: 6, unit: "$/oz", kind: "price" },
  { id: "hg", label: "Tembaga", group: "metal", root: "COMEX:HG", front: "COMEX:HG1!", months: "HKNUZ", count: 6, unit: "$/lb", kind: "price" },
  { id: "es", label: "S&P 500 (E-mini)", group: "index", root: "CME_MINI:ES", front: "CME_MINI:ES1!", months: QUARTERLY, count: 5, unit: "poin", kind: "price" },
  { id: "nq", label: "Nasdaq 100 (E-mini)", group: "index", root: "CME_MINI:NQ", front: "CME_MINI:NQ1!", months: QUARTERLY, count: 4, unit: "poin", kind: "price" },
  { id: "sr3", label: "SOFR 3 bulan", group: "rates", root: "CME:SR3", front: "CME:SR31!", months: QUARTERLY, count: 12, unit: "% (tersirat)", kind: "rate" },
  { id: "zq", label: "Fed funds 30 hari", group: "rates", root: "CBOT:ZQ", front: "CBOT:ZQ1!", months: ALL, count: 12, unit: "% (tersirat)", kind: "rate" },
  { id: "zn", label: "Obligasi AS 10 tahun", group: "rates", root: "CBOT:ZN", front: "CBOT:ZN1!", months: QUARTERLY, count: 3, unit: "harga", kind: "price" },
  { id: "vx", label: "VIX", group: "volatility", root: "CBOE:VX", front: "CBOE:VX1!", months: ALL, count: 8, unit: "poin", kind: "price" },
  { id: "btc", label: "Bitcoin (CME)", group: "crypto", root: "CME:BTC", front: "CME:BTC1!", months: ALL, count: 6, unit: "$", kind: "price" },
  { id: "eth", label: "Ether (CME)", group: "crypto", root: "CME:ETH", front: "CME:ETH1!", months: ALL, count: 6, unit: "$", kind: "price" },
  { id: "6e", label: "Euro (EUR/USD)", group: "currency", root: "CME:6E", front: "CME:6E1!", months: QUARTERLY, count: 4, unit: "$/€", kind: "price" },
  { id: "6j", label: "Yen (JPY/USD)", group: "currency", root: "CME:6J", front: "CME:6J1!", months: QUARTERLY, count: 4, unit: "$/¥", kind: "price" },
  { id: "zc", label: "Jagung", group: "agri", root: "CBOT:ZC", front: "CBOT:ZC1!", months: "HKNUZ", count: 6, unit: "¢/bushel", kind: "price" },
  { id: "zs", label: "Kedelai", group: "agri", root: "CBOT:ZS", front: "CBOT:ZS1!", months: "FHKNQUX", count: 7, unit: "¢/bushel", kind: "price" },
  { id: "zw", label: "Gandum", group: "agri", root: "CBOT:ZW", front: "CBOT:ZW1!", months: "HKNUZ", count: 6, unit: "¢/bushel", kind: "price" },
  { id: "kc", label: "Kopi", group: "agri", root: "ICEUS:KC", front: "ICEUS:KC1!", months: "HKNUZ", count: 5, unit: "¢/lb", kind: "price" },
];

export const productOf = (id: string) => PRODUCTS.find((p) => p.id === id) ?? null;

/** A contract month, from this month on: its ticker (NYMEX:CLZ2026), its month (2026-12) and label. */
export type ContractMonth = { ticker: string; month: string; label: string };

/** The listed months from `now`'s month on, more than asked for (the front few may have expired). */
export function contractMonths(p: CurveProduct, now = new Date()): ContractMonth[] {
  const out: ContractMonth[] = [];
  const y0 = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  for (let k = 0; k < 48 && out.length < p.count + 3; k++) {
    const m = (m0 + k) % 12;
    const y = y0 + Math.floor((m0 + k) / 12);
    const code = MONTH_CODES[m];
    if (!p.months.includes(code)) continue;
    out.push({ ticker: `${p.root}${code}${y}`, month: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTH_ID[m]} ${String(y).slice(2)}` });
  }
  return out;
}

export type CurvePoint = ContractMonth & { price: number; value: number; changePercent: number | null; volume: number | null };

export type Curve = {
  id: string;
  label: string;
  group: CurveGroup;
  unit: string;
  kind: CurveKind;
  points: CurvePoint[];
  /** For a price curve: contango, backwardation or flat, from the front to the last point. For
   *  a rate curve: the rate path, falling (cuts priced) or rising (hikes). */
  shape: "contango" | "backwardation" | "flat" | "cuts" | "hikes" | null;
  /** The last point against the front, in percent (rate curves: in percentage points). */
  spread: number | null;
  /** Price curves: the front-to-~12-month spread as a yearly rate (the carry), in percent. */
  annualCarry: number | null;
  /** Rate curves: the change in rate priced to the last point, in quarter-point moves. */
  moves25: number | null;
  asOf: number;
};

const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/**
 * The curve from the quotes: from the contract the continuous front is (expired months before it
 * dropped), `count` points; its shape and carry. Exported for the tests.
 */
export function buildCurve(p: CurveProduct, months: ContractMonth[], quotes: Map<string, { price: number | null; changePercent: number | null; volume: number | null }>, now = Date.now()): Curve {
  let priced = months
    .map((m) => ({ m, q: quotes.get(m.ticker) }))
    .filter((x): x is { m: ContractMonth; q: { price: number; changePercent: number | null; volume: number | null } } => x.q?.price != null && Number.isFinite(x.q.price));
  const front = quotes.get(p.front)?.price;
  if (front != null) {
    const at = priced.findIndex((x) => Math.abs(x.q.price - front) <= Math.abs(front) * 1e-9);
    if (at > 0) priced = priced.slice(at);
  }
  const points: CurvePoint[] = priced.slice(0, p.count).map(({ m, q }) => ({
    ...m,
    price: q.price,
    value: p.kind === "rate" ? Math.round((100 - q.price) * 10_000) / 10_000 : q.price,
    changePercent: q.changePercent,
    volume: q.volume,
  }));
  const first = points[0];
  const last = points.at(-1);
  let shape: Curve["shape"] = null;
  let spread: number | null = null;
  let annualCarry: number | null = null;
  let moves25: number | null = null;
  if (first && last && points.length >= 2) {
    if (p.kind === "rate") {
      spread = last.value - first.value;
      moves25 = Math.round((spread / 0.25) * 10) / 10;
      shape = Math.abs(spread) < 0.1 ? "flat" : spread < 0 ? "cuts" : "hikes";
    } else {
      spread = ((last.price - first.price) / first.price) * 100;
      shape = Math.abs(spread) < 0.5 ? "flat" : spread > 0 ? "contango" : "backwardation";
      // About a year out: the point nearest 12 months after the front.
      const year = points.reduce((best, pt) => (Math.abs(monthsBetween(first.month, pt.month) - 12) < Math.abs(monthsBetween(first.month, best.month) - 12) ? pt : best), last);
      const span = monthsBetween(first.month, year.month);
      if (span >= 2) annualCarry = (((year.price - first.price) / first.price) * 100 * 12) / span;
    }
  }
  return { id: p.id, label: p.label, group: p.group, unit: p.unit, kind: p.kind, points, shape, spread, annualCarry, moves25, asOf: now };
}

/** One market's curve; a minute in the cache. */
export function curve(id: string): Promise<Curve> {
  const p = productOf(id);
  if (!p) return Promise.reject(new Error(`unknown curve ${id}`));
  return cached(`curve:${id}`, 60_000, async () => {
    const months = contractMonths(p);
    const quotes = await tradingview.batchQuotes([p.front, ...months.map((m) => m.ticker)], (s) => [s]);
    return buildCurve(p, months, quotes);
  });
}

/** Every curve, in one scanner request; a minute in the cache. */
export function allCurves(): Promise<Curve[]> {
  return cached("curves:all", 60_000, async () => {
    const plan = PRODUCTS.map((p) => ({ p, months: contractMonths(p) }));
    const tickers = plan.flatMap(({ p, months }) => [p.front, ...months.map((m) => m.ticker)]);
    const quotes = await tradingview.batchQuotes(tickers, (s) => [s]);
    return plan.map(({ p, months }) => buildCurve(p, months, quotes));
  });
}
