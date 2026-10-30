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
// - Caspers Mastermind Supertrend v2           (© Caspers_Mastermind, MPL-2.0, Pine v6)
// - Cosine-Weighted MA ATR                     (© InvestorUnknown, MPL-2.0, Pine v6)
// - DEMA Flow [Alpha Extract]                  (© AlphaExtract, MPL-2.0, Pine v6)

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
  select,
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
  // A flat range or bars without volume have no profile to draw.
  if (!(top > bot) || !(maxvol > 0)) return { plots: {} };
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

// =====================================================================================
// Caspers Mastermind Supertrend v2 (© Caspers_Mastermind)
// =====================================================================================

// Pine v6's color.green and color.red.
const V6_GREEN = "#4CAF50";
const V6_RED = "#F23645";

community2.push({
  id: "caspers-mastermind-supertrend",
  name: "Caspers Mastermind Supertrend v2",
  short: "Caspers ST",
  category: "Community",
  overlay: true,
  aliases: ["Caspers Mastermind", "Mastermind Supertrend", "Median Supertrend"],
  legendInputs: ["lengthPeriod", "factor", "medianLength"],
  inputs: [
    int("lengthPeriod", "Mastermind Period", 5, 2),
    float("factor", "Multiplier", 2.1, 0.05),
    int("medianLength", "Median Length", 9),
    // The script's long and short alerts, shown on the chart (this app has no alerts).
    bool("showSignals", "Show Long/Short signals", false),
  ],
  plots: [{ key: "trend", title: "Caspers Mastermind Trend", color: V6_GREEN, width: 2 }],
  compute: (bars, p) => caspersSupertrend(bars, p),
});

/**
 * A Supertrend around the median close of the last `medianLength` bars (ta.percentile_nearest_rank
 * at 50) instead of hl2, with an ATR of `lengthPeriod`: green on the lower band in an uptrend, red
 * on the upper one in a downtrend.
 */
export function caspersSupertrend(bars: Bars, p: Params): IndicatorResult {
  const median = ta.percentileNearestRank(bars.close, n(p, "medianLength"), 50);
  const { value, direction } = ta.supertrend(bars, n(p, "factor"), n(p, "lengthPeriod"), median);
  const markers: Marker[] = [];
  if (b(p, "showSignals")) {
    // The script names its alerts the other way round ("Long" fires as the line turns red); these
    // follow the line's color: Long as it turns green (direction -1), Short as it turns red.
    for (let i = 1; i < bars.length; i++) {
      const [was, now] = [direction[i - 1], direction[i]];
      if (!Number.isFinite(value[i]) || !Number.isFinite(was) || was === now) continue;
      if (now < 0) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: V6_GREEN, text: "Long" });
      else markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: V6_RED, text: "Short" });
    }
  }
  return { plots: { trend: value }, colors: { trend: direction.map((d) => (d === 1 ? V6_RED : V6_GREEN)) }, markers };
}

// Cosine-Weighted MA ATR [InvestorUnknown] — © InvestorUnknown, MPL-2.0, Pine v6. A moving
// average whose weights follow a shifted cosine (cos(π·(i+1)/len) + 1 for the bar i back,
// normalized): the latest bars weigh the most, the oldest nothing. Bands at ± ATR × multiplier
// (Wilder's ATR, or the same cosine weighting over true ranges); the source crossing above the
// upper band turns it long, the short source crossing below the lower one short. The script's
// Overlay mode: the line and bars colored by side, the band on the other side drawn as circles
// with a fill to the line. (Its Backtest mode and custom-timeframe options aren't ported.)
const CW_SOURCES = ["open", "high", "low", "close", "oc2", "hl2", "occ3", "hlc3", "ohlc4", "hlcc4"] as const;
const CW_LONG = "#24D013"; // color.rgb(54, 208, 19)
const CW_SHORT = "#E32222"; // color.rgb(227, 34, 34)

/** The script's bar.calc_src(), with its oc2 and occ3 besides Pine's own sources. */
function cwSource(bars: Bars, key: string): Series {
  if (key === "oc2") return bars.close.map((c, i) => (bars.open[i] + c) / 2);
  if (key === "occ3") return bars.close.map((c, i) => (bars.open[i] + c + c) / 3);
  return ta.source(bars, key);
}

/** f_Cosine_Weighted_MA / f_Cosine_Weighted_ATR: the cosine-weighted sum of the last `len` values. */
export function cosineWeighted(x: Series, len: number): Series {
  const raw = Array.from({ length: len }, (_, i) => Math.cos((Math.PI * (i + 1)) / len) + 1);
  const total = raw.reduce((a, w) => a + w, 0);
  const weights = raw.map((w) => w / total);
  return x.map((_, bar) => {
    // The script returns 0 before `len` bars; nothing is drawn there instead.
    if (bar < len) return NaN;
    let sum = 0;
    for (let i = 0; i < len; i++) sum += weights[i] * x[bar - i];
    return sum;
  });
}

community2.push({
  id: "cosine-weighted-ma-atr",
  name: "Cosine-Weighted MA ATR [InvestorUnknown]",
  short: "Cosine-Weighted MA ATR",
  category: "Community",
  overlay: true,
  description: "Cosine-weighted moving average with ATR bands: long when the source closes above the upper band, short below the lower one.",
  aliases: ["CWMA", "Cosine Weighted Moving Average", "InvestorUnknown"],
  inputs: [
    bool("intraday", "Allow Intra-day Updating", true),
    bool("plotSrc", "Plot Calculation Source", false),
    bool("colorBars", "Color Bars?", true),
    int("maLength", "CWMA Length", 14),
    select("cwmaSrc", "Source", CW_SOURCES, "close"),
    bool("plotCwma", "Plot CWMA?", true),
    select("atrType", "ATR Type", ["Normal ATR", "Sine-Weighted ATR"], "Normal ATR"),
    int("atrLen", "ATR Length", 14),
    float("atrMult", "ATR Multiplier", 1.2, 0.1),
    bool("plotCircles", "Plot ATR Circles", true),
    select("srcLong", "Source for Long Signal", CW_SOURCES, "close"),
    select("srcShort", "Source for Short Signal", CW_SOURCES, "close"),
  ],
  plots: [
    { key: "src", title: "Calculation Source (Price)", color: "rgba(255,235,59,0.7)", width: 2 },
    { key: "cwma", title: "Cosine-Weighted Moving Average", color: CW_SHORT, width: 2 },
    { key: "band", title: "ATR Band", color: CW_SHORT, style: "circles", width: 3 },
    { key: "cwmaFill", title: "CWMA (fill)", color: CW_SHORT, display: "none" },
    { key: "bandFill", title: "ATR Band (fill)", color: CW_SHORT, display: "none" },
  ],
  compute: (bars, p) => cosineWeightedMaAtr(bars, p),
});

export function cosineWeightedMaAtr(bars: Bars, p: Params): IndicatorResult {
  const len = bars.close.length;
  const source = cwSource(bars, s(p, "cwmaSrc"));
  const cwma = cosineWeighted(source, n(p, "maLength"));
  const atrLen = n(p, "atrLen");
  const atr = s(p, "atrType") === "Normal ATR" ? ta.atr(bars, atrLen) : cosineWeighted(ta.tr(bars, true), atrLen);
  const mult = n(p, "atrMult");
  const up = cwma.map((m, i) => m + atr[i] * mult);
  const dn = cwma.map((m, i) => m - atr[i] * mult);
  const srcL = cwSource(bars, s(p, "srcLong"));
  const srcS = cwSource(bars, s(p, "srcShort"));

  // `var int signal`: 1 after a cross above the upper band, -1 after one below the lower band.
  const signal = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    let sig = i > 0 ? signal[i - 1] : 0;
    if (ta.crossover(srcL, up, i)) sig = 1;
    if (ta.crossunder(srcS, dn, i)) sig = -1;
    signal[i] = sig;
  }
  const side = signal.map((sg) => (sg > 0 ? CW_LONG : CW_SHORT));
  // The circles: the band on the other side of the line (below it while long).
  const band = cwma.map((_, i) => (signal[i] > 0 ? dn[i] : up[i]));

  // "Allow Intra-day Updating" off: everything a bar late, as confirmed at the close.
  const intraday = b(p, "intraday");
  const lag = (x: Series): Series => (intraday ? x : x.map((_, i) => (i > 0 ? x[i - 1] : NaN)));
  const cwmaShown = lag(cwma);
  const bandShown = lag(band);

  // The fill between the circles and the line: red above it (short), green below (long), fading
  // toward the line as the script's gradient does.
  const fillColor: Color[] = cwma.map((_, i) => (bandShown[i] > cwmaShown[i] ? colorNew(CW_SHORT, 80) : colorNew(CW_LONG, 80)));

  // Plots switched off are left out, as Pine's na plots.
  return {
    plots: {
      ...(b(p, "plotSrc") ? { src: lag(source) } : {}),
      ...(b(p, "plotCwma") ? { cwma: cwmaShown } : {}),
      ...(b(p, "plotCircles") ? { band: bandShown } : {}),
      cwmaFill: cwmaShown,
      bandFill: bandShown,
    },
    colors: { cwma: side, band: side },
    fills: b(p, "plotCircles") ? [{ a: "bandFill", b: "cwmaFill", color: fillColor }] : [],
    barColors: b(p, "colorBars") ? (intraday ? side : side.map((_, i) => (i > 0 ? side[i - 1] : CW_SHORT))) : undefined,
  };
}

// Cameron Fous's (iknkfx.com) "Stochastics Momentum Index", short title "Krypton Fear & Greed":
// the SMI (close against the middle of the range's high and low, double-smoothed, as a share of
// half the range) shown as its b-period EMA and its 4-period EMA, with the part above +50 and below
// -50 filled. As in the script, the levels and the clipped lines are drawn as plots too, and the
// fills keep its titles (the upper one "OverSold", the lower "OverBought").
export function kryptonFearGreed(bars: Bars, p: Params): IndicatorResult {
  const a = Math.max(1, n(p, "lengthK"));
  const d = Math.max(1, n(p, "lengthD"));
  const ob = n(p, "overbought");
  const os = n(p, "oversold");
  const hh = ta.highest(bars.high, a);
  const ll = ta.lowest(bars.low, a);
  const diff = ta.sub(hh, ll);
  const rdiff = bars.close.map((c, i) => c - (hh[i] + ll[i]) / 2);
  const avgrel = ta.ema(ta.ema(rdiff, d), d);
  const avgdiff = ta.ema(ta.ema(diff, d), d);
  const smi = avgrel.map((r, i) => (avgdiff[i] !== 0 ? (r / (avgdiff[i] / 2)) * 100 : 0));
  const signal = ta.ema(smi, d);
  const ema4 = ta.ema(smi, 4);
  const upper = signal.map(() => ob);
  const lower = signal.map(() => os);
  const upperClip = signal.map((v) => (v > ob ? v : ob));
  const lowerClip = signal.map((v) => (v < os ? v : os));
  return {
    plots: { smi: signal, ema: ema4, upper, upperClip, lower, lowerClip },
    fills: [
      { a: "upper", b: "upperClip", color: colorNew("#FFB4D7", 50) },
      { a: "lower", b: "lowerClip", color: colorNew("#69FDBC", 50) },
    ],
  };
}

community2.push({
  id: "krypton-fear-greed",
  name: "Stochastics Momentum Index (Krypton Fear & Greed)",
  short: "Krypton Fear & Greed",
  category: "Community",
  overlay: false,
  aliases: ["Krypton Fear & Greed", "Krypton", "Fear & Greed", "Cameron Fous", "iknkfx", "SMI"],
  description: "Cameron Fous (iknkfx.com): SMI dengan sinyal EMA; area di atas +50 dan di bawah -50 diwarnai.",
  inputs: [int("lengthK", "Percent K Length", 10), int("lengthD", "Percent D Length", 3), int("overbought", "Overbought", 50, -100, 100), int("oversold", "Oversold", -50, -100, 100)],
  plots: [
    { key: "smi", title: "Stochastic", color: "#33FFC1" },
    { key: "ema", title: "EMA", color: "#FF5252" },
    { key: "upper", title: "Level +50", color: "#2962FF" },
    { key: "upperClip", title: "Stochastic di atas +50", color: "#2962FF" },
    { key: "lower", title: "Level -50", color: "#2962FF" },
    { key: "lowerClip", title: "Stochastic di bawah -50", color: "#2962FF" },
  ],
  compute: (bars, p) => kryptonFearGreed(bars, p),
});

// =====================================================================================
// Deadband Hysteresis Filter (BackQuant), MPL-2.0
// =====================================================================================

/**
 * A baseline that moves only when price leaves a band around it (the deadband): by `response`
 * times how far past the band price is. The band is ATR × mult, a percent of price, ticks or
 * points, times Enter Mult. Its slope colors the line and the candles. As in the script, Exit
 * Mult is computed but never read: between the bands the baseline holds, as inside them.
 */
export function deadbandHysteresis(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const x = ta.source(bars, s(p, "source"));
  const mode = s(p, "thrMode");
  const atr = mode === "ATR" ? ta.atr(bars, Math.max(1, n(p, "atrLen"))) : null;
  const mintick = mode === "Ticks" ? inferMintick(bars) : 0;
  const em = Math.max(n(p, "enterMult"), 0.0001);
  const response = n(p, "response");
  const long = s(p, "longColor");
  const short = s(p, "shortColor");
  const dbhf = ta.fill(len);
  const line: Color[] = new Array(len).fill(undefined);
  const candles: Color[] = new Array(len).fill(undefined);
  let level = NaN;
  let trend = 0;
  let colour = "#FFFFFF";
  for (let i = 0; i < len; i++) {
    const v = x[i];
    if (Number.isNaN(level)) level = v;
    const base =
      mode === "ATR"
        ? ta.nz(atr![i] * n(p, "atrMult"))
        : mode === "Percent"
          ? ta.nz(Math.abs(v) * n(p, "pctThresh") * 0.01)
          : mode === "Ticks"
            ? mintick * n(p, "tickThresh")
            : n(p, "ptsThresh");
    const tauEnter = base * em;
    const diff = v - level;
    if (diff > tauEnter) level += response * (diff - tauEnter);
    else if (diff < -tauEnter) level += response * (diff + tauEnter);
    dbhf[i] = level;
    if (i > 0 && level > dbhf[i - 1]) trend = 1;
    if (i > 0 && level < dbhf[i - 1]) trend = -1;
    if (trend === 1) colour = long;
    if (trend === -1) colour = short;
    line[i] = colorNew(colour, 40);
    candles[i] = colour;
  }
  return {
    plots: { dbhf: b(p, "showFilter") ? dbhf : ta.fill(len) },
    colors: { dbhf: line },
    barColors: b(p, "paintCandles") ? candles : undefined,
  };
}

community2.push({
  id: "deadband-hysteresis-filter",
  name: "Deadband Hysteresis Filter [BackQuant]",
  short: "DBHF",
  category: "Community",
  overlay: true,
  aliases: ["Deadband Hysteresis Filter", "Deadband", "Hysteresis", "DBHF", "BackQuant"],
  description: "BackQuant: garis dasar yang hanya bergerak saat harga keluar dari pita mati (ATR, persen, tick, atau poin); kemiringannya mewarnai garis dan candle.",
  inputs: [
    src("close", "source", "Price Source"),
    select("thrMode", "Threshold Mode", ["ATR", "Percent", "Ticks", "Points"], "ATR"),
    int("atrLen", "ATR Length", 14),
    float("atrMult", "ATR Mult", 1.0, 0.1),
    float("pctThresh", "Percent Threshold", 0.5, 0.1),
    int("tickThresh", "Tick Threshold", 10),
    float("ptsThresh", "Points Threshold", 5.0, 0.1),
    float("enterMult", "Enter Mult", 1.0, 0.1, 0.1),
    float("exitMult", "Exit Mult", 0.5, 0.05, 0.05),
    float("response", "Response", 0.2, 0.01, 0.01, 1),
    bool("showFilter", "Show Filtered Price on chart", true),
    bool("paintCandles", "Paint candles according to Trend", true),
    colorInput("longColor", "Long Color", "#33ff00"),
    colorInput("shortColor", "Short Color", "#ff0000"),
  ],
  plots: [{ key: "dbhf", title: "DBHF", color: "#33ff00", width: 4 }],
  compute: (bars, p) => deadbandHysteresis(bars, p),
});

// DEMA Flow [Alpha Extract] — © AlphaExtract, MPL-2.0, Pine v6
// (tradingview.com/script/En4W9675-DEMA-Flow-Alpha-Extract). The DEMA of the close (2·EMA −
// EMA of the EMA), smoothed by the median of its last few values; ATR bands around it, wider above
// (2.1 ATR) than below (1.5). A close above the upper band turns the flow bullish, one below the
// lower band bearish, and it stays so until the other band is crossed; the line and the candles take
// its color (gray before the first break). The script's "Show ATR Bands" and "Show Trend Labels"
// inputs draw nothing there; here they draw the bands and the turns, off by default so the chart
// looks as it does on TradingView.
const DF_BULL = "#00ff88";
const DF_BEAR = "#ff0066";
const DF_NEUTRAL = colorNew("#888888", 50);

community2.push({
  id: "dema-flow-alpha-extract",
  name: "DEMA Flow [Alpha Extract]",
  short: "DEMA Flow",
  category: "Community",
  overlay: true,
  description: "Alpha Extract: DEMA yang dihaluskan median, dengan pita ATR asimetris (2,1 di atas, 1,5 di bawah). Close menembus pita atas = flow bullish, menembus pita bawah = bearish, bertahan sampai pita seberang ditembus; garis dan candle ikut berwarna.",
  aliases: ["DEMA Flow", "Alpha Extract", "AlphaExtract", "DEMA Trend"],
  legendInputs: ["demaLength", "hlFilterLength"],
  inputs: [
    int("demaLength", "DEMA Length", 23, 5, 100),
    int("hlFilterLength", "HL Median Filter Length", 4, 3, 15),
    int("atrLength", "ATR Length", 14, 5, 50),
    float("upperAtrMult", "Upper ATR Multiplier", 2.1, 0.1, 0.5, 5),
    float("lowerAtrMult", "Lower ATR Multiplier", 1.5, 0.1, 0.5, 5),
    bool("showBands", "Show ATR Bands", false),
    bool("showLabels", "Show Trend Labels", false),
    bool("colorCandles", "Color candles by trend", true),
  ],
  plots: [
    { key: "trend", title: "Smooth DEMA Trend", color: DF_BULL, width: 2 },
    { key: "upper", title: "Upper ATR Band", color: colorNew(DF_BEAR, 60), width: 1 },
    { key: "lower", title: "Lower ATR Band", color: colorNew(DF_BULL, 60), width: 1 },
  ],
  compute: (bars, p) => demaFlow(bars, p),
});

/** hlMedian(): the median of the last `len` values, from the bar it has them all (na before, or with an na among them). */
export function rollingMedian(x: Series, len: number): Series {
  return x.map((_, i) => {
    if (i < len - 1) return NaN;
    const w = x.slice(i - len + 1, i + 1);
    if (w.some((v) => !Number.isFinite(v))) return NaN;
    w.sort((a, b) => a - b);
    return len % 2 === 1 ? w[(len - 1) / 2] : (w[len / 2 - 1] + w[len / 2]) / 2;
  });
}

export function demaFlow(bars: Bars, p: Params): IndicatorResult {
  const smooth = rollingMedian(ta.dema(bars.close, n(p, "demaLength")), n(p, "hlFilterLength"));
  const atr = ta.atr(bars, n(p, "atrLength"));
  const upper = smooth.map((m, i) => m + n(p, "upperAtrMult") * atr[i]);
  const lower = smooth.map((m, i) => m - n(p, "lowerAtrMult") * atr[i]);
  // `var trendSignal`: 1 after a close above the upper band, -1 after one below the lower band.
  const trend = new Array<number>(bars.close.length).fill(0);
  const markers: Marker[] = [];
  for (let i = 0; i < bars.close.length; i++) {
    let t = i > 0 ? trend[i - 1] : 0;
    if (bars.close[i] > upper[i]) t = 1;
    if (bars.close[i] < lower[i]) t = -1;
    trend[i] = t;
    // The script's alerts (ta.crossover / crossunder of the state through 0), as markers.
    if (b(p, "showLabels") && i > 0 && t !== trend[i - 1]) {
      if (t === 1) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: DF_BULL, text: "Bullish" });
      else if (t === -1) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: DF_BEAR, text: "Bearish" });
    }
  }
  const color = trend.map((t) => (t === 1 ? DF_BULL : t === -1 ? DF_BEAR : DF_NEUTRAL));
  return {
    plots: { trend: smooth, ...(b(p, "showBands") ? { upper, lower } : {}) },
    colors: { trend: color },
    barColors: b(p, "colorCandles") ? color : undefined,
    markers,
  };
}
