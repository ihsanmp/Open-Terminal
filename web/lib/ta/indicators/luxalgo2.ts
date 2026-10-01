// More ports of LuxAlgo scripts published on TradingView.
//
// This file is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0
// (CC BY-NC-SA 4.0, https://creativecommons.org/licenses/by-nc-sa/4.0/), as the scripts it
// is derived from are — © LuxAlgo. It is NOT covered by the repository's MIT license:
// non-commercial use only, and adaptations must keep this license and attribution.
//
// - Buyside & Sellside Liquidity [LuxAlgo]            - Market Structure (Breakers) [LuxAlgo]
// - Chaos Weighted RSI [LuxAlgo]                      - Market Structure Break & OB Probability Toolkit [LuxAlgo]
// - Clusters Volume Profile [LuxAlgo]                 - Order Block Detector [LuxAlgo]
// - Fair Value Gap [LuxAlgo]                          - Pivot Points High Low & Missed Reversal Levels [LuxAlgo]
// - Harmonic Resonance Oscillator [LuxAlgo]           - SMT Divergences [LuxAlgo]
// - Supply and Demand Daily [LuxAlgo]

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { colorNew, formatPattern, formatVolume, inferMintick, timeParts } from "../pine";
import { toHex, withOpacity } from "../../color";
import {
  b,
  bool,
  colorInput,
  float,
  int,
  n,
  s,
  select,
  text,
  type Box,
  type ChartContext,
  type DrawSize,
  type IndicatorDef,
  type IndicatorResult,
  type IndicatorTable,
  type Label,
  type Line,
  type Marker,
  type Params,
  type TableCell,
} from "../types";

export const luxalgo2: IndicatorDef[] = [];

const GREEN = "#089981";
const RED = "#f23645";

/** ta.pivothigh(src, left, right): the pivot's value on the bar that confirms it, else na. */
export function pivotHigh(x: Series, left: number, right: number): Series {
  const p = ta.pivotHighs(x, left, right);
  return x.map((_, i) => (i - right >= 0 && p[i - right] ? x[i - right] : NaN));
}
export function pivotLow(x: Series, left: number, right: number): Series {
  const p = ta.pivotLows(x, left, right);
  return x.map((_, i) => (i - right >= 0 && p[i - right] ? x[i - right] : NaN));
}

/** Pine's `if x` on a float: false for na and for 0. */
const truthy = (v: number) => Number.isFinite(v) && v !== 0;

/** Pine's `a != b` on floats: false when either side is na. */
const changed = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && a !== b;

const TABLE_POSITION = { "Top Right": "top_right", "Bottom Right": "bottom_right", "Bottom Left": "bottom_left" } as const;
const TABLE_SIZE: Record<string, DrawSize> = { Tiny: "tiny", Small: "small", Normal: "normal", Large: "large", Huge: "huge" };
const position = (v: string) => TABLE_POSITION[v as keyof typeof TABLE_POSITION] ?? "top_right";

// =====================================================================================
// Buyside & Sellside Liquidity [LuxAlgo]
// =====================================================================================

type Liq = {
  /** The (invisible) margin box around the level; only its coordinates matter. */
  zone: { left: number; top: number; right: number; bottom: number };
  /** The breach zone box, shown once price runs through the level. */
  breach: Box | null;
  label: Label | null;
  brZ: boolean;
  brL: boolean;
  ln: Line | null;
  lne: Line | null;
};

const emptyLiq = (): Liq => ({ zone: { left: NaN, top: NaN, right: NaN, bottom: NaN }, breach: null, label: null, brZ: false, brL: false, ln: null, lne: null });

luxalgo2.push({
  id: "luxalgo-bsl",
  name: "Buyside & Sellside Liquidity [LuxAlgo]",
  short: "LuxAlgo - Buyside & Sellside Liquidity",
  category: "Community",
  overlay: true,
  autoscale: false,
  legendInputs: [],
  inputs: [
    int("liqLen", "Detection Length", 7, 3, 13),
    float("margin", "Margin", 6.9, 0.1, 4),
    bool("liqBuy", "Buyside Liquidity Zones", true),
    float("marBuy", "Buyside Margin", 2.3, 0.1, 1.5),
    colorInput("cBuy", "Buyside Color", "#4caf50"),
    bool("liqSel", "Sellside Liquidity Zones", true),
    float("marSel", "Sellside Margin", 2.3, 0.1, 1.5),
    colorInput("cSel", "Sellside Color", "#f23645"),
    bool("lqVoid", "Liquidity Voids", false),
    colorInput("cVoidBull", "Void Bullish", "#4caf50"),
    colorInput("cVoidBear", "Void Bearish", "#f23645"),
    select("mode", "Mode", ["Present", "Historical"], "Present"),
    int("visLiq", "# Visible Levels", 3, 1, 50),
  ],
  plots: [],
  compute: (bars, p) => buysideSellside(bars, p),
});

function buysideSellside(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { high, low, close } = bars;
  const liqLen = n(p, "liqLen");
  const liqMar = 10 / n(p, "margin");
  const [liqBuy, liqSel] = [b(p, "liqBuy"), b(p, "liqSel")];
  const [marBuy, marSel] = [n(p, "marBuy"), n(p, "marSel")];
  const [cBuy, cSel] = [s(p, "cBuy"), s(p, "cSel")];
  const visLiq = n(p, "visLiq");
  const atr = ta.atr(bars, 10);
  const atr200 = ta.atr(bars, 200);
  const present = s(p, "mode") === "Present";
  const per = (i: number) => !present || len - 1 - i <= 500;

  const ph = pivotHigh(high, liqLen, 1);
  const pl = pivotLow(low, liqLen, 1);
  const maxSize = 50;
  const zd = new Array<number>(maxSize).fill(0);
  const zx = new Array<number>(maxSize).fill(0);
  const zy = new Array<number>(maxSize).fill(NaN);
  const inOut = (d: number, x: number, y: number) => {
    zd.unshift(d), zx.unshift(x), zy.unshift(y), zd.pop(), zx.pop(), zy.pop();
  };

  const buys: Liq[] = [emptyLiq()];
  const sells: Liq[] = [emptyLiq()];
  const voids: Box[] = [];

  const cluster = (i: number, pivot: number, dirWanted: 1 | -1) => {
    const a = atr[i] / liqMar;
    let count = 0, stP = 0, stB = 0, minP = 0, maxP = 10e6;
    for (let k = 0; k < maxSize; k++) {
      if (zd[k] !== dirWanted) continue;
      if (dirWanted === 1 ? zy[k] > pivot + a : zy[k] < pivot - a) break;
      if (zy[k] > pivot - a && zy[k] < pivot + a) {
        count += 1;
        stB = zx[k];
        stP = zy[k];
        if (zy[k] > minP) minP = zy[k];
        if (zy[k] < maxP) maxP = zy[k];
      }
    }
    return { count, stP, stB, mid: (minP + maxP) / 2, a };
  };

  const addLevel = (list: Liq[], i: number, c: ReturnType<typeof cluster>, buy: boolean) => {
    const head = list[0];
    if (c.stB === head.zone.left) {
      head.zone.top = c.mid + c.a;
      head.zone.right = i + 10;
      head.zone.bottom = c.mid - c.a;
    } else {
      const css = buy ? cBuy : cSel;
      list.unshift({
        zone: { left: c.stB, top: c.mid + c.a, right: i + 10, bottom: c.mid - c.a },
        breach: null,
        label: { index: c.stB, price: c.stP, text: buy ? "Buyside liquidity" : "Sellside liquidity", style: "left", valign: buy ? "above" : "below", textColor: colorNew(css, 25), size: "tiny" },
        brZ: false,
        brL: false,
        ln: { x1: c.stB, y1: c.stP, x2: i - 1, y2: c.stP, color: css },
        lne: { x1: i - 1, y1: c.stP, x2: NaN, y2: c.stP, color: css, style: "dotted" },
      });
    }
    if (list.length > visLiq) list.pop();
  };

  for (let i = 0; i < len; i++) {
    const x2 = i - 1;
    if (truthy(ph[i])) {
      const dir = zd[0];
      const y1 = zy[0];
      const y2 = ta.nz(high[i - 1]);
      if (dir < 1) inOut(1, x2, y2);
      else if (dir === 1 && ph[i] > y1) (zx[0] = x2), (zy[0] = y2);
      if (per(i)) {
        const c = cluster(i, ph[i], 1);
        if (c.count > 2) addLevel(buys, i, c, true);
      }
    }
    if (truthy(pl[i])) {
      const dir = zd[0];
      const y1 = zy[0];
      const y2 = ta.nz(low[i - 1]);
      if (dir > -1) inOut(-1, x2, y2);
      else if (dir === -1 && pl[i] < y1) (zx[0] = x2), (zy[0] = y2);
      if (per(i)) {
        const c = cluster(i, pl[i], -1);
        if (c.count > 2) addLevel(sells, i, c, false);
      }
    }

    for (const x of buys) {
      if (!x.ln) continue;
      const lvl = x.ln.y1;
      if (!x.brL) {
        if (x.lne) x.lne.x2 = i;
        if (high[i] > x.zone.top) {
          x.brL = x.brZ = true;
          x.breach = { x1: i - 1, top: Math.min(lvl + marBuy * atr[i], high[i]), x2: i + 1, bottom: lvl, bg: colorNew(cBuy, liqBuy ? 73 : 100) };
        }
      } else if (x.brZ) {
        if (low[i] > lvl - marBuy * atr[i] && high[i] < lvl + marBuy * atr[i]) {
          x.breach!.x2 = i + 1;
          x.breach!.top = Math.max(high[i], x.breach!.top);
          if (liqBuy && x.lne) x.lne.x2 = i + 1;
        } else x.brZ = false;
      }
    }
    for (const x of sells) {
      if (!x.ln) continue;
      const lvl = x.ln.y1;
      if (!x.brL) {
        if (x.lne) x.lne.x2 = i;
        if (low[i] < x.zone.bottom) {
          x.brL = x.brZ = true;
          x.breach = { x1: i - 1, top: lvl, x2: i + 1, bottom: Math.max(lvl - marSel * atr[i], low[i]), bg: colorNew(cSel, liqSel ? 73 : 100) };
        }
      } else if (x.brZ) {
        if (low[i] > lvl - marSel * atr[i] && high[i] < lvl + marSel * atr[i]) {
          x.breach!.x2 = i + 1;
          x.breach!.bottom = Math.min(low[i], x.breach!.bottom);
          if (liqSel && x.lne) x.lne.x2 = i + 1;
        } else x.brZ = false;
      }
    }

    // Liquidity voids: gaps wider than ATR(200), drawn as 13 thin slices until price trades back.
    if (b(p, "lqVoid") && per(i) && i >= 2) {
      const isBull = (k: number) => k >= 2 && low[k] - high[k - 2] > atr200[k] && low[k] > high[k - 2] && close[k - 1] > high[k - 2];
      const isBear = (k: number) => k >= 2 && low[k - 2] - high[k] > atr200[k] && high[k] < low[k - 2] && close[k - 1] < low[k - 2];
      const slices = (from: number, to: number, css: string) => {
        const st = Math.abs(to - from) / 13;
        for (let k = 0; k < 13; k++) voids.push({ x1: i - 2, x2: i, top: from + k * st, bottom: from + (k + 1) * st, bg: colorNew(css, 90) });
      };
      if (isBull(i)) {
        if (isBull(i - 1)) slices(low[i - 1], low[i], s(p, "cVoidBull"));
        else slices(high[i - 2], low[i], s(p, "cVoidBull"));
      }
      if (isBear(i)) {
        if (isBear(i - 1)) slices(high[i], high[i - 1], s(p, "cVoidBear"));
        else slices(high[i], low[i - 2], s(p, "cVoidBear"));
      }
    }
    for (let k = voids.length - 1; k >= 0; k--) {
      const cb = voids[k];
      const ba = (cb.top + cb.bottom) / 2;
      const side = Math.sign(close[i - 1] - ba);
      if (side !== Math.sign(close[i] - ba) || side !== Math.sign(low[i] - ba) || side !== Math.sign(high[i] - ba)) voids.splice(k, 1);
      else cb.x2 = i + 1;
    }
  }

  const lines: Line[] = [];
  const labels: Label[] = [];
  const boxes: Box[] = [...voids];
  for (const x of [...buys, ...sells]) {
    if (x.ln) lines.push(x.ln);
    if (x.lne && Number.isFinite(x.lne.x2)) lines.push(x.lne);
    if (x.label) labels.push(x.label);
    if (x.breach) boxes.push(x.breach);
  }
  return { plots: {}, lines, labels, boxes: boxes.slice(-500) };
}

// =====================================================================================
// Chaos Weighted RSI [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-chaos-rsi",
  name: "Chaos Weighted RSI [LuxAlgo]",
  short: "LuxAlgo - Chaos Weighted RSI",
  category: "Community",
  overlay: false,
  precision: 2,
  legendInputs: ["rsiLength", "disorder", "sensitivity"],
  inputs: [
    int("rsiLength", "RSI Length", 14),
    int("disorder", "Disorder Lookback", 20, 2),
    float("sensitivity", "Weight Sensitivity", 1, 0.1, 0.1),
    colorInput("bull", "Bullish Color", GREEN),
    colorInput("bear", "Bearish Color", RED),
    colorInput("neutral", "Neutral Color", "#787b86"),
    int("transparency", "Background Transparency", 90, 0, 100),
    int("divStrength", "Divergence Strength", 20, 1),
    bool("showBullDiv", "Show Bullish Divergence", true),
    bool("showBearDiv", "Show Bearish Divergence", true),
    bool("showDivLines", "Show Divergence Lines", true),
    colorInput("bullDiv", "Bullish Divergence Color", GREEN),
    colorInput("bearDiv", "Bearish Divergence Color", RED),
  ],
  plots: [{ key: "wrsi", title: "Chaos Weighted RSI", color: GREEN }],
  compute: (bars, p) => chaosRsi(bars, p),
});

/** Sevcik fractal dimension of the last `length` values, mapped to 0 (orderly) … 1 (chaotic). */
export function chaosSeries(src: Series, length: number): Series {
  const hh = ta.highest(src, length);
  const ll = ta.lowest(src, length);
  return src.map((_, i) => {
    if (i - length + 1 < 0 || Number.isNaN(hh[i])) return NaN;
    const range = hh[i] - ll[i];
    let L = 0;
    for (let k = 0; k <= length - 2; k++) {
      const a = src[i - k - 1];
      const c = src[i - k];
      if (Number.isNaN(a) || Number.isNaN(c)) return NaN;
      const y1 = range > 0 ? (a - ll[i]) / range : 0.5;
      const y2 = range > 0 ? (c - ll[i]) / range : 0.5;
      L += Math.sqrt((y1 - y2) ** 2 + (1 / (length - 1)) ** 2);
    }
    const fdi = 1 + Math.log(L) / Math.log(2 * (length - 1));
    return Math.max(0, Math.min(1, (fdi - 1) / 0.5));
  });
}

/** The script's adaptive EMA: na input or alpha resets it to the next value, as Pine does. */
function adaptiveEma(src: Series, alpha: Series): Series {
  let val = NaN;
  return src.map((x, i) => (val = Number.isNaN(val) ? x : val + alpha[i] * (x - val)));
}

function chaosRsi(bars: Bars, p: Params): IndicatorResult {
  const close = bars.close;
  const chaos = chaosSeries(close, n(p, "disorder"));
  const base = 1 / n(p, "rsiLength");
  const alpha = chaos.map((c) => (Number.isNaN(c) ? NaN : Math.max(0.001, Math.min(1, base * Math.pow(1 - c, n(p, "sensitivity"))))));
  const change = ta.change(close);
  const gain = change.map((v) => (Number.isNaN(v) ? NaN : Math.max(v, 0)));
  const loss = change.map((v) => (Number.isNaN(v) ? NaN : Math.max(-v, 0)));
  const avgGain = adaptiveEma(gain, alpha);
  const avgLoss = adaptiveEma(loss, alpha);
  const wrsi = avgGain.map((g, i) => (avgLoss[i] === 0 ? 100 : 100 - 100 / (1 + g / avgLoss[i])));

  const [bull, bear, neutral] = [s(p, "bull"), s(p, "bear"), s(p, "neutral")];
  const str = n(p, "divStrength");
  const pHi = pivotHigh(wrsi, str, str);
  const pLo = pivotLow(wrsi, str, str);
  const lines: Line[] = [];
  const labels: Label[] = [];
  let lastLoW = NaN, lastLoBar = NaN, lastLoPrice = NaN;
  let lastHiW = NaN, lastHiBar = NaN, lastHiPrice = NaN;
  for (let i = 0; i < wrsi.length; i++) {
    const j = i - str;
    if (Number.isFinite(pLo[i])) {
      if (Number.isFinite(lastLoW) && wrsi[j] > lastLoW && bars.low[j] < lastLoPrice) {
        if (b(p, "showDivLines")) lines.push({ x1: lastLoBar, y1: lastLoW, x2: j, y2: wrsi[j], color: s(p, "bullDiv"), style: "dotted" });
        if (b(p, "showBullDiv")) labels.push({ index: j, price: wrsi[j], text: "•", style: "none", textColor: s(p, "bullDiv"), size: "normal" });
      }
      lastLoW = wrsi[j], lastLoPrice = bars.low[j], lastLoBar = j;
    }
    if (Number.isFinite(pHi[i])) {
      if (Number.isFinite(lastHiW) && wrsi[j] < lastHiW && bars.high[j] > lastHiPrice) {
        if (b(p, "showDivLines")) lines.push({ x1: lastHiBar, y1: lastHiW, x2: j, y2: wrsi[j], color: s(p, "bearDiv"), style: "dotted" });
        if (b(p, "showBearDiv")) labels.push({ index: j, price: wrsi[j], text: "•", style: "none", textColor: s(p, "bearDiv"), size: "normal" });
      }
      lastHiW = wrsi[j], lastHiPrice = bars.high[j], lastHiBar = j;
    }
  }

  // Pine fills these with vertical gradients; per bar they're drawn at the gradient's average.
  const ob = wrsi.map((v) => (v > 70 ? colorNew(bear, 100 - 25 * Math.min(1, (v - 70) / 30)) : undefined));
  const os = wrsi.map((v) => (v < 30 ? colorNew(bull, 100 - 25 * Math.min(1, (30 - v) / 30)) : undefined));
  const center = wrsi.map((v) => (Number.isFinite(v) ? colorNew(v > 50 ? bull : bear, 75) : undefined));
  return {
    plots: { wrsi },
    colors: { wrsi: wrsi.map((v) => (v > 50 ? bull : bear)) },
    hlines: [
      { price: 70, color: neutral, dashed: true },
      { price: 30, color: neutral, dashed: true },
      { price: 50, color: neutral, dashed: true },
    ],
    fills: [
      { a: 70, b: 30, color: colorNew(neutral, n(p, "transparency")) },
      { a: "wrsi", b: 70, color: ob },
      { a: "wrsi", b: 30, color: os },
      { a: "wrsi", b: 50, color: center },
    ],
    lines: lines.slice(-500),
    labels: labels.slice(-500),
  };
}

// =====================================================================================
// Clusters Volume Profile [LuxAlgo]
// =====================================================================================

const CLUSTER_PALETTE = ["#2196f3", "#f44336", "#4caf50", "#ff9800", "#9c27b0", "#00bcd4", "#ffeb3b", "#e91e63", "#795548", "#607d8b"];

luxalgo2.push({
  id: "luxalgo-clusters-vp",
  name: "Clusters Volume Profile [LuxAlgo]",
  short: "LuxAlgo - Clusters Volume Profile",
  category: "Community",
  overlay: true,
  autoscale: false,
  legendInputs: ["lookback", "k"],
  inputs: [
    int("lookback", "Lookback Period", 200, 10),
    int("k", "Number of Clusters", 5, 2, 10),
    int("iters", "K-Means Iterations", 50, 5, 50),
    int("rows", "Rows per Cluster VP", 20, 2),
    int("vpWidth", "Max VP Width (Bars)", 40, 5),
    int("vpOffset", "VP Offset", 10, -500, 500),
    bool("showDots", "Highlight Price Dots", true),
    select("dotSize", "Dot Size", ["tiny", "small", "normal", "large", "huge"], "small"),
  ],
  plots: [],
  compute: (bars, p) => clustersVolumeProfile(bars, p),
});

/** 1-D k-means on price, centroids moved to each cluster's volume-weighted price. */
export function kmeans(prices: number[], volumes: number[], k: number, iterations: number) {
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const step = (maxP - minP) / (k + 1);
  const centroids = Array.from({ length: k }, (_, i) => minP + (i + 1) * step);
  const assignments = new Array<number>(prices.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    prices.forEach((p, i) => {
      let best = 0;
      let bestD = 1e10;
      centroids.forEach((c, j) => {
        const d = Math.abs(p - c);
        if (d < bestD) (bestD = d), (best = j);
      });
      assignments[i] = best;
    });
    const pv = new Array<number>(k).fill(0);
    const v = new Array<number>(k).fill(0);
    prices.forEach((p, i) => {
      pv[assignments[i]] += p * volumes[i];
      v[assignments[i]] += volumes[i];
    });
    for (let j = 0; j < k; j++) if (v[j] > 0) centroids[j] = pv[j] / v[j];
  }
  return { assignments, centroids };
}

function clustersVolumeProfile(bars: Bars, p: Params): IndicatorResult {
  const last = bars.length - 1;
  const lookback = Math.min(n(p, "lookback"), bars.length);
  if (lookback < 2) return { plots: {} };
  const k = n(p, "k");
  const rows = n(p, "rows");
  const hl2 = ta.source(bars, "hl2");
  const back = (i: number) => last - i; // Pine's [i]
  const prices = Array.from({ length: lookback }, (_, i) => hl2[back(i)]);
  const vols = Array.from({ length: lookback }, (_, i) => bars.volume[back(i)]);
  const { assignments } = kmeans(prices, vols, k, n(p, "iters"));
  const mintick = inferMintick(bars);
  const calcStart = last - lookback + 1;
  const vpStartX = last + n(p, "vpOffset");
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const labels: Label[] = [];
  const dots: Label[] = [];
  const reserved = k * 2;

  for (let c = 0; c < k; c++) {
    const color = CLUSTER_PALETTE[c % CLUSTER_PALETTE.length];
    const members: number[] = [];
    for (let i = 0; i < lookback; i++) {
      if (assignments[i] !== c) continue;
      members.push(i);
      if (b(p, "showDots") && dots.length < 500 - reserved) {
        dots.push({ index: back(i), price: hl2[back(i)], text: "•", style: "none", textColor: color, size: s(p, "dotSize") as DrawSize });
      }
    }
    if (members.length === 0) continue;
    const cMin = Math.min(...members.map((i) => bars.low[back(i)]));
    const cMax = Math.max(...members.map((i) => bars.high[back(i)]));
    const total = members.reduce((a, i) => a + bars.volume[back(i)], 0);
    const bins = new Array<number>(rows).fill(0);
    let binSize = (cMax - cMin) / rows;
    if (binSize === 0) binSize = mintick;
    for (const i of members) {
      const h = bars.high[back(i)], l = bars.low[back(i)], v = bars.volume[back(i)];
      const wick = Math.max(h - l, mintick);
      for (let r = 0; r < rows; r++) {
        const lo = Math.max(l, cMin + r * binSize);
        const hi = Math.min(h, cMin + (r + 1) * binSize);
        if (hi > lo) bins[r] += (v * (hi - lo)) / wick;
      }
    }
    const maxBin = Math.max(...bins);
    const poc = bins.indexOf(maxBin);
    for (let r = 0; r < rows; r++) {
      if (boxes.length >= 500) break;
      if (bins[r] === 0) continue;
      const bottom = cMin + r * binSize;
      const top = bottom + binSize;
      const endX = vpStartX + Math.trunc((bins[r] / maxBin) * n(p, "vpWidth"));
      const isPoc = r === poc;
      boxes.push({ x1: vpStartX, x2: endX, top, bottom, bg: isPoc ? color : colorNew(color, 75), border: isPoc ? color : undefined });
      if (isPoc) {
        const y = (top + bottom) / 2;
        lines.push({ x1: calcStart, y1: y, x2: vpStartX, y2: y, color, style: "dashed" });
        labels.push({ index: calcStart, price: y, text: formatVolume(bins[r]), style: "right", textColor: color, size: "small" });
        labels.push({ index: endX, price: y, text: `Total: ${formatVolume(total)}`, style: "left", textColor: color, size: "small" });
      }
    }
  }
  return { plots: {}, boxes, lines, labels: [...dots, ...labels] };
}

// =====================================================================================
// Fair Value Gap [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-fvg",
  name: "Fair Value Gap [LuxAlgo]",
  short: "LuxAlgo - Fair Value Gap",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["FVG", "Far Value Gap"],
  legendInputs: [],
  inputs: [
    float("threshold", "Threshold %", 0, 0.1, 0),
    bool("auto", "Auto Threshold", false),
    int("showLast", "Unmitigated Levels", 0, 0, 500),
    bool("mitigationLevels", "Mitigation Levels", false),
    int("extend", "Extend", 20, 0, 500),
    bool("dynamic", "Dynamic", false),
    colorInput("bullCss", "Bullish FVG", withOpacity(GREEN, 30)),
    colorInput("bearCss", "Bearish FVG", withOpacity(RED, 30)),
    bool("showDash", "Show Dashboard", false),
    select("dashLoc", "Location", ["Top Right", "Bottom Right", "Bottom Left"], "Top Right"),
    select("textSize", "Size", ["Tiny", "Small", "Normal"], "Small"),
  ],
  plots: [
    { key: "maxBull", title: "Dynamic Bull Max", color: GREEN, display: "none" },
    { key: "minBull", title: "Dynamic Bull Min", color: GREEN, display: "none" },
    { key: "maxBear", title: "Dynamic Bear Max", color: RED, display: "none" },
    { key: "minBear", title: "Dynamic Bear Min", color: RED, display: "none" },
  ],
  compute: (bars, p) => fairValueGap(bars, p),
});

function fairValueGap(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { high, low, close } = bars;
  const dynamic = b(p, "dynamic");
  const [bullCss, bearCss] = [s(p, "bullCss"), s(p, "bearCss")];
  type Fvg = { max: number; min: number; isBull: boolean; bar: number; box: Box | null };
  const records: Fvg[] = [];
  const boxes: Box[] = [];
  const lines: Line[] = [];
  let maxBull = NaN, minBull = NaN, maxBear = NaN, minBear = NaN;
  let bullCount = 0, bearCount = 0, bullMit = 0, bearMit = 0;
  const plots = { maxBull: ta.fill(len), minBull: ta.fill(len), maxBear: ta.fill(len), minBear: ta.fill(len) };
  let cum = 0;

  for (let i = 0; i < len; i++) {
    cum += (high[i] - low[i]) / low[i];
    const threshold = b(p, "auto") ? cum / i : n(p, "threshold") / 100;
    const bullFvg = i >= 2 && low[i] > high[i - 2] && close[i - 1] > high[i - 2] && (low[i] - high[i - 2]) / high[i - 2] > threshold;
    const bearFvg = i >= 2 && high[i] < low[i - 2] && close[i - 1] < low[i - 2] && (low[i - 2] - high[i]) / high[i] > threshold;

    if (bullFvg) {
      const g: Fvg = { max: low[i], min: high[i - 2], isBull: true, bar: i, box: null };
      if (dynamic) (maxBull = g.max), (minBull = g.min);
      else boxes.unshift((g.box = { x1: i - 2, top: g.max, x2: i + n(p, "extend"), bottom: g.min, bg: bullCss }));
      records.unshift(g);
      bullCount += 1;
    } else if (dynamic) maxBull = Math.max(Math.min(close[i], maxBull), minBull);

    if (bearFvg) {
      const g: Fvg = { max: low[i - 2], min: high[i], isBull: false, bar: i, box: null };
      if (dynamic) (maxBear = g.max), (minBear = g.min);
      else boxes.unshift((g.box = { x1: i - 2, top: g.max, x2: i + n(p, "extend"), bottom: g.min, bg: bearCss }));
      records.unshift(g);
      bearCount += 1;
    } else if (dynamic) minBear = Math.min(Math.max(close[i], minBear), maxBear);

    for (let k = records.length - 1; k >= 0; k--) {
      const g = records[k];
      const mitigated = g.isBull ? close[i] < g.min : close[i] > g.max;
      if (!mitigated) continue;
      const level = g.isBull ? g.min : g.max;
      if (b(p, "mitigationLevels")) lines.push({ x1: g.bar, y1: level, x2: i, y2: level, color: g.isBull ? bullCss : bearCss, style: "dashed" });
      if (g.box) boxes.splice(boxes.indexOf(g.box), 1);
      records.splice(k, 1);
      if (g.isBull) bullMit += 1;
      else bearMit += 1;
    }
    plots.maxBull[i] = maxBull, plots.minBull[i] = minBull, plots.maxBear[i] = maxBear, plots.minBear[i] = minBear;
  }

  for (const g of records.slice(0, n(p, "showLast"))) {
    const level = g.isBull ? g.min : g.max;
    lines.push({ x1: g.bar, y1: level, x2: len - 1, y2: level, color: g.isBull ? bullCss : bearCss });
  }

  let table: IndicatorTable | undefined;
  if (b(p, "showDash")) {
    const size = TABLE_SIZE[s(p, "textSize")] ?? "small";
    const [bs, rs] = [toHex(bullCss), toHex(bearCss)];
    const pct = (a: number, c: number) => (c ? `${((a / c) * 100).toFixed(2)}%` : "—");
    const cells: TableCell[] = [
      { col: 1, row: 0, text: "Bullish", color: bs, size },
      { col: 2, row: 0, text: "Bearish", color: rs, size },
      { col: 0, row: 1, text: "Count", color: "#ffffff", size },
      { col: 0, row: 2, text: "Mitigated", color: "#ffffff", size },
      { col: 1, row: 1, text: String(bullCount), color: bs, size },
      { col: 2, row: 1, text: String(bearCount), color: rs, size },
      { col: 1, row: 2, text: pct(bullMit, bullCount), color: bs, size },
      { col: 2, row: 2, text: pct(bearMit, bearCount), color: rs, size },
    ];
    table = { position: position(s(p, "dashLoc")), bg: "#1e222d", frame: "#373a46", border: "#373a46", cells };
  }

  return {
    // The dynamic zones only exist in Dynamic mode.
    plots: dynamic ? plots : {},
    fills: dynamic
      ? [
          { a: "maxBull", b: "minBull", color: bullCss },
          { a: "maxBear", b: "minBear", color: bearCss },
        ]
      : [],
    boxes: boxes.slice(0, 500),
    lines: lines.slice(-500),
    table,
  };
}

// =====================================================================================
// Harmonic Resonance Oscillator [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-hro",
  name: "Harmonic Resonance Oscillator [LuxAlgo]",
  short: "LuxAlgo - Harmonic Resonance Oscillator",
  category: "Community",
  overlay: false,
  legendInputs: ["refPeriod", "normLength"],
  inputs: [
    int("refPeriod", "Reference Period", 30, 2),
    float("shortMult", "Short Multiplier", 0.5, 0.1, 0.1),
    float("medMult", "Medium Multiplier", 1, 0.1, 0.1),
    float("longMult", "Long Multiplier", 2, 0.1, 0.1),
    float("bandwidth", "Bandwidth", 0.1, 0.05, 0.01, 0.5), // Ehlers' band-pass needs 4πB / period < π/2
    int("normLength", "Normalization Lookback", 50, 10),
    float("ob", "Overbought Threshold", 80, 1, 50),
    float("os", "Oversold Threshold", 20, 1, 0),
    colorInput("bull", "Bullish Color", GREEN),
    colorInput("bear", "Bearish Color", RED),
    colorInput("obColor", "Overbought Color", RED),
    colorInput("osColor", "Oversold Color", GREEN),
    bool("showBg", "Show Background Highlighting", true),
  ],
  plots: [
    { key: "baseline", title: "Baseline", color: "rgba(209,212,220,0.2)" },
    { key: "dynOB", title: "Dynamic Overbought", color: withOpacity(RED, 50), dotted: true },
    { key: "dynOS", title: "Dynamic Oversold", color: withOpacity(GREEN, 50), dotted: true },
    { key: "osc", title: "Harmonic Resonance", color: GREEN, width: 2 },
  ],
  compute: (bars, p) => harmonicResonance(bars, p),
});

/** The script's band-pass filter (Ehlers-style), na until two bars back exist. */
export function bandpass(src: Series, period: number, bandwidth: number): Series {
  const alpha = Math.cos((2 * Math.PI) / period);
  const beta = 1 / Math.cos((4 * Math.PI * bandwidth) / period);
  const gamma = beta - Math.sqrt(beta * beta - 1);
  const alpha2 = 1 - gamma;
  const out = ta.fill(src.length);
  for (let i = 0; i < src.length; i++) {
    const prev1 = ta.nz(out[i - 1]);
    const prev2 = ta.nz(out[i - 2]);
    out[i] = 0.5 * alpha2 * (src[i] - (i >= 2 ? src[i - 2] : NaN)) + gamma * (1 + alpha) * prev1 - gamma * prev2;
  }
  return out;
}

function harmonicResonance(bars: Bars, p: Params): IndicatorResult {
  const close = bars.close;
  const ref = n(p, "refPeriod");
  const bw = n(p, "bandwidth");
  const normLen = n(p, "normLength");
  const normalize = (x: Series) => {
    const hh = ta.highest(x, normLen);
    const ll = ta.lowest(x, normLen);
    return x.map((v, i) => (100 * (v - ll[i])) / Math.max(hh[i] - ll[i], 1e-10));
  };
  const cycles = [n(p, "shortMult"), n(p, "medMult"), n(p, "longMult")].map((m) => normalize(bandpass(close, Math.max(ref * m, 2), bw)));
  const osc = close.map((_, i) => (cycles[0][i] + cycles[1][i] + cycles[2][i]) / 3);
  const sd = ta.stdev(osc, normLen);
  const dynOB = sd.map((v) => 50 + (n(p, "ob") - 50) * (v / 25));
  const dynOS = sd.map((v) => 50 - (50 - n(p, "os")) * (v / 25));
  const [bull, bear] = [s(p, "bull"), s(p, "bear")];
  return {
    plots: { baseline: close.map(() => 50), dynOB, dynOS, osc },
    colors: {
      osc: osc.map((v) => (v > 50 ? bull : bear)),
      dynOB: dynOB.map(() => colorNew(s(p, "obColor"), 50)),
      dynOS: dynOS.map(() => colorNew(s(p, "osColor"), 50)),
    },
    // A vertical gradient in Pine, from half-opaque at the oscillator to clear at 50.
    fills: [{ a: "osc", b: 50, color: osc.map((v) => (Number.isFinite(v) ? colorNew(v > 50 ? bull : bear, 75) : undefined)) }],
    bgColors: b(p, "showBg")
      ? osc.map((v, i) => (v > dynOB[i] ? colorNew(bear, 90) : v < dynOS[i] ? colorNew(bull, 90) : undefined))
      : undefined,
  };
}

// =====================================================================================
// Market Structure (Breakers) [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-ms-breakers",
  name: "Market Structure (Breakers) [LuxAlgo]",
  short: "Market Structure (Breakers)",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["Market Structure"],
  legendInputs: ["length"],
  inputs: [
    int("length", "Swings Period", 20, 2),
    int("breaks", "Maximum Breaks", 1, 1),
    int("maxDuration", "Breaker Maximum Duration", 1000, 1, 100000),
    colorInput("bullCss", "Bullish MS", GREEN),
    colorInput("bullBreakCss", "Bullish Breaker", RED),
    colorInput("bearCss", "Bearish MS", RED),
    colorInput("bearBreakCss", "Bearish Breaker", GREEN),
  ],
  plots: [],
  compute: (bars, p) => marketStructureBreakers(bars, p),
});

function marketStructureBreakers(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { open, high, low, close } = bars;
  const length = n(p, "length");
  const maxBreaks = n(p, "breaks");
  const maxDuration = n(p, "maxDuration");
  const ph = ta.fixnan(pivotHigh(high, length, length));
  const pl = ta.fixnan(pivotLow(low, length, length));
  const lines: Line[] = [];
  const labels: Label[] = [];
  const markers: Marker[] = [];
  const boxes: Box[] = [];
  type Breaker = { level: Line; breaks: number };
  const bullms: Breaker[] = [];
  const bearms: Breaker[] = [];
  let phx = 0, plx = 0, phcross = false, plcross = false, os = 0;

  for (let i = 0; i < len; i++) {
    if (i > 0 && changed(ph[i], ph[i - 1])) (phx = i - length), (phcross = false);
    if (close[i] > ph[i] && !phcross) {
      lines.push({ x1: phx, y1: ph[i], x2: i, y2: ph[i], color: s(p, "bullCss") });
      labels.push({ index: Math.trunc((phx + i) / 2), price: ph[i], text: os === -1 ? "MSS" : "MSB", style: "down", textColor: s(p, "bullCss"), size: "small" });
      const level: Line = { x1: i, y1: ph[i], x2: i, y2: ph[i], color: s(p, "bullBreakCss"), style: "dotted" };
      lines.push(level);
      bullms.unshift({ level, breaks: 0 });
      phcross = true;
      if (bullms.length > 100) bullms.pop();
      os = 1;
    }
    let breakDown = false;
    for (let k = bullms.length - 1; k >= 0; k--) {
      const g = bullms[k];
      g.level.x2 = i;
      if (close[i] < g.level.y2 && open[i] > g.level.y2) {
        g.breaks += 1;
        if (g.breaks === maxBreaks) bullms.splice(k, 1), (breakDown = true);
      } else if (i - g.level.x1 >= maxDuration) {
        lines.splice(lines.indexOf(bullms.splice(k, 1)[0].level), 1);
      }
    }
    if (bullms.length > 0) {
      const lvl = bullms[0].level.y2;
      if (low[i] < lvl && Math.min(close[i], open[i]) > lvl) boxes.push({ x1: i - 0.4, x2: i + 0.4, top: high[i], bottom: low[i], bg: "", border: GREEN });
    }

    if (i > 0 && changed(pl[i], pl[i - 1])) (plx = i - length), (plcross = false);
    if (close[i] < pl[i] && !plcross) {
      lines.push({ x1: plx, y1: pl[i], x2: i, y2: pl[i], color: s(p, "bearCss") });
      labels.push({ index: Math.trunc((plx + i) / 2), price: pl[i], text: os === 1 ? "MSS" : "MSB", style: "up", textColor: s(p, "bearCss"), size: "small" });
      const level: Line = { x1: i, y1: pl[i], x2: i, y2: pl[i], color: s(p, "bearBreakCss"), style: "dotted" };
      lines.push(level);
      bearms.unshift({ level, breaks: 0 });
      plcross = true;
      if (bearms.length > 100) bearms.pop();
      os = -1;
    }
    let breakUp = false;
    for (let k = bearms.length - 1; k >= 0; k--) {
      const g = bearms[k];
      g.level.x2 = i;
      if (close[i] > g.level.y2 && open[i] < g.level.y2) {
        g.breaks += 1;
        if (g.breaks === maxBreaks) bearms.splice(k, 1), (breakUp = true);
      } else if (i - g.level.x1 >= maxDuration) {
        lines.splice(lines.indexOf(bearms.splice(k, 1)[0].level), 1);
      }
    }
    if (bearms.length > 0) {
      const lvl = bearms[0].level.y2;
      if (high[i] > lvl && Math.max(close[i], open[i]) < lvl) boxes.push({ x1: i - 0.4, x2: i + 0.4, top: high[i], bottom: low[i], bg: "", border: RED });
    }

    if (breakUp) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: GREEN });
    if (breakDown) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: RED });
  }
  return { plots: {}, lines: lines.slice(-500), labels: labels.slice(-500), markers, boxes: boxes.slice(-500) };
}

// =====================================================================================
// Market Structure Break & OB Probability Toolkit [LuxAlgo]
// =====================================================================================

const SESSION_INPUTS = [
  { key: "london", name: "London", from: [8, 0], to: [17, 0], color: "#3b82f6" },
  { key: "ny", name: "New York", from: [13, 0], to: [22, 0], color: "#f97316" },
  { key: "tokyo", name: "Tokyo", from: [0, 0], to: [9, 0], color: "#f43f5e" },
  { key: "sydney", name: "Sydney", from: [21, 0], to: [6, 0], color: "#eab308" },
] as const;

luxalgo2.push({
  id: "luxalgo-msb-ob",
  name: "Market Structure Break & OB Probability Toolkit [LuxAlgo]",
  short: "LuxAlgo - Market Structure Break & OB Probability Toolkit",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["Order Block", "MSB"],
  legendInputs: [],
  inputs: [
    bool("showStats", "Show Advanced Analytics", true),
    select("dashPos", "Dashboard Position", ["Top Right", "Bottom Right", "Bottom Left"], "Top Right"),
    select("dashSize", "Dashboard Size", ["Tiny", "Small", "Normal", "Large", "Huge"], "Small"),
    int("pivotLen", "Pivot Lookback", 7, 1),
    float("zScore", "MSB Momentum Z-Score", 0.5, 0.1, 0.1),
    select("mode", "Display Mode", ["Historical", "Present"], "Historical"),
    int("obCount", "Max Active OBs", 10, 1, 100),
    bool("extendBroken", "Extend Broken OBs", false),
    bool("hideOverlaps", "Hide Overlapping OBs", false),
    bool("showSessions", "Show Session Ranges", true),
    ...SESSION_INPUTS.flatMap((x) => [bool(`show_${x.key}`, `${x.name} Session`, false), colorInput(`color_${x.key}`, `${x.name} Color`, x.color)]),
  ],
  plots: [],
  compute: (bars, p, ext) => msbObToolkit(bars, p, ext?.chart),
});

function msbObToolkit(bars: Bars, p: Params, chart?: ChartContext): IndicatorResult {
  const len = bars.length;
  const { open, high, low, close, volume } = bars;
  const change = ta.change(close);
  const avgChange = ta.sma(change, 50);
  const stdChange = ta.stdev(change, 50);
  const z = change.map((c, i) => (c - avgChange[i]) / stdChange[i]);
  const volPct = ta.percentrank(volume, 100);
  const pl_ = n(p, "pivotLen");
  const ph = pivotHigh(high, pl_, pl_);
  const pl = pivotLow(low, pl_, pl_);
  const present = s(p, "mode") === "Present";
  const lines: Line[] = [];
  const labels: Label[] = [];
  const boxes: Box[] = [];
  type OB = { box: Box; label: Label; poc: Line; top: number; bottom: number; isBull: boolean; isHPZ: boolean; mitigated: boolean; mitBar: number; score: number };
  const obs: OB[] = [];
  const drop = (ob: OB) => {
    for (const [arr, item] of [[boxes, ob.box], [labels, ob.label], [lines, ob.poc]] as const) {
      const k = (arr as unknown[]).indexOf(item);
      if (k >= 0) (arr as unknown[]).splice(k, 1);
    }
  };
  let lastPh = NaN, lastPl = NaN, lastPhIdx = NaN, lastPlIdx = NaN;
  let totalMitigated = 0, totalObs = 0;

  // Session ranges, in the chart's exchange time zone like input.session.
  const sessions = b(p, "showSessions") ? SESSION_INPUTS.filter((x) => b(p, `show_${x.key}`)) : [];
  const tz = chart?.timezone ?? "Etc/UTC";
  const inSession = (i: number, x: (typeof SESSION_INPUTS)[number]) => {
    const t = timeParts(bars.time[i], tz);
    const m = t.hour * 60 + t.minute;
    const from = x.from[0] * 60 + x.from[1];
    const to = x.to[0] * 60 + x.to[1];
    return from < to ? m >= from && m < to : m >= from || m < to;
  };
  const open_: Record<string, { box: Box; label: Label } | null> = {};

  for (let i = 0; i < len; i++) {
    if (Number.isFinite(ph[i])) (lastPh = ph[i]), (lastPhIdx = i - pl_);
    if (Number.isFinite(pl[i])) (lastPl = pl[i]), (lastPlIdx = i - pl_);

    for (const x of sessions) {
      const color = s(p, `color_${x.key}`);
      const on = inSession(i, x);
      const was = i > 0 && inSession(i - 1, x);
      if (on && !was) {
        const box: Box = { x1: i, x2: i, top: high[i], bottom: low[i], bg: colorNew(color, 92), border: color, borderStyle: "dotted" };
        const label: Label = { index: i, price: high[i], text: x.name, style: "none", textColor: color, size: "small" };
        boxes.push(box), labels.push(label);
        open_[x.key] = { box, label };
      } else if (on && open_[x.key]) {
        const o = open_[x.key]!;
        o.box.top = Math.max(o.box.top, high[i]);
        o.box.bottom = Math.min(o.box.bottom, low[i]);
        o.box.x2 = i;
        o.label.index = Math.round((o.box.x1 + i) / 2);
        o.label.price = o.box.top;
      }
    }

    const msbBull = i > 0 && close[i] > lastPh && close[i - 1] <= lastPh && z[i] > n(p, "zScore");
    const msbBear = i > 0 && close[i] < lastPl && close[i - 1] >= lastPl && z[i] < -n(p, "zScore");
    if (msbBull) {
      lines.push({ x1: lastPhIdx, y1: lastPh, x2: i, y2: lastPh, color: GREEN });
      labels.push({ index: Math.round((lastPhIdx + i) / 2), price: lastPh, text: "MSB", style: "down", textColor: GREEN, size: "small" });
    }
    if (msbBear) {
      lines.push({ x1: lastPlIdx, y1: lastPl, x2: i, y2: lastPl, color: RED });
      labels.push({ index: Math.round((lastPlIdx + i) / 2), price: lastPl, text: "MSB", style: "up", textColor: RED, size: "small" });
    }
    if (msbBull || msbBear) {
      let obIdx = 0;
      for (let k = 1; k <= 10; k++) {
        if (i - k < 0) break;
        if ((msbBull && close[i - k] < open[i - k]) || (msbBear && close[i - k] > open[i - k])) {
          obIdx = k;
          break;
        }
      }
      const top = high[i - obIdx];
      const bottom = low[i - obIdx];
      const mid = (top + bottom) / 2;
      const score = Math.min(100, Math.abs(z[i]) * 20 + volPct[i] * 0.5);
      const isHPZ = score > 80;
      const base = msbBull ? GREEN : RED;
      const hpz = msbBull ? "#1de9b6" : "#ff5252";
      const overlapping =
        b(p, "hideOverlaps") && obs.some((o) => !o.mitigated && ((top <= o.top && top >= o.bottom) || (bottom <= o.top && bottom >= o.bottom)));
      if (!overlapping) {
        const box: Box = isHPZ
          ? { x1: i - obIdx, top, x2: i + 15, bottom, border: colorNew(hpz, 40), bg: colorNew(hpz, 80), borderStyle: "dashed" }
          : { x1: i - obIdx, top, x2: i + 15, bottom, border: colorNew(base, 60), bg: colorNew(base, 85), borderStyle: "dashed" };
        const poc: Line = { x1: i - obIdx, y1: mid, x2: i + 15, y2: mid, color: colorNew(isHPZ ? hpz : base, isHPZ ? 40 : 70), style: "dashed" };
        const label: Label = { index: i + 18, price: mid, text: Number.isFinite(score) ? `${formatPattern(score, "#")}%` : "", style: "none", textColor: isHPZ ? hpz : base, size: "tiny" };
        boxes.push(box), lines.push(poc), labels.push(label);
        obs.push({ box, label, poc, top, bottom, isBull: msbBull, isHPZ, mitigated: false, mitBar: 0, score });
      }
      if (msbBull) lastPh = NaN;
      else lastPl = NaN;
      totalObs += 1;
    }

    let mitCount = 0;
    for (let k = obs.length - 1; k >= 0; k--) {
      const ob = obs[k];
      if (!ob.mitigated) {
        ob.box.x2 = i + 15, ob.label.index = i + 18, ob.poc.x2 = i + 15;
        if (ob.isBull ? low[i] < ob.bottom : high[i] > ob.top) {
          ob.mitigated = true;
          ob.mitBar = i;
          totalMitigated += 1;
          if (present) drop(ob);
          else {
            ob.box.bg = colorNew("#787b86", 90);
            ob.box.border = colorNew("#787b86", 70);
            ob.label.textColor = colorNew("#787b86", 50);
            ob.poc.color = colorNew("#787b86", 80);
            ob.box.x2 = i, ob.label.index = i, ob.poc.x2 = i;
          }
        }
      } else {
        mitCount += 1;
        const extend = b(p, "extendBroken") && mitCount <= 2 && i - ob.mitBar <= 50;
        if (present) drop(ob);
        else if (extend) (ob.box.x2 = i + 15), (ob.label.index = i + 18), (ob.poc.x2 = i + 15);
        else (ob.box.x2 = ob.mitBar), (ob.label.index = ob.mitBar), (ob.poc.x2 = ob.mitBar);
      }
    }
    if (obs.length > n(p, "obCount")) drop(obs.shift()!);
  }

  let table: IndicatorTable | undefined;
  if (b(p, "showStats")) {
    const size = TABLE_SIZE[s(p, "dashSize")] ?? "small";
    const efficiency = totalObs > 0 ? (totalMitigated / totalObs) * 100 : 0;
    const hpzs = obs.filter((o) => o.isHPZ && !o.mitigated).length;
    table = {
      position: position(s(p, "dashPos")),
      bg: "#161616",
      frame: "#2E2E2E",
      border: "#161616",
      cells: [
        { col: 0, row: 0, colSpan: 2, text: "Statistics", color: "#DBDBDB", size, align: "center" },
        { col: 0, row: 1, colSpan: 2, text: "", color: "#2E2E2E", thin: true },
        { col: 0, row: 2, text: "Reliability", color: "#808080", size, align: "left" },
        { col: 1, row: 2, text: `${formatPattern(efficiency, "#.#")}%`, color: efficiency > 50 ? GREEN : RED, size, align: "right" },
        { col: 0, row: 3, colSpan: 2, text: "", color: "#2E2E2E", thin: true },
        { col: 0, row: 4, text: "HP-OB Count", color: "#808080", size, align: "left" },
        { col: 1, row: 4, text: String(hpzs), color: "#DBDBDB", size, align: "right" },
      ],
    };
  }
  return { plots: {}, lines: lines.slice(-500), labels: labels.slice(-500), boxes: boxes.slice(-500), table };
}

// =====================================================================================
// Order Block Detector [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-ob-detector",
  name: "Order Block Detector [LuxAlgo]",
  short: "Order Block Detector",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["Order Block"],
  legendInputs: ["length"],
  inputs: [
    int("length", "Volume Pivot Length", 5, 1),
    int("bullLast", "Bullish OB", 3, 1),
    colorInput("bgBull", "Bullish OB Background", withOpacity("#169400", 20)),
    colorInput("bull", "Bullish OB Border", "#169400"),
    colorInput("bullAvg", "Bullish OB Average", withOpacity("#9598a1", 63)),
    int("bearLast", "Bearish OB", 3, 1),
    colorInput("bgBear", "Bearish OB Background", withOpacity("#ff1100", 20)),
    colorInput("bear", "Bearish OB Border", "#ff1100"),
    colorInput("bearAvg", "Bearish OB Average", withOpacity("#9598a1", 63)),
    select("lineStyle", "Average Line Style", ["⎯⎯⎯", "----", "····"], "⎯⎯⎯"),
    int("lineWidth", "Average Line Width", 1, 1),
    select("mitigation", "Mitigation Methods", ["Wick", "Close"], "Wick"),
  ],
  plots: [],
  compute: (bars, p) => orderBlockDetector(bars, p),
});

function orderBlockDetector(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { high, low, close, volume } = bars;
  const length = n(p, "length");
  const upper = ta.highest(high, length);
  const lower = ta.lowest(low, length);
  const byClose = s(p, "mitigation") === "Close";
  const targetBull = byClose ? ta.lowest(close, length) : lower;
  const targetBear = byClose ? ta.highest(close, length) : upper;
  const phv = pivotHigh(volume, length, length);
  const hl2 = ta.source(bars, "hl2");
  type Arrays = { top: number[]; btm: number[]; avg: number[]; left: number[] };
  const bull: Arrays = { top: [], btm: [], avg: [], left: [] };
  const bear: Arrays = { top: [], btm: [], avg: [], left: [] };
  const add = (a: Arrays, top: number, btm: number, left: number) => {
    a.top.unshift(top), a.btm.unshift(btm), a.avg.unshift((top + btm) / 2), a.left.unshift(left);
  };
  // Pine's for…in over an array it removes from: the next element shifts under the index.
  const removeMitigated = (a: Arrays, target: number, isBull: boolean) => {
    const list = isBull ? a.btm : a.top;
    for (let k = 0; k < list.length; k++) {
      const element = list[k];
      const idx = list.indexOf(element);
      if (isBull ? target < element : target > element) {
        a.top.splice(idx, 1), a.btm.splice(idx, 1), a.avg.splice(idx, 1), a.left.splice(idx, 1);
      }
    }
  };
  let os = 0;
  for (let i = 0; i < len; i++) {
    const j = i - length;
    if (j >= 0) os = high[j] > upper[i] ? 0 : low[j] < lower[i] ? 1 : os;
    if (truthy(phv[i]) && os === 1) add(bull, hl2[j], low[j], j);
    if (truthy(phv[i]) && os === 0) add(bear, high[j], hl2[j], j);
    removeMitigated(bull, targetBull[i], true);
    removeMitigated(bear, targetBear[i], false);
  }
  const dash = ({ "⎯⎯⎯": "solid", "----": "dashed", "····": "dotted" } as const)[s(p, "lineStyle") as "⎯⎯⎯"] ?? "solid";
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const draw = (a: Arrays, count: number, bg: string, border: string, lvl: string) => {
    for (let k = 0; k < Math.min(count, a.top.length); k++) {
      boxes.push({ x1: a.left[k], x2: a.left[k], top: a.top[k], bottom: a.btm[k], bg, border: colorNew(border, 70), extendRight: true });
      lines.push({ x1: a.left[k], y1: a.avg[k], x2: a.left[k] + 1, y2: a.avg[k], color: lvl, style: dash, width: n(p, "lineWidth"), extend: "right" });
    }
  };
  draw(bull, n(p, "bullLast"), s(p, "bgBull"), s(p, "bull"), s(p, "bullAvg"));
  draw(bear, n(p, "bearLast"), s(p, "bgBear"), s(p, "bear"), s(p, "bearAvg"));
  return { plots: {}, boxes, lines };
}

// =====================================================================================
// Pivot Points High Low & Missed Reversal Levels [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-missed-pivots",
  name: "Pivot Points High Low & Missed Reversal Levels [LuxAlgo]",
  short: "Pivot Points High Low & Missed Reversal Levels",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["Missed Reversal"],
  legendInputs: ["length"],
  inputs: [
    int("length", "Pivot Length", 50, 1),
    bool("showReg", "Regular Pivots", true),
    colorInput("regHigh", "Regular High", "#ef5350"),
    colorInput("regLow", "Regular Low", "#26a69a"),
    bool("showMiss", "Missed Pivots", true),
    colorInput("missHigh", "Missed High", "#ef5350"),
    colorInput("missLow", "Missed Low", "#26a69a"),
    colorInput("labelCss", "Text Label Color", "#ffffff"),
  ],
  plots: [],
  compute: (bars, p) => missedPivots(bars, p),
});

function missedPivots(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const { high, low } = bars;
  const length = n(p, "length");
  const [showReg, showMiss] = [b(p, "showReg"), b(p, "showMiss")];
  const [regH, regL, missH, missL] = [s(p, "regHigh"), s(p, "regLow"), s(p, "missHigh"), s(p, "missLow")];
  const ph = pivotHigh(high, length, length);
  const pl = pivotLow(low, length, length);
  const lines: Line[] = [];
  const labels: Label[] = [];
  const ghostLabel = (x: number, y: number, isHigh: boolean) =>
    labels.push({ index: x, price: y, text: "👻", style: isHigh ? "down" : "up", bg: isHigh ? missH : missL, textColor: "#ffffff", size: "small" });
  const newLine = (l: Line) => (lines.push(l), l);

  let ghost: Line | null = null;
  // Pine's math.max(na, x) is na, so these stay na until the first pivot resets them.
  let max = 0, min = 0, maxX1 = 0, minX1 = 0;
  let followMax = 0, followMaxX1 = 0, followMin = 0, followMinX1 = 0;
  let os = 0, py1 = 0, px1 = 0;

  for (let i = 0; i < len; i++) {
    const j = i - length;
    const prevMax = max, prevMin = min, prevFollowMin = followMin, prevFollowMax = followMax;
    const hj = j >= 0 ? high[j] : NaN;
    const lj = j >= 0 ? low[j] : NaN;
    max = Math.max(hj, max);
    min = Math.min(lj, min);
    followMax = Math.max(hj, followMax);
    followMin = Math.min(lj, followMin);
    if (max > prevMax) (maxX1 = j), (followMin = low[j]);
    if (min < prevMin) (minX1 = j), (followMax = high[j]);
    if (followMin < prevFollowMin) followMinX1 = j;
    if (followMax > prevFollowMax) followMaxX1 = j;

    const osPrev = os;
    if (ghost) ghost.x2 = i;

    if (truthy(ph[i])) {
      if (showMiss) {
        if (osPrev === 1) {
          ghostLabel(minX1, min, false);
          newLine({ x1: px1, y1: py1, x2: minX1, y2: min, color: missH, style: "dashed" });
          px1 = minX1, py1 = min;
          if (ghost) ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regL, 50), width: 2 });
        } else if (ph[i] < max) {
          ghostLabel(maxX1, max, true);
          ghostLabel(followMinX1, followMin, false);
          newLine({ x1: px1, y1: py1, x2: maxX1, y2: max, color: missL, style: "dashed" });
          px1 = maxX1, py1 = max;
          if (ghost) ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regH, 50), width: 2 });
          newLine({ x1: px1, y1: py1, x2: followMinX1, y2: followMin, color: missH, style: "dashed" });
          px1 = followMinX1, py1 = followMin;
          ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regL, 50), width: 2 });
        }
      }
      if (showReg) {
        labels.push({ index: j, price: ph[i], text: "▼", style: "down", bg: regH, textColor: s(p, "labelCss"), size: "small" });
        newLine({ x1: px1, y1: py1, x2: j, y2: ph[i], color: missL, style: ph[i] < max || osPrev === 1 ? "dashed" : "solid" });
      }
      py1 = ph[i], px1 = j, os = 1, max = ph[i], min = ph[i];
    }

    const osPrev2 = osPrev;
    if (truthy(pl[i])) {
      if (showMiss) {
        if (osPrev2 === 0) {
          ghostLabel(maxX1, max, true);
          newLine({ x1: px1, y1: py1, x2: maxX1, y2: max, color: missL, style: "dashed" });
          px1 = maxX1, py1 = max;
          if (ghost) ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regH, 50), width: 2 });
        } else if (pl[i] > min) {
          ghostLabel(followMaxX1, followMax, true);
          ghostLabel(minX1, min, false);
          newLine({ x1: px1, y1: py1, x2: minX1, y2: min, color: missH, style: "dashed" });
          px1 = minX1, py1 = min;
          if (ghost) ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regL, 50), width: 2 });
          newLine({ x1: px1, y1: py1, x2: followMaxX1, y2: followMax, color: missL, style: "dashed" });
          px1 = followMaxX1, py1 = followMax;
          ghost.x2 = px1;
          ghost = newLine({ x1: px1, y1: py1, x2: px1, y2: py1, color: colorNew(regH, 50), width: 2 });
        }
      }
      if (showReg) {
        labels.push({ index: j, price: pl[i], text: "▲", style: "up", bg: regL, textColor: s(p, "labelCss"), size: "small" });
        newLine({ x1: px1, y1: py1, x2: j, y2: pl[i], color: missH, style: pl[i] > min || osPrev2 === 0 ? "dashed" : "solid" });
      }
      py1 = pl[i], px1 = j, os = 0, max = pl[i], min = pl[i];
    }
  }

  // The swing still forming since the last pivot.
  const last = len - 1;
  if (last >= px1 && len > 0) {
    let y = os === 1 ? Infinity : -Infinity;
    let x = last;
    for (let k = 0; k <= last - px1 - 1; k++) {
      const v = os === 1 ? low[last - k] : high[last - k];
      if (os === 1 ? v < y : v > y) (y = v), (x = last - k);
    }
    if (Number.isFinite(y)) {
      if (showMiss) ghostLabel(x, y, os !== 1);
      if (showMiss) lines.push({ x1: px1, y1: py1, x2: x, y2: y, color: os === 1 ? missH : missL, style: "dashed" });
      lines.push({ x1: x, y1: y, x2: last, y2: y, color: colorNew(os === 1 ? missH : missL, 50), width: 2 });
    }
  }
  // Drop what Pine can't draw (na coordinates) and the first zigzag leg, which starts from bar 0 at price 0.
  const drawable = (l: Line) => [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite) && !(l.x1 === 0 && l.y1 === 0);
  return { plots: {}, lines: lines.filter(drawable).slice(-500), labels: labels.filter((l) => Number.isFinite(l.price)).slice(-500) };
}

// =====================================================================================
// SMT Divergences [LuxAlgo]
// =====================================================================================

type TvBar = { time: number; high: number; low: number; close: number };

const smtPath = (sym1: string, sym2: string, chart: ChartContext) => {
  const res = chart.intervalSeconds >= 28 * 86_400 ? "1M" : chart.intervalSeconds >= 7 * 86_400 ? "1W" : chart.intervalSeconds >= 86_400 ? "1D" : String(Math.max(1, Math.round(chart.intervalSeconds / 60)));
  return `/api/tv/bars?symbols=${encodeURIComponent([sym1, sym2].join(","))}&resolution=${res}&count=2000`;
};

luxalgo2.push({
  id: "luxalgo-smt",
  name: "SMT Divergences [LuxAlgo]",
  short: "LuxAlgo - SMT Divergences",
  category: "Community",
  overlay: true,
  autoscale: false,
  legendInputs: ["length", "sym1", "sym2"],
  inputs: [
    int("length", "Pivot Lookback", 3, 2),
    bool("useSym1", "Comparison Symbol A", true),
    text("sym1", "Symbol A (EXCHANGE:TICKER)", "CME_MINI_DL:ES1!"),
    bool("useSym2", "Comparison Symbol B", true),
    text("sym2", "Symbol B (EXCHANGE:TICKER)", "CBOT_MINI_DL:YM1!"),
    colorInput("bullDiv", "Swing High", "#ff1100"),
    colorInput("bearDiv", "Swing Low", "#2157f3"),
    bool("showDash", "Show Dashboard", false),
    select("dashLoc", "Location", ["Top Right", "Bottom Right", "Bottom Left"], "Top Right"),
    select("textSize", "Size", ["Tiny", "Small", "Normal"], "Small"),
  ],
  plots: [],
  fetches: (p, chart) => [smtPath(s(p, "sym1").trim().toUpperCase(), s(p, "sym2").trim().toUpperCase(), chart)],
  compute: (bars, p, ext) => {
    const chart = ext?.chart;
    const [sym1, sym2] = [s(p, "sym1").trim().toUpperCase(), s(p, "sym2").trim().toUpperCase()];
    const data = chart ? (ext?.fetched?.[smtPath(sym1, sym2, chart)] as Record<string, TvBar[] | null> | undefined) : undefined;
    return smtDivergences(bars, p, data?.[sym1] ?? null, data?.[sym2] ?? null, sym1, sym2);
  },
});

/** The other symbol's high/low at each chart bar (request.security, gaps off). */
function align(bars: Bars, other: TvBar[] | null): { high: Series; low: Series } {
  const high = ta.fill(bars.length);
  const low = ta.fill(bars.length);
  if (!other) return { high, low };
  let j = -1;
  for (let i = 0; i < bars.length; i++) {
    while (j + 1 < other.length && other[j + 1].time <= bars.time[i]) j++;
    if (j >= 0) (high[i] = other[j].high), (low[i] = other[j].low);
  }
  return { high, low };
}

export function smtDivergences(bars: Bars, p: Params, other1: TvBar[] | null, other2: TvBar[] | null, sym1: string, sym2: string): IndicatorResult {
  const len = bars.length;
  const length = n(p, "length");
  const [bullCss, bearCss] = [s(p, "bullDiv"), s(p, "bearDiv")];
  const ph = ta.fixnan(pivotHigh(bars.high, length, length));
  const pl = ta.fixnan(pivotLow(bars.low, length, length));
  const lines: Line[] = [];
  const labels: Label[] = [];

  /** get_divergence with its own `var` state per call site. */
  const divergence = (isHigh: boolean, css: string) => {
    let y1 = NaN, symY1 = NaN, x1 = NaN, smt = 0;
    return (i: number, y2: number, y2Prev: number, symY2: number, symY2Prev: number) => {
      if (changed(y2, y2Prev) && changed(symY2, symY2Prev)) {
        if ((y2 - y1) * (symY2 - symY1) < 0) {
          lines.push({ x1: i - length, y1: y2, x2: x1, y2: y1, color: css });
          smt += 1;
        }
        symY1 = symY2, y1 = y2, x1 = i - length;
      } else if ((isHigh && y2 > y2Prev) || (!isHigh && y2 < y2Prev)) {
        symY1 = NaN, y1 = y2, x1 = i - length;
      }
      return smt;
    };
  };

  const series = [other1, other2].map((o) => {
    const a = align(bars, o);
    return { ph: ta.fixnan(pivotHigh(a.high, length, length)), pl: ta.fixnan(pivotLow(a.low, length, length)), has: Boolean(o?.length) };
  });
  const use = [b(p, "useSym1") && series[0].has, b(p, "useSym2") && series[1].has];
  const divs = [0, 1].map(() => ({ hi: divergence(true, bullCss), lo: divergence(false, bearCss) }));
  const phSmt = [0, 0], plSmt = [0, 0];
  let phN = 0, plN = 0;
  const tickers = [sym1.split(":").pop() ?? sym1, sym2.split(":").pop() ?? sym2];

  for (let i = 1; i < len; i++) {
    const phChanged = changed(ph[i], ph[i - 1]);
    const plChanged = changed(pl[i], pl[i - 1]);
    if (phChanged) phN += 1;
    if (plChanged) plN += 1;
    const prevPh = [...phSmt], prevPl = [...plSmt];
    for (const k of [0, 1]) {
      if (!use[k]) continue;
      phSmt[k] = divs[k].hi(i, ph[i], ph[i - 1], series[k].ph[i], series[k].ph[i - 1]);
      plSmt[k] = divs[k].lo(i, pl[i], pl[i - 1], series[k].pl[i], series[k].pl[i - 1]);
    }
    const names = (now: number[], prev: number[]) => [0, 1].filter((k) => now[k] > prev[k]).map((k) => tickers[k]).join(" | ");
    if (phChanged) {
      const txt = names(phSmt, prevPh);
      if (txt) labels.push({ index: i - length, price: ph[i], text: txt, style: "down", bg: bullCss, textColor: "#ffffff", size: "tiny" });
    } else {
      const txt = names(plSmt, prevPl);
      if (txt) labels.push({ index: i - length, price: pl[i], text: txt, style: "up", bg: bearCss, textColor: "#ffffff", size: "tiny" });
    }
  }

  let table: IndicatorTable | undefined;
  if (b(p, "showDash")) {
    const size = TABLE_SIZE[s(p, "textSize")] ?? "small";
    const pct = (a: number, c: number) => `${a} (${formatPattern((a / c) * 100, "#")}%)`;
    table = {
      position: position(s(p, "dashLoc")),
      bg: "#1e222d",
      frame: "#373a46",
      border: "#373a46",
      cells: [
        { col: 1, row: 0, text: "Swing High", color: "#ffffff", size },
        { col: 2, row: 0, text: "Swing Low", color: "#ffffff", size },
        { col: 0, row: 1, text: tickers[0], color: "#ffffff", size },
        { col: 0, row: 2, text: tickers[1], color: "#ffffff", size },
        { col: 1, row: 1, text: pct(phSmt[0], phN), color: bullCss, size },
        { col: 2, row: 1, text: pct(plSmt[0], plN), color: bearCss, size },
        { col: 1, row: 2, text: pct(phSmt[1], phN), color: bullCss, size },
        { col: 2, row: 2, text: pct(plSmt[1], plN), color: bearCss, size },
      ],
    };
  }
  return { plots: {}, lines: lines.slice(-500), labels: labels.slice(-500), table };
}

// =====================================================================================
// Supply and Demand Daily [LuxAlgo]
// =====================================================================================

luxalgo2.push({
  id: "luxalgo-supply-demand-daily",
  name: "Supply and Demand Daily [LuxAlgo]",
  short: "LuxAlgo - Supply and Demand Daily",
  category: "Community",
  overlay: true,
  autoscale: false,
  description: "Each day's supply and demand zones from where the previous day's volume concentrated (intraday charts; intrabar data is the chart's own bars).",
  legendInputs: ["per", "div"],
  inputs: [
    float("per", "Threshold %", 10, 1, 0),
    int("div", "Resolution", 50, 2, 500),
    bool("showSupply", "Supply", true),
    colorInput("supplyCss", "Supply Color", "#2157f3"),
    bool("supplyArea", "Supply Area", true),
    bool("supplyAvg", "Supply Average", true),
    bool("supplyWavg", "Supply Weighted", true),
    bool("showDemand", "Demand", true),
    colorInput("demandCss", "Demand Color", "#ff5d00"),
    bool("demandArea", "Demand Area", true),
    bool("demandAvg", "Demand Average", true),
    bool("demandWavg", "Demand Weighted", true),
  ],
  plots: [],
  compute: (bars, p, ext) => supplyDemandDaily(bars, p, ext?.chart?.timezone ?? "Etc/UTC"),
});

function supplyDemandDaily(bars: Bars, p: Params, timezone: string): IndicatorResult {
  const len = bars.length;
  const { high, low, volume } = bars;
  const per = n(p, "per");
  const div = n(p, "div");
  const boxes: Box[] = [];
  const lines: Line[] = [];
  type Area = { box: Box | null; avg: Line | null; wavg: Line | null };
  let supplyArea: Area | null = null;
  let demandArea: Area | null = null;
  let max = 0, min = 0, x1 = 0, csum = 0;
  let prevDay = NaN;

  const setArea = (css: string, left: number, top: number, btm: number, avg: number, wavg: number, i: number, showArea: boolean, showAvg: boolean, showWavg: boolean): Area => {
    const area: Area = {
      box: showArea ? { x1: left, x2: i, top, bottom: btm, bg: colorNew(css, 80) } : null,
      avg: showAvg ? { x1: left, y1: avg, x2: i, y2: avg, color: css } : null,
      wavg: showWavg ? { x1: left, y1: wavg, x2: i, y2: wavg, color: css, style: "dashed" } : null,
    };
    if (area.box) boxes.push(area.box);
    if (area.avg) lines.push(area.avg);
    if (area.wavg) lines.push(area.wavg);
    return area;
  };

  for (let i = 0; i < len; i++) {
    // high[1] is na on the first bar, which leaves these na until the first new day (as in Pine).
    max = Math.max(i > 0 ? high[i - 1] : NaN, max);
    min = Math.min(i > 0 ? low[i - 1] : NaN, min);
    csum += i > 0 ? volume[i - 1] : NaN;
    const day = timeParts(bars.time[i], timezone).day;
    if (i > 0 && day !== prevDay) {
      const r = (max - min) / div;
      const supply = { lvl: max, prev: max, sum: 0, prevSum: 0, csum: 0, avg: 0, reached: false };
      const demand = { lvl: min, prev: min, sum: 0, prevSum: 0, csum: 0, avg: 0, reached: false };
      outer: for (let k = 0; k < div; k++) {
        supply.lvl -= r;
        demand.lvl += r;
        // Pine's `for j = 1 to (n - x1) - 1` counts down to 0 when the day had a single bar.
        const last = i - x1 - 1;
        for (let j = 1; last >= 1 ? j <= last : j >= last; last >= 1 ? j++ : j--) {
          const h = high[i - j], l = low[i - j], v = volume[i - j];
          supply.sum += h > supply.lvl && h < supply.prev ? v : 0;
          supply.avg += supply.lvl * (supply.sum - supply.prevSum);
          supply.csum += supply.sum - supply.prevSum;
          supply.prevSum = supply.sum;
          demand.sum += l < demand.lvl && l > demand.prev ? v : 0;
          demand.avg += demand.lvl * (demand.sum - demand.prevSum);
          demand.csum += demand.sum - demand.prevSum;
          demand.prevSum = demand.sum;

          if ((supply.sum / csum) * 100 > per && !supply.reached) {
            if (b(p, "showSupply")) {
              supplyArea = setArea(s(p, "supplyCss"), x1, max, supply.lvl, (max + supply.lvl) / 2, supply.avg / supply.csum, i, b(p, "supplyArea"), b(p, "supplyAvg"), b(p, "supplyWavg"));
            }
            supply.reached = true;
          }
          if ((demand.sum / csum) * 100 > per && !demand.reached && b(p, "showDemand")) {
            demandArea = setArea(s(p, "demandCss"), x1, demand.lvl, min, (min + demand.lvl) / 2, demand.avg / demand.csum, i, b(p, "demandArea"), b(p, "demandAvg"), b(p, "demandWavg"));
            demand.reached = true;
          }
          if (supply.reached && demand.reached) break outer;
        }
        supply.prev = supply.lvl;
        demand.prev = demand.lvl;
      }
      max = high[i], min = low[i], csum = volume[i], x1 = i;
    }
    prevDay = day;
  }
  // The latest zones run to the last bar.
  for (const a of [supplyArea, demandArea] as Array<Area | null>) {
    if (!a) continue;
    if (a.box) a.box.x2 = len - 1;
    if (a.avg) a.avg.x2 = len - 1;
    if (a.wavg) a.wavg.x2 = len - 1;
  }
  return { plots: {}, boxes: boxes.slice(-500), lines: lines.slice(-500) };
}
