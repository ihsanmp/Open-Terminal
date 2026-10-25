"use client";

import { useSyncExternalStore } from "react";

// The pop-ups for the whales' and institutions' buys and sells of the chart's pair
// (components/WhaleToasts.tsx): whether they're on, and which transactions have been shown, kept
// in this browser so a reload doesn't show them again.

const ON_KEY = "whalePopups";
const SEEN_KEY = "whalePopupsSeen";
const PAIRS_KEY = "whalePopupsPairs";
const MAX_SEEN = 3000;

const listeners = new Set<() => void>();
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private window or blocked storage: the pop-ups still work, just forget across reloads
  }
};

export function popupsOn(): boolean {
  return read(ON_KEY) !== "0";
}

export function setPopupsOn(on: boolean): void {
  write(ON_KEY, on ? "1" : "0");
  for (const l of listeners) l();
}

/** Whether the pop-ups are on, kept in step wherever it's switched (the toast, the Insider tab). */
export function usePopupsOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    popupsOn,
    () => true
  );
}

const list = (key: string): string[] => {
  try {
    const v = JSON.parse(read(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The transactions already shown (or passed over), as asset:id. */
export const seenAlerts = (): Set<string> => new Set(list(SEEN_KEY));

export function markSeen(keys: string[]): void {
  if (!keys.length) return;
  const all = [...list(SEEN_KEY), ...keys];
  write(SEEN_KEY, JSON.stringify([...new Set(all)].slice(-MAX_SEEN)));
}

/** Whether a pair's alerts have been read before (the first time, only the last day's pop up). */
export function pairKnown(symbol: string): boolean {
  return list(PAIRS_KEY).includes(symbol);
}

export function markPair(symbol: string): void {
  const all = list(PAIRS_KEY);
  if (!all.includes(symbol)) write(PAIRS_KEY, JSON.stringify([...all, symbol].slice(-500)));
}
