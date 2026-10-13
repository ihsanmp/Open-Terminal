// The symbols opened last, newest first, as TradingView's symbol search lists them before
// anything is typed: whichever way a symbol was opened (the search, the watchlist, a tab). Kept in
// the workspace (store/terminal.ts: recentSymbols), so it's saved with the tabs and the watchlist,
// shared by every window, and backed up to the API's disk with them: clearing the browser's
// storage or a new profile doesn't lose it. A symbol picked in the search keeps its name, kind and
// exchange; one opened another way is known by its ticker until it's searched.

export type RecentSymbol = { symbol: string; name?: string; exchange?: string; type?: string };

export const MAX_RECENT = 50;

/** The list with a symbol put first, keeping what was known of it (a name from an earlier search). */
export function withRecent(list: readonly RecentSymbol[], entry: RecentSymbol): RecentSymbol[] {
  const symbol = entry.symbol.toUpperCase();
  const known = list.find((r) => r.symbol === symbol);
  const merged: RecentSymbol = { ...known, ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v)), symbol };
  return [merged, ...list.filter((r) => r.symbol !== symbol)].slice(0, MAX_RECENT);
}

/** The list before it was kept in the workspace (this browser's own), read once to carry it over. */
export function legacyRecent(): RecentSymbol[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("openterminal-recent-symbols") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r) => typeof r?.symbol === "string") : [];
  } catch {
    return [];
  }
}

const FX_EXCHANGES = /^(OANDA|FX|FX_IDC|FXCM|PEPPERSTONE|SAXO|ICMARKETS|CAPITALCOM|EIGHTCAP|FOREXCOM):/;
const CRYPTO_EXCHANGES = /^(BINANCE|BYBIT|COINBASE|OKX|KRAKEN|BITGET|GATEIO|MEXC|KUCOIN|BITSTAMP|CRYPTO|CRYPTOCAP|PANCAKESWAP|UNISWAP\w*):/;

/** The kind of a symbol not looked up: as the app spells them (BTC-USD, EURUSD=X, ^GSPC, GC=F,
 *  or TradingView's OANDA:EURUSD and BINANCE:BTCUSDT). */
export function kindOf(symbol: string): string {
  if (FX_EXCHANGES.test(symbol)) return "forex";
  if (CRYPTO_EXCHANGES.test(symbol)) return "crypto";
  if (/-USDT?$/.test(symbol)) return "crypto";
  if (/=X$/.test(symbol)) return "forex";
  if (symbol.startsWith("^")) return "index";
  if (/=F$/.test(symbol)) return "futures";
  return "stock";
}
