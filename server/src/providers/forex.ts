// Every forex pair a broker quotes (OANDA, FOREX.com, SAXO, Pepperstone, IG and TradingView's FX,
// as their lists stood in October 2026), one way round each (EURUSD, not USDEUR: the euro, pound,
// Aussie and kiwi before the dollar, the dollar before the rest, the yen last), with the emerging
// markets' dollar pairs and the rupiah's crosses, and the precious metals; priced from TradingView's
// scanner in one request for all of them (FX_IDC's reference rates; metals from OANDA and TVC).

import { cached } from "../cache.js";
import * as tradingview from "./tradingview.js";

export type ForexGroup = "major" | "minor" | "exotic" | "metal";

export const FOREX_PAIRS: Record<Exclude<ForexGroup, "metal">, string[]> = {
  major: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"],
  // Both currencies among the G10 (USD EUR JPY GBP CHF AUD NZD CAD NOK SEK).
  minor: [
    "AUDCAD", "AUDCHF", "AUDJPY", "AUDNOK", "AUDNZD", "AUDSEK", "CADCHF", "CADJPY", "CADNOK", "CADSEK",
    "CHFJPY", "CHFNOK", "CHFSEK", "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNOK", "EURNZD",
    "EURSEK", "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNOK", "GBPNZD", "GBPSEK", "NOKJPY", "NOKSEK",
    "NZDCAD", "NZDCHF", "NZDJPY", "NZDNOK", "NZDSEK", "SEKJPY", "USDNOK", "USDSEK",
  ],
  exotic: [
    "AUDCNH", "AUDCZK", "AUDDKK", "AUDHKD", "AUDHUF", "AUDIDR", "AUDMXN", "AUDPLN", "AUDSGD", "AUDTRY",
    "AUDZAR", "BRLJPY", "CADCNH", "CADHKD", "CADMXN", "CADPLN", "CADSGD", "CADTRY", "CADZAR", "CHFCNH",
    "CHFCZK", "CHFDKK", "CHFHKD", "CHFHUF", "CHFMXN", "CHFPLN", "CHFTRY", "CHFZAR", "CNHHKD", "CNHJPY",
    "CZKPLN", "DKKCZK", "DKKHUF", "DKKJPY", "DKKPLN", "DKKSGD", "DKKZAR", "EURCNH", "EURCZK", "EURDKK",
    "EURHKD", "EURHUF", "EURIDR", "EURILS", "EURMXN", "EURPLN", "EURRON", "EURSGD", "EURTHB", "EURTRY",
    "EURZAR", "GBPCNH", "GBPCZK", "GBPDKK", "GBPHKD", "GBPHUF", "GBPIDR", "GBPILS", "GBPINR", "GBPMXN",
    "GBPPLN", "GBPSGD", "GBPTRY", "GBPZAR", "HKDJPY", "HUFJPY", "INRJPY", "JPYIDR", "MXNJPY", "NOKCZK",
    "NOKDKK", "NZDCNH", "NZDCZK", "NZDDKK", "NZDHKD", "NZDHUF", "NZDMXN", "NZDPLN", "NZDSGD", "NZDTRY",
    "NZDZAR", "PLNHUF", "PLNJPY", "SEKDKK", "SEKPLN", "SGDCNH", "SGDHKD", "SGDIDR", "SGDJPY", "SGDSEK",
    "TRYDKK", "TRYJPY", "TRYZAR", "USDAED", "USDARS", "USDBRL", "USDCLP", "USDCNH", "USDCOP", "USDCZK",
    "USDDKK", "USDEGP", "USDHKD", "USDHUF", "USDIDR", "USDILS", "USDINR", "USDKES", "USDKRW", "USDKWD",
    "USDMXN", "USDMYR", "USDNGN", "USDPHP", "USDPKR", "USDPLN", "USDQAR", "USDRON", "USDSAR", "USDSGD",
    "USDTHB", "USDTRY", "USDTWD", "USDVND", "USDZAR", "ZARJPY",
  ],
};

/** The metals against the dollar, where TradingView prices them. */
export const METALS: Record<string, string> = { XAUUSD: "OANDA:XAUUSD", XAGUSD: "TVC:SILVER", XPTUSD: "TVC:PLATINUM", XPDUSD: "TVC:PALLADIUM" };

const GROUP = new Map<string, ForexGroup>([
  ...(Object.entries(FOREX_PAIRS) as Array<[ForexGroup, string[]]>).flatMap(([g, pairs]) => pairs.map((p) => [p, g] as [string, ForexGroup])),
  ...Object.keys(METALS).map((p) => [p, "metal"] as [string, ForexGroup]),
]);

/** A pair's group (an unlisted pair counts as exotic). */
export const groupOf = (pair: string): ForexGroup => GROUP.get(pair.toUpperCase()) ?? "exotic";

/**
 * TradingView's listings for one of our forex symbols (EURUSD=X, JPY=X for USDJPY as Yahoo writes
 * it, XAUUSD=X): FX_IDC's reference rate first, then TradingView's FX feed; a metal where it trades.
 * Null for anything else.
 */
export function fxTickers(symbol: string): string[] | null {
  const s = symbol.toUpperCase();
  let m = /^([A-Z]{6})=X$/.exec(s);
  if (m) return METALS[m[1]] ? [METALS[m[1]]] : [`FX_IDC:${m[1]}`, `FX:${m[1]}`];
  m = /^([A-Z]{3})=X$/.exec(s);
  return m ? [`FX_IDC:USD${m[1]}`] : null;
}

export type ForexRow = {
  /** As the app writes it: EURUSD=X. */
  symbol: string;
  pair: string;
  group: ForexGroup;
  name: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
};

const ALL = [...Object.values(FOREX_PAIRS).flat(), ...Object.keys(METALS)];

/** Every pair's latest price, in the lists' order (a pair the scanner has no price for is left out). */
export function forexBoard(): Promise<ForexRow[]> {
  return cached("forex:board", 10_000, async () => {
    const quotes = await tradingview.batchQuotes(
      ALL.map((p) => `${p}=X`),
      (s) => fxTickers(s) ?? [],
    );
    const rows: ForexRow[] = [];
    for (const pair of ALL) {
      const q = quotes.get(`${pair}=X`);
      if (!q || q.price == null) continue;
      rows.push({ symbol: `${pair}=X`, pair, group: groupOf(pair), name: q.name, price: q.price, change: q.change, changePercent: q.changePercent, high: q.high, low: q.low });
    }
    if (!rows.length) throw new Error("no forex prices from TradingView");
    return rows;
  });
}
