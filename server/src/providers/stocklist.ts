// Every stock of a market, biggest first, a page at a time or by search (the Watchlist's "Saham"
// categories): TradingView's scanner for that market, each company once (its home listing), as
// the Yahoo-style symbol the rest of the app uses (BBCA.JK, 7203.T, AAPL).

import { cached } from "../cache.js";
import { STOCK_MARKETS } from "./heatmap.js";
import * as tradingview from "./tradingview.js";

export type StockMarket = (typeof STOCK_MARKETS)[number];
export const isStockMarket = (m: string): m is StockMarket => (STOCK_MARKETS as readonly string[]).includes(m);

export type StockRow = {
  symbol: string;
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
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
      columns: ["description", "close", "change", "market_cap_basic", "volume", "sector", "currency"],
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
      const [name, close, change, mcap, volume, sector, currency] = r.d;
      // France's scanner names the venue EURONEXT; its listings are Paris (.PA) ones.
      const symbol = market === "france" && exchange === "EURONEXT" ? `${code}.PA` : tradingview.yahooSymbolOf(exchange, code);
      return { symbol, code, name: name ?? code, price: close ?? null, changePercent: change ?? null, marketCap: mcap ?? null, volume: volume ?? null, sector: sector ?? null, currency: currency ?? null };
    });
    return { total, page, perPage: PER_PAGE, rows };
  });
}
