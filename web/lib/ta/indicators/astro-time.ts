// Astro & time-trading indicators, after the user's "A–Z guide to astro time trading":
//
//   Planetary Aspects      conjunction / sextile / square / trine / opposition between two bodies
//   Moon Phases            new and full moons (and quarters)
//   Planetary Retrograde   retrograde periods and the stations that start and end them
//   Declination & OOB      geocentric declination, out of bounds beyond the Sun's ±23.4°
//   Bradley Siderograph    Bradley's 1947 sidereal potential, S = W(L + D) + M
//   Astro Time Window      a daily count of exact aspects, stations, lunations and OOB ingresses —
//                          the guide's "predict WHEN, not direction" turning-point feature
//   Gann Square of 9       price levels a turn of the Square of 9 away from a pivot
//   Gann Time Cycles       calendar-day counts (30 … 360, 1 – 5 years) from a pivot
//   Fourier Cycles (Hurst) the strongest sine cycles in recent prices, summed and projected
//
// Planet positions from ../astro.ts (JPL elements, corrected to precise ones for Mars and beyond). Event dates are found day by day, so they
// carry into the future and are drawn past the last bar. Independent implementations, MIT.

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { dailyMotion, geocentric, longitude, obliquity, separation, type Body } from "../astro";
import { alpha, b, bool, float, int, n, s, select, type Box, type Color, type IndicatorDef, type IndicatorResult, type Label, type Line, type Params, type TableCell } from "../types";

const DAY = 86_400;
const PLANETS: Array<Exclude<Body, "Earth">> = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const GLYPH: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Earth: "⊕", Mars: "♂", Jupiter: "♃", Saturn: "♄", Uranus: "♅", Neptune: "♆", Pluto: "♇",
};
const ASPECTS = [
  { key: "conj", name: "Conjunction", angle: 0, glyph: "☌", color: "#FFD600" },
  { key: "sext", name: "Sextile", angle: 60, glyph: "⚹", color: "#00E676" },
  { key: "square", name: "Square", angle: 90, glyph: "□", color: "#FF5252" },
  { key: "trine", name: "Trine", angle: 120, glyph: "△", color: "#40C4FF" },
  { key: "opp", name: "Opposition", angle: 180, glyph: "☍", color: "#E040FB" },
] as const;

// ---- shared helpers ----

const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const startOfDay = (t: number) => Math.floor(t / DAY) * DAY;
const diff = (a: number, b: number) => ((a - b + 540) % 360) - 180; // signed angle a − b in −180 … 180

/** Chart timing: bar spacing, last bar time and bars to project ahead. */
function timing(bars: Bars, projectDays: number) {
  const len = bars.length;
  const span = len > 1 ? Math.max(60, bars.time[len - 1] - bars.time[len - 2]) : DAY;
  const last = bars.time[len - 1];
  // At most 5,000 bars ahead (on an hourly chart a year is 8,760): events past that aren't drawn.
  const ahead = Math.min(5000, Math.round((projectDays * DAY) / span));
  return { len, span, last, ahead, end: last + ahead * span };
}

/** The bar a time falls in, counting future bars past the last one; -1 before the chart. */
function indexAt(bars: Bars, span: number, t: number): number {
  const times = bars.time;
  const len = times.length;
  if (t < times[0]) return -1;
  if (t >= times[len - 1] + span) return len - 1 + Math.floor((t - times[len - 1]) / span);
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Days (UTC midnights) from the first bar to `end`. */
function daysOf(bars: Bars, end: number): number[] {
  const out: number[] = [];
  for (let d = startOfDay(bars.time[0]); d <= end; d += DAY) out.push(d);
  return out;
}

/** When f(t) crosses zero going day by day: the interpolated time, with the sign before. */
function zeroCrossings(days: number[], f: (t: number) => number, near = 20): Array<{ t: number; from: number }> {
  const out: Array<{ t: number; from: number }> = [];
  let prev = f(days[0]);
  for (let k = 1; k < days.length; k++) {
    const v = f(days[k]);
    if (Number.isFinite(prev) && Number.isFinite(v) && prev !== 0 && Math.sign(v) !== Math.sign(prev) && Math.abs(v - prev) < 2 * near)
      out.push({ t: days[k - 1] + (DAY * Math.abs(prev)) / (Math.abs(prev) + Math.abs(v)), from: Math.sign(prev) });
    prev = v;
  }
  return out;
}

/** Price range of the last bars, for drawings in the future. */
function lastRange(bars: Bars, len = 200): { hi: number; lo: number } {
  const from = Math.max(0, bars.length - len);
  return { hi: Math.max(...bars.high.slice(from)), lo: Math.min(...bars.low.slice(from)) };
}

const tableOf = (cells: TableCell[], position: "top_right" | "bottom_left" | "bottom_right" | "top_left" = "bottom_left") => ({
  position,
  bg: "rgba(0,0,0,0.75)",
  frame: "#363A45",
  border: "#363A45",
  cells,
});

const frameOf = (p: Params) => (s(p, "frame") === "Heliocentric" ? "heliocentric" : "geocentric");

/** Exact major aspects of a pair: one event per crossing of 0°, ±60°, ±90°, ±120° or 180°. */
function aspectEvents(a: Body, bb: Body, days: number[], frame: "geocentric" | "heliocentric", keys: string[]) {
  const out: Array<{ t: number; aspect: (typeof ASPECTS)[number] }> = [];
  for (const asp of ASPECTS) {
    if (!keys.includes(asp.key)) continue;
    const targets = asp.angle === 0 || asp.angle === 180 ? [asp.angle] : [asp.angle, 360 - asp.angle];
    for (const target of targets)
      for (const c of zeroCrossings(days, (t) => diff(separation(a, bb, t, frame), target))) out.push({ t: c.t, aspect: asp });
  }
  return out.sort((x, y) => x.t - y.t);
}

// ---- Planetary Aspects ----

export const planetaryAspects: IndicatorDef = {
  id: "astro-aspects",
  name: "Planetary Aspects",
  short: "Aspects",
  category: "Community",
  overlay: true,
  aliases: ["Astro", "Astrology", "Conjunction", "Square", "Trine", "Opposition", "Sextile"],
  description: "Exact conjunctions, sextiles, squares, trines and oppositions between two planets, marked on the chart and ahead of it, with the bars inside the orb shaded.",
  legendInputs: ["a", "b"],
  inputs: [
    select("a", "Planet A", PLANETS, "Sun"),
    select("b", "Planet B", PLANETS, "Mars"),
    select("frame", "Positions", ["Geocentric", "Heliocentric"], "Geocentric"),
    ...ASPECTS.map((a) => bool(a.key, `${a.name} (${a.angle}°)`, true)),
    float("orb", "Orb (degrees) for shading", 2, 0.5, 0),
    int("projectDays", "Project Ahead (days)", 365, 0, 3000),
    bool("shade", "Shade Bars Inside the Orb", true),
  ],
  plots: [],
  compute: (bars, p) => aspectsCompute(bars, p),
};

export function aspectsCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const a = s(p, "a") as Body;
  const bb = s(p, "b") as Body;
  const frame = frameOf(p);
  if (a === bb || !Number.isFinite(longitude(a, bars.time[0], frame)) || !Number.isFinite(longitude(bb, bars.time[0], frame))) return { plots: {} };
  const { len, span, end } = timing(bars, n(p, "projectDays"));
  const keys = ASPECTS.filter((x) => b(p, x.key)).map((x) => x.key);
  const days = daysOf(bars, end);
  const { hi } = lastRange(bars);
  const labels: Label[] = aspectEvents(a, bb, days, frame, keys).map(({ t, aspect }) => {
    const i = indexAt(bars, span, t);
    const future = i >= len;
    return {
      index: i,
      price: future ? hi : bars.high[i],
      text: `${GLYPH[a]}${aspect.glyph}${GLYPH[bb]}${future ? ` ${date(t)}` : ""}`,
      style: "down",
      bg: aspect.color,
      textColor: "#000000",
      size: "tiny",
    } satisfies Label;
  });
  const result: IndicatorResult = { plots: {}, labels };
  if (b(p, "shade")) {
    const orb = n(p, "orb");
    result.bgColors = bars.time.map((t) => {
      const sep = separation(a, bb, t, frame);
      const hit = ASPECTS.find((x) => keys.includes(x.key) && Math.min(Math.abs(diff(sep, x.angle)), Math.abs(diff(sep, 360 - x.angle))) <= orb);
      return hit ? alpha(hit.color, 0.14) : undefined;
    });
  }
  return result;
}

// ---- Moon Phases ----

export const moonPhases: IndicatorDef = {
  id: "moon-phases",
  name: "Lunar Phases (Astro)",
  short: "Lunar",
  category: "Community",
  overlay: true,
  aliases: ["Lunar", "New Moon", "Full Moon", "Astro"],
  description: "New and full moons (and optionally the quarters) on the chart and ahead of it; studies such as Yuan, Zheng & Zhu (2006) link lunar phases to market returns.",
  inputs: [
    bool("quarters", "Show First / Last Quarters", false),
    bool("shade", "Shade Waxing (new → full) Bars", false),
    int("projectDays", "Project Ahead (days)", 120, 0, 3000),
  ],
  plots: [],
  compute: (bars, p) => moonPhasesCompute(bars, p),
};

export function moonPhasesCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const { span, end, len } = timing(bars, n(p, "projectDays"));
  const days = daysOf(bars, end);
  const { hi, lo } = lastRange(bars);
  const phases = [
    { target: 0, text: "🌑 New", above: false },
    { target: 180, text: "🌕 Full", above: true },
    ...(b(p, "quarters") ? [{ target: 90, text: "🌓 1st Q", above: true }, { target: 270, text: "🌗 Last Q", above: false }] : []),
  ];
  const labels: Label[] = [];
  for (const ph of phases)
    for (const c of zeroCrossings(days, (t) => diff(separation("Moon", "Sun", t), ph.target), 40)) {
      const i = indexAt(bars, span, c.t);
      const future = i >= len;
      labels.push({
        index: i,
        price: ph.above ? (future ? hi : bars.high[i]) : future ? lo : bars.low[i],
        text: future ? `${ph.text} ${date(c.t)}` : ph.text,
        style: ph.above ? "down" : "up",
        bg: ph.above ? "#ECEFF1" : "#37474F",
        textColor: ph.above ? "#000000" : "#FFFFFF",
        size: "tiny",
      });
    }
  const result: IndicatorResult = { plots: {}, labels };
  if (b(p, "shade")) result.bgColors = bars.time.map((t) => (separation("Moon", "Sun", t) < 180 ? "rgba(236,239,241,0.05)" : undefined));
  return result;
}

// ---- Planetary Retrograde ----

const RETRO: Array<Exclude<Body, "Earth" | "Sun" | "Moon">> = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const RETRO_COLOR: Record<string, string> = { Mercury: "#FFB300", Venus: "#F06292", Mars: "#FF5252", Jupiter: "#7C4DFF", Saturn: "#8D6E63", Uranus: "#26C6DA", Neptune: "#448AFF", Pluto: "#9E9E9E" };

export const planetaryRetrograde: IndicatorDef = {
  id: "astro-retrograde",
  name: "Planetary Retrograde",
  short: "Retrograde",
  category: "Community",
  overlay: true,
  aliases: ["Mercury Retrograde", "Rx", "Station", "Astro"],
  description: "Shades the bars while a planet is retrograde (seen from Earth) and marks its stations — retrograde (Rx) and direct (D) — on the chart and ahead of it.",
  inputs: [...RETRO.map((pl) => bool(pl, pl, pl === "Mercury")), int("projectDays", "Project Ahead (days)", 365, 0, 3000)],
  plots: [],
  compute: (bars, p) => retrogradeCompute(bars, p),
};

export function retrogradeCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const { len, span, end } = timing(bars, n(p, "projectDays"));
  const days = daysOf(bars, end);
  const { hi, lo } = lastRange(bars);
  const shown = RETRO.filter((pl) => b(p, pl));
  const labels: Label[] = [];
  const boxes: Box[] = [];
  const bg: Color[] = new Array(len).fill(undefined);
  shown.forEach((pl, k) => {
    const color = RETRO_COLOR[pl];
    const stations = zeroCrossings(days, (t) => dailyMotion(pl, t), 5);
    let rxStart: number | null = dailyMotion(pl, days[0]) < 0 ? 0 : null;
    for (const st of stations) {
      const i = indexAt(bars, span, st.t);
      const goingRx = st.from > 0;
      const future = i >= len;
      labels.push({
        index: i,
        price: (future ? hi : bars.high[i]) * (1 + 0.012 * k),
        text: `${GLYPH[pl]} ${goingRx ? "Rx" : "D"}${future ? ` ${date(st.t)}` : ""}`,
        style: "down",
        bg: color,
        textColor: "#000000",
        size: "tiny",
      });
      if (goingRx) rxStart = i;
      else if (rxStart !== null) {
        if (i >= len) boxes.push({ x1: Math.max(rxStart, len - 1), x2: i, top: hi, bottom: lo, bg: alpha(color, 0.08) });
        for (let j = rxStart; j <= Math.min(i, len - 1); j++) bg[j] ??= alpha(color, 0.12);
        rxStart = null;
      }
    }
    if (rxStart !== null) for (let j = rxStart; j < len; j++) bg[j] ??= alpha(color, 0.12);
  });
  return { plots: {}, labels, boxes, bgColors: bg };
}

// ---- Declination & Out of Bounds ----

const DEC_BODIES: Array<Exclude<Body, "Earth">> = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const DEC_COLOR: Record<string, string> = { Sun: "#FFD600", Moon: "#B0BEC5", Mercury: "#FFB300", Venus: "#F06292", Mars: "#FF5252", Jupiter: "#7C4DFF", Saturn: "#8D6E63" };

export const declinationOob: IndicatorDef = {
  id: "astro-declination",
  name: "Planetary Declination (OOB)",
  short: "Declination",
  category: "Community",
  overlay: false,
  precision: 2,
  aliases: ["Out of Bounds", "OOB", "Declination", "Astro"],
  description: "Geocentric declination of the planets, with the ±23.44° bounds of the Sun's path; a planet beyond them is out of bounds (shaded), often watched before unusual moves.",
  inputs: [...DEC_BODIES.map((pl) => bool(pl, pl, ["Moon", "Mercury", "Venus", "Mars"].includes(pl))), int("projectDays", "Project Ahead (days)", 180, 0, 3000)],
  plots: DEC_BODIES.flatMap((pl) => [
    { key: pl, title: pl, color: DEC_COLOR[pl], width: 1 as const },
    { key: `${pl}p`, title: `${pl} (projection)`, color: DEC_COLOR[pl], width: 1 as const, dashed: true },
  ]),
  compute: (bars, p) => declinationCompute(bars, p),
};

export function declinationCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const { len, span, last, ahead } = timing(bars, n(p, "projectDays"));
  const plots: Record<string, Series> = {};
  const offsets: Record<string, number> = {};
  const at = (j: number) => (j < len ? bars.time[j] : last + (j - (len - 1)) * span);
  const shown = DEC_BODIES.filter((pl) => b(p, pl));
  for (const pl of shown) {
    plots[pl] = bars.time.map((t) => geocentric(pl, t).dec);
    if (ahead > 0) {
      plots[`${pl}p`] = bars.time.map((_, i) => (i + ahead < len - 1 ? NaN : geocentric(pl, at(i + ahead)).dec));
      offsets[`${pl}p`] = ahead;
    }
  }
  const bound = obliquity(last);
  const bgColors = bars.time.map((t) => (shown.some((pl) => Math.abs(geocentric(pl, t).dec) > obliquity(t)) ? "rgba(255,82,82,0.10)" : undefined));
  return {
    plots,
    offsets,
    bgColors,
    hlines: [
      { price: bound, color: "#FF5252", dashed: true },
      { price: 0, color: "#787B86", dashed: true },
      { price: -bound, color: "#FF5252", dashed: true },
    ],
  };
}

// ---- Bradley Siderograph ----

const BRADLEY_PLANETS: Array<Exclude<Body, "Earth" | "Moon">> = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const SLOW = new Set<Body>(["Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);
const MALEFIC = new Set<Body>(["Mars", "Saturn", "Pluto"]);

/**
 * Bradley's daily sidereal potential, S = W(L + D) + M: L sums the aspects among Jupiter … Pluto,
 * M every other pair of the Sun … Pluto, D is half the sum of Venus' and Mars' declinations.
 * Each aspect peaks at ±10 when exact and fades linearly to 0 at the 15° orb — sextiles and trines
 * positive, squares and oppositions negative, conjunctions negative when Mars, Saturn or Pluto is
 * in them and positive otherwise (Bradley's own conjunction table isn't public; this is its rule
 * of thumb).
 */
export function bradleyPotential(t: number, w = 4, orb = 15): number {
  const lon = BRADLEY_PLANETS.map((pl) => geocentric(pl, t).lon);
  let L = 0;
  let M = 0;
  for (let i = 0; i < BRADLEY_PLANETS.length; i++)
    for (let j = i + 1; j < BRADLEY_PLANETS.length; j++) {
      const sep = Math.abs(diff(lon[i], lon[j])); // 0 … 180
      let v = 0;
      for (const [angle, val] of [[0, 0], [60, 10], [90, -10], [120, 10], [180, -10]] as const) {
        const off = Math.abs(sep - angle);
        if (off > orb) continue;
        const valency = angle === 0 ? (MALEFIC.has(BRADLEY_PLANETS[i]) || MALEFIC.has(BRADLEY_PLANETS[j]) ? -10 : 10) : val;
        v += valency * (1 - off / orb);
      }
      if (SLOW.has(BRADLEY_PLANETS[i]) && SLOW.has(BRADLEY_PLANETS[j])) L += v;
      else M += v;
    }
  const D = (geocentric("Venus", t).dec + geocentric("Mars", t).dec) / 2;
  return w * (L + D) + M;
}

export const bradleySiderograph: IndicatorDef = {
  id: "bradley-siderograph",
  name: "Bradley Siderograph",
  short: "Bradley",
  category: "Community",
  overlay: false,
  precision: 0,
  aliases: ["Bradley", "Siderograph", "Astro", "Turning Points"],
  description: "Donald Bradley's 1947 siderograph: the running total of the daily planetary potential S = W(L + D) + M (by default less its 1-year average), projected ahead. Its turns — not its direction — are what it's read for.",
  inputs: [
    float("w", "Long-term Weight W", 4, 0.5, 0),
    float("orb", "Aspect Orb (degrees)", 15, 1, 1),
    // The running total drifts with aspects that last decades (Neptune–Pluto's sextile), which
    // hides its turns; less its own 1-year average the turns stand out.
    select("mode", "Plot", ["Running total − 1y average", "Running total (classic)", "Daily potential"], "Running total − 1y average"),
    int("projectDays", "Project Ahead (days)", 365, 0, 3000),
    bool("markTurns", "Mark Projected Turns", true),
  ],
  plots: [
    { key: "sidero", title: "Siderograph", color: "#29B6F6", width: 2 },
    { key: "siderop", title: "Siderograph (projection)", color: "#29B6F6", width: 2, dashed: true },
  ],
  compute: (bars, p) => bradleyCompute(bars, p),
};

export function bradleyCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const { len, span, last, ahead, end } = timing(bars, n(p, "projectDays"));
  const w = n(p, "w");
  const orb = n(p, "orb");
  // Daily values (noon UTC), running-totalled from the first bar's day.
  const days = daysOf(bars, end);
  const daily = days.map((d) => bradleyPotential(d + DAY / 2, w, orb));
  const mode = s(p, "mode");
  const total = daily.map(((sum) => (v: number) => (sum += v))(0));
  const avg = ta.sma(total, 365);
  const series = mode === "Daily potential" ? daily : mode === "Running total (classic)" ? total : total.map((v, k) => v - avg[k]);
  const valueAt = (t: number) => series[Math.min(series.length - 1, Math.max(0, Math.floor((t - days[0]) / DAY)))];
  const at = (j: number) => (j < len ? bars.time[j] : last + (j - (len - 1)) * span);
  const plots: Record<string, Series> = { sidero: bars.time.map(valueAt) };
  const offsets: Record<string, number> = {};
  if (ahead > 0) {
    plots.siderop = bars.time.map((_, i) => (i + ahead < len - 1 ? NaN : valueAt(at(i + ahead))));
    offsets.siderop = ahead;
  }
  const result: IndicatorResult = { plots, offsets };
  if (b(p, "markTurns") && ahead > 0) {
    // Turns ahead: local extremes of the daily series over a 5-day window either side.
    const labels: Label[] = [];
    const first = days.findIndex((d) => d > last);
    for (let k = Math.max(first, 5); k >= 0 && k < series.length - 5; k++) {
      const win = series.slice(k - 5, k + 6);
      const v = series[k];
      const top = v === Math.max(...win);
      const bottom = v === Math.min(...win);
      if (!top && !bottom) continue;
      labels.push({
        index: indexAt(bars, span, days[k]),
        price: v,
        text: `${top ? "▲" : "▼"} ${date(days[k])}`,
        style: top ? "down" : "up",
        bg: top ? "#1565C0" : "#7B1FA2",
        textColor: "#FFFFFF",
        size: "tiny",
      });
    }
    result.labels = labels;
  }
  return result;
}

// ---- Astro Time Window ----

export const astroTimeWindow: IndicatorDef = {
  id: "astro-time-window",
  name: "Astro Time Window",
  short: "Time Window",
  category: "Community",
  overlay: false,
  precision: 0,
  aliases: ["Astro", "Turning Point", "Time Trading", "Volatility Window"],
  description:
    "A daily count of astro events — exact aspects between the planets, retrograde/direct stations, new and full moons, out-of-bounds ingresses — as a timing (not direction) signal for turns and volatility, projected ahead.",
  inputs: [
    bool("moon", "Count New / Full Moons", true),
    bool("stations", "Count Stations (weight 2)", true),
    bool("oob", "Count Out-of-Bounds Ingresses", true),
    int("spread", "Count Events Within ± Days", 1, 0, 10),
    int("threshold", "Window Threshold (events)", 4, 1, 50),
    int("projectDays", "Project Ahead (days)", 120, 0, 3000),
  ],
  plots: [
    { key: "score", title: "Events", color: "#26A69A", style: "histogram" },
    { key: "scorep", title: "Events (projection)", color: "#80CBC4", style: "histogram" },
  ],
  compute: (bars, p) => timeWindowCompute(bars, p),
};

const ASPECT_ANGLES = [0, 60, 90, 120, 180, 240, 270, 300];
/** Whether an angle passes `target` between two readings a day apart. */
const passes = (a0: number, a1: number, target: number) => {
  const [d0, d1] = [diff(a0, target), diff(a1, target)];
  return d0 !== 0 && Math.sign(d0) !== Math.sign(d1) && Math.abs(d1 - d0) < 30;
};

/** Astro events that become exact on one UTC day. */
export function astroEvents(day: number, p: Params): number {
  const planets = BRADLEY_PLANETS;
  const lon0 = planets.map((pl) => geocentric(pl, day).lon);
  const lon1 = planets.map((pl) => geocentric(pl, day + DAY).lon);
  let count = 0;
  for (let i = 0; i < planets.length; i++)
    for (let j = i + 1; j < planets.length; j++)
      for (const a of ASPECT_ANGLES) if (passes(lon0[i] - lon0[j], lon1[i] - lon1[j], a)) count++;
  if (b(p, "moon")) {
    const [m0, m1] = [separation("Moon", "Sun", day), separation("Moon", "Sun", day + DAY)];
    if (passes(m0, m1, 0) || passes(m0, m1, 180)) count++;
  }
  if (b(p, "stations"))
    for (const pl of RETRO) if (Math.sign(dailyMotion(pl, day)) !== Math.sign(dailyMotion(pl, day + DAY))) count += 2;
  if (b(p, "oob"))
    for (const pl of ["Moon", "Mercury", "Venus", "Mars"] as const) {
      const out = (x: number) => Math.abs(geocentric(pl, x).dec) > obliquity(x);
      if (out(day + DAY) && !out(day)) count++;
    }
  return count;
}

export function timeWindowCompute(bars: Bars, p: Params): IndicatorResult {
  if (!bars.length) return { plots: {} };
  const { len, span, last, ahead } = timing(bars, n(p, "projectDays"));
  const cache = new Map<number, number>();
  const events = (d: number) => {
    if (!cache.has(d)) cache.set(d, astroEvents(d, p));
    return cache.get(d)!;
  };
  const spread = n(p, "spread");
  const score = (t: number) => {
    const d = startOfDay(t);
    let sum = 0;
    for (let k = -spread; k <= spread; k++) sum += events(d + k * DAY);
    return sum;
  };
  const threshold = n(p, "threshold");
  const at = (j: number) => (j < len ? bars.time[j] : last + (j - (len - 1)) * span);
  const plots: Record<string, Series> = { score: bars.time.map(score) };
  const offsets: Record<string, number> = {};
  const colors: Record<string, Color[]> = { score: plots.score.map((v) => (v >= threshold ? "#FF9800" : undefined)) };
  if (ahead > 0) {
    plots.scorep = bars.time.map((_, i) => (i + ahead <= len - 1 ? NaN : score(at(i + ahead))));
    offsets.scorep = ahead;
    colors.scorep = plots.scorep.map((v) => (v >= threshold ? "#FFCC80" : undefined));
  }
  // The next windows ahead, listed.
  const cells: TableCell[] = [{ col: 0, row: 0, colSpan: 2, text: "Next astro time windows", color: "#FF9800", bold: true, size: "small" }];
  // Consecutive days over the threshold are one window, dated at its busiest day.
  let row = 1;
  let peak: { d: number; v: number } | null = null;
  const flush = () => {
    if (!peak || row > 6) return;
    cells.push({ col: 0, row, text: date(peak.d), color: "#FFFFFF", size: "small" }, { col: 1, row, text: `${peak.v} events`, color: "#FFCC80", size: "small", align: "right" });
    row++;
  };
  for (let d = startOfDay(last) + DAY; row <= 6 && d < last + n(p, "projectDays") * DAY; d += DAY) {
    const v = score(d);
    if (v >= threshold) {
      if (!peak || v > peak.v) peak = { d, v };
    } else {
      flush();
      peak = null;
    }
  }
  flush();
  return {
    plots,
    offsets,
    colors,
    hlines: [{ price: threshold, color: "#FF9800", dashed: true }],
    table: tableOf(cells, "top_right"),
  };
}

// ---- Gann Square of 9 ----

export const gannSquare9: IndicatorDef = {
  id: "gann-square-of-9",
  name: "Gann Square of 9",
  short: "Sq9",
  category: "Support & Resistance",
  overlay: true,
  aliases: ["Gann", "Square of Nine", "Sq9", "Time Trading"],
  description: "W. D. Gann's Square of 9: price levels whole turns and fractions of a turn around the square from a pivot — (√price ± degrees/180)², in a price unit that suits the market — drawn from the pivot to the right edge.",
  inputs: [
    select("pivot", "Pivot", ["Lowest Low", "Highest High"], "Lowest Low"),
    int("lookback", "Pivot Lookback (bars)", 365, 5, 5000),
    select("step", "Step", ["45°", "90°", "120°", "180°", "360°"], "90°"),
    int("levels", "Levels Each Side", 6, 1, 24),
    // On a 57,800 bitcoin a 90° step is only ±240; Gann practice scales such prices (578 → 602).
    select("unit", "Price Unit", ["Auto", "0.01", "0.1", "1", "10", "100", "1000", "10000"], "Auto"),
  ],
  plots: [],
  compute: (bars, p) => gannSquare9Compute(bars, p),
};

export function gannSquare9Compute(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  if (!len) return { plots: {} };
  const from = Math.max(0, len - n(p, "lookback"));
  const low = s(p, "pivot") === "Lowest Low";
  let pi = from;
  for (let i = from; i < len; i++) if (low ? bars.low[i] < bars.low[pi] : bars.high[i] > bars.high[pi]) pi = i;
  const pivot = low ? bars.low[pi] : bars.high[pi];
  const deg = Number(s(p, "step").replace("°", ""));
  // Auto: three whole digits (57,800 → 578, 4.25 → 4.25).
  const unit = s(p, "unit") === "Auto" ? (pivot >= 1000 ? 10 ** (Math.floor(Math.log10(pivot)) - 2) : 1) : Number(s(p, "unit"));
  const root = Math.sqrt(pivot / unit);
  const lines: Line[] = [];
  const labels: Label[] = [];
  for (let k = -n(p, "levels"); k <= n(p, "levels"); k++) {
    const r = root + (k * deg) / 180; // a full 360° turn adds 2 to the square root
    if (r <= 0) continue;
    const price = r * r * unit;
    const whole = (k * deg) % 360 === 0;
    const color = k === 0 ? "#FFD600" : whole ? "#E040FB" : "#7E57C2";
    lines.push({ x1: pi, y1: price, x2: len - 1, y2: price, color, width: k === 0 ? 2 : 1, dashed: !whole, extend: "right" });
    labels.push({ index: len - 1, price, text: `${k > 0 ? "+" : ""}${k * deg}°  ${price.toFixed(price < 10 ? 4 : 2)}`, style: "left", valign: "above", textColor: color, size: "tiny" });
  }
  return { plots: {}, lines, labels };
}

// ---- Gann Time Cycles ----

const GANN_DAYS = [30, 45, 60, 90, 120, 144, 180, 225, 270, 315, 360];

export const gannTimeCycles: IndicatorDef = {
  id: "gann-time-cycles",
  name: "Gann Time Cycles",
  short: "Gann Time",
  category: "Support & Resistance",
  overlay: true,
  aliases: ["Gann", "Time Cycles", "Anniversary", "Time Trading"],
  description: "W. D. Gann's time counts from a pivot: 30, 45, 60, 90, 120, 144, 180, 225, 270, 315 and 360 calendar days, and 1 – 5 year anniversaries, as vertical lines into the future.",
  inputs: [
    select("pivot", "Pivot", ["Highest High", "Lowest Low"], "Highest High"),
    int("lookback", "Pivot Lookback (bars)", 365, 5, 5000),
    bool("years", "Add 2 – 5 Year Anniversaries", true),
  ],
  plots: [],
  compute: (bars, p) => gannTimeCompute(bars, p),
};

export function gannTimeCompute(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  if (!len) return { plots: {} };
  const { span } = timing(bars, 0);
  const from = Math.max(0, len - n(p, "lookback"));
  const high = s(p, "pivot") === "Highest High";
  let pi = from;
  for (let i = from; i < len; i++) if (high ? bars.high[i] > bars.high[pi] : bars.low[i] < bars.low[pi]) pi = i;
  const { hi, lo } = lastRange(bars, 120); // the range on screen, so the counts' labels show
  const counts = [...GANN_DAYS, ...(b(p, "years") ? [730, 1095, 1460, 1825] : [])];
  const lines: Line[] = [];
  const labels: Label[] = [];
  for (const d of counts) {
    const t = bars.time[pi] + d * DAY;
    const i = indexAt(bars, span, t);
    if (i > len - 1 + 5000) continue; // years ahead on an intraday chart
    const major = d % 90 === 0;
    const color = major ? "#FF9800" : "#78909C";
    lines.push({ x1: i, y1: lo, x2: i, y2: hi, color, dashed: !major, width: 1 });
    labels.push({ index: i, price: hi, text: `${d >= 730 ? `${d / 365}y` : `${d}d`}${i >= len ? ` ${date(t)}` : ""}`, style: "down", bg: color, textColor: "#000000", size: "tiny" });
  }
  labels.push({ index: pi, price: high ? bars.high[pi] : bars.low[pi], text: "Gann pivot", style: high ? "down" : "up", bg: "#FFD600", textColor: "#000000", size: "tiny" });
  return { plots: {}, lines, labels };
}

// ---- Fourier Cycles (Hurst) ----

export const fourierCycles: IndicatorDef = {
  id: "fourier-cycles",
  name: "Fourier Cycles (Hurst)",
  short: "Fourier",
  category: "Oscillators",
  overlay: false,
  precision: 4,
  aliases: ["Hurst", "FFT", "DFT", "Spectral", "Dominant Cycle", "Time Trading"],
  description:
    "J. M. Hurst's idea that price is overlapping sine cycles: the strongest cycles in the detrended log price of the last N bars, found by a Fourier scan, are summed and projected ahead.",
  inputs: [
    int("lookback", "Lookback (bars)", 512, 64, 5000),
    int("cycles", "Cycles to Combine", 3, 1, 8),
    int("minPeriod", "Shortest Cycle (bars)", 10, 4, 1000),
    int("maxPeriod", "Longest Cycle (bars, 0 = half the lookback)", 0, 0, 5000),
    int("projectBars", "Project Ahead (bars)", 120, 0, 2000),
  ],
  plots: [
    { key: "detrended", title: "Detrended price", color: "#787B86", width: 1 },
    { key: "model", title: "Cycle model", color: "#FF9800", width: 2 },
    { key: "modelp", title: "Cycle model (projection)", color: "#FF9800", width: 2, dashed: true },
  ],
  compute: (bars, p) => fourierCompute(bars, p),
};

export function fourierCompute(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const N = Math.min(n(p, "lookback"), len);
  if (N < 32) return { plots: {} };
  const start = len - N;
  // Detrend the log price with a least-squares line over the window.
  const y = bars.close.slice(start).map((v) => Math.log(v));
  const xm = (N - 1) / 2;
  const ym = y.reduce((a, v) => a + v, 0) / N;
  let sxy = 0;
  let sxx = 0;
  y.forEach((v, k) => ((sxy += (k - xm) * (v - ym)), (sxx += (k - xm) ** 2)));
  const slope = sxy / sxx;
  const r = y.map((v, k) => v - (ym + slope * (k - xm)));
  // Amplitude spectrum over whole-bar periods; the strongest local peaks are the cycles.
  const minP = Math.max(4, n(p, "minPeriod"));
  const maxP = Math.min(Math.floor(N / 2), n(p, "maxPeriod") || Math.floor(N / 2));
  const spectrum: Array<{ period: number; a: number; b: number; amp: number }> = [];
  for (let P = minP; P <= maxP; P++) {
    let a = 0;
    let c = 0;
    for (let k = 0; k < N; k++) {
      const ph = (2 * Math.PI * k) / P;
      a += r[k] * Math.cos(ph);
      c += r[k] * Math.sin(ph);
    }
    spectrum.push({ period: P, a: (2 * a) / N, b: (2 * c) / N, amp: (2 * Math.hypot(a, c)) / N });
  }
  const peaks = spectrum.filter((x, k) => (k === 0 || x.amp >= spectrum[k - 1].amp) && (k === spectrum.length - 1 || x.amp >= spectrum[k + 1].amp));
  const chosen = peaks.sort((u, v) => v.amp - u.amp).slice(0, n(p, "cycles"));
  const model = (k: number) => chosen.reduce((sum, c) => sum + c.a * Math.cos((2 * Math.PI * k) / c.period) + c.b * Math.sin((2 * Math.PI * k) / c.period), 0);

  const ahead = n(p, "projectBars");
  const plots: Record<string, Series> = {
    detrended: bars.close.map((_, i) => (i < start ? NaN : r[i - start])),
    model: bars.close.map((_, i) => (i < start ? NaN : model(i - start))),
  };
  const offsets: Record<string, number> = {};
  if (ahead > 0) {
    plots.modelp = bars.close.map((_, i) => (i + ahead < len - 1 ? NaN : model(i + ahead - start)));
    offsets.modelp = ahead;
  }
  const { span } = timing(bars, 0);
  const cells: TableCell[] = [
    { col: 0, row: 0, text: "Cycle", color: "#FF9800", bold: true, size: "small" },
    { col: 1, row: 0, text: "Bars", color: "#FF9800", bold: true, size: "small", align: "right" },
    { col: 2, row: 0, text: "Days", color: "#FF9800", bold: true, size: "small", align: "right" },
    { col: 3, row: 0, text: "Amp %", color: "#FF9800", bold: true, size: "small", align: "right" },
  ];
  chosen.forEach((c, k) =>
    cells.push(
      { col: 0, row: k + 1, text: `#${k + 1}`, color: "#B2B5BE", size: "small" },
      { col: 1, row: k + 1, text: String(c.period), color: "#FFFFFF", size: "small", align: "right" },
      { col: 2, row: k + 1, text: ((c.period * span) / DAY).toFixed(1), color: "#FFFFFF", size: "small", align: "right" },
      { col: 3, row: k + 1, text: (c.amp * 100).toFixed(1), color: "#FFFFFF", size: "small", align: "right" }
    )
  );
  return { plots, offsets, hlines: [{ price: 0, color: "#787B86", dashed: true }], table: tableOf(cells, "top_right") };
}

export const astroTimeIndicators: IndicatorDef[] = [
  planetaryAspects,
  moonPhases,
  planetaryRetrograde,
  declinationOob,
  bradleySiderograph,
  astroTimeWindow,
  gannSquare9,
  gannTimeCycles,
  fourierCycles,
];
