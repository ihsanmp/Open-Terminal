// Pivot High/Low support & resistance levels, written for OpenTerminal (MIT, like the rest of
// the repository). It offers the options of JustUncleL's "Pivot Hilo Support n Resistance
// Levels" TradingView script — pivot dots, S/R level extensions or a fractal chaos channel,
// HH/LH/HL/LL swing labels, ideal pivots, Renko-style pivots, MA filtering and fractal break
// arrows — but is an independent implementation, not a translation of that GPL-3 source.

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { bool, int, n, s, b, select, src, type Color, type IndicatorDef, type IndicatorResult, type Marker, type Params } from "../types";

const MA_TYPES = ["SMA", "EMA", "WMA", "VWMA", "Smooth SMA", "DEMA", "TEMA", "Hull MA", "ZeroLag EMA", "Triangular MA", "SuperSmooth MA"] as const;

const LIME = "#00E676";
const GRAY = "#787B86";
const GREEN = "#4CAF50";
const MAROON = "#880E4F";
const ORANGE = "#FFA500";

/** Ehlers' two-pole super smoother. */
function superSmoother(x: Series, len: number): Series {
  const a = Math.exp((-1.414 * Math.PI) / len);
  const c2 = 2 * a * Math.cos((1.414 * Math.PI) / len);
  const c3 = -a * a;
  const c1 = 1 - c2 - c3;
  const out: number[] = [];
  x.forEach((v, i) => out.push((c1 * (v + ta.nz(x[i - 1]))) / 2 + c2 * ta.nz(out[i - 1]) + c3 * ta.nz(out[i - 2])));
  return out;
}

export function movingAverage(type: string, bars: Bars, x: Series, len: number): Series {
  switch (type) {
    case "EMA":
      return ta.ema(x, len);
    case "WMA":
      return ta.wma(x, len);
    case "VWMA":
      return ta.vwma(x, bars.volume, len);
    case "Smooth SMA":
      return ta.rma(x, len);
    case "DEMA": {
      const e = ta.ema(x, len);
      const ee = ta.ema(e, len);
      return e.map((v, i) => 2 * v - ee[i]);
    }
    case "TEMA": {
      const e = ta.ema(x, len);
      const ee = ta.ema(e, len);
      const eee = ta.ema(ee, len);
      return e.map((v, i) => 3 * (v - ee[i]) + eee[i]);
    }
    case "Hull MA":
      return ta.hma(x, len);
    case "ZeroLag EMA": {
      const lag = Math.floor((len - 1) / 2);
      return ta.ema(x.map((v, i) => 2 * v - (i >= lag ? x[i - lag] : NaN)), len);
    }
    case "Triangular MA":
      return ta.sma(ta.sma(x, len), len);
    case "SuperSmooth MA":
      return superSmoother(x, len);
    default:
      return ta.sma(x, len);
  }
}

export const pivotHilo: IndicatorDef = {
  id: "pivot-hilo-levels",
  name: "Pivot Hilo Support n Resistance Levels",
  short: "PVTLVLS",
  category: "Community",
  overlay: true,
  aliases: ["Pivot Hilo", "PVTLVLS", "Fractal Chaos Channel", "HH LL"],
  legendInputs: ["left", "right"],
  inputs: [
    bool("showPivots", "Show Pivot Points", true),
    bool("autoStrength", "Use Auto Strength Pivots Points", false),
    int("left", "Pivot Length Left Hand Side", 5, 1),
    int("right", "Pivot Length Right Hand Side", 5, 1),
    bool("showLevels", "Show S/R Level Extensions", true),
    bool("channel", "Show Levels as a Fractal Chaos Channel", false),
    int("shunt", "When to start Printing Pivot (0 = no wait, 1 = wait for candle close)", 1, 0, 1),
    int("maxLevelLen", "Maximum S/R Level Extension Length", 0, 0),
    bool("renko", "Use Renko Style Pivots (open/close for high/low)", false),
    bool("ideal", "Show Only Ideal Pivots", false),
    bool("showSwings", "Show HH,LL,LH,HL markers on Pivots Points", false),
    bool("swing3", "Filter HH,LL,LH,HL to Third Level Swings", false),
    bool("colorPivotBar", "Highlight Pivot with Coloured Bar", false),
    bool("showBreaks", "Show Fractal Break Alert Arrows", false),
    bool("filterBreaks", "Apply MA Filter to Fractal Break Alerts", false),
    bool("maFilter", "Use MA Filter on Pivots", false),
    select("fastType", "Fast MA Type", MA_TYPES, "EMA"),
    int("fastLen", "Fast MA - Length", 21, 1),
    src("close", "fastSrc", "Fast MA - Source"),
    select("slowType", "Slow MA Type", MA_TYPES, "EMA"),
    int("slowLen", "Slow MA - Length", 55, 1),
    src("close", "slowSrc", "Slow MA - Source"),
    bool("showMAs", "Show MA Lines", false),
  ],
  plots: [
    { key: "fastMa", title: "Fast MA", color: LIME, style: "circles", width: 2 },
    { key: "slowMa", title: "Slow MA", color: GRAY, style: "circles", width: 2 },
    { key: "hiHalo", title: "High Pivot halo", color: "rgba(255,255,255,0.5)", style: "circles", width: 3 },
    { key: "loHalo", title: "Low Pivot halo", color: "rgba(255,255,255,0.5)", style: "circles", width: 3 },
    { key: "hiDot", title: "High Pivot", color: GREEN, style: "circles", width: 2 },
    { key: "loDot", title: "Low Pivot", color: MAROON, style: "circles", width: 2 },
    { key: "top", title: "Top Levels", color: MAROON },
    { key: "bottom", title: "Bottom Levels", color: GREEN },
    { key: "topChannel", title: "Top Chaos Channel", color: GREEN, style: "step" },
    { key: "bottomChannel", title: "Bottom Chaos Channel", color: MAROON, style: "step" },
  ],
  compute: (bars, p) => computePivotHilo(bars, p),
};

/** Is bar `c` a pivot of `x` with `left` bars before and `right` bars after it? */
function isPivot(x: Series, c: number, left: number, right: number, high: boolean, ideal: boolean): boolean {
  if (c - left < 0 || c + right >= x.length || Number.isNaN(x[c])) return false;
  const beats = (a: number, other: number) => (high ? a > other : a < other);
  if (ideal) {
    // Strictly climbing into the pivot and strictly falling away from it (or the mirror image).
    for (let k = c - left; k < c; k++) if (!beats(x[k + 1], x[k])) return false;
    for (let k = c; k < c + right; k++) if (!beats(x[k], x[k + 1])) return false;
    return true;
  }
  // TradingView's pivot rule: at least equal to the left side, strictly beyond the right side.
  for (let k = c - left; k < c; k++) if (beats(x[k], x[c])) return false;
  for (let k = c + 1; k <= c + right; k++) if (!beats(x[c], x[k])) return false;
  return true;
}

export function computePivotHilo(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { open, close } = bars;
  const renko = b(p, "renko");
  const hi = renko ? close.map((c, i) => Math.max(c, open[i])) : bars.high;
  const lo = renko ? close.map((c, i) => Math.min(c, open[i])) : bars.low;
  const shunt = n(p, "shunt");
  const fast = movingAverage(s(p, "fastType"), bars, ta.source(bars, s(p, "fastSrc")), n(p, "fastLen"));
  const slow = movingAverage(s(p, "slowType"), bars, ta.source(bars, s(p, "slowSrc")), n(p, "slowLen"));
  const fastFirst = n(p, "fastLen") > n(p, "slowLen");
  const trendEma = ta.ema(close, 21);
  const auto = b(p, "autoStrength");

  const empty = () => ta.fill(len);
  const out = {
    fastMa: b(p, "showMAs") ? fast : empty(),
    slowMa: b(p, "showMAs") && !fastFirst ? slow : empty(),
    hiHalo: empty(),
    loHalo: empty(),
    hiDot: empty(),
    loDot: empty(),
    top: empty(),
    bottom: empty(),
    topChannel: empty(),
    bottomChannel: empty(),
  };
  const markers: Marker[] = [];
  const barColors: Color[] = new Array(len).fill(undefined);

  // Latest confirmed levels, pivot bars (for the level extensions) and pivot prices (for swings).
  let top = NaN, bottom = NaN;
  const hiBars: boolean[] = new Array(len).fill(false);
  const loBars: boolean[] = new Array(len).fill(false);
  const highs: number[] = [];
  const lows: number[] = [];
  const dots = b(p, "showPivots") && !b(p, "showSwings");
  const swingKind = (list: number[], v: number) => {
    list.unshift(v);
    if (list.length < 2) return 0;
    const prior = b(p, "swing3") ? list.slice(1, 4) : list.slice(1, 2);
    if (prior.length < (b(p, "swing3") ? 3 : 1)) return 0;
    if (prior.every((x) => x < v)) return 1;
    if (prior.every((x) => x > v)) return -1;
    return 0;
  };

  for (let i = 0; i < len; i++) {
    // A pivot is reported `shunt` bars after the bar that completes it.
    const confirm = i - shunt;
    const left = auto ? (close[confirm] > trendEma[confirm] ? n(p, "left") : n(p, "left") + 1) : n(p, "left");
    const right = auto ? (close[confirm] < trendEma[confirm] ? n(p, "right") : n(p, "right") + 1) : n(p, "right");
    const c = confirm - right;
    const allowHigh = !b(p, "maFilter") || !(fastFirst || fast[confirm] < slow[confirm]);
    const allowLow = !b(p, "maFilter") || !(fastFirst || fast[confirm] > slow[confirm]);
    const newHigh = confirm >= 0 && allowHigh && isPivot(hi, c, left, right, true, b(p, "ideal"));
    const newLow = confirm >= 0 && allowLow && isPivot(lo, c, left, right, false, b(p, "ideal"));

    if (newHigh) {
      top = bars.high[c];
      hiBars[c] = true;
      if (dots) (out.hiHalo[c] = hi[c]), (out.hiDot[c] = hi[c]);
      const kind = swingKind(highs, hi[c]);
      if (b(p, "showSwings") && kind === 1) markers.push({ index: c, position: "aboveBar", shape: "arrowUp", color: GREEN, text: "HH" });
      if (b(p, "showSwings") && kind === -1) markers.push({ index: c, position: "aboveBar", shape: "arrowDown", color: MAROON, text: "LH" });
    }
    if (newLow) {
      bottom = bars.low[c];
      loBars[c] = true;
      if (dots) (out.loHalo[c] = lo[c]), (out.loDot[c] = lo[c]);
      const kind = swingKind(lows, lo[c]);
      if (b(p, "showSwings") && kind === 1) markers.push({ index: c, position: "belowBar", shape: "arrowUp", color: GREEN, text: "HL" });
      if (b(p, "showSwings") && kind === -1) markers.push({ index: c, position: "belowBar", shape: "arrowDown", color: MAROON, text: "LL" });
    }
    if ((newHigh || newLow) && b(p, "colorPivotBar")) barColors[c] = ORANGE;

    if (b(p, "showLevels") && b(p, "channel")) {
      out.topChannel[i] = top;
      out.bottomChannel[i] = bottom;
    }

    const breakUp = close[i] > top && open[i] <= top && (!b(p, "filterBreaks") || ((fastFirst || fast[i] > slow[i]) && close[i] > fast[i]));
    const breakDown = close[i] < bottom && open[i] >= bottom && (!b(p, "filterBreaks") || ((fastFirst || fast[i] < slow[i]) && close[i] < fast[i]));
    if (b(p, "showBreaks") && breakUp) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: LIME });
    if (b(p, "showBreaks") && breakDown) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: "#FF5252" });
  }

  // S/R level extensions: each level runs from its pivot bar until the next pivot of its side
  // (the last one to the latest bar), optionally capped at a maximum length.
  if (b(p, "showLevels") && !b(p, "channel")) {
    extendLevels(out.top, hiBars, bars.high, n(p, "maxLevelLen"));
    extendLevels(out.bottom, loBars, bars.low, n(p, "maxLevelLen"));
  }

  // Leave out the plots the settings turn off.
  const plots = Object.fromEntries(Object.entries(out).filter(([, v]) => v.some(Number.isFinite)));
  return { plots, markers, barColors };
}

function extendLevels(series: Series, pivotBars: boolean[], price: Series, maxLen: number) {
  const starts: number[] = [];
  pivotBars.forEach((v, k) => v && starts.push(k));
  starts.forEach((st, k) => {
    // Stop a bar short of the next level so the chart doesn't join the two with a vertical line.
    const end = k + 1 < starts.length ? starts[k + 1] - 2 : series.length - 1;
    for (let j = st; j <= end && (maxLen === 0 || j - st < maxLen); j++) series[j] = price[st];
  });
}
