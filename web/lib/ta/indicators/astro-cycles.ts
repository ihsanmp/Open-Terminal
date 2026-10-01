// "Astro Cycles (BTC)" — planetary cycles drawn as waves over the bitcoin chart and projected
// ahead, in the manner of Astronacci's cycle charts.
//
// Each wave is cos(h × angle between two planets): with harmonic h = 1 it peaks at one alignment
// (conjunction or opposition) and bottoms at the other, once per synodic period; h = 4 adds the
// squares, and so on. Positions come from JPL's planetary elements (see ../astro.ts), so the waves
// are the real sky, not fitted sine curves. The defaults are the three cycles closest to an
// Astronacci BTC chart of 2025 – 2027 (correlation 0.8 – 0.98 with its waves): heliocentric
// Jupiter–Neptune ×4 (~3.2 years), Mars–Uranus (~1.9 years) and Mars–Saturn (~2 years).
//
// Waves span the price range of the last `rangeLen` bars, as the reference chart's span its
// visible range (or, optionally, each bar's trailing range, following price through history). Where the shown cycles bottom or top
// together ahead is marked, and a table lists each cycle's next turns.

import * as ta from "../core";
import { type Bars } from "../core";
import { separation, type Body } from "../astro";
import { b, bool, int, n, s, select, type Box, type ChartContext, type IndicatorDef, type IndicatorResult, type Label, type Params, type PlotDef, type TableCell } from "../types";

const BODIES: Body[] = ["Sun", "Moon", "Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const DAY = 86_400;

type CycleDefault = { a: Body; b: Body; h: number; peak: "Conjunction" | "Opposition"; color: string };
const DEFAULTS: CycleDefault[] = [
  { a: "Jupiter", b: "Neptune", h: 4, peak: "Conjunction", color: "#E040FB" },
  { a: "Mars", b: "Uranus", h: 1, peak: "Opposition", color: "#448AFF" },
  { a: "Mars", b: "Saturn", h: 1, peak: "Opposition", color: "#FF5252" },
];

const cycleInputs = DEFAULTS.flatMap((d, k) => {
  const c = k + 1;
  return [
    bool(`show${c}`, `Cycle ${c}`, true),
    select(`a${c}`, `Cycle ${c}: Planet A`, BODIES, d.a),
    select(`b${c}`, `Cycle ${c}: Planet B`, BODIES, d.b),
    int(`h${c}`, `Cycle ${c}: Harmonic (1 = synodic, 4 = squares)`, d.h, 1, 12),
    select(`peak${c}`, `Cycle ${c}: Wave Peaks At`, ["Conjunction", "Opposition"], d.peak),
  ];
});

const cyclePlots: PlotDef[] = DEFAULTS.flatMap((d, k) => [
  { key: `c${k + 1}`, title: `Cycle ${k + 1}`, color: d.color, width: 2 },
  { key: `c${k + 1}p`, title: `Cycle ${k + 1} (projection)`, color: d.color, width: 2, dashed: true },
]);

export const astroCycles: IndicatorDef = {
  id: "astro-cycles",
  name: "Astro Cycles (BTC)",
  short: "Astro Cycles",
  category: "Community",
  overlay: true,
  aliases: ["Astronacci", "Astrology", "Planetary Cycles", "Synodic", "Jupiter", "Mars", "Saturn", "Uranus", "Neptune"],
  description:
    "Planetary cycles (real positions from JPL's elements) drawn as waves over BTC and projected ahead, like Astronacci's cycle charts. Defaults: Jupiter–Neptune ×4, Mars–Uranus and Mars–Saturn (heliocentric).",
  legendInputs: [],
  inputs: [
    select("frame", "Positions", ["Heliocentric", "Geocentric"], "Heliocentric"),
    int("rangeLen", "Wave Height: Price Range of Last N Bars", 730, 10, 5000),
    // Fixed, as on the reference chart: every wave spans the recent range, so they stay smooth.
    select("heightMode", "Wave Height Follows", ["Fixed (last range)", "Rolling range"], "Fixed (last range)"),
    int("projectDays", "Project Ahead (days)", 540, 0, 3000),
    ...cycleInputs,
    bool("showComposite", "Composite of Shown Cycles", false),
    bool("markTurns", "Mark Projected Cycle Bottoms / Tops", true),
    bool("shadeFuture", "Shade the Projection", true),
    bool("showTable", "Show Next Turns Table", true),
  ],
  plots: [...cyclePlots, { key: "composite", title: "Composite", color: "#FFD600", width: 2 }, { key: "compositep", title: "Composite (projection)", color: "#FFD600", width: 2, dashed: true }],
  compute: (bars, p, ext) => astroCyclesCompute(bars, p, ext?.chart),
};

type Cycle = { k: number; label: string; wave: (t: number) => number };

function cyclesOf(p: Params): Cycle[] {
  const frame = s(p, "frame") === "Geocentric" ? "geocentric" : "heliocentric";
  const out: Cycle[] = [];
  for (let k = 1; k <= DEFAULTS.length; k++) {
    if (!b(p, `show${k}`)) continue;
    const a = s(p, `a${k}`) as Body;
    const bb = s(p, `b${k}`) as Body;
    const h = n(p, `h${k}`);
    const sign = s(p, `peak${k}`) === "Opposition" ? -1 : 1;
    out.push({
      k,
      label: `${a}–${bb}${h > 1 ? ` ×${h}` : ""}`,
      wave: (t) => sign * Math.cos((h * separation(a, bb, t, frame) * Math.PI) / 180),
    });
  }
  return out;
}

const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Local extremes of f, sampled daily over [from, to), beyond ±min. */
function turns(f: (t: number) => number, from: number, to: number, min = 0.6): Array<{ t: number; v: number }> {
  const out: Array<{ t: number; v: number }> = [];
  let [t0, v0, v1] = [from, f(from), f(from + DAY)];
  for (let t = from + 2 * DAY; t < to; t += DAY) {
    const v2 = f(t);
    const t1 = t0 + DAY;
    if ((v1 > v0 && v1 >= v2 && v1 > min) || (v1 < v0 && v1 <= v2 && v1 < -min)) out.push({ t: t1, v: v1 });
    [t0, v0, v1] = [t1, v1, v2];
  }
  return out;
}

const isBtc = (chart: ChartContext | undefined) => !chart || (chart.type === "crypto" && /^BTC/.test(chart.ticker));

export function astroCyclesCompute(bars: Bars, p: Params, chart?: ChartContext): IndicatorResult {
  const len = bars.length;
  if (len === 0) return { plots: {} };
  if (!isBtc(chart)) {
    return {
      plots: {},
      table: { position: "bottom_left", bg: "rgba(0,0,0,0.75)", frame: "#363A45", border: "#363A45", cells: [{ col: 0, row: 0, text: "Astro Cycles: BTC charts only", color: "#B2B5BE", size: "small" }] },
    };
  }
  const cycles = cyclesOf(p);
  const span = len > 1 ? Math.max(60, bars.time[len - 1] - bars.time[len - 2]) : DAY;
  const last = bars.time[len - 1];
  const ahead = Math.min(5000, Math.round((n(p, "projectDays") * DAY) / span));

  // Price range of the trailing rangeLen bars, at each bar and now.
  const rangeLen = n(p, "rangeLen");
  const hi = ta.highest(bars.high, rangeLen).map((v, i) => (Number.isFinite(v) ? v : Math.max(...bars.high.slice(0, i + 1))));
  const lo = ta.lowest(bars.low, rangeLen).map((v, i) => (Number.isFinite(v) ? v : Math.min(...bars.low.slice(0, i + 1))));
  const [hiNow, loNow] = [hi[len - 1], lo[len - 1]];
  const rolling = s(p, "heightMode") === "Rolling range";
  const scale = (w: number, i: number) => (rolling ? (hi[i] + lo[i]) / 2 + ((hi[i] - lo[i]) / 2) * w : scaleNow(w));
  const scaleNow = (w: number) => (hiNow + loNow) / 2 + ((hiNow - loNow) / 2) * w;

  // The projection is a plot shifted `ahead` bars: its value at bar i is the wave at bar i + ahead,
  // starting from the last real bar so it joins the history.
  const futureTime = (j: number) => (j < len ? bars.time[j] : last + (j - (len - 1)) * span);
  const plots: Record<string, number[]> = {};
  const offsets: Record<string, number> = {};
  const draw = (key: string, wave: (t: number) => number) => {
    plots[key] = bars.time.map((t, i) => scale(wave(t), i));
    if (ahead > 0) {
      plots[`${key}p`] = bars.time.map((_, i) => (i + ahead < len - 1 ? NaN : scaleNow(wave(futureTime(i + ahead)))));
      offsets[`${key}p`] = ahead;
    }
  };
  for (const c of cycles) draw(`c${c.k}`, c.wave);
  const composite = (t: number) => cycles.reduce((a, c) => a + c.wave(t), 0) / cycles.length;
  if (b(p, "showComposite") && cycles.length) draw("composite", composite);

  const result: IndicatorResult = { plots, offsets };
  const end = last + ahead * span;

  if (b(p, "shadeFuture") && ahead > 0) {
    const pad = (hiNow - loNow) * 0.08;
    const box: Box = { x1: len - 1, x2: len - 1 + ahead, top: hiNow + pad, bottom: loNow - pad, bg: "rgba(206,147,216,0.12)" };
    result.boxes = [box];
  }

  if (b(p, "markTurns") && cycles.length && ahead > 0) {
    const labels: Label[] = [];
    // The average of waves rarely reaches their extremes: any clear turn of it counts.
    for (const turn of turns(composite, last + DAY, end, 0.2)) {
      const bottom = turn.v < 0;
      labels.push({
        index: len - 1 + Math.round((turn.t - last) / span),
        price: bottom ? loNow : hiNow,
        text: `${bottom ? "CYCLE BOTTOM" : "CYCLE TOP"}\n${date(turn.t)}`,
        style: bottom ? "up" : "down",
        bg: bottom ? "#7B1FA2" : "#1565C0",
        textColor: "#FFFFFF",
        size: "small",
      });
    }
    result.labels = labels;
  }

  if (b(p, "showTable") && cycles.length) {
    const cells: TableCell[] = [
      { col: 0, row: 0, text: "Astro cycle", color: "#FF9800", bold: true, size: "small" },
      { col: 1, row: 0, text: "Next top", color: "#FF9800", bold: true, size: "small" },
      { col: 2, row: 0, text: "Next bottom", color: "#FF9800", bold: true, size: "small" },
    ];
    const now = Date.now() / 1000;
    const from = Math.min(now, last);
    [...cycles.map((c) => ({ label: c.label, wave: c.wave, color: (astroCycles.plots.find((pl) => pl.key === `c${c.k}`) ?? astroCycles.plots[0]).color })), ...(cycles.length > 1 ? [{ label: "Composite", wave: composite, color: "#FFD600" }] : [])].forEach((c, k) => {
      const next = turns(c.wave, from, from + 6 * 365 * DAY, c.label === "Composite" ? 0.2 : 0.6);
      const top = next.find((x) => x.v > 0);
      const bottom = next.find((x) => x.v < 0);
      cells.push(
        { col: 0, row: k + 1, text: c.label, color: c.color, size: "small" },
        { col: 1, row: k + 1, text: top ? date(top.t) : "—", color: "#FFFFFF", size: "small" },
        { col: 2, row: k + 1, text: bottom ? date(bottom.t) : "—", color: "#FFFFFF", size: "small" }
      );
    });
    result.table = { position: "bottom_left", bg: "rgba(0,0,0,0.75)", frame: "#363A45", border: "#363A45", cells };
  }
  return result;
}
