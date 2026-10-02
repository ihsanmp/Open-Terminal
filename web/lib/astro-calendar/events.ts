// The astrology calendar's events, computed offline from planet positions (../ta/astro.ts, JPL
// elements; checked to a fraction of a degree): stations (retrograde / direct), sign ingresses,
// exact major aspects between the planets, new and full moons, and eclipses.
//
// Positions are sampled once a day (00:00 UTC) and each event's moment is interpolated between
// the two days around it, which is well within the day for everything listed here.

import { geocentric, type Body } from "../ta/astro";

export type EventKind = "station" | "ingress" | "aspect" | "lunation" | "eclipse";

export type AstroEvent = {
  id: string;
  /** Unix seconds (UTC) of the exact moment. */
  time: number;
  kind: EventKind;
  title: string;
  /** Short symbol for the calendar, e.g. "♀℞". */
  glyph: string;
  /** One line on what happens in the sky (Indonesian). */
  detail: string;
  /**
   * Keys under which past events of the same kind are looked up for the market impact, most
   * specific first (e.g. Mars square Saturn, then Mars–Saturn tension, then any square).
   */
  keys: string[];
  /** Trading days over which the impact is measured. */
  horizon: number;
  bodies: string[];
};

type Planet = Exclude<Body, "Earth" | "Moon">;
const PLANETS: Planet[] = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const RETRO: Planet[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const SLOW = new Set<string>(["Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);

export const GLYPH: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂", Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇",
};
const NAME_ID: Record<string, string> = {
  Sun: "Matahari", Moon: "Bulan", Mercury: "Merkurius", Venus: "Venus", Mars: "Mars", Jupiter: "Jupiter", Saturn: "Saturnus", Uranus: "Uranus", Neptune: "Neptunus", Pluto: "Pluto",
};
export const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_GLYPH = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const ELEMENTS = ["Api", "Tanah", "Udara", "Air"];
const element = (sign: number) => ELEMENTS[sign % 4];

const ASPECTS = [
  { angle: 0, name: "Conjunction", glyph: "☌", nature: "conj" },
  { angle: 60, name: "Sextile", glyph: "⚹", nature: "soft" },
  { angle: 90, name: "Square", glyph: "□", nature: "hard" },
  { angle: 120, name: "Trine", glyph: "△", nature: "soft" },
  { angle: 180, name: "Opposition", glyph: "☍", nature: "hard" },
] as const;

const DAY = 86_400;
const norm = (d: number) => ((d % 360) + 360) % 360;
const diff = (a: number, b: number) => ((a - b + 540) % 360) - 180; // signed a − b, −180 … 180
/** "Scorpio 8°29′" */
export function position(lon: number): string {
  const sign = Math.floor(norm(lon) / 30);
  const deg = norm(lon) - sign * 30;
  return `${SIGNS[sign]} ${Math.floor(deg)}°${String(Math.floor((deg % 1) * 60)).padStart(2, "0")}′`;
}

/** Where f crosses zero between two daily samples: the fraction of the day (0 … 1), or null. */
function crossing(f0: number, f1: number, maxJump = 90): number | null {
  if (!Number.isFinite(f0) || !Number.isFinite(f1) || f0 === 0 || Math.sign(f0) === Math.sign(f1) || Math.abs(f1 - f0) > maxJump) return null;
  return Math.abs(f0) / (Math.abs(f0) + Math.abs(f1));
}

/**
 * Every event from `fromDay` to `toDay` (UTC day numbers, days since 1970-01-01). Takes roughly a
 * few hundred milliseconds for 40 years.
 */
export function buildEvents(fromDay: number, toDay: number): AstroEvent[] {
  const n = toDay - fromDay + 3; // a day either side for speeds and crossings
  const t0 = (fromDay - 1) * DAY;
  const lon: Record<string, Float64Array> = {};
  for (const b of [...PLANETS, "Moon"] as const) {
    const a = new Float64Array(n);
    for (let k = 0; k < n; k++) a[k] = geocentric(b, t0 + k * DAY).lon;
    lon[b] = a;
  }
  const at = (k: number, frac: number) => t0 + (k + frac) * DAY;
  const events: AstroEvent[] = [];
  const push = (e: Omit<AstroEvent, "id">) => {
    const day = Math.floor(e.time / DAY);
    if (day >= fromDay && day <= toDay) events.push({ ...e, id: `${e.keys[0]}@${Math.round(e.time / 600)}` });
  };

  // Stations: the daily motion changes sign.
  for (const p of RETRO) {
    const L = lon[p];
    for (let k = 1; k < n - 1; k++) {
      const v0 = diff(L[k], L[k - 1]);
      const v1 = diff(L[k + 1], L[k]);
      const f = crossing(v0, v1, 10);
      if (f === null) continue;
      const rx = v0 > 0;
      const time = at(k, f - 0.5);
      push({
        time,
        kind: "station",
        title: `${p} ${rx ? "Retrograde" : "Direct"}`,
        glyph: `${GLYPH[p]}${rx ? "℞" : "D"}`,
        detail: rx
          ? `${NAME_ID[p]} berhenti lalu tampak bergerak mundur dari Bumi, di ${position(L[k])}.`
          : `${NAME_ID[p]} berhenti mundur dan kembali bergerak maju, di ${position(L[k])}.`,
        keys: [`${rx ? "rx" : "direct"}:${p}`],
        horizon: SLOW.has(p) ? 20 : 10,
        bodies: [p],
      });
    }
  }

  // Ingresses: a planet enters a sign (again, when retrograde takes it back).
  for (const p of PLANETS) {
    const L = lon[p];
    for (let k = 0; k < n - 1; k++) {
      const s0 = Math.floor(L[k] / 30);
      const s1 = Math.floor(L[k + 1] / 30);
      if (s0 === s1) continue;
      const boundary = (diff(L[k + 1], L[k]) > 0 ? s1 : s0) * 30;
      const f = crossing(diff(L[k], boundary), diff(L[k + 1], boundary), 40) ?? 0.5;
      const sign = s1;
      const cardinal = p === "Sun" && sign % 3 === 0 ? ["Ekuinoks Maret", "Solstis Juni", "Ekuinoks September", "Solstis Desember"][[0, 3, 6, 9].indexOf(sign)] : null;
      push({
        time: at(k, f),
        kind: "ingress",
        title: cardinal ?? `${p} enters ${SIGNS[sign]}`,
        glyph: `${GLYPH[p]}${SIGN_GLYPH[sign]}`,
        detail: `${NAME_ID[p]} masuk ${SIGNS[sign]} (elemen ${element(sign)})${cardinal ? `: ${cardinal.toLowerCase()}` : ""}.`,
        keys: [`ingress:${p}:${SIGNS[sign]}`, `ingress:${p}:${element(sign)}`, `ingress:${p}`],
        horizon: SLOW.has(p) ? 20 : 5,
        bodies: [p],
      });
    }
  }

  // Exact major aspects between two planets (both ways round: +60° and −60° …).
  for (let i = 0; i < PLANETS.length; i++)
    for (let j = i + 1; j < PLANETS.length; j++) {
      const a = PLANETS[i];
      const b = PLANETS[j];
      // The Sun is never more than 28° from Mercury or 48° from Venus: only conjunctions.
      const aspects = a === "Sun" && (b === "Mercury" || b === "Venus") ? ASPECTS.filter((x) => x.angle === 0) : b === "Venus" && a === "Mercury" ? ASPECTS.filter((x) => x.angle <= 60) : ASPECTS;
      const A = lon[a];
      const B = lon[b];
      for (const asp of aspects) {
        const targets = asp.angle === 0 || asp.angle === 180 ? [asp.angle] : [asp.angle, 360 - asp.angle];
        for (const target of targets)
          for (let k = 0; k < n - 1; k++) {
            const f = crossing(diff(norm(A[k] - B[k]), target), diff(norm(A[k + 1] - B[k + 1]), target), 40);
            if (f === null) continue;
            const slowPair = SLOW.has(a) && SLOW.has(b);
            push({
              time: at(k, f),
              kind: "aspect",
              title: `${a} ${asp.name} ${b}`,
              glyph: `${GLYPH[a]}${asp.glyph}${GLYPH[b]}`,
              detail: `${NAME_ID[a]} (${position(A[k])}) dan ${NAME_ID[b]} (${position(B[k])}) membentuk sudut ${asp.angle}° tepat.`,
              keys: [`aspect:${a}-${b}:${asp.name}`, `aspect:${a}-${b}:${asp.nature}`, `aspect:${asp.name}${slowPair ? ":slow" : ""}`],
              horizon: slowPair ? 10 : 5,
              bodies: [a, b],
            });
          }
      }
    }

  // New and full moons, and the eclipses among them (the Moon near the ecliptic, i.e. a node).
  const M = lon.Moon;
  const S = lon.Sun;
  for (const [target, phase] of [[0, "new"], [180, "full"]] as const)
    for (let k = 0; k < n - 1; k++) {
      const f = crossing(diff(norm(M[k] - S[k]), target), diff(norm(M[k + 1] - S[k + 1]), target), 60);
      if (f === null) continue;
      const time = at(k, f);
      const moon = geocentric("Moon", time);
      const sign = Math.floor(moon.lon / 30);
      const beta = Math.abs(moon.lat);
      // Eclipse limits on the Moon's latitude at the lunation (Meeus ch. 54, rounded).
      const eclipse = phase === "new" ? (beta < 1.55 ? "solar" : null) : beta < 0.95 ? "lunar" : beta < 1.55 ? "penumbral" : null;
      push({
        time,
        kind: "lunation",
        title: phase === "new" ? `New Moon in ${SIGNS[sign]}` : `Full Moon in ${SIGNS[sign]}`,
        glyph: phase === "new" ? "🌑" : "🌕",
        detail: `${phase === "new" ? "Bulan baru" : "Purnama"} di ${position(moon.lon)}.`,
        keys: [`lunation:${phase}:${SIGNS[sign]}`, `lunation:${phase}:${element(sign)}`, `lunation:${phase}`],
        horizon: 5,
        bodies: ["Moon", "Sun"],
      });
      if (eclipse)
        push({
          time,
          kind: "eclipse",
          title: eclipse === "solar" ? "Solar Eclipse" : eclipse === "lunar" ? "Lunar Eclipse" : "Penumbral Lunar Eclipse",
          glyph: eclipse === "solar" ? "🌘" : "🌒",
          detail: `${eclipse === "solar" ? "Gerhana matahari" : eclipse === "lunar" ? "Gerhana bulan" : "Gerhana bulan penumbra"}: ${phase === "new" ? "bulan baru" : "purnama"} dekat node Bulan (lintang Bulan ${beta.toFixed(2)}°), di ${position(moon.lon)}.`,
          keys: [`eclipse:${eclipse === "solar" ? "solar" : "lunar"}`, "eclipse"],
          horizon: 10,
          bodies: ["Moon", "Sun"],
        });
    }

  return events.sort((x, y) => x.time - y.time);
}
