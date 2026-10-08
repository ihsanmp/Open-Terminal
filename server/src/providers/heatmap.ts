// Heatmaps beyond US stocks: other stock markets, crypto, ETFs, world indices, FX and
// commodities, each as cells grouped like TradingView's heatmaps, all from its scanner.

import * as tradingview from "./tradingview.js";
import { cryptoTicker } from "../symbols.js";
import { WORLD_INDICES } from "../indices.js";

type Perf = Partial<Record<tradingview.ChangePeriod, number | null>>;

/** One box: sized by `size` (market cap, AUM, or 1 for an even grid), colored by its change. */
export type HeatCell = { symbol: string; label: string; name: string; group: string; size: number; perf: Perf };

/** Stock markets by their scanner's name. */
export const STOCK_MARKETS = [
  "us", "indonesia", "japan", "china", "hongkong", "korea", "taiwan", "india", "singapore", "malaysia",
  "uk", "germany", "france", "canada", "australia", "brazil",
] as const;
export const HEATMAP_MARKETS = [...STOCK_MARKETS, "crypto", "etf", "indices", "forex", "commodities"] as const;
export type HeatmapMarket = (typeof HEATMAP_MARKETS)[number];
export const isHeatmapMarket = (m: string): m is HeatmapMarket => (HEATMAP_MARKETS as readonly string[]).includes(m);

/** Boxes in a stock, crypto or ETF map: the biggest, as TradingView shows. */
const TOP = 150;

const PERF_COLS = tradingview.PERF_COLUMNS.map(([, c]) => c);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** The day's change and then each longer period's, in PERF_COLUMNS order. */
export function perfOf(day: unknown, longer: unknown[]): Perf {
  const perf: Perf = { "1D": num(day) };
  tradingview.PERF_COLUMNS.forEach(([p], i) => (perf[p] = num(longer[i])));
  return perf;
}

/** US stocks come from the shared market scan; this maps its rows. */
export function usCells(rows: tradingview.MarketRow[]): HeatCell[] {
  return rows
    .filter((r) => r.marketCap)
    .slice(0, TOP)
    .map((r) => ({ symbol: r.symbol, label: r.symbol, name: r.name, group: r.sector, size: r.marketCap!, perf: { ...r.perf, "1D": r.changePercent } }));
}

async function stockCells(market: string): Promise<HeatCell[]> {
  const rows = await tradingview.scanAt(market, {
    columns: ["description", "sector", "market_cap_basic", "change", ...PERF_COLS],
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      // One box per company: its home listing, not the copies on other venues.
      { left: "is_primary", operation: "equal", right: true },
      { left: "market_cap_basic", operation: "nempty" },
    ],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, TOP],
  });
  return rows.map((r) => {
    const [exchange, code] = r.s.split(":");
    const [name, sector, mcap, change, ...perfs] = r.d;
    // France's scanner names the venue EURONEXT; its listings are Paris (.PA) ones.
    const symbol = market === "france" && exchange === "EURONEXT" ? `${code}.PA` : tradingview.yahooSymbolOf(exchange, code);
    return { symbol, label: code, name: name ?? code, group: sector || "Other", size: mcap, perf: perfOf(change, perfs) };
  });
}

async function cryptoCells(): Promise<HeatCell[]> {
  const rows = await tradingview.scanAt("coin", {
    columns: ["base_currency", "base_currency_desc", "market_cap_calc", "24h_close_change|5", ...PERF_COLS, "crypto_common_categories", "crypto_common_categories.tr"],
    sort: { sortBy: "crypto_total_rank", sortOrder: "asc" },
    range: [0, TOP + 40],
  });
  const seen = new Set<string>();
  const out: HeatCell[] = [];
  for (const r of rows) {
    const [base, name, mcap, change, ...rest] = r.d;
    const [ids, labels] = rest.slice(PERF_COLS.length) as [string[] | null, string[] | null];
    const symbol = String(base ?? "").toUpperCase();
    // Stablecoins sit at ~0% and would take much of the map as grey boxes.
    if (!symbol || !num(mcap) || seen.has(symbol) || ids?.includes("stablecoins")) continue;
    seen.add(symbol);
    out.push({ symbol: cryptoTicker(symbol), label: symbol, name: name ?? symbol, group: labels?.[0] ?? "Other", size: mcap, perf: perfOf(change, rest) });
    if (out.length === TOP) break;
  }
  return out;
}

async function etfCells(): Promise<HeatCell[]> {
  const rows = await tradingview.scanAt("america", {
    columns: ["description", "aum", "asset_class.tr", "category.tr", "change", ...PERF_COLS],
    filter: [
      { left: "typespecs", operation: "has", right: ["etf"] },
      { left: "aum", operation: "nempty" },
    ],
    sort: { sortBy: "aum", sortOrder: "desc" },
    range: [0, TOP],
  });
  return rows.map((r) => {
    const code = r.s.split(":")[1];
    const [name, aum, assetClass, category, change, ...perfs] = r.d;
    // Equity ETFs are most of the list, so they're split by category (sector, size and style …).
    const group = assetClass === "Equity" && category ? `Equity · ${category}` : (assetClass ?? "Other");
    return { symbol: code, label: code, name: name ?? code, group, size: aum, perf: perfOf(change, perfs) };
  });
}

/** Boxes of equal size, by TradingView ticker: [ticker, label, group]. */
async function evenCells(list: Array<[string, string, string, string?]>): Promise<HeatCell[]> {
  const rows = await tradingview.scanAt("global", { symbols: { tickers: list.map(([t]) => t) }, columns: ["description", "change", ...PERF_COLS] });
  const byTicker = new Map(rows.map((r) => [r.s, r.d]));
  return list.flatMap(([ticker, label, group, symbol]) => {
    const d = byTicker.get(ticker);
    if (!d) return [];
    const [name, change, ...perfs] = d;
    return [{ symbol: symbol ?? ticker, label, name: name ?? label, group, size: 1, perf: perfOf(change, perfs) }];
  });
}

// The VIX measures volatility, not a market's move, so it's left off the map.
const INDICES = WORLD_INDICES.filter((i) => i.symbol !== "^VIX").map((i): [string, string, string, string] => [i.tv, i.name, i.region, i.symbol]);

const FOREX: Array<[string, string, string]> = [
  ["TVC:DXY", "DXY", "Dollar"],
  ...["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"].map((p): [string, string, string] => [`FX:${p}`, p, "Majors"]),
  ...["EURJPY", "GBPJPY", "EURGBP", "EURCHF", "AUDJPY", "EURAUD", "GBPCHF", "CADJPY"].map((p): [string, string, string] => [`FX:${p}`, p, "Crosses"]),
  ...["USDIDR", "USDSGD", "USDMYR", "USDTHB", "USDPHP", "USDINR", "USDCNY", "USDKRW", "USDHKD", "USDTWD"].map((p): [string, string, string] => [`FX_IDC:${p}`, p, "Asia"]),
  ...["USDMXN", "USDBRL", "USDZAR", "USDTRY", "USDPLN", "USDSEK", "USDNOK"].map((p): [string, string, string] => [`FX_IDC:${p}`, p, "Other"]),
];

const COMMODITIES: Array<[string, string, string]> = [
  ["TVC:GOLD", "Gold", "Metals"],
  ["TVC:SILVER", "Silver", "Metals"],
  ["TVC:PLATINUM", "Platinum", "Metals"],
  ["TVC:PALLADIUM", "Palladium", "Metals"],
  ["COMEX:HG1!", "Copper", "Metals"],
  ["NYMEX:CL1!", "WTI Crude", "Energy"],
  ["ICEEUR:BRN1!", "Brent", "Energy"],
  ["NYMEX:NG1!", "Natural Gas", "Energy"],
  ["NYMEX:RB1!", "Gasoline", "Energy"],
  ["NYMEX:HO1!", "Heating Oil", "Energy"],
  ["CBOT:ZW1!", "Wheat", "Grains"],
  ["CBOT:ZC1!", "Corn", "Grains"],
  ["CBOT:ZS1!", "Soybeans", "Grains"],
  ["CBOT:ZO1!", "Oats", "Grains"],
  ["ICEUS:KC1!", "Coffee", "Softs"],
  ["ICEUS:SB1!", "Sugar", "Softs"],
  ["ICEUS:CC1!", "Cocoa", "Softs"],
  ["ICEUS:CT1!", "Cotton", "Softs"],
  ["MYX:FCPO1!", "Palm Oil", "Softs"],
  ["CME:LE1!", "Live Cattle", "Livestock"],
  ["CME:HE1!", "Lean Hogs", "Livestock"],
];

/** Every market but US stocks (which come from the shared scan). */
export async function heatmapCells(market: Exclude<HeatmapMarket, "us">): Promise<HeatCell[]> {
  switch (market) {
    case "crypto":
      return cryptoCells();
    case "etf":
      return etfCells();
    case "indices":
      return evenCells(INDICES);
    case "forex":
      return evenCells(FOREX);
    case "commodities":
      return evenCells(COMMODITIES);
    default:
      return stockCells(market);
  }
}
