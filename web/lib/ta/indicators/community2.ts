// Ports of open-source TradingView community scripts.
//
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy
// of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// - Bitcoin Halving Cycle Profit              (open-source TradingView script, Pine v5)
// - Supertrend                                (© KivancOzbulgen, Pine v4)
// - UT Bot Alerts                             (open-source TradingView script, Pine v4)
// - Volume Profile / Fixed Range              (© LonesomeTheBlue, MPL-2.0, Pine v5)
// - Bollinger Bands Percentile + Stdev Channels (BBPct) (© Algoalpha X © Sushiboi77, MPL-2.0, Pine v5)

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { colorNew, formatMintick, inferMintick, timeParts } from "../pine";
import {
  b,
  bool,
  colorInput,
  float,
  int,
  n,
  src,
  s,
  type ChartContext,
  type Color,
  type IndicatorDef,
  type IndicatorResult,
  type Label,
  type Line,
  type Marker,
  type Params,
  type Box,
} from "../types";

export const community2: IndicatorDef[] = [];

// Pine v4's color constants.
const V4_GREEN = "#4CAF50";
const V4_RED = "#FF5252";
const V4_WHITE = "#FFFFFF";

// =====================================================================================
// Bitcoin Halving Cycle Profit
// =====================================================================================

type Ymd = [number, number, number];
const HALVINGS: Ymd[] = [
  [2012, 11, 28],
  [2016, 7, 9],
  [2020, 5, 11],
  [2024, 4, 19],
];
/** The background bands use 2024-04-10 for the fourth halving, as the script does. */
const BAND_HALVINGS: Ymd[] = [
  [2012, 11, 28],
  [2016, 7, 9],
  [2020, 5, 11],
  [2024, 4, 10],
];

/** Pine's timestamp(y, m, d) in the exchange time zone, in seconds. */
export function exchangeTimestamp(tz: string, [y, m, d]: Ymd): number {
  const utc = Date.UTC(y, m - 1, d) / 1000;
  // Shift by the zone's offset at that moment (twice, to settle across DST changes).
  let t = utc;
  for (let k = 0; k < 2; k++) {
    const p = timeParts(t, tz);
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000;
    t = utc - (local - t);
  }
  return t;
}

const rgb = (r: number, g: number, bl: number, transp = 0) => colorNew(`rgb(${r},${g},${bl})`, transp);

community2.push({
  id: "btc-halving-cycle",
  name: "Bitcoin Halving Cycle Profit",
  short: "Bitcoin Halving Cycle Profit",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["Halving"],
  description: "Profit-taking and DCA zones counted from each Bitcoin halving (weekly and monthly charts; daily shows the halvings).",
  legendInputs: [],
  inputs: [
    bool("halvingDate", "Halving Date", true),
    bool("weeklyStart", "(Weekly) Profit [START]", true),
    bool("weeklyEnd", "(Weekly) Profit [END]", true),
    bool("monthlyStart", "(Monthly) Profit [START]", true),
    bool("monthlyEnd", "(Monthly) Profit [END]", true),
    bool("dca", "DCA (Show)", true),
    bool("background", "Show Background Color", true),
    int("startWeekly", "(Weekly) START Profit [Offset]", 40, -40),
    int("endWeekly", "(Weekly) END Profit [Offset]", 80, 0),
    int("dcaWeekly", "DCA Weekly [Offset]", 135, 0),
    int("startMonthly", "(Monthly) START Profit [Offset]", 10, -100),
    int("endMonthly", "(Monthly) END Profit [Offset]", 18, 0),
    int("dcaMonthly", "DCA Monthly [Offset]", 31, 0),
  ],
  plots: [],
  compute: (bars, p, ext) => halvingCycle(bars, p, ext?.chart),
});

export function halvingCycle(bars: Bars, p: Params, chart?: ChartContext): IndicatorResult {
  const len = bars.length;
  const tz = chart?.timezone ?? "Etc/UTC";
  const secs = chart?.intervalSeconds ?? 86_400;
  const isDaily = secs >= 86_400 && secs < 7 * 86_400;
  const isWeekly = secs >= 7 * 86_400 && secs < 28 * 86_400;
  const isMonthly = secs >= 28 * 86_400;
  const { high, low, time } = bars;
  const lines: Line[] = [];
  const labels: Label[] = [];

  // Background bands: bars within a window after each halving, repeated at growing offsets.
  // The script's windows are in milliseconds: months × 30 × 86 400 × 300 (weekly) and
  // months × 36 × 30 × 86 400 × 100 (monthly).
  const bg: Color[] = new Array(len).fill(undefined);
  const band = (windowSec: (k: number) => number, transp: number, offset: number) => {
    const starts = BAND_HALVINGS.map((h) => exchangeTimestamp(tz, h) + 0.001);
    for (let i = 0; i < len; i++) {
      const hit = starts.some((st, k) => time[i] >= st && time[i] <= st + windowSec(k));
      if (hit && i + offset < len) bg[i + offset] = rgb(0, 255, 8, transp);
    }
  };
  if (b(p, "background") && isWeekly) {
    const w = (months: number, last: number) => (k: number) => (k === 3 ? last : months) * 30 * 86_400 * 0.3;
    [
      [90, 40],
      [85, 47],
      [80, 54],
      [75, 61],
      [60, 68],
    ].forEach(([tr, off]) => band(w(5.5, 6), tr, off));
    band(w(3.5, 4), 55, 75);
  }
  if (b(p, "background") && isMonthly) {
    const w = (k: number) => (k === 3 ? 1 : 0.25) * 36 * 30 * 86_400 * 0.1;
    [
      [85, 11],
      [80, 12],
      [75, 13],
      [65, 14],
      [55, 15],
      [45, 16],
      [40, 17],
    ].forEach(([tr, off]) => band(w, tr, off));
  }

  const above = (x: number) => (x >= 0 && x < len ? high[x] : NaN);
  const below = (x: number) => (x >= 0 && x < len ? low[x] : NaN);
  const vline = (x: number, color: string, style: "dashed" | "dotted", width: number) =>
    lines.push({ x1: x, y1: below(Math.min(x, len - 1)), x2: x, y2: above(Math.min(x, len - 1)), color, style, width, extend: "both" });
  const push = (l: Label) => Number.isFinite(l.price) && labels.push(l);

  for (const h of HALVINGS) {
    const ts = exchangeTimestamp(tz, h);
    const i = time.findIndex((t, k) => ts <= t && (k === 0 || ts > time[k - 1]));
    if (i <= 0) continue;
    const labelX = isDaily ? i + 280 : i;
    const [y, m, d] = h;
    vline(i, rgb(255, 123, 0), "dashed", 3);
    if (b(p, "halvingDate")) {
      push({ index: i, price: high[i], text: `⛏\nHalving\n${m}/${d}/${y}\n🟠`, style: "down", textColor: "#000000", bg: rgb(255, 136, 0, 5), size: "normal" });
    }
    const cycle = (start: number, end: number, dca: number, showStart: boolean, showEnd: boolean, dots: number[], dotColors: string[]) => {
      const xs = labelX + start, xe = labelX + end, xd = labelX + dca;
      if (showStart) {
        push({ index: xs, price: above(xs), text: "Profit\nSTART\n🟢\n⛏\n40ʷ ᵃᵍᵒ", style: "down", textColor: "#000000", bg: rgb(17, 255, 0), size: "normal" });
        vline(xs, rgb(0, 255, 8), "dotted", 2);
        push({ index: xs, price: above(xs), text: "", style: "cross", bg: rgb(40, 255, 0), size: "small" });
      }
      if (showEnd) {
        push({ index: xe, price: above(xe), text: "Profit\nEND\n🔴\n⛏\n80ʷ ᵃᵍᵒ", style: "down", textColor: "#000000", bg: rgb(255, 0, 0), size: "normal" });
        vline(xe, rgb(255, 0, 0), "dotted", 2);
        push({ index: xe, price: above(xe), text: "", style: "cross", bg: rgb(40, 255, 0), size: "small" });
      }
      if (b(p, "dca")) {
        push({ index: xd, price: below(xd), text: "→\nDCA\n🟡\n⛏\n135ʷ ᵃᵍᵒ", style: "up", textColor: "#000000", bg: isWeekly ? rgb(226, 246, 0, 25) : rgb(226, 246, 0), size: "normal" });
        dots.forEach((dx, k) => push({ index: xd + dx, price: below(xd + dx), text: "", style: "circle", bg: dotColors[k], size: "tiny" }));
      }
    };
    if (isWeekly) {
      cycle(n(p, "startWeekly"), n(p, "endWeekly"), n(p, "dcaWeekly"), b(p, "weeklyStart"), b(p, "weeklyEnd"), [0, 12, 24, 36, 48], [
        rgb(251, 226, 0), rgb(203, 249, 0, 35), rgb(170, 255, 59, 46), rgb(115, 255, 0, 58), rgb(38, 255, 0, 58),
      ]);
    }
    if (isMonthly) {
      cycle(n(p, "startMonthly"), n(p, "endMonthly"), n(p, "dcaMonthly"), b(p, "monthlyStart"), b(p, "monthlyEnd"), [0, 3, 6, 9, 12], [
        rgb(251, 226, 0), rgb(203, 249, 0, 35), rgb(88, 255, 59, 58), rgb(42, 255, 5, 58), rgb(42, 255, 5, 58),
      ]);
    }
  }
  return { plots: {}, lines, labels, bgColors: bg };
}

// =====================================================================================
// Supertrend (KivancOzbulgen)
// =====================================================================================

community2.push({
  id: "supertrend-kivanc",
  name: "Supertrend (KivancOzbulgen)",
  short: "Supertrend",
  category: "Community",
  overlay: true,
  precision: 2,
  aliases: ["SuperTrend", "Kivanc"],
  legendInputs: ["periods", "source", "multiplier"],
  inputs: [
    int("periods", "ATR Period", 10),
    src("hl2"),
    float("multiplier", "ATR Multiplier", 3, 0.1, 0),
    bool("changeAtr", "Change ATR Calculation Method ?", true),
    bool("showSignals", "Show Buy/Sell Signals ?", true),
    bool("highlighting", "Highlighter On/Off ?", true),
  ],
  plots: [
    { key: "up", title: "Up Trend", color: V4_GREEN, width: 2 },
    { key: "dn", title: "Down Trend", color: V4_RED, width: 2 },
    { key: "mid", title: "ohlc4", color: V4_WHITE, display: "none" },
  ],
  compute: (bars, p) => supertrendKivanc(bars, p),
});

export function supertrendKivanc(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const x = ta.source(bars, s(p, "source"));
  const periods = n(p, "periods");
  const mult = n(p, "multiplier");
  const atr = b(p, "changeAtr") ? ta.atr(bars, periods) : ta.sma(ta.tr(bars, false), periods);
  const close = bars.close;
  const upOut = ta.fill(len);
  const dnOut = ta.fill(len);
  const trend = new Array<number>(len).fill(1);
  const labels: Label[] = [];
  let upPrev = NaN, dnPrev = NaN;
  for (let i = 0; i < len; i++) {
    let up = x[i] - mult * atr[i];
    const up1 = ta.nz(upPrev, up);
    if (close[i - 1] > up1) up = Math.max(up, up1);
    let dn = x[i] + mult * atr[i];
    const dn1 = ta.nz(dnPrev, dn);
    if (close[i - 1] < dn1) dn = Math.min(dn, dn1);
    const prev = i > 0 ? trend[i - 1] : 1;
    trend[i] = prev === -1 && close[i] > dn1 ? 1 : prev === 1 && close[i] < up1 ? -1 : prev;
    upPrev = up, dnPrev = dn;
    if (trend[i] === 1) upOut[i] = up;
    else dnOut[i] = dn;
    if (i === 0) continue;
    if (trend[i] === 1 && trend[i - 1] === -1) {
      labels.push({ index: i, price: up, text: "", style: "circle", bg: V4_GREEN, size: "tiny" });
      if (b(p, "showSignals")) labels.push({ index: i, price: up, text: "Buy", style: "up", bg: V4_GREEN, textColor: V4_WHITE, size: "tiny" });
    }
    if (trend[i] === -1 && trend[i - 1] === 1) {
      labels.push({ index: i, price: dn, text: "", style: "circle", bg: V4_RED, size: "tiny" });
      if (b(p, "showSignals")) labels.push({ index: i, price: dn, text: "Sell", style: "down", bg: V4_RED, textColor: V4_WHITE, size: "tiny" });
    }
  }
  const hl = b(p, "highlighting");
  // Pine v4 fills default to 90 transparency.
  const longFill = trend.map((t) => colorNew(hl && t === 1 ? V4_GREEN : V4_WHITE, 90));
  const shortFill = trend.map((t) => colorNew(hl && t === -1 ? V4_RED : V4_WHITE, 90));
  return {
    plots: { up: upOut, dn: dnOut, mid: ta.source(bars, "ohlc4") },
    fills: [
      { a: "mid", b: "up", color: longFill },
      { a: "mid", b: "dn", color: shortFill },
    ],
    labels,
  };
}

// =====================================================================================
// UT Bot Alerts
// =====================================================================================

community2.push({
  id: "ut-bot-alerts",
  name: "UT Bot Alerts",
  short: "UT Bot Alerts",
  category: "Community",
  overlay: true,
  aliases: ["UT Bot"],
  legendInputs: ["a", "c"],
  inputs: [
    float("a", "Key Value (sensitivity)", 1, 0.1, 0),
    int("c", "ATR Period", 10),
    bool("h", "Signals from Heikin Ashi Candles", false),
  ],
  plots: [{ key: "stop", title: "ATR Trailing Stop", color: "#2196F3", display: "none" }],
  compute: (bars, p) => utBot(bars, p),
});

/** Heikin Ashi close is the bar's ohlc4. */
export function utBot(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const x: Series = b(p, "h") ? ta.source(bars, "ohlc4") : bars.close;
  const nLoss = ta.atr(bars, n(p, "c")).map((v) => n(p, "a") * v);
  const stop = ta.fill(len);
  for (let i = 0; i < len; i++) {
    const prev = ta.nz(stop[i - 1], 0);
    const src1 = x[i - 1];
    stop[i] =
      x[i] > prev && src1 > prev
        ? Math.max(ta.nz(stop[i - 1]), x[i] - nLoss[i])
        : x[i] < prev && src1 < prev
          ? Math.min(ta.nz(stop[i - 1]), x[i] + nLoss[i])
          : x[i] > prev
            ? x[i] - nLoss[i]
            : x[i] + nLoss[i];
  }
  const markers: Marker[] = [];
  const barColors: Color[] = new Array(len).fill(undefined);
  for (let i = 0; i < len; i++) {
    if (x[i] > stop[i]) barColors[i] = V4_GREEN;
    if (x[i] < stop[i]) barColors[i] = V4_RED;
    if (x[i] > stop[i] && ta.crossover(x, stop, i)) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: V4_GREEN, text: "Buy" });
    if (x[i] < stop[i] && ta.crossover(stop, x, i)) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: V4_RED, text: "Sell" });
  }
  return { plots: { stop }, markers, barColors };
}

// =====================================================================================
// Volume Profile / Fixed Range (LonesomeTheBlue)
// =====================================================================================

community2.push({
  id: "volume-profile-fixed-range",
  name: "Volume Profile / Fixed Range",
  short: "Volume Profile / Fixed Range",
  category: "Community",
  overlay: true,
  autoscale: false,
  aliases: ["VPFR", "Volume Profile"],
  legendInputs: ["bbars", "cnum", "percent"],
  inputs: [
    int("bbars", "Number of Bars", 150, 1, 500),
    int("cnum", "Row Size", 24, 5, 100),
    float("percent", "Value Area Volume %", 70, 1, 0),
    colorInput("pocColor", "POC Color", "#ff0000"),
    int("pocWidth", "POC Width", 2, 1, 5),
    colorInput("vupColor", "Value Area Up", colorNew("#2196F3", 30)),
    colorInput("vdownColor", "Value Area Down", colorNew("#FF9800", 30)),
    colorInput("upColor", "UP Volume", colorNew("#2196F3", 75)),
    colorInput("downColor", "Down Volume", colorNew("#FF9800", 75)),
    bool("showPoc", "Show POC Label", true),
  ],
  plots: [],
  compute: (bars, p) => volumeProfileFixedRange(bars, p),
});

export function volumeProfileFixedRange(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const last = len - 1;
  const bbars = Math.min(n(p, "bbars"), len);
  const cnum = n(p, "cnum");
  if (bbars < 1) return { plots: {} };
  const { open, high, low, close, volume } = bars;
  const back = (k: number) => last - k;
  let top = -Infinity, bot = Infinity;
  for (let k = 0; k < bbars; k++) (top = Math.max(top, high[back(k)])), (bot = Math.min(bot, low[back(k)]));
  const dist = (top - bot) / 500;
  const step = (top - bot) / cnum;
  const levels = Array.from({ length: cnum + 1 }, (_, x) => bot + step * x);
  const getVol = (y11: number, y12: number, y21: number, y22: number, height: number, vol: number) =>
    ta.nz((Math.max(Math.min(Math.max(y11, y12), Math.max(y21, y22)) - Math.max(Math.min(y11, y12), Math.min(y21, y22)), 0) * vol) / height);

  const volumes = new Array<number>(cnum * 2).fill(0);
  for (let k = 0; k < bbars; k++) {
    const i = back(k);
    const bodyTop = Math.max(close[i], open[i]);
    const bodyBot = Math.min(close[i], open[i]);
    const green = close[i] >= open[i];
    const topwick = high[i] - bodyTop;
    const bottomwick = bodyBot - low[i];
    const body = bodyTop - bodyBot;
    const denom = 2 * topwick + 2 * bottomwick + body;
    const bodyvol = (body * volume[i]) / denom;
    const topwickvol = (2 * topwick * volume[i]) / denom;
    const bottomwickvol = (2 * bottomwick * volume[i]) / denom;
    for (let x = 0; x < cnum; x++) {
      const bodyPart = getVol(levels[x], levels[x + 1], bodyBot, bodyTop, body, bodyvol);
      const wicks =
        getVol(levels[x], levels[x + 1], bodyTop, high[i], topwick, topwickvol) / 2 + getVol(levels[x], levels[x + 1], bodyBot, low[i], bottomwick, bottomwickvol) / 2;
      volumes[x] += (green ? bodyPart : 0) + wicks;
      volumes[x + cnum] += (green ? 0 : bodyPart) + wicks;
    }
  }
  const totals = Array.from({ length: cnum }, (_, x) => volumes[x] + volumes[x + cnum]);
  const maxvol = Math.max(...totals);
  const poc = totals.indexOf(maxvol);
  const totalmax = (totals.reduce((a, v) => a + v, 0) * n(p, "percent")) / 100;
  let vaTotal = totals[poc];
  let up = poc, down = poc;
  for (let x = 0; x < cnum; x++) {
    if (vaTotal >= totalmax) break;
    const uppervol = up < cnum - 1 ? totals[up + 1] : 0;
    const lowervol = down > 0 ? totals[down - 1] : 0;
    if (uppervol === 0 && lowervol === 0) break;
    if (uppervol >= lowervol) (vaTotal += uppervol), (up += 1);
    else (vaTotal += lowervol), (down -= 1);
  }
  for (let x = 0; x < cnum * 2; x++) volumes[x] = (volumes[x] * bbars) / (3 * maxvol);

  const x0 = last - bbars + 1;
  const boxes: Box[] = [];
  for (let x = 0; x < cnum; x++) {
    const inVa = x >= down && x <= up;
    const w1 = Math.round(volumes[x]);
    const w2 = Math.round(volumes[x + cnum]);
    const topY = levels[x + 1] - dist;
    const botY = levels[x] + dist;
    boxes.push({ x1: x0, x2: x0 + w1, top: topY, bottom: botY, bg: inVa ? s(p, "vupColor") : s(p, "upColor") });
    boxes.push({ x1: x0 + w1, x2: x0 + w1 + w2, top: topY, bottom: botY, bg: inVa ? s(p, "vdownColor") : s(p, "downColor") });
  }
  const pocLevel = (levels[poc] + levels[poc + 1]) / 2;
  const lines: Line[] = [{ x1: x0, y1: pocLevel, x2: x0 + 1, y2: pocLevel, color: s(p, "pocColor"), width: n(p, "pocWidth"), extend: "right" }];
  const labels: Label[] = [];
  if (b(p, "showPoc")) {
    labels.push({
      index: last + 15,
      price: pocLevel,
      text: `POC: ${formatMintick(pocLevel, inferMintick(bars))}`,
      style: close[last] >= pocLevel ? "up" : "down",
      bg: "#2196F3",
      textColor: "#000000",
      size: "normal",
    });
  }
  return { plots: {}, boxes, lines, labels };
}

// =====================================================================================
// Bollinger Bands Percentile + Stdev Channels (BBPct) [AlgoAlpha] (© Algoalpha X © Sushiboi77, MPL-2.0)
// =====================================================================================

community2.push({
  id: "algoalpha-bbpct",
  name: "Bollinger Bands Percentile + Stdev Channels (BBPct) [AlgoAlpha]",
  short: "◭ BBPCT% [AlgoAlpha]",
  category: "Community",
  overlay: false,
  aliases: ["BBPct", "Bollinger Bands Percent", "AlgoAlpha"],
  legendInputs: ["length", "source", "mult"],
  inputs: [
    bool("neon", "Neon Color Theme", true),
    int("length", "Length", 20, 1),
    src("close"),
    float("mult", "Multiplier", 2, 0.1, 0.001),
    bool("showStdev", "Show Bollinger Band Stdev %", false),
  ],
  plots: [
    { key: "z", title: "Z", color: "#00ffbb" },
    { key: "stdev", title: "Stdev %", color: "#26A69A", style: "histogram" },
    { key: "obUpper", title: "OB upper", color: "#ff1100", display: "none" },
    { key: "obLower", title: "OB lower", color: "#ff1100", display: "none" },
    { key: "obMid", title: "OB mid", color: "#ff1100", display: "none" },
    { key: "osUpper", title: "OS upper", color: "#00ffbb", display: "none" },
    { key: "osLower", title: "OS lower", color: "#00ffbb", display: "none" },
    { key: "osMid", title: "OS mid", color: "#00ffbb", display: "none" },
    { key: "mid", title: "Mid", color: "#787B86", display: "none" },
  ],
  compute: (bars, p) => bbpct(bars, p),
});

export function bbpct(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const x = ta.source(bars, s(p, "source"));
  const length = n(p, "length");
  const basis = ta.sma(x, length);
  const sd = ta.stdev(x, length);
  const dev = sd.map((v) => n(p, "mult") * v);
  const z = x.map((v, i) => (100 * (v - (basis[i] - dev[i]))) / (2 * dev[i]));
  const hist = dev.map((d, i) => (100 * d) / bars.close[i]);
  const bull = b(p, "neon") ? "#00ffbb" : "#00b712";
  const bear = b(p, "neon") ? "#ff1100" : "#c30010";
  const level = (v: number) => new Array<number>(len).fill(v);
  // The script's "Symmetrical Standard Deviation Channels" (close within ±5 % of itself) are
  // always true for a positive price, so the arrows fire on the BBPct crosses alone.
  const close = bars.close;
  const stdL = close.map((c) => c > c - 0.05 * c);
  const stdS = close.map((c) => c < c + 0.05 * c);
  const markers: Marker[] = [];
  const lo = level(-8);
  const hi = level(108);
  for (let i = 1; i < len; i++) {
    if (ta.crossover(z, lo, i) && stdL[i]) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: bull });
    if (ta.crossunder(z, hi, i) && stdS[i]) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: bear });
  }
  const plots: Record<string, Series> = {
    z,
    obUpper: level(130),
    obLower: level(110),
    obMid: level(95),
    osUpper: level(-10),
    osLower: level(-30),
    osMid: level(5),
    mid: level(50),
  };
  if (b(p, "showStdev")) plots.stdev = hist;
  return {
    plots,
    colors: {
      z: z.map((v) => (v > 50 ? bull : bear)),
      stdev: hist.map((v, i) => (i > 0 && hist[i - 1] < v ? "#26A69A" : "#B2DFDB")),
    },
    hlines: [{ price: 50, color: "#787B86", dashed: true }],
    fills: [
      // A vertical gradient in Pine, from the line's color at the oscillator to clear at 50.
      { a: "z", b: "mid", color: z.map((v) => (Number.isFinite(v) ? colorNew(v > 50 ? bull : bear, 50) : undefined)) },
      { a: "obUpper", b: "obLower", color: colorNew(bear, 80) },
      { a: "obLower", b: "obMid", color: colorNew(bear, 87) },
      { a: "osUpper", b: "osLower", color: colorNew(bull, 87) },
      { a: "osUpper", b: "osMid", color: colorNew(bull, 93) },
    ],
    markers,
  };
}
