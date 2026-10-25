"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiGet } from "./api";
import { useTerminal, useWidgetSetting } from "../store/terminal";

// The pair open on the Charting page, for every tool to follow: its symbol, what it is and where
// it belongs in each tool (server/src/providers/paircontext.ts), and a brief of all of it. A tool
// that picks something for the pair (the futures curve, the COT market, the calendar's country)
// picks it again when the pair changes; a choice made by hand stays until then.

export type GeoKey = "gold" | "oil" | "dxy" | "us10y" | "spx" | "btc" | "vix";
export type PairContext = {
  symbol: string;
  label: string;
  kind: "crypto" | "fx" | "metal" | "energy" | "agri" | "index" | "stock" | "etf" | "rate" | "volatility" | "dollar" | "other";
  currencies: string[];
  country: string | null;
  sector: string | null;
  regimeKey: string | null;
  regimeProxy: boolean;
  curveId: string | null;
  cotId: string | null;
  quantKey: string | null;
  geo: { key: GeoKey; sign: 1 | -1 } | null;
  etfs: string[];
  keywords: string[];
};

export const KIND_LABEL: Record<PairContext["kind"], string> = {
  crypto: "kripto", fx: "forex", metal: "logam", energy: "energi", agri: "pertanian", index: "indeks", stock: "saham", etf: "ETF", rate: "suku bunga", volatility: "volatilitas", dollar: "dolar", other: "lainnya",
};

/** The symbol on the Charting page: its own when it's unlinked, else the active one. */
export function useChartSymbol(): string {
  return useTerminal((s) => {
    const chart = s.pages.find((p) => p.type === "chart");
    return chart && !chart.linked && chart.symbol ? chart.symbol : s.activeSymbol;
  });
}

export function usePairContext() {
  const symbol = useChartSymbol();
  const q = useQuery({ queryKey: ["pair-ctx", symbol], queryFn: () => apiGet<PairContext>(`/api/desk/pair?symbol=${encodeURIComponent(symbol)}`), staleTime: 3_600_000 });
  return { symbol, ctx: q.data ?? null, loading: q.isLoading };
}

/**
 * Whether a text names the pair: whole words only ("gold" not in "golden", "eth" not in
 * "ethereum"), a ticker with or without its $; a keyword written "$link" only with it.
 */
export function mentions(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return keywords.some((k) => new RegExp(`(^|[^a-z0-9$])${k.startsWith("$") ? `\\$${esc(k.slice(1))}` : `\\$?${esc(k)}`}(?![a-z0-9])`).test(t));
}

/** Keywords too broad to tell one pair's news from its market's ("crypto" names every coin). */
export const BROAD_KEYWORDS = new Set(["crypto"]);

/**
 * A widget setting that follows the pair: set to `fromPair` whenever the chart's pair changes
 * (once the pair's context is known and gives a value), otherwise left as chosen.
 */
export function useFollowPair<T>(key: string, fallback: T, fromPair: T | null | undefined, ready: boolean): [T, (v: T) => void] {
  const symbol = useChartSymbol();
  const [value, setValue] = useWidgetSetting<T>(key, fallback);
  const [syncedFor, setSyncedFor] = useWidgetSetting<string | null>(`${key}@pair`, null);
  useEffect(() => {
    if (!ready || syncedFor === symbol) return;
    if (fromPair != null) setValue(fromPair);
    setSyncedFor(symbol);
  }, [ready, symbol, syncedFor, fromPair, setValue, setSyncedFor]);
  return [value, setValue];
}
