// The sky as numbers, a day at a time, for the quant forecaster: what the astrology calendar marks
// (../astro/events.ts, the same computation as the web's), read as features the model can weigh
// against the markets' own. Whether any of it helps is left to the walk-forward test (model.ts
// reports the forecasts with and without these).

import { buildEvents, type AstroEvent } from "../astro/events.js";

export const ASTRO_FEATURES = [
  "Merkurius retrograde",
  "Venus retrograde",
  "Mars retrograde",
  "Planet retrograde (jumlah)",
  "Fase bulan (sin)",
  "Fase bulan (cos)",
  "Gerhana ±7 hari",
  "Aspek tegang ±3 hari",
  "Aspek harmonis ±3 hari",
  "Aspek planet lambat ±10 hari",
  "Ingress ±2 hari",
] as const;

const DAY = 86_400;
const dayOf = (e: AstroEvent) => Math.floor(e.time / DAY);

/** Each UTC day's sky features from `fromDay` to `toDay` (inclusive), in ASTRO_FEATURES order. */
export function astroFeatures(fromDay: number, toDay: number): Map<number, number[]> {
  // A margin each side, for the windows and the retrograde state the period opens in.
  const events = buildEvents(fromDay - 400, toDay + 40).sort((a, b) => a.time - b.time);
  const retro = new Set<string>();
  const newMoons = events.filter((e) => e.keys[0].startsWith("lunation:new")).map(dayOf);
  const counts = (pred: (e: AstroEvent) => boolean) => {
    const byDay = new Map<number, number>();
    for (const e of events) if (pred(e)) byDay.set(dayOf(e), (byDay.get(dayOf(e)) ?? 0) + 1);
    return (d: number, w: number) => {
      let n = 0;
      for (let k = d - w; k <= d + w; k++) n += byDay.get(k) ?? 0;
      return n;
    };
  };
  const nature = (e: AstroEvent) => e.keys[1]?.split(":")[2];
  const hard = counts((e) => e.kind === "aspect" && nature(e) === "hard");
  const soft = counts((e) => e.kind === "aspect" && nature(e) === "soft");
  const slow = counts((e) => e.kind === "aspect" && e.keys[2]?.endsWith(":slow"));
  const ingress = counts((e) => e.kind === "ingress");
  const eclipse = counts((e) => e.kind === "eclipse");

  const out = new Map<number, number[]>();
  let i = 0;
  let nm = 0;
  for (let d = fromDay - 400; d <= toDay; d++) {
    // Stations up to the end of this day set who is retrograde.
    while (i < events.length && dayOf(events[i]) <= d) {
      const [k, planet] = events[i].keys[0].split(":");
      if (k === "rx") retro.add(planet);
      else if (k === "direct") retro.delete(planet);
      i++;
    }
    if (d < fromDay) continue;
    while (nm + 1 < newMoons.length && newMoons[nm + 1] <= d) nm++;
    const last = newMoons[nm];
    const next = newMoons[nm + 1] ?? last + 29.53;
    const phase = last <= d && next > last ? (d - last) / (next - last) : 0;
    out.set(d, [
      retro.has("Mercury") ? 1 : 0,
      retro.has("Venus") ? 1 : 0,
      retro.has("Mars") ? 1 : 0,
      retro.size,
      Math.sin(2 * Math.PI * phase),
      Math.cos(2 * Math.PI * phase),
      eclipse(d, 7) > 0 ? 1 : 0,
      hard(d, 3),
      soft(d, 3),
      slow(d, 10),
      ingress(d, 2),
    ]);
  }
  return out;
}
