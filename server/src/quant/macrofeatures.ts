// The US data's surprises as numbers, a day at a time, for the quant forecaster: each release's
// actual against the consensus, signed so that + is hotter or stronger (jobless claims and the
// unemployment rate turned round), in units of that release's own usual surprise (1.4826 × its
// median absolute surprise, as the research and the Live TV's news impact read them), capped at
// ±3. Summed over the last week and month by kind, after the research the forecaster follows
// ("Astronomi, Makro, dan Pergerakan Market", Oct 2026): inflation (CPI and core CPI, the most
// telling since 2021, so read apart from then on), jobs (payrolls, unemployment, claims), the ISM
// surveys, and the rest. Point in time: a surprise counts from its day on, scaled by the surprises
// before it only.

import type { Release } from "../providers/macroengine.js";
import { scaleOf } from "../providers/newsimpact.js";

/** Each release followed: its kind, and +1 when a print above the consensus is hotter/stronger. */
export const RELEASE_KIND: Record<string, { kind: "cpi" | "jobs" | "ism" | "other"; sign: 1 | -1 }> = {
  "Inflation Rate MoM": { kind: "cpi", sign: 1 },
  "Core Inflation Rate MoM": { kind: "cpi", sign: 1 },
  "Non Farm Payrolls": { kind: "jobs", sign: 1 },
  "Unemployment Rate": { kind: "jobs", sign: -1 },
  "Initial Jobless Claims": { kind: "jobs", sign: -1 },
  "ISM Manufacturing PMI": { kind: "ism", sign: 1 },
  "ISM Services PMI": { kind: "ism", sign: 1 },
  "PPI MoM": { kind: "other", sign: 1 },
  "Core PCE Price Index MoM": { kind: "other", sign: 1 },
  "Retail Sales MoM": { kind: "other", sign: 1 },
  "GDP Growth Rate QoQ Adv": { kind: "other", sign: 1 },
};

export const MACRO_FEATURES = [
  "Surprise inflasi 7 hari",
  "Surprise inflasi 28 hari",
  "Surprise inflasi 28 hari (rezim sejak 2021)",
  "Surprise tenaga kerja 7 hari",
  "Surprise tenaga kerja 28 hari",
  "Surprise ISM 7 hari",
  "Surprise ISM 28 hari",
  "Surprise data lain 28 hari",
] as const;

const DAY_MS = 86_400_000;
/** A release type is scaled once it has this many earlier surprises. */
const MIN_HISTORY = 12;
/** The inflation regime: CPI took over from payrolls as the release that moves markets. */
export const CPI_REGIME_DAY = Date.UTC(2021, 0, 1) / DAY_MS;

/** The day's signed, scaled surprises by kind. */
export function dailySurprises(releases: Release[]): Map<number, Record<"cpi" | "jobs" | "ism" | "other", number>> {
  const byTitle = new Map<string, Release[]>();
  for (const r of releases) {
    if (r.actual === null || r.forecast === null || !RELEASE_KIND[r.title]) continue;
    (byTitle.get(r.title) ?? byTitle.set(r.title, []).get(r.title)!).push(r);
  }
  const daily = new Map<number, Record<"cpi" | "jobs" | "ism" | "other", number>>();
  for (const [title, list] of byTitle) {
    const { kind, sign } = RELEASE_KIND[title];
    list.sort((a, b) => a.date.localeCompare(b.date));
    const past: number[] = [];
    for (const r of list) {
      const surprise = r.actual! - r.forecast!;
      if (past.length >= MIN_HISTORY) {
        const z = Math.max(-3, Math.min(3, (surprise / scaleOf(past)) * sign));
        const d = Math.floor(Date.parse(r.date) / DAY_MS);
        if (Number.isFinite(d)) {
          const row = daily.get(d) ?? { cpi: 0, jobs: 0, ism: 0, other: 0 };
          row[kind] += z;
          daily.set(d, row);
        }
      }
      past.push(surprise);
    }
  }
  return daily;
}

/** Each UTC day's macro features from `fromDay` to `toDay`, in MACRO_FEATURES order. */
export function macroFeatures(releases: Release[], fromDay: number, toDay: number): Map<number, number[]> {
  const daily = dailySurprises(releases);
  const sum = (d: number, w: number, kind: "cpi" | "jobs" | "ism" | "other") => {
    let s = 0;
    for (let k = d - w + 1; k <= d; k++) s += daily.get(k)?.[kind] ?? 0;
    return s;
  };
  const out = new Map<number, number[]>();
  for (let d = fromDay; d <= toDay; d++) {
    const cpi28 = sum(d, 28, "cpi");
    out.set(d, [sum(d, 7, "cpi"), cpi28, d >= CPI_REGIME_DAY ? cpi28 : 0, sum(d, 7, "jobs"), sum(d, 28, "jobs"), sum(d, 7, "ism"), sum(d, 28, "ism"), sum(d, 28, "other")]);
  }
  return out;
}
