// A chart's prices in another currency, as TradingView's currency menu on the price scale: each bar
// is multiplied by the exchange rate of its own time (not today's). Rates come through the app's
// history API like any chart: TradingView's FX_IDC rates for currencies, the coins' own prices for
// crypto. Every currency is read as its value in US dollars, so any two convert through it.

import type { Candle } from "./api";
import type { Drawing } from "./drawings/tools";

export type Currency = { code: string; name: string; crypto?: boolean };

/** The currencies offered, US dollar first; the chart's own comes to the top of the menu. */
export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US Dollar" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "EUR", name: "Euro" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "GBP", name: "British Pound" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "KRW", name: "South Korean Won" },
  { code: "INR", name: "Indian Rupee" },
  { code: "THB", name: "Thai Baht" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "VND", name: "Vietnamese Dong" },
  { code: "TWD", name: "New Taiwan Dollar" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "AED", name: "United Arab Emirates Dirham" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "ZAR", name: "South African Rand" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "PLN", name: "Polish Zloty" },
  { code: "BTC", name: "Bitcoin", crypto: true },
  { code: "ETH", name: "Ethereum", crypto: true },
  { code: "BNB", name: "BNB", crypto: true },
  { code: "SOL", name: "Solana", crypto: true },
  { code: "XRP", name: "XRP", crypto: true },
];

const CRYPTO = new Set(CURRENCIES.filter((c) => c.crypto).map((c) => c.code));
/** Stablecoins a chart may be quoted in, worth a dollar for this purpose. */
const DOLLARS = new Set(["USD", "USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD", "USDE"]);

/**
 * The chart that tells what one unit of a currency is worth in dollars, and whether its price must
 * be turned over (FX_IDC:USDIDR is rupiah per dollar); null for the dollar itself.
 */
export function usdSource(code: string): { symbol: string; invert: boolean; per?: number } | null {
  const c = code.toUpperCase();
  if (DOLLARS.has(c)) return null;
  // London quotes in pence (GBX): a hundredth of a pound.
  if (c === "GBX") return { symbol: "FX_IDC:USDGBP", invert: true, per: 100 };
  if (CRYPTO.has(c) || !/^[A-Z]{3}$/.test(c)) return { symbol: `${c}-USD`, invert: false };
  return { symbol: `FX_IDC:USD${c}`, invert: true };
}

/** Rates from intraday bars for intraday charts, daily ones for the rest. */
export const rateInterval = (barSeconds: number) => (barSeconds < 86_400 ? "1h" : "1D");

type Point = { time: number; value: number };

/** A currency's dollar value over time, from its chart's closes (null: the dollar, always 1). */
export function usdValues(code: string, bars: Candle[] | null | undefined): Point[] | null {
  const src = usdSource(code);
  if (!src || !bars) return null;
  const per = src.per ?? 1;
  return bars.filter((b) => Number.isFinite(b.close) && b.close > 0).map((b) => ({ time: b.time, value: (src.invert ? 1 / b.close : b.close) / per }));
}

/** The value in force at `time`: the last one at or before it, else the first. */
function valueAt(points: Point[], time: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (time < points[0].time) return points[0].value;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].value;
}

/** One unit of the chart's currency in the one shown, at `time` (each currency's dollar value; null: the dollar). */
export function rateAt(fromUsd: Point[] | null, toUsd: Point[] | null, time: number): number {
  return (fromUsd?.length ? valueAt(fromUsd, time) : 1) / (toUsd?.length ? valueAt(toUsd, time) : 1);
}

/**
 * The bars in another currency: each bar's prices times one unit of `from` in `to` at that bar's end
 * (its close), the same rate for its open, high and low so the candle keeps its shape. `fromUsd`
 * and `toUsd` are each currency's dollar value (null: the dollar). Volume stays in units traded.
 */
export function convertCandles(bars: Candle[], fromUsd: Point[] | null, toUsd: Point[] | null, barSeconds: number): Candle[] {
  if ((fromUsd && fromUsd.length === 0) || (toUsd && toUsd.length === 0)) return bars;
  return bars.map((b) => {
    const rate = rateAt(fromUsd, toUsd, b.time + barSeconds - 1);
    return { ...b, open: b.open * rate, high: b.high * rate, low: b.low * rate, close: b.close * rate };
  });
}

/** The currency a quote is in, as the menu names it (a stablecoin is the dollar's: USDT shows USD). */
export function nativeCurrency(quoteCurrency: string | null | undefined): string {
  const c = (quoteCurrency ?? "USD").trim();
  // TradingView writes pence "GBp"; upper-cased it would read as pounds.
  if (c === "GBp") return "GBX";
  return DOLLARS.has(c.toUpperCase()) ? "USD" : c.toUpperCase();
}

/**
 * A drawing in the currency shown (`rate`: one unit of the chart's own currency in it, at a bar's
 * time), or with `back`, a drawing made or moved there in the chart's own: drawings are kept in the
 * symbol's currency, so they sit on the same bars in any. Each point at the rate of its own time, as
 * the bars are; a Gann square's price per bar at its first point's. Drawings on an indicator's pane
 * hold that indicator's values, not prices, and stay as they are.
 */
export function convertDrawing(d: Drawing, rate: (time: number) => number, back = false): Drawing {
  if (d.pane) return d;
  const k = (time: number) => (back ? 1 / rate(time) : rate(time));
  const out: Drawing = { ...d, points: d.points.map((p) => ({ ...p, price: p.price * k(p.time) })) };
  if (d.ratio !== undefined && d.points[0]) out.ratio = d.ratio * k(d.points[0].time);
  return out;
}
