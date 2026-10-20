// The chat's view of the app: the calendar's events, the prices it keeps, the planets' precise
// positions. One per page, the events taken from the calendar once it has worked them out.

import { buildEvents, type AstroEvent } from "../astro-calendar/events";
import { seriesOf, type Asset, type Series } from "../astro-calendar/impact";
import { apparentLongitude, RETRO_PLANETS, retrogradePeriods, sunIngresses, type RetroPeriod, type RetroPlanet } from "../astro-calendar/retrograde";
import { geocentric } from "../ta/astro";
import type { QuantForecast } from "../quant";
import type { Env } from "./answer";
import type { Planet } from "./text";

const retroCache = new Map<string, RetroPeriod[]>();
const dated = new Map<Asset, { from: Series; to: Series }>();

/**
 * A series dated by the day its session closes. Gold's daily bars are stamped with the session's
 * opening, the evening before (Sunday for Monday's), so they're moved a day on: "the close of 12 May"
 * is then 12 May's, and gold lines up day by day with the dollar index and bitcoin.
 */
export function bySessionClose(asset: Asset, s: Series): Series {
  const cached = dated.get(asset);
  if (cached?.from === s) return cached.to;
  let sundays = 0;
  for (let i = Math.max(0, s.days.length - 300); i < s.days.length; i++) if (new Date(s.days[i] * 86_400_000).getUTCDay() === 0) sundays++;
  const out = sundays > 10 ? { days: Int32Array.from(s.days, (d) => d + 1), close: s.close } : s;
  dated.set(asset, { from: s, to: out });
  return out;
}
const sunCache = new Map<number, ReturnType<typeof sunIngresses>>();

export function chatEnv(events: AstroEvent[] | null, forecast?: QuantForecast, now = Date.now()): Env {
  return {
    today: Math.floor(now / 86_400_000),
    series: (a: Asset) => bySessionClose(a, seriesOf(a)),
    events,
    retro: (planet: RetroPlanet, from: number, to: number) => {
      // Asked for many times in a conversation: kept by planet and span (rounded to the day).
      const key = `${planet}:${Math.floor(from / 86_400_000)}:${Math.floor(to / 86_400_000)}`;
      let v = retroCache.get(key);
      if (!v) {
        v = retrogradePeriods(planet, from, to);
        retroCache.set(key, v);
      }
      return v;
    },
    sun: (year: number) => {
      let v = sunCache.get(year);
      if (!v) {
        v = sunIngresses(year);
        sunCache.set(year, v);
      }
      return v;
    },
    longitude: (planet: Planet, ms: number) =>
      (RETRO_PLANETS as string[]).includes(planet) ? apparentLongitude(planet as RetroPlanet, ms) : geocentric(planet as "Sun" | "Moon", ms / 1000).lon,
    forecast,
  };
}

/** For tests and tools: the calendar's events worked out here (a second or so). */
export function eventsFrom(fromDay: number, toDay: number): AstroEvent[] {
  return buildEvents(fromDay, toDay);
}
