// Symbol conventions shared by every route.
//
//  - Crypto uses Yahoo's "<BASE>-USD" form (BTC-USD, PEPE-USD), so a coin can
//    never be confused with a stock that happens to share its ticker.
//  - Indices start with "^" (^GSPC, ^JKSE), exactly as Yahoo spells them.
//  - Everything else is an equity/ETF: bare US tickers, or Yahoo suffixes for
//    other exchanges (BBCA.JK, 7203.T).

/** Plain tickers that meant crypto before the -USD convention; kept for saved watchlists. */
const LEGACY_CRYPTO: Record<string, string> = {
  BTC: "BTC", ETH: "ETH", SOL: "SOL", BNB: "BNB", XRP: "XRP", ADA: "ADA",
  DOGE: "DOGE", AVAX: "AVAX", DOT: "DOT", LINK: "LINK", LTC: "LTC", MATIC: "POL",
};

/** The coin's base asset (e.g. "PEPE") when the symbol is a crypto pair, else null. */
export function cryptoBase(symbol: string): string | null {
  const s = symbol.toUpperCase();
  const m = /^([A-Z0-9]{1,20})-USDT?$/.exec(s);
  if (m) return m[1];
  return LEGACY_CRYPTO[s] ?? null;
}

export const cryptoTicker = (base: string) => `${base.toUpperCase()}-USD`;

export const isIndex = (symbol: string) => symbol.startsWith("^");

/** Non-US listings (Yahoo suffix), FX pairs and futures: Nasdaq's API can't serve these. */
export const isYahooOnly = (symbol: string) => isIndex(symbol) || /[.=]/.test(symbol);
