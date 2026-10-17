// The US data's surprises as numbers, a day at a time, for the quant forecaster: each release the
// macro engine follows (CPI, payrolls, PCE, claims …), its actual against the consensus, hawkish-
// signed and in units of that release's own usual surprise (as the Live TV's news impact reads
// them), summed over the last week and month. Point in time: a surprise counts from its day on, and
// is scaled by the surprises before it only.

import { TARGETS, type Release } from "../providers/macroengine.js";
import { scaleOf } from "../providers/newsimpact.js";

export const MACRO_FEATURES = ["Surprise data AS 5 hari (hawkish +)", "Surprise data AS 20 hari (hawkish +)"] as const;

const DAY_MS = 86_400_000;
/** A release type is scaled once it has this many earlier surprises. */
const MIN_HISTORY = 12;

/** Each UTC day's macro features from `fromDay` to `toDay`, in MACRO_FEATURES order. */
export function macroFeatures(releases: Release[], fromDay: number, toDay: number): Map<number, number[]> {
  const hawkOf = new Map(TARGETS.map((t) => [t.title, t.hawk]));
  const byTitle = new Map<string, Release[]>();
  for (const r of releases) {
    if (r.actual === null || r.forecast === null || !hawkOf.has(r.title)) continue;
    (byTitle.get(r.title) ?? byTitle.set(r.title, []).get(r.title)!).push(r);
  }
  // The day's signed, scaled surprises.
  const daily = new Map<number, number>();
  for (const [title, list] of byTitle) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const past: number[] = [];
    for (const r of list) {
      const surprise = r.actual! - r.forecast!;
      if (past.length >= MIN_HISTORY) {
        const z = Math.max(-4, Math.min(4, (surprise / scaleOf(past)) * hawkOf.get(title)!));
        const d = Math.floor(Date.parse(r.date) / DAY_MS);
        if (Number.isFinite(d)) daily.set(d, (daily.get(d) ?? 0) + z);
      }
      past.push(surprise);
    }
  }
  const sumOver = (d: number, w: number) => {
    let s = 0;
    for (let k = d - w + 1; k <= d; k++) s += daily.get(k) ?? 0;
    return s;
  };
  const out = new Map<number, number[]>();
  for (let d = fromDay; d <= toDay; d++) out.set(d, [sumOver(d, 7), sumOver(d, 28)]);
  return out;
}
