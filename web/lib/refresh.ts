"use client";

import { createContext, useContext } from "react";

// Refresh policy. Every widget polls, so the intervals here decide most of the
// app's steady-state CPU, GPU (repaints) and network load. Fast refresh is kept
// for data that actually moves: US stocks during their session, crypto always.

/** False while the widget is scrolled out of view (set per widget by Workspace). */
export const WidgetVisibleContext = createContext(true);

const LEGACY_CRYPTO = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "LTC", "MATIC"]);

export const isCryptoSymbol = (symbol: string) => /-USDT?$/i.test(symbol) || LEGACY_CRYPTO.has(symbol.toUpperCase());
const isNonUsListing = (symbol: string) => /[\^.=]/.test(symbol);

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** US equities trade (including pre/after-market) 04:00–20:00 New York time on weekdays. */
export function usSessionActive(now = new Date()): boolean {
  const parts = Object.fromEntries(nyParts.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 4 * 60 && minutes < 20 * 60;
}

/** Quote refresh for one symbol. */
export function quoteRefreshMs(symbol: string): number {
  if (isCryptoSymbol(symbol)) return 5_000;
  if (isNonUsListing(symbol)) return 20_000;
  return usSessionActive() ? 3_000 : 60_000;
}

/** Fastest refresh any symbol in a list needs. */
export const listRefreshMs = (symbols: string[]) => Math.min(60_000, ...symbols.map(quoteRefreshMs));

/** Interval that is `open` while the US session runs and `closed` otherwise. */
export const sessionRefreshMs = (open: number, closed: number) => () => (usSessionActive() ? open : closed);

/**
 * A react-query `refetchInterval` that stops while the widget is off-screen.
 * (react-query already pauses intervals while the whole window is hidden.)
 */
export function usePoll(ms: number | (() => number)): () => number | false {
  const visible = useContext(WidgetVisibleContext);
  return () => (visible ? (typeof ms === "function" ? ms() : ms) : false);
}
