// The sky as numbers for the quant forecaster: the season, from the Sun's place among the signs
// (the Earth's tilt). The research the forecaster follows ("Astronomi, Makro, dan Pergerakan
// Market", Oct 2026: 40 tests, 2005–2026) found nothing in the moon's phases, eclipses, Mercury
// retrograde, geomagnetic storms or the clock changes, and two seasonal patterns that held:
// WTI weaker in autumn (16 of 22 years) and bitcoin wilder in winter (9 of 13), gold firmer in
// winter (17 of 22, weakly). So the season is what the model reads; the walk-forward test still
// decides whether it helps (model.ts reports the forecasts with and without it).

import { buildEvents } from "../astro/events.js";

export const ASTRO_FEATURES = ["Musim gugur (21 Sep–20 Des)", "Musim dingin (21 Des–20 Mar)", "Musim semi (21 Mar–20 Jun)"] as const;

export type Season = "spring" | "summer" | "autumn" | "winter";

/** The sign the Sun enters at each season's start (the northern hemisphere's). */
const SEASON_AT: Record<string, Season> = { Aries: "spring", Cancer: "summer", Libra: "autumn", Capricorn: "winter" };

/** Each UTC day's season from `fromDay` to `toDay`, from the Sun's ingresses. */
export function seasons(fromDay: number, toDay: number): Map<number, Season> {
  const starts = buildEvents(fromDay - 120, toDay + 1)
    .filter((e) => e.kind === "ingress" && e.keys[0].startsWith("ingress:Sun:"))
    .map((e) => ({ day: Math.floor(e.time / 86_400), season: SEASON_AT[e.keys[0].split(":")[2]] }))
    .filter((s) => s.season)
    .sort((a, b) => a.day - b.day);
  const out = new Map<number, Season>();
  let k = 0;
  for (let d = fromDay; d <= toDay; d++) {
    while (k + 1 < starts.length && starts[k + 1].day <= d) k++;
    out.set(d, starts[k]?.season ?? "summer");
  }
  return out;
}

/** Each UTC day's sky features from `fromDay` to `toDay`, in ASTRO_FEATURES order. */
export function astroFeatures(fromDay: number, toDay: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const [d, s] of seasons(fromDay, toDay)) out.set(d, [s === "autumn" ? 1 : 0, s === "winter" ? 1 : 0, s === "spring" ? 1 : 0]);
  return out;
}
