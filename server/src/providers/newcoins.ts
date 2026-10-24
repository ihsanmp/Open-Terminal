// New altcoins: what the exchanges and CoinMarketCap have just listed, with where each trades and
// a chart for it — so a coin listed this week can be found, charted and watched before it reaches
// the ranked board (TradingView's ~2,500 coins with a market-cap rank).
//
//   CoinMarketCap  its "recently added" list (public data API): name, date added, market cap,
//                  24h volume, chain; stock "derivatives" and coins with no trading left out;
//   OKX            spot listings with their listing time, crypto only (its tokenized stocks are
//                  another category);
//   Gate           spot listings with their trading start, leveraged tokens (BTC3L, ETH5S) left out.
//
// Each coin is then looked up on TradingView, every exchange at once, for its best pair: the
// price, the 24h change and volume, and the symbol the chart opens (BASE-USD for a coin the usual
// exchanges carry, else the pair itself, a DEX pool included). Bybit, MEXC, Bitget and Binance
// don't answer from here, so their listings come only through CoinMarketCap.

import { cached } from "../cache.js";
import * as tradingview from "./tradingview.js";

export type NewCoin = {
  symbol: string;
  name: string;
  /** When it was first listed by any source (ms). */
  listedAt: number;
  /** Where it was found listed: "CoinMarketCap", "OKX", "Gate". */
  sources: string[];
  /** Its chain on CoinMarketCap (Solana, BNB Smart Chain …), when it's a token. */
  chain: string | null;
  marketCap: number | null;
  /** The symbol the chart opens, or null when TradingView has no pair for it yet. */
  chart: string | null;
  /** The pair the price is from (OKX:PEARLUSDT, RAYDIUM:…). */
  pair: string | null;
  exchange: string | null;
  dex: boolean;
  /** Whether TradingView's pair names the same coin (a new ticker is often another token's too). */
  sameName: boolean | null;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
};

const DAY = 86_400_000;
const UA = { "User-Agent": "Mozilla/5.0" };

/** A coin as the listings know it, before TradingView is asked. */
type Listed = Pick<NewCoin, "symbol" | "name" | "listedAt" | "sources" | "chain" | "marketCap">;

type Listing = { symbol: string; name: string; listedAt: number; source: string; chain?: string | null; marketCap?: number | null; volume?: number | null };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** CoinMarketCap's newest coins (its "date added" order), the ones still trading. */
export function cmcListings(body: any, since: number): Listing[] {
  const list: any[] = body?.data?.cryptoCurrencyList ?? [];
  return list
    .map((c) => ({
      tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
      symbol: String(c.symbol ?? "").toUpperCase(),
      name: String(c.name ?? ""),
      listedAt: Date.parse(c.dateAdded ?? ""),
      source: "CoinMarketCap",
      chain: c.platform?.name ?? null,
      marketCap: Number(c.quotes?.[0]?.marketCap) || null,
      volume: Number(c.quotes?.[0]?.volume24h) || 0,
    }))
    .filter((c) => c.symbol && Number.isFinite(c.listedAt) && c.listedAt >= since && (c.volume ?? 0) > 0 && !isStockToken(c.name, c.tags));
}

/** A token that is a share or a fund (tokenized stocks and ETFs, stock "derivatives"), not a crypto coin. */
export function isStockToken(name: string, tags: string[] = []): boolean {
  return /\(Derivatives\)|tokeni[sz]ed|xStock/i.test(name) || tags.some((t) => /tokeni[sz]ed|stock|real-world-assets-stocks/i.test(t));
}

/** OKX spot listings in USDT since a time, crypto only (instCategory 1; 3 is its tokenized stocks). */
export function okxListings(body: any, since: number): Listing[] {
  const list: any[] = body?.data ?? [];
  return list
    .filter((d) => d.quoteCcy === "USDT" && d.state === "live" && String(d.instCategory) === "1" && Number(d.listTime) >= since)
    .map((d) => ({ symbol: String(d.baseCcy).toUpperCase(), name: String(d.baseCcy), listedAt: Number(d.listTime), source: "OKX" }));
}

/** A leveraged token's ticker (BTC3L, ETH5S, AAVE3S): not a coin. */
export const isLeveraged = (symbol: string) => /\d+[LS]$/.test(symbol);

/** Gate spot listings in USDT since a time, leveraged tokens left out. */
export function gateListings(body: any, since: number): Listing[] {
  const list: any[] = Array.isArray(body) ? body : [];
  return list
    .filter((d) => d.quote === "USDT" && d.trade_status === "tradable" && Number(d.buy_start) * 1000 >= since && !isLeveraged(String(d.base)))
    .map((d) => ({ symbol: String(d.base).toUpperCase(), name: String(d.base_name || d.base), listedAt: Number(d.buy_start) * 1000, source: "Gate" }));
}

/** The listings by coin: the earliest date, every source, the fullest name. */
export function mergeListings(lists: Listing[][]): Map<string, Listed> {
  const out = new Map<string, Listed>();
  for (const l of lists.flat()) {
    if (!/^[A-Z0-9]{1,20}$/.test(l.symbol)) continue;
    const e = out.get(l.symbol);
    if (!e) {
      out.set(l.symbol, { symbol: l.symbol, name: l.name, listedAt: l.listedAt, sources: [l.source], chain: l.chain ?? null, marketCap: l.marketCap ?? null });
      continue;
    }
    e.listedAt = Math.min(e.listedAt, l.listedAt);
    if (!e.sources.includes(l.source)) e.sources.push(l.source);
    if (l.source === "CoinMarketCap") {
      e.name = l.name;
      e.chain = l.chain ?? e.chain;
      e.marketCap = l.marketCap ?? e.marketCap;
    }
  }
  return out;
}

/** Whether two names for a coin agree: one holds the other, or they share a word of 3+ letters. */
export function namesAgree(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const words = new Set(x.split(/\s+/).filter((w) => w.length >= 3 && !["coin", "token", "the", "usd", "usdt"].includes(w)));
  return y.split(/\s+/).some((w) => words.has(w));
}

/** New coins of the last `days` days, newest first; fifteen minutes in the cache. */
export function newCoins(days = 30, now = Date.now()): Promise<NewCoin[]> {
  return cached(`newcoins:${days}`, 15 * 60_000, async () => {
    const since = now - days * DAY;
    const [cmc, okx, gate] = await Promise.allSettled([
      getJson("https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=300&sortBy=date_added&sortType=asc&convert=USD&cryptoType=all&tagType=all&audited=false"),
      getJson("https://www.okx.com/api/v5/public/instruments?instType=SPOT"),
      getJson("https://api.gateio.ws/api/v4/spot/currency_pairs"),
    ]);
    const lists = [
      cmc.status === "fulfilled" ? cmcListings(cmc.value, since) : [],
      okx.status === "fulfilled" ? okxListings(okx.value, since) : [],
      gate.status === "fulfilled" ? gateListings(gate.value, since) : [],
    ];
    if (lists.every((l) => l.length === 0) && [cmc, okx, gate].every((r) => r.status === "rejected")) throw new Error("sumber listing baru tidak terjangkau");
    const merged = mergeListings(lists);
    const pairs = await tradingview.bestPairsFor([...merged.keys()]).catch(() => new Map<string, tradingview.CryptoPair>());
    const coins: NewCoin[] = await Promise.all(
      [...merged.values()].map(async (c) => {
        const p = pairs.get(c.symbol);
        return {
          ...c,
          chart: p ? await tradingview.tokenSymbol(p).catch(() => p.ticker) : null,
          pair: p?.ticker ?? null,
          exchange: p?.exchange ?? null,
          dex: Boolean(p?.dex),
          // A CoinMarketCap name to check against; an exchange-only listing has just its ticker.
          sameName: p && c.sources.includes("CoinMarketCap") ? namesAgree(c.name, p.name) : null,
          price: p?.price ?? null,
          change24h: p?.changePercent ?? null,
          volume24h: p?.volumeUsd ?? null,
        };
      }),
    );
    // An exchange listing has only a ticker; its pair's name tells a tokenized stock (TQQQX, NFLXX on Gate).
    const stocks = new Set([...pairs.values()].filter((p) => isStockToken(p.name)).map((p) => p.base));
    return coins.filter((c) => !stocks.has(c.symbol)).sort((a, b) => b.listedAt - a.listedAt);
  });
}
