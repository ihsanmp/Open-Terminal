// Pure matching/ranking behind GET /api/search, kept free of I/O so it can be tested.

import { cryptoTicker } from "./symbols.js";

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

/** A coin we can chart: TradingView's ranked board, plus any Binance USDT base it lacks. */
export type Coin = { symbol: string; name: string; rank: number | null };

/**
 * The coin term inside a query, with any quote currency stripped:
 * "btc-usd", "BTC/USDT" and "BTCUSDT" all mean "btc". `pair` is set when the user
 * spelled out a USD pair, i.e. they are clearly after the crypto and not a stock.
 */
export function cryptoTerm(query: string): { term: string; pair: boolean } {
  const q = query.trim().toLowerCase();
  const m = /^([a-z0-9]{1,20})\s*[-/]\s*usdt?$/.exec(q) ?? /^([a-z0-9]{2,20})usdt$/.exec(q);
  return m ? { term: m[1], pair: true } : { term: q, pair: false };
}

/** Coins whose ticker or name matches the query, best match first, as BASE-USD results. */
export function matchCoins(coins: Coin[], query: string, limit = 6): SearchResult[] {
  const { term } = cryptoTerm(query);
  if (!term) return [];
  // Exact ticker and exact name tie, so "bitcoin" finds Bitcoin (#1) before a small token whose ticker is BITCOIN.
  const score = (c: Coin) => {
    const sym = c.symbol.toLowerCase();
    const name = c.name.toLowerCase();
    return sym === term || name === term ? 0 : sym.startsWith(term) || name.startsWith(term) ? 1 : 2;
  };
  const seen = new Set<string>();
  return coins
    .filter((c) => c.symbol.toLowerCase().includes(term) || c.name.toLowerCase().includes(term))
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i) // coins arrive in market-cap rank order
    .map(({ c }) => c)
    .filter((c) => !seen.has(c.symbol) && seen.add(c.symbol))
    .slice(0, limit)
    .map((c) => ({ symbol: cryptoTicker(c.symbol), name: c.name, exchange: c.rank ? `Crypto #${c.rank}` : "Crypto", type: "crypto" }));
}

/**
 * Merge result lists (earlier lists win ties) and order them so Enter picks the
 * obvious hit: the symbol the user typed, then the coin/index it names, then
 * prefix matches, then everything else. Duplicate symbols are dropped.
 */
export function rankResults(lists: SearchResult[][], query: string, limit = 25): SearchResult[] {
  const needle = query.trim().toUpperCase();
  const { term, pair } = cryptoTerm(query);
  const coin = cryptoTicker(term);
  const rank = (r: SearchResult) => {
    const sym = r.symbol.toUpperCase();
    if (sym === needle || (pair && sym === coin)) return 0;
    if (sym === `${needle}-USD` || sym === `^${needle}` || r.name.toUpperCase() === needle) return 1;
    if (r.type === "index" || sym.startsWith(needle) || (pair && r.type === "crypto")) return 2;
    return 3;
  };
  const seen = new Set<string>();
  return lists
    .flat()
    .map((r, i) => ({ r, i, s: rank(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(({ r }) => r)
    .filter((r) => !seen.has(r.symbol.toUpperCase()) && seen.add(r.symbol.toUpperCase()))
    .slice(0, limit);
}
