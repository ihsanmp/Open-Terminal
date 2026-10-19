// Every stock of a market, biggest first, a page at a time or by search (the Watchlist's "Saham"
// categories): TradingView's scanner for that market, each company once (its home listing), as
// the Yahoo-style symbol the rest of the app uses (BBCA.JK, 7203.T, AAPL).

import { cached } from "../cache.js";
import { STOCK_MARKETS } from "./heatmap.js";
import * as tradingview from "./tradingview.js";
import { isLegacyCryptoTicker } from "../symbols.js";

/**
 * The app's symbol for a listing; one whose bare ticker the app reads as a coin (Grayscale's BTC
 * and ETH trusts, Interlink's LINK) keeps its exchange (AMEX:BTC), so it opens as itself.
 */
export function listingSymbol(exchange: string, code: string, symbol: string): string {
  return isLegacyCryptoTicker(symbol) ? `${exchange}:${code}` : symbol;
}

export type StockMarket = (typeof STOCK_MARKETS)[number];
export const isStockMarket = (m: string): m is StockMarket => (STOCK_MARKETS as readonly string[]).includes(m);

export type StockRow = {
  symbol: string;
  code: string;
  name: string;
  price: number | null;
  /** Since the last close; over the last week and the last month (TradingView's Perf.W, Perf.1M). */
  changePercent: number | null;
  changeWeek: number | null;
  changeMonth: number | null;
  marketCap: number | null;
  volume: number | null;
  sector: string | null;
  currency: string | null;
};
export type StockPage = { total: number; page: number; perPage: number; rows: StockRow[] };

export const PER_PAGE = 100;

/** The scanner's search: a ticker or a name ("bank", "BBCA", "toyota"). */
export const searchFilter = (q: string) => ({ left: "name,description", operation: "match", right: q });

export function stockPage(market: StockMarket, page = 1, q = ""): Promise<StockPage> {
  const query = q.trim().slice(0, 40);
  return cached(`stocks:${market}:${page}:${query.toLowerCase()}`, 10_000, async () => {
    // The US scanner is TradingView's "america".
    const { total, data } = await tradingview.scanPage(market === "us" ? "america" : market, {
      columns: ["description", "close", "change", "market_cap_basic", "volume", "sector", "currency", "Perf.W", "Perf.1M"],
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "is_primary", operation: "equal", right: true },
        ...(query ? [searchFilter(query)] : []),
      ],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [(page - 1) * PER_PAGE, page * PER_PAGE],
    });
    const rows = data.map((r): StockRow => {
      const [exchange, code] = r.s.split(":");
      const [name, close, change, mcap, volume, sector, currency, week, month] = r.d;
      // France's scanner names the venue EURONEXT; its listings are Paris (.PA) ones.
      const symbol = listingSymbol(exchange, code, market === "france" && exchange === "EURONEXT" ? `${code}.PA` : tradingview.yahooSymbolOf(exchange, code));
      return { symbol, code, name: name ?? code, price: close ?? null, changePercent: change ?? null, changeWeek: week ?? null, changeMonth: month ?? null, marketCap: mcap ?? null, volume: volume ?? null, sector: sector ?? null, currency: currency ?? null };
    });
    return { total, page, perPage: PER_PAGE, rows };
  });
}

// ---------------------------------------------------------------- ETFs

/** ETFs by asset class, as TradingView's scanner keys them (its `asset_class`), in the US. */
export const ETF_CLASSES = {
  equity: "c05f85d35d1cd0be6ebb2af4be16e06a",
  bond: "b6e443a6c4a8a2e7918c5dbf3d45c796",
  commodity: "8fe80395f389e29e3ea42210337f0350",
  // The spot bitcoin and ether ETFs (IBIT, FBTC, ETHA …) are classed as currency.
  currency: "1af0389838508d7016a9841eb6273962",
  alternative: "4071518f1736a5a43dae51b47590322f",
  allocation: "b090e99b8d95f5837ec178c2d3d3fc50",
} as const;
export type EtfClass = keyof typeof ETF_CLASSES;
export const isEtfClass = (c: string): c is EtfClass => c in ETF_CLASSES;
/** The markets whose ETFs are listed: the US, and Indonesia's own on the IDX. */
export const ETF_MARKETS = ["us", "indonesia"] as const;
export type EtfMarket = (typeof ETF_MARKETS)[number];
export const isEtfMarket = (m: string): m is EtfMarket => (ETF_MARKETS as readonly string[]).includes(m);

/** A market's ETFs (a class's, in the US), the biggest by assets first, or those a search finds. */
export function etfPage(market: EtfMarket, cls: EtfClass | null, page = 1, q = ""): Promise<StockPage> {
  const query = q.trim().slice(0, 40);
  return cached(`etfs:${market}:${cls ?? "all"}:${page}:${query.toLowerCase()}`, 10_000, async () => {
    const { total, data } = await tradingview.scanPage(market === "us" ? "america" : market, {
      // The category ("Large Cap Blend", "Investment Grade" …) where the sector of a stock would be.
      columns: ["description", "close", "change", "aum", "volume", "category.tr", "currency", "asset_class.tr", "Perf.W", "Perf.1M"],
      filter: [
        { left: "typespecs", operation: "has", right: ["etf"] },
        ...(cls ? [{ left: "asset_class", operation: "equal", right: ETF_CLASSES[cls] }] : []),
        ...(query ? [searchFilter(query)] : []),
      ],
      sort: { sortBy: "aum", sortOrder: "desc" },
      range: [(page - 1) * PER_PAGE, page * PER_PAGE],
    });
    const rows = data.map((r): StockRow => {
      const [exchange, code] = r.s.split(":");
      const [name, close, change, aum, volume, category, currency, assetClass, week, month] = r.d;
      return {
        symbol: listingSymbol(exchange, code, tradingview.yahooSymbolOf(exchange, code)),
        code,
        name: name ?? code,
        price: close ?? null,
        changePercent: change ?? null,
        changeWeek: week ?? null,
        changeMonth: month ?? null,
        marketCap: aum ?? null,
        volume: volume ?? null,
        // "Pair" (what TradingView files the spot bitcoin ETFs under) says less than their class.
        sector: (category && category !== "Pair" ? category : assetClass) ?? null,
        currency: currency ?? null,
      };
    });
    return { total, page, perPage: PER_PAGE, rows };
  });
}
