// Futures and commodities: each market's front contract, continuous (TradingView's "1!"), as the
// app writes it (ES=F, GC=F, FCPO=F), grouped as the Watchlist lists them: financial futures
// (equity indices, rates and bonds, currencies, crypto) and commodities (energy, metals, grains,
// softs, livestock). The chart and the quotes read them from here too; priced in one scanner
// request for all of them.

import { cached } from "../cache.js";
import * as tradingview from "./tradingview.js";

export type FuturesGroup = "index" | "rates" | "currency" | "crypto" | "energy" | "metal" | "grain" | "soft" | "livestock";
export const COMMODITY_GROUPS: FuturesGroup[] = ["energy", "metal", "grain", "soft", "livestock"];

type Contract = { code: string; tv: string; group: FuturesGroup };

const C = (group: FuturesGroup, list: Array<[code: string, tv: string]>): Contract[] => list.map(([code, tv]) => ({ code, tv, group }));

/** Every contract, checked against TradingView's scanner in October 2026 (each has a price). */
export const CONTRACTS: Contract[] = [
  ...C("index", [
    ["ES", "CME_MINI:ES1!"], ["NQ", "CME_MINI:NQ1!"], ["YM", "CBOT_MINI:YM1!"], ["RTY", "CME_MINI:RTY1!"], ["VX", "CBOE:VX1!"],
    ["NIY", "CME:NIY1!"], ["NKD", "CME:NKD1!"], ["FDAX", "EUREX:FDAX1!"], ["FESX", "EUREX:FESX1!"], ["FTSE", "ICEEUR:Z1!"], ["HSI", "HKEX:HSI1!"],
  ]),
  ...C("rates", [
    ["ZT", "CBOT:ZT1!"], ["ZF", "CBOT:ZF1!"], ["ZN", "CBOT:ZN1!"], ["TN", "CBOT:TN1!"], ["ZB", "CBOT:ZB1!"], ["UB", "CBOT:UB1!"],
    ["SR3", "CME:SR31!"], ["ZQ", "CBOT:ZQ1!"], ["FGBL", "EUREX:FGBL1!"], ["FGBM", "EUREX:FGBM1!"], ["FGBS", "EUREX:FGBS1!"], ["GILT", "ICEEUR:G1!"],
  ]),
  ...C("currency", [
    ["DX", "ICEUS:DX1!"], ["6E", "CME:6E1!"], ["6J", "CME:6J1!"], ["6B", "CME:6B1!"], ["6A", "CME:6A1!"], ["6C", "CME:6C1!"],
    ["6S", "CME:6S1!"], ["6N", "CME:6N1!"], ["6M", "CME:6M1!"],
  ]),
  ...C("crypto", [["BTC", "CME:BTC1!"], ["MBT", "CME:MBT1!"], ["ETH", "CME:ETH1!"], ["MET", "CME:MET1!"], ["SOL", "CME:SOL1!"], ["XRP", "CME:XRP1!"]]),
  ...C("energy", [["CL", "NYMEX:CL1!"], ["BZ", "NYMEX:BB1!"], ["NG", "NYMEX:NG1!"], ["RB", "NYMEX:RB1!"], ["HO", "NYMEX:HO1!"], ["MTF", "ICEEUR:ATW1!"]]),
  ...C("metal", [["GC", "COMEX:GC1!"], ["SI", "COMEX:SI1!"], ["HG", "COMEX:HG1!"], ["PL", "NYMEX:PL1!"], ["PA", "NYMEX:PA1!"], ["ALI", "COMEX:ALI1!"], ["FEF", "SGX:FEF1!"]]),
  ...C("grain", [["ZC", "CBOT:ZC1!"], ["ZW", "CBOT:ZW1!"], ["KE", "CBOT:KE1!"], ["ZS", "CBOT:ZS1!"], ["ZM", "CBOT:ZM1!"], ["ZL", "CBOT:ZL1!"], ["ZO", "CBOT:ZO1!"], ["ZR", "CBOT:ZR1!"]]),
  ...C("soft", [
    ["KC", "ICEUS:KC1!"], ["RC", "ICEEUR:RC1!"], ["SB", "ICEUS:SB1!"], ["WSUG", "ICEEUR:W1!"], ["CC", "ICEUS:CC1!"], ["LCC", "ICEEUR:C1!"],
    ["CT", "ICEUS:CT1!"], ["OJ", "ICEUS:OJ1!"], ["LBR", "CME:LBR1!"], ["FCPO", "MYX:FCPO1!"], ["TF", "SGX:TF1!"],
  ]),
  ...C("livestock", [["LE", "CME:LE1!"], ["GF", "CME:GF1!"], ["HE", "CME:HE1!"], ["DC", "CME:DC1!"]]),
];

const BY_CODE = new Map(CONTRACTS.map((c) => [c.code, c]));

/** TradingView's continuous front contract for one of our futures symbols (GC=F), else null. */
export function futuresTickers(symbol: string): string[] | null {
  const m = /^([A-Z0-9]+)=F$/.exec(symbol.toUpperCase());
  const c = m ? BY_CODE.get(m[1]) : undefined;
  return c ? [c.tv] : null;
}

export type FuturesRow = {
  /** As the app writes it: GC=F. */
  symbol: string;
  code: string;
  group: FuturesGroup;
  name: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  /** Over the last week and month, in percent. */
  changeWeek: number | null;
  changeMonth: number | null;
  high: number | null;
  low: number | null;
  currency: string | null;
};

/** Every contract's latest price, in the list's order (one the scanner has no price for is left out). */
export function futuresBoard(): Promise<FuturesRow[]> {
  return cached("futures:board", 10_000, async () => {
    const quotes = await tradingview.batchQuotes(
      CONTRACTS.map((c) => `${c.code}=F`),
      (s) => futuresTickers(s) ?? [],
    );
    const rows: FuturesRow[] = [];
    for (const c of CONTRACTS) {
      const q = quotes.get(`${c.code}=F`);
      if (!q || q.price == null) continue;
      rows.push({ symbol: `${c.code}=F`, code: c.code, group: c.group, name: q.name, price: q.price, change: q.change, changePercent: q.changePercent, changeWeek: q.changeWeek ?? null, changeMonth: q.changeMonth ?? null, high: q.high, low: q.low, currency: q.currency });
    }
    if (!rows.length) throw new Error("no futures prices from TradingView");
    return rows;
  });
}
