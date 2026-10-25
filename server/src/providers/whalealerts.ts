// Pop-ups for the pair open on the chart: the whales' and the institutions' buys and sells among
// its transactions (providers/transfers.ts), those big enough to matter. A coin pair is about its
// coin, and against another coin (SOL/BTC) about that one too; a stock about its own insiders and
// holders.

import { isTvPair } from "../symbols.js";
import { coreOf } from "./paircontext.js";
import type { TransferRow } from "./transfers.js";

export type WhaleAlert = TransferRow & { asset: string };

/** Coins a pair can be quoted in that have whales and institutions of their own. */
const QUOTE_COINS = new Set(["BTC", "ETH", "SOL", "BNB"]);

/** The assets whose transactions concern a pair, as transfers.ts reads them (SOL-USD, AAPL). */
export function alertAssets(symbol: string): string[] {
  const { core, crypto, cryptoQuote } = coreOf(symbol);
  if (crypto) return [`${crypto}-USD`, ...(cryptoQuote && QUOTE_COINS.has(cryptoQuote) && cryptoQuote !== crypto ? [`${cryptoQuote}-USD`] : [])];
  return [isTvPair(symbol) ? core : symbol.toUpperCase()];
}

/** The least a transaction of each kind must be worth to pop up (US$); an institution's always does. */
export const MIN_USD: Record<TransferRow["category"], number> = {
  institution: 0,
  insider: 100_000,
  whale: 1_000_000,
  onchain: 1_000_000,
  exchange: 1_000_000,
};

/** A buy or a sell by a whale or an institution, big enough for a pop-up. */
export function isAlert(row: TransferRow): boolean {
  if (row.side !== "buy" && row.side !== "sell") return false;
  const min = MIN_USD[row.category];
  return min === 0 || (row.usd ?? 0) >= min;
}

/** Seconds, whichever a row was given in. */
const secondsOf = (t: number) => (t > 1e11 ? Math.floor(t / 1000) : t);

/** Each asset's alerts of the last `days`, newest first, each transaction once. */
export function pickAlerts(byAsset: Array<{ asset: string; rows: TransferRow[] }>, now = Date.now(), days = 14, limit = 40): WhaleAlert[] {
  const since = now / 1000 - days * 86_400;
  const seen = new Set<string>();
  const out: WhaleAlert[] = [];
  for (const { asset, rows } of byAsset) {
    for (const r of rows) {
      const time = secondsOf(r.time);
      if (!isAlert(r) || time < since || seen.has(`${asset}:${r.id}`)) continue;
      seen.add(`${asset}:${r.id}`);
      out.push({ ...r, time, asset });
    }
  }
  return out.sort((a, b) => b.time - a.time).slice(0, limit);
}
