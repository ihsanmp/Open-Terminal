// A planet's retrograde periods, to the minute: its apparent geocentric longitude on the true
// ecliptic of date (astronomy-engine: light time and aberration included, as the almanacs and the
// astrologers' ephemerides give it), the stations found where its daily motion changes sign, by
// bisection. With each period, its shadow: from when the planet first reaches the degree it will
// turn direct at (the pre-shadow) to when it is back at the degree it turned retrograde at (the
// post-shadow).
//
// Checked against the published 2026 Mercury retrogrades (Feb 26 – Mar 20, Jun 29 – Jul 23,
// Oct 24 – Nov 13, US Eastern time): retrograde.test.ts.

import * as AE from "astronomy-engine";

export type RetroPlanet = "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";
export const RETRO_PLANETS: RetroPlanet[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

export type Station = { /** Unix ms. */ time: number; lon: number };
export type RetroPeriod = {
  planet: RetroPlanet;
  /** Turning retrograde, and direct again. */
  start: Station;
  end: Station;
  /** Pre-shadow (it reaches the degree it will turn direct at) and post-shadow (back at the degree it turned retrograde at); null past the searched range. */
  shadowStart: number | null;
  shadowEnd: number | null;
};

const DAY_MS = 86_400_000;
const BODY: Record<RetroPlanet, AE.Body> = {
  Mercury: AE.Body.Mercury, Venus: AE.Body.Venus, Mars: AE.Body.Mars, Jupiter: AE.Body.Jupiter,
  Saturn: AE.Body.Saturn, Uranus: AE.Body.Uranus, Neptune: AE.Body.Neptune, Pluto: AE.Body.Pluto,
};
/** How often to sample the motion: finer than the shortest stretch between two stations. */
const STEP_DAYS: Record<RetroPlanet, number> = { Mercury: 1, Venus: 2, Mars: 2, Jupiter: 4, Saturn: 4, Uranus: 5, Neptune: 5, Pluto: 5 };

const norm = (d: number) => ((d % 360) + 360) % 360;
const diff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Apparent geocentric ecliptic longitude (degrees, tropical, of date) at unix ms. */
export function apparentLongitude(planet: RetroPlanet, ms: number): number {
  return norm(AE.Ecliptic(AE.GeoVector(BODY[planet], new Date(ms), true)).elon);
}

/** Degrees per day, at unix ms. */
function speed(planet: RetroPlanet, ms: number): number {
  const h = 0.02 * DAY_MS;
  return diff(apparentLongitude(planet, ms + h), apparentLongitude(planet, ms - h)) / 0.04;
}

/** Where f changes sign between a and b (f(a), f(b) of opposite signs), to within a minute. */
function bisect(f: (ms: number) => number, a: number, b: number, fa = f(a)): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  while (hi - lo > 30_000) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Every station from `from` to `to` (unix ms), in order: true for turning retrograde. */
function stations(planet: RetroPlanet, from: number, to: number): Array<Station & { rx: boolean }> {
  const step = STEP_DAYS[planet] * DAY_MS;
  const f = (ms: number) => speed(planet, ms);
  const out: Array<Station & { rx: boolean }> = [];
  let t0 = from;
  let v0 = f(t0);
  for (let t1 = from + step; t0 < to; t1 += step) {
    const v1 = f(t1);
    if (Math.sign(v1) !== Math.sign(v0) && v0 !== 0) {
      const time = bisect(f, t0, t1, v0);
      out.push({ time, lon: apparentLongitude(planet, time), rx: v0 > 0 });
    }
    t0 = t1;
    v0 = v1;
  }
  return out;
}

/** When the planet, moving direct, is at `lon` between `from` and `to` (unix ms); null if it isn't. */
function reaches(planet: RetroPlanet, lon: number, from: number, to: number, step: number): number | null {
  const g = (ms: number) => diff(apparentLongitude(planet, ms), lon);
  let t0 = from;
  let g0 = g(t0);
  for (let t1 = from + step; t0 < to; t1 += step) {
    const g1 = g(Math.min(t1, to));
    // A crossing from below (direct motion), not the wrap at the opposite side of the circle.
    if (g0 < 0 && g1 >= 0 && g1 - g0 < 90) return bisect(g, t0, Math.min(t1, to), g0);
    t0 = t1;
    g0 = g1;
  }
  return null;
}

/**
 * The retrograde periods that touch the span from `from` to `to` (unix ms): those that begin in
 * it, and one already running at its start.
 */
export function retrogradePeriods(planet: RetroPlanet, from: number, to: number): RetroPeriod[] {
  // A period running at `from` began up to a few months before (Pluto's run ~5 months).
  const lookBack = planet === "Mercury" ? 40 * DAY_MS : planet === "Venus" || planet === "Mars" ? 90 * DAY_MS : 170 * DAY_MS;
  const lookAhead = lookBack;
  const list = stations(planet, from - lookBack, to + lookAhead);
  const out: RetroPeriod[] = [];
  for (let k = 0; k < list.length - 1; k++) {
    const s = list[k];
    const e = list[k + 1];
    if (!s.rx || e.rx) continue;
    if (e.time < from || s.time >= to) continue;
    const span = e.time - s.time;
    const step = Math.max(DAY_MS / 2, span / 40);
    out.push({
      planet,
      start: { time: s.time, lon: s.lon },
      end: { time: e.time, lon: e.lon },
      shadowStart: reaches(planet, e.lon, s.time - 3 * span, s.time, step),
      shadowEnd: reaches(planet, s.lon, e.time, e.time + 3 * span, step),
    });
  }
  return out;
}

// ---------------------------------------------------------------- the Sun's signs

export type SunIngress = {
  /** 0 = Aries … 11 = Pisces. */
  sign: number;
  /** Unix ms of the Sun's entry. */
  time: number;
  /** The equinox or solstice the entry is, if it is one. */
  season: "spring" | "summer" | "autumn" | "winter" | null;
};
const SEASON: Record<number, SunIngress["season"]> = { 0: "spring", 3: "summer", 6: "autumn", 9: "winter" };

/**
 * When the Sun enters each sign in a year (UTC year), in order: the moment its apparent
 * geocentric longitude reaches a multiple of 30° (astronomy-engine's SearchSunLongitude, to the
 * second), the equinoxes and solstices among them.
 */
export function sunIngresses(year: number): SunIngress[] {
  const out: SunIngress[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (let sign = 0; sign < 12; sign++) {
    const t = AE.SearchSunLongitude(sign * 30, new Date(start), 366);
    if (!t) continue;
    let ms = t.date.getTime();
    // A sign the Sun entered before the year began (late December's Capricorn) comes again at its end.
    if (ms < start) {
      const again = AE.SearchSunLongitude(sign * 30, new Date(ms + 300 * DAY_MS), 100);
      if (!again) continue;
      ms = again.date.getTime();
    }
    if (ms < end) out.push({ sign, time: ms, season: SEASON[sign] ?? null });
  }
  return out.sort((a, b) => a.time - b.time);
}
