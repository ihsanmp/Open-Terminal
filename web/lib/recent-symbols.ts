"use client";

import { useSyncExternalStore } from "react";

// The symbols opened last, newest first, as TradingView's symbol search lists them before
// anything is typed. Kept in this browser (all tabs and windows share it), whichever way a symbol
// was opened: the search, the watchlist, a link. A symbol picked in the search keeps its name,
// kind and exchange; one opened another way is known by its ticker until it's searched.

export type RecentSymbol = { symbol: string; name?: string; exchange?: string; type?: string };

const KEY = "openterminal-recent-symbols";
const MAX = 20;
const listeners = new Set<() => void>();
let cache: RecentSymbol[] | null = null;

function read(): RecentSymbol[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter((r) => typeof r?.symbol === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: RecentSymbol[]) {
  cache = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // remembered until the page closes
  }
  for (const l of listeners) l();
}

/** Puts a symbol first, keeping what was known of it (a name from an earlier search). */
export function addRecent(entry: RecentSymbol, list: RecentSymbol[] = read()): RecentSymbol[] {
  const symbol = entry.symbol.toUpperCase();
  const known = list.find((r) => r.symbol === symbol);
  const merged: RecentSymbol = { ...known, ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v)), symbol };
  const next = [merged, ...list.filter((r) => r.symbol !== symbol)].slice(0, MAX);
  if (typeof window !== "undefined") write(next);
  return next;
}

export function removeRecent(symbol: string) {
  write(read().filter((r) => r.symbol !== symbol));
}

export function clearRecent() {
  write([]);
}

/** The kind of a symbol not looked up: as the app spells them (BTC-USD, EURUSD=X, ^GSPC, GC=F). */
export function kindOf(symbol: string): string {
  if (/-USDT?$/.test(symbol)) return "crypto";
  if (/=X$/.test(symbol)) return "forex";
  if (symbol.startsWith("^")) return "index";
  if (/=F$/.test(symbol)) return "futures";
  return "stock";
}

const EMPTY: RecentSymbol[] = [];

export function useRecentSymbols(): RecentSymbol[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // Another window's opens show here too.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== KEY) return;
        cache = null;
        l();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    () => EMPTY
  );
}
