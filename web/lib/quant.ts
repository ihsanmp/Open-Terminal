// The quant forecasts (server: quant/service.ts), as the Live TV's Prakiraan tab and the Astro
// Calendar's events read them: each market's chance of a rise over 5, 10 and 20 trading days, its
// walk-forward record, and its out-of-sample forecast for past days.

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

export const QUANT_HORIZONS = [5, 10, 20] as const;
export type QuantHorizon = (typeof QUANT_HORIZONS)[number];
export type QuantVerdict = "Bullish" | "Bearish" | "Netral";

export type QuantScore = { n: number; acc: number; baseAcc: number; bss: number; z: number; proven: boolean };
export type HorizonForecast = {
  pUp: number;
  baseRate: number;
  verdict: QuantVerdict;
  score: QuantScore;
  without: { astro: QuantScore; macro: QuantScore };
  drivers: Array<{ name: string; group: "market" | "macro" | "astro"; pull: number }>;
  band: { p10: number; p50: number; p90: number };
};
export type AssetForecast = {
  key: string;
  label: string;
  symbol: string;
  group: string;
  unit: "%" | "bp";
  price: number;
  asOfDay: number;
  horizons: Record<QuantHorizon, HorizonForecast>;
};
export type QuantForecast = { at: number; asOfDay: number; assets: AssetForecast[] };
export type QuantHistory = { asOfDay: number; history: Record<QuantHorizon, Array<[number, number]>> };

/** The forecasts, refreshed every ten minutes (the server works them out a few times a day). */
export function useQuantForecast() {
  return useQuery({
    queryKey: ["quant-forecast"],
    queryFn: () => apiGet<QuantForecast>("/api/quant/forecast"),
    refetchInterval: 600_000,
    staleTime: 300_000,
    retry: 6,
    retryDelay: 15_000,
  });
}

/** A market's out-of-sample forecasts for past days. */
export function useQuantHistory(key: string) {
  return useQuery({
    queryKey: ["quant-history", key],
    queryFn: () => apiGet<QuantHistory>(`/api/quant/history/${key}`),
    staleTime: 600_000,
    retry: 6,
    retryDelay: 15_000,
  });
}

/** The forecast horizon nearest to a span of trading days (an astro event's 5, 10 or 20). */
export const horizonFor = (days: number): QuantHorizon => QUANT_HORIZONS.reduce((a, b) => (Math.abs(b - days) < Math.abs(a - days) ? b : a));

/** Bullish or bearish only with a tested signal; the chance otherwise is the market's usual. */
export function verdictOf(pUp: number, f: HorizonForecast): QuantVerdict {
  if (!f.score.proven) return "Netral";
  const lean = pUp - f.baseRate;
  return pUp >= 0.5 && lean >= 0.03 ? "Bullish" : pUp < 0.5 && lean <= -0.03 ? "Bearish" : "Netral";
}

/**
 * What was forecast the day before `eventDay` for a span: the out-of-sample forecast of the last
 * trading day before it when that's known, the latest forecast for an event still ahead.
 */
export function forecastFor(eventDay: number, h: QuantHorizon, hist: QuantHistory | undefined, live: AssetForecast | undefined): { pUp: number; asOfDay: number; live: boolean } | null {
  if (live && eventDay - 1 >= live.asOfDay) return { pUp: live.horizons[h].pUp, asOfDay: live.asOfDay, live: true };
  const rows = hist?.history[h];
  if (!rows?.length) return null;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= eventDay - 1) lo = mid + 1;
    else hi = mid;
  }
  const k = lo - 1;
  // A forecast more than a week before the event isn't its H-1 one.
  if (k < 0 || eventDay - 1 - rows[k][0] > 7) return null;
  return { pUp: rows[k][1], asOfDay: rows[k][0], live: false };
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const signedPts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} poin`;
