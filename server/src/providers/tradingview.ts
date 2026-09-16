// TradingView's public scanner/search endpoints — used by tradingview.com's
// own screener widget and symbol search box. No API key. Requires a
// believable Referer/Origin or the edge returns 403.

import type { Quote } from "./yahoo.js";
import type { CryptoRow } from "./coingecko.js";
import { cryptoTicker } from "../symbols.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Content-Type": "application/json",
  Referer: "https://www.tradingview.com/",
  Origin: "https://www.tradingview.com",
};

/** Map a Nasdaq-reported exchange label to TradingView's exchange prefix. */
export function toTVExchange(exchange: string | null): string {
  const e = (exchange ?? "").toUpperCase();
  if (e.includes("NASDAQ")) return "NASDAQ";
  if (e === "NYSE") return "NYSE";
  if (e.includes("AMERICAN") || e === "PSE" || e.includes("ARCA") || e.includes("AMEX")) return "AMEX";
  return "NASDAQ";
}

export type Fundamentals = {
  open: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  sharesOutstanding: number | null;
};

const COLUMNS = [
  "open",
  "price_earnings_ttm",
  "earnings_per_share_basic_ttm",
  "dividends_yield_current",
  "beta_1_year",
  "total_shares_outstanding",
];

/**
 * Batch-fetch fundamentals for a list of {symbol, exchange} pairs in a
 * single request. Returns a map keyed by the plain symbol (not the
 * "EXCHANGE:SYMBOL" ticker) so callers can merge by symbol directly.
 */
export async function scanFundamentals(
  entries: Array<{ symbol: string; exchange: string | null }>
): Promise<Map<string, Fundamentals>> {
  const tickers = entries.map((e) => `${toTVExchange(e.exchange)}:${e.symbol}`);
  const out = new Map<string, Fundamentals>();
  if (tickers.length === 0) return out;

  const res = await fetch("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ symbols: { tickers }, columns: COLUMNS }),
  });
  if (!res.ok) throw new Error(`tradingview scan ${res.status}`);
  const json = await res.json();
  const rows: Array<{ s: string; d: (number | null)[] }> = json?.data ?? [];

  for (const row of rows) {
    const symbol = row.s.split(":")[1];
    const [open, pe, eps, divYield, beta, shares] = row.d;
    out.set(symbol, {
      open: open ?? null,
      pe: pe ?? null,
      eps: eps ?? null,
      dividendYield: divYield !== null && divYield !== undefined ? divYield / 100 : null,
      beta: beta ?? null,
      sharesOutstanding: shares ?? null,
    });
  }
  return out;
}

export type MarketRow = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  sector: string;
  exchange: string;
};

/** Live top-N-by-market-cap snapshot across every US exchange, one request. */
export async function marketScan(limit = 1500): Promise<MarketRow[]> {
  const res = await fetch("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      columns: ["description", "close", "change", "market_cap_basic", "sector", "volume", "exchange"],
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "typespecs", operation: "has", right: ["common"] },
      ],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, limit],
    }),
  });
  if (!res.ok) throw new Error(`tradingview scan ${res.status}`);
  const json = await res.json();
  const rows: Array<{ s: string; d: any[] }> = json?.data ?? [];
  return rows
    .map((r) => {
      const [name, close, change, marketCap, sector, volume, exchange] = r.d;
      return {
        symbol: r.s.split(":")[1],
        name: name ?? r.s.split(":")[1],
        price: close ?? null,
        changePercent: change ?? null,
        marketCap: marketCap ?? null,
        sector: sector || "Other",
        volume: volume ?? null,
        exchange: exchange ?? "",
      };
    })
    // OTC/pink-sheet listings are foreign primary listings mirrored onto US OTC
    // markets — noisy, illiquid duplicates of companies better represented
    // elsewhere; drop them so the heatmap/screener only shows primary US listings.
    .filter((r) => r.symbol && r.exchange !== "OTC");
}

export type EarningsInfo = {
  symbol: string;
  nextEarningsDate: number | null; // unix seconds
  lastEarningsDate: number | null;
  epsForecast: number | null;
};

const EARNINGS_COLUMNS = ["earnings_release_next_date", "earnings_release_date", "earnings_per_share_forecast_next_fq"];

/**
 * Next/last earnings date + forward EPS estimate for a batch of US symbols.
 * We don't know each symbol's exchange up front, so every symbol is queried
 * under NASDAQ/NYSE/AMEX at once in a single request — TradingView just drops
 * whichever prefixes don't match, so exactly one row comes back per symbol.
 */
export async function earningsCalendar(symbols: string[]): Promise<EarningsInfo[]> {
  const exchanges = ["NASDAQ", "NYSE", "AMEX"];
  const tickers = symbols.flatMap((s) => exchanges.map((ex) => `${ex}:${s}`));
  const res = await fetch("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ symbols: { tickers }, columns: EARNINGS_COLUMNS }),
  });
  if (!res.ok) throw new Error(`tradingview scan ${res.status}`);
  const json = await res.json();
  const rows: Array<{ s: string; d: (number | null)[] }> = json?.data ?? [];

  const bySymbol = new Map<string, EarningsInfo>();
  for (const row of rows) {
    const symbol = row.s.split(":")[1];
    if (bySymbol.has(symbol)) continue;
    const [nextEarningsDate, lastEarningsDate, epsForecast] = row.d;
    bySymbol.set(symbol, { symbol, nextEarningsDate, lastEarningsDate, epsForecast });
  }
  return symbols.map((s) => bySymbol.get(s) ?? { symbol: s, nextEarningsDate: null, lastEarningsDate: null, epsForecast: null });
}

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

// Non-US exchanges we can serve via Yahoo Finance (our international fallback —
// Nasdaq/TradingView quote & history endpoints only cover US-listed names).
// Matched case-insensitively against TradingView's `exchange` field, which is
// sometimes a short code ("XETR") and sometimes a full name ("Euronext Paris").
const EXCHANGE_SUFFIX: Array<{ match: RegExp; suffix: string }> = [
  { match: /^(mil|bit)$/i, suffix: ".MI" }, // Borsa Italiana / Euronext Milan
  { match: /euronext paris|^par$/i, suffix: ".PA" },
  { match: /euronext amsterdam|^ams$/i, suffix: ".AS" },
  { match: /euronext brussels|^bru$/i, suffix: ".BR" },
  { match: /euronext lisbon|^lis$/i, suffix: ".LS" },
  { match: /^(xetr|fra|ger|gettex)$/i, suffix: ".DE" }, // Germany (Xetra/Frankfurt)
  { match: /^(lse|lsin)$/i, suffix: ".L" }, // London
  { match: /^(bme|mce)$/i, suffix: ".MC" }, // Spain (Madrid)
  { match: /^(six|swx|ebs)$/i, suffix: ".SW" }, // Switzerland
  { match: /^omxsto$/i, suffix: ".ST" }, // Stockholm
  { match: /^omxcop$/i, suffix: ".CO" }, // Copenhagen
  { match: /^omxhex$/i, suffix: ".HE" }, // Helsinki
  { match: /^oslo$/i, suffix: ".OL" }, // Oslo
  { match: /^(tsx|tsxv)$/i, suffix: ".TO" }, // Toronto
  { match: /^asx$/i, suffix: ".AX" }, // Australia
  { match: /^hkex$/i, suffix: ".HK" }, // Hong Kong
  { match: /^tse$/i, suffix: ".T" }, // Tokyo
  { match: /^nse$/i, suffix: ".NS" }, // India (NSE)
  { match: /^bse$/i, suffix: ".BO" }, // India (BSE)
  { match: /^idx$/i, suffix: ".JK" }, // Indonesia
  { match: /^krx$/i, suffix: ".KS" }, // Korea
  { match: /^sgx$/i, suffix: ".SI" }, // Singapore
  { match: /^twse$/i, suffix: ".TW" }, // Taiwan
  { match: /^tpex$/i, suffix: ".TWO" },
  { match: /^sse$/i, suffix: ".SS" }, // Shanghai
  { match: /^szse$/i, suffix: ".SZ" }, // Shenzhen
  { match: /^bmfbovespa$/i, suffix: ".SA" }, // Brazil
  { match: /^bmv$/i, suffix: ".MX" }, // Mexico
  { match: /^myx$/i, suffix: ".KL" }, // Malaysia
  { match: /^set$/i, suffix: ".BK" }, // Thailand
  { match: /^pse$/i, suffix: ".PS" }, // Philippines
  { match: /^nzx$/i, suffix: ".NZ" }, // New Zealand
  { match: /^tase$/i, suffix: ".TA" }, // Israel
  { match: /^jse$/i, suffix: ".JO" }, // South Africa
  { match: /^tadawul$/i, suffix: ".SR" }, // Saudi Arabia
];

function yahooSuffixFor(exchange: string): string {
  for (const { match, suffix } of EXCHANGE_SUFFIX) {
    if (match.test(exchange)) return suffix;
  }
  return "";
}

export async function search(query: string): Promise<SearchResult[]> {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(
    query
  )}&hl=1&lang=en&search_type=undefined&domain=production&sort_by_country=US`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`tradingview search ${res.status}`);
  const json = await res.json();
  const rows: any[] = json?.symbols ?? [];
  const strip = (s: string) => s.replace(/<\/?em>/g, "");
  return rows
    .filter((r) => ["stock", "fund", "dr"].includes(r.type))
    .slice(0, 15)
    .map((r) => {
      const exchange = r.exchange ?? "";
      const symbol = strip(r.symbol);
      return {
        // Non-US listings get a Yahoo-compatible suffix (e.g. "ISP" -> "ISP.MI")
        // so quote/chart lookups downstream can actually resolve them — Nasdaq's
        // API only covers US tickers, and a bare symbol collides with US names.
        symbol: symbol.includes(".") ? symbol : symbol + yahooSuffixFor(exchange),
        name: strip(r.description ?? r.symbol),
        exchange,
        type: r.type ?? "",
      };
    });
}

// ---- equity research: profile, TTM ratios, analyst consensus, peers ----

// Yahoo suffix -> TradingView exchange prefix (the inverse of EXCHANGE_SUFFIX).
const SUFFIX_TO_TV: Record<string, string> = {
  JK: "IDX", MI: "MIL", PA: "EURONEXT", AS: "EURONEXT", BR: "EURONEXT", LS: "EURONEXT", DE: "XETR", L: "LSE",
  MC: "BME", SW: "SIX", ST: "OMXSTO", CO: "OMXCOP", HE: "OMXHEX", OL: "OSL", TO: "TSX", V: "TSXV", AX: "ASX",
  HK: "HKEX", T: "TSE", NS: "NSE", BO: "BSE", KS: "KRX", KQ: "KRX", SI: "SGX", TW: "TWSE", TWO: "TPEX",
  SS: "SSE", SZ: "SZSE", SA: "BMFBOVESPA", MX: "BMV", KL: "MYX", BK: "SET", PS: "PSE", NZ: "NZX", TA: "TASE",
  JO: "JSE", SR: "TADAWUL",
};

const US_EXCHANGES = ["NASDAQ", "NYSE", "AMEX"];

/** Candidate TradingView tickers for a Yahoo-style symbol, most likely first. */
export function tvTickers(symbol: string): string[] {
  const dot = symbol.lastIndexOf(".");
  if (dot <= 0) return US_EXCHANGES.map((ex) => `${ex}:${symbol.replace("-", ".")}`);
  const exchange = SUFFIX_TO_TV[symbol.slice(dot + 1).toUpperCase()];
  if (!exchange) return [];
  let code = symbol.slice(0, dot);
  if (exchange === "HKEX") code = code.replace(/^0+/, ""); // Yahoo 0700.HK is TradingView HKEX:700
  return [`${exchange}:${code}`];
}

const RESEARCH_COLUMNS = [
  "description", "exchange", "sector", "industry", "country", "number_of_employees", "fundamental_currency_code",
  "currency", "close", "market_cap_basic", "enterprise_value_fq", "price_earnings_ttm", "price_book_fq",
  "price_revenue_ttm", "enterprise_value_ebitda_ttm", "gross_margin_ttm", "operating_margin_ttm", "net_margin_ttm",
  "return_on_equity_fq", "return_on_assets_fq", "return_on_invested_capital_fq", "total_revenue_yoy_growth_ttm",
  "earnings_per_share_diluted_yoy_growth_ttm", "dividends_yield_current", "dividend_payout_ratio_ttm", "beta_1_year",
  "current_ratio_fq", "debt_to_equity_fq", "earnings_per_share_diluted_ttm", "total_shares_outstanding",
  "price_target_average", "price_target_high", "price_target_low", "recommendation_buy", "recommendation_over",
  "recommendation_hold", "recommendation_under", "recommendation_sell", "recommendation_total", "recommendation_mark",
] as const;

export type ResearchProfile = { ticker: string } & Record<(typeof RESEARCH_COLUMNS)[number], any>;

async function globalScan(body: unknown): Promise<Array<{ s: string; d: any[] }>> {
  const res = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`tradingview scan ${res.status}`);
  return (await res.json())?.data ?? [];
}

export async function researchProfile(symbol: string): Promise<ResearchProfile> {
  const tickers = tvTickers(symbol);
  if (tickers.length === 0) throw new Error(`tradingview: unsupported exchange for ${symbol}`);
  const rows = await globalScan({ symbols: { tickers }, columns: RESEARCH_COLUMNS });
  const row = tickers.map((t) => rows.find((r) => r.s === t)).find(Boolean);
  if (!row) throw new Error(`tradingview: no data for ${symbol}`);
  return { ticker: row.s, ...Object.fromEntries(RESEARCH_COLUMNS.map((c, i) => [c, row.d[i] ?? null])) } as ResearchProfile;
}

export type PeerRow = {
  ticker: string; symbol: string; name: string; currency: string | null; price: number | null; marketCapUsd: number | null;
  pe: number | null; pb: number | null; evEbitda: number | null; netMargin: number | null; roe: number | null;
  revenueGrowth: number | null; dividendYield: number | null;
};

const PEER_COLUMNS = [
  "name", "description", "exchange", "currency", "close", "market_cap_basic", "price_earnings_ttm", "price_book_fq",
  "enterprise_value_ebitda_ttm", "net_margin_ttm", "return_on_equity_fq", "total_revenue_yoy_growth_ttm", "dividends_yield_current",
];

/** Largest primary listings in the same industry and home market. */
export async function peers(profile: ResearchProfile, limit = 10): Promise<PeerRow[]> {
  const exchanges = US_EXCHANGES.includes(profile.exchange) ? US_EXCHANGES : [profile.exchange];
  const rows = await globalScan({
    columns: PEER_COLUMNS,
    filter: [
      { left: "industry", operation: "equal", right: profile.industry },
      { left: "exchange", operation: "in_range", right: exchanges },
      { left: "type", operation: "equal", right: "stock" },
      { left: "is_primary", operation: "equal", right: true },
    ],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, limit],
  });
  return rows.map((r) => {
    const [name, description, exchange, currency, close, mcap, pe, pb, evEbitda, netMargin, roe, growth, dy] = r.d;
    const suffix = yahooSuffixFor(exchange ?? "");
    const code = exchange === "HKEX" ? String(name).padStart(4, "0") : String(name);
    return {
      ticker: r.s,
      symbol: US_EXCHANGES.includes(exchange) ? code.replace(".", "-") : code + suffix,
      name: description ?? name,
      currency: currency ?? null,
      price: close ?? null,
      marketCapUsd: mcap ?? null,
      pe: pe ?? null,
      pb: pb ?? null,
      evEbitda: evEbitda ?? null,
      netMargin: netMargin ?? null,
      roe: roe ?? null,
      revenueGrowth: growth ?? null,
      dividendYield: dy ?? null,
    };
  });
}

// ---- batch quotes for indices and non-US listings (one request, no rate-limit games) ----

const QUOTE_COLUMNS = ["description", "close", "change", "change_abs", "open", "high", "low", "volume", "currency", "exchange", "price_52_week_high", "price_52_week_low"];

/** Quotes keyed by the caller's symbol; `tickersFor` lists TradingView candidates per symbol. */
export async function batchQuotes(symbols: string[], tickersFor: (symbol: string) => string[]): Promise<Map<string, Quote>> {
  const wanted = new Map<string, string[]>();
  for (const s of symbols) {
    const t = tickersFor(s);
    if (t.length) wanted.set(s, t);
  }
  const out = new Map<string, Quote>();
  if (wanted.size === 0) return out;
  const rows = await globalScan({ symbols: { tickers: [...new Set([...wanted.values()].flat())] }, columns: QUOTE_COLUMNS });
  const byTicker = new Map(rows.map((r) => [r.s, r.d]));
  for (const [symbol, tickers] of wanted) {
    const d = tickers.map((t) => byTicker.get(t)).find(Boolean);
    if (!d || d[1] == null) continue;
    const [name, close, changePct, changeAbs, open, high, low, volume, currency, exchange, hi52, lo52] = d;
    out.set(symbol, {
      symbol, name: name ?? null, price: close, change: changeAbs ?? null, changePercent: changePct ?? null,
      open: open ?? null, high: high ?? null, low: low ?? null,
      previousClose: changeAbs != null ? close - changeAbs : null, bid: null, ask: null, volume: volume ?? null, avgVolume: null,
      marketCap: null, pe: null, eps: null, dividendYield: null, week52High: hi52 ?? null, week52Low: lo52 ?? null, beta: null,
      sharesOutstanding: null, currency: currency ?? null, exchange: exchange ?? null, marketState: null, time: null, source: "tradingview",
    });
  }
  return out;
}

// ---- crypto: TradingView's ranked coin universe (~2,500 assets, one request) ----

const COIN_COLUMNS = ["base_currency", "base_currency_desc", "close", "24h_close_change|5", "market_cap_calc", "24h_vol_cmc", "crypto_total_rank", "base_currency_logoid"];

let coinCache: { rows: CryptoRow[]; bySymbol: Map<string, CryptoRow>; fetched: number } | null = null;
let coinRequest: Promise<CryptoRow[]> | null = null;

/** Every ranked coin, best market cap first; refreshed at most every 15s. */
export async function coinBoard(): Promise<CryptoRow[]> {
  if (coinCache && Date.now() - coinCache.fetched < 15_000) return coinCache.rows;
  coinRequest ??= (async () => {
    try {
      const res = await fetch("https://scanner.tradingview.com/coin/scan", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ columns: COIN_COLUMNS, sort: { sortBy: "crypto_total_rank", sortOrder: "asc" }, range: [0, 5000] }),
      });
      if (!res.ok) throw new Error(`tradingview coin scan ${res.status}`);
      const data: Array<{ s: string; d: any[] }> = (await res.json())?.data ?? [];
      const rows: CryptoRow[] = data
        .filter((r) => r.d[0] && r.d[2] != null)
        .map((r) => {
          const [base, name, close, change, mcap, vol, rank, logo] = r.d;
          const symbol = String(base).toUpperCase();
          return {
            id: r.s, symbol, ticker: cryptoTicker(symbol), name: name ?? symbol, price: close, changePercent24h: change ?? null,
            marketCap: mcap ?? null, volume24h: vol ?? null, rank: rank ?? null, sparkline: [],
            image: logo ? `https://s3-symbol-logo.tradingview.com/${logo}.svg` : null,
          };
        });
      const bySymbol = new Map<string, CryptoRow>();
      for (const row of rows) if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row); // best-ranked wins a shared ticker
      coinCache = { rows, bySymbol, fetched: Date.now() };
      return rows;
    } finally {
      coinRequest = null;
    }
  })();
  return coinRequest;
}

export async function coinQuote(base: string, displaySymbol: string): Promise<Quote> {
  await coinBoard();
  const c = coinCache?.bySymbol.get(base.toUpperCase());
  if (!c) throw new Error(`tradingview: no coin ${base}`);
  const prev = c.changePercent24h !== null ? c.price / (1 + c.changePercent24h / 100) : null;
  return {
    symbol: displaySymbol, name: c.name, price: c.price, change: prev !== null ? c.price - prev : null,
    changePercent: c.changePercent24h, open: null, high: null, low: null, previousClose: prev, bid: null, ask: null,
    volume: c.volume24h, avgVolume: null, marketCap: c.marketCap, pe: null, eps: null, dividendYield: null,
    week52High: null, week52Low: null, beta: null, sharesOutstanding: null, currency: "USD", exchange: "Crypto",
    marketState: "Open", time: null, source: "tradingview",
  };
}

export async function coinSearch(query: string, limit = 6): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await coinBoard();
  // Exact ticker and exact name tie, so "bitcoin" finds Bitcoin (#1) before a small token whose ticker is BITCOIN.
  const score = (c: CryptoRow) =>
    c.symbol.toLowerCase() === q || c.name.toLowerCase() === q ? 0 : c.symbol.toLowerCase().startsWith(q) || c.name.toLowerCase().startsWith(q) ? 1 : 2;
  const seen = new Set<string>();
  return rows
    .filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i) // rows are already in rank order
    .map(({ c }) => c)
    .filter((c) => !seen.has(c.symbol) && seen.add(c.symbol))
    .slice(0, limit)
    .map((c) => ({ symbol: c.ticker, name: c.name, exchange: c.rank ? `Crypto #${c.rank}` : "Crypto", type: "crypto" }));
}

/** Units of `to` per one unit of `from`, from TradingView's FX_IDC reference rates. */
export async function fxRate(from: string, to: string): Promise<number> {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b) return 1;
  const rows = await globalScan({ symbols: { tickers: [`FX_IDC:${a}${b}`, `FX_IDC:${b}${a}`] }, columns: ["close"] });
  const direct = rows.find((r) => r.s === `FX_IDC:${a}${b}`)?.d[0];
  if (direct) return direct;
  const inverse = rows.find((r) => r.s === `FX_IDC:${b}${a}`)?.d[0];
  if (inverse) return 1 / inverse;
  throw new Error(`tradingview: no fx rate ${a}->${b}`);
}
