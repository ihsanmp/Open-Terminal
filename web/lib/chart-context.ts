import { isCryptoSymbol } from "./refresh";
import type { ChartContext } from "./ta/types";

// Yahoo-style suffix → exchange time zone, for Pine's hour()/dayofweek() on the chart.
const SUFFIX_TZ: Record<string, string> = {
  JK: "Asia/Jakarta",
  L: "Europe/London",
  T: "Asia/Tokyo",
  HK: "Asia/Hong_Kong",
  SS: "Asia/Shanghai",
  SZ: "Asia/Shanghai",
  KS: "Asia/Seoul",
  KQ: "Asia/Seoul",
  NS: "Asia/Kolkata",
  BO: "Asia/Kolkata",
  SI: "Asia/Singapore",
  AX: "Australia/Sydney",
  TO: "America/Toronto",
  V: "America/Toronto",
  DE: "Europe/Berlin",
  F: "Europe/Berlin",
  PA: "Europe/Paris",
  AS: "Europe/Amsterdam",
  BR: "Europe/Brussels",
  MI: "Europe/Rome",
  MC: "Europe/Madrid",
  SW: "Europe/Zurich",
  ST: "Europe/Stockholm",
  OL: "Europe/Oslo",
  CO: "Europe/Copenhagen",
  HE: "Europe/Helsinki",
  SA: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  TW: "Asia/Taipei",
  BK: "Asia/Bangkok",
  KL: "Asia/Kuala_Lumpur",
  NZ: "Pacific/Auckland",
  JO: "Africa/Johannesburg",
};

/** syminfo for a chart symbol as TradingView would report it. Crypto charts here are
 *  Binance USDT pairs shown as "-USD", so their ticker is BASEUSDT. */
export function chartContext(symbol: string, intervalSeconds: number): ChartContext {
  const upper = symbol.toUpperCase();
  if (isCryptoSymbol(upper)) {
    const base = upper.replace(/-USDT?$/, "");
    return { symbol, ticker: `${base}USDT`, type: "crypto", timezone: "Etc/UTC", intervalSeconds };
  }
  if (upper.endsWith("=X")) {
    const pair = upper.slice(0, -2);
    return { symbol, ticker: pair.length === 3 ? `USD${pair}` : pair, type: "forex", timezone: "America/New_York", intervalSeconds };
  }
  if (upper.startsWith("^")) return { symbol, ticker: upper.slice(1), type: "index", timezone: "America/New_York", intervalSeconds };
  const dot = upper.lastIndexOf(".");
  const suffix = dot > 0 ? upper.slice(dot + 1) : "";
  return {
    symbol,
    ticker: dot > 0 ? upper.slice(0, dot) : upper,
    type: "stock",
    timezone: SUFFIX_TZ[suffix] ?? "America/New_York",
    intervalSeconds,
  };
}
