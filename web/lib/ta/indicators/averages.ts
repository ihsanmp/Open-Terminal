import * as ta from "../core";
import { type Anchor, type Bars, type Series } from "../core";
import { C, alpha, b, bool, float, int, n, s, select, src, type IndicatorDef } from "../types";

const offset = int("offset", "Offset", 0, -500, 500);

function simpleMa(id: string, name: string, short: string, len: number, f: (x: Series, len: number, bars: Bars) => Series): IndicatorDef {
  return {
    id, name, short, category: "Moving Averages", overlay: true,
    inputs: [int("length", "Length", len), src(), offset],
    plots: [{ key: "ma", title: short, color: C.blue }],
    compute: (bars, p) => ({
      plots: { ma: f(ta.source(bars, s(p, "source")), n(p, "length"), bars) },
      offsets: { ma: n(p, "offset") },
    }),
  };
}

export const averages: IndicatorDef[] = [
  simpleMa("sma", "Moving Average Simple", "SMA", 9, ta.sma),
  simpleMa("ema", "Moving Average Exponential", "EMA", 9, ta.ema),
  simpleMa("wma", "Moving Average Weighted", "WMA", 9, ta.wma),
  simpleMa("smma", "Smoothed Moving Average", "SMMA", 7, ta.rma),
  simpleMa("hma", "Hull Moving Average", "HMA", 9, ta.hma),
  simpleMa("vwma", "Volume Weighted Moving Average", "VWMA", 20, (x, len, bars) => ta.vwma(x, bars.volume, len)),
  simpleMa("dema", "Double EMA", "DEMA", 9, ta.dema),
  simpleMa("tema", "Triple EMA", "TEMA", 9, ta.tema),
  {
    id: "alma", name: "Arnaud Legoux Moving Average", short: "ALMA", category: "Moving Averages", overlay: true,
    inputs: [int("length", "Window Size", 9), float("offset", "Offset", 0.85, 0.01), float("sigma", "Sigma", 6, 0.1), src()],
    plots: [{ key: "ma", title: "ALMA", color: C.blue }],
    compute: (bars, p) => ({
      plots: { ma: ta.alma(ta.source(bars, s(p, "source")), n(p, "length"), n(p, "offset"), n(p, "sigma")) },
    }),
  },
  {
    id: "lsma", name: "Least Squares Moving Average", short: "LSMA", category: "Moving Averages", overlay: true,
    inputs: [int("length", "Length", 25), int("lroffset", "Offset", 0, -500, 500), src()],
    plots: [{ key: "ma", title: "LSMA", color: C.blue }],
    compute: (bars, p) => ({ plots: { ma: ta.linreg(ta.source(bars, s(p, "source")), n(p, "length"), n(p, "lroffset")) } }),
  },
  {
    id: "kama", name: "Kaufman's Adaptive Moving Average", short: "KAMA", category: "Moving Averages", overlay: true,
    inputs: [int("length", "Length", 14), int("fast", "Fast Length", 2), int("slow", "Slow Length", 30), src()],
    plots: [{ key: "ma", title: "KAMA", color: C.purple }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const mom = ta.map(ta.change(x, len), Math.abs);
      const vol = ta.sum(ta.map(ta.change(x), Math.abs), len);
      const fastA = 2 / (n(p, "fast") + 1);
      const slowA = 2 / (n(p, "slow") + 1);
      const out = ta.fill(bars.length);
      for (let i = 0; i < bars.length; i++) {
        if (ta.isNa(mom[i]) || ta.isNa(vol[i])) continue;
        const er = vol[i] !== 0 ? mom[i] / vol[i] : 0;
        const a = (er * (fastA - slowA) + slowA) ** 2;
        out[i] = a * x[i] + (1 - a) * ta.nz(out[i - 1], x[i]);
      }
      return { plots: { ma: out } };
    },
  },
  {
    id: "mcginley", name: "McGinley Dynamic", short: "McGinley", category: "Moving Averages", overlay: true,
    inputs: [int("length", "Length", 14), src()],
    plots: [{ key: "ma", title: "McGinley Dynamic", color: C.blue }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const e = ta.ema(x, len);
      const out = ta.fill(bars.length);
      for (let i = 0; i < bars.length; i++) {
        const prev = i > 0 ? out[i - 1] : NaN;
        out[i] = ta.isNa(prev) ? e[i] : prev + (x[i] - prev) / (len * Math.pow(x[i] / prev, 4));
      }
      return { plots: { ma: out } };
    },
  },
  {
    id: "maribbon", name: "Moving Average Ribbon", short: "MA Ribbon", category: "Moving Averages", overlay: true,
    inputs: [1, 2, 3, 4].flatMap((k, i) => [
      select(`type${k}`, `MA #${k} Type`, ta.MA_TYPES, "SMA"),
      int(`len${k}`, `MA #${k} Length`, [20, 50, 100, 200][i]),
    ]).concat([src()]),
    plots: [
      { key: "ma1", title: "MA #1", color: "#F6C309" },
      { key: "ma2", title: "MA #2", color: "#FB9800" },
      { key: "ma3", title: "MA #3", color: "#FB6500" },
      { key: "ma4", title: "MA #4", color: "#F60C0C" },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const ma = (k: number) => ta.maByType(s(p, `type${k}`), x, n(p, `len${k}`), bars.volume);
      return { plots: { ma1: ma(1), ma2: ma(2), ma3: ma(3), ma4: ma(4) } };
    },
  },
  {
    id: "macross", name: "MA Cross", short: "MA Cross", category: "Moving Averages", overlay: true,
    inputs: [int("short", "Short", 9), int("long", "Long", 21), select("type", "MA Type", ta.MA_TYPES, "SMA"), src()],
    plots: [
      { key: "short", title: "Short", color: C.orange },
      { key: "long", title: "Long", color: C.blue },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const sh = ta.maByType(s(p, "type"), x, n(p, "short"), bars.volume);
      const lo = ta.maByType(s(p, "type"), x, n(p, "long"), bars.volume);
      const markers = [];
      for (let i = 1; i < bars.length; i++) {
        if (ta.crossover(sh, lo, i)) markers.push({ index: i, position: "belowBar" as const, shape: "circle" as const, color: C.green });
        else if (ta.crossunder(sh, lo, i)) markers.push({ index: i, position: "aboveBar" as const, shape: "circle" as const, color: C.red });
      }
      return { plots: { short: sh, long: lo }, markers };
    },
  },
  {
    id: "median", name: "Median", short: "Median", category: "Moving Averages", overlay: true,
    inputs: [src("hl2"), int("length", "Median Length", 3), int("atrLength", "ATR Length", 14), float("atrMult", "ATR Multiplier", 2)],
    plots: [
      { key: "median", title: "Median", color: "#FF5252" },
      { key: "ema", title: "Median EMA", color: C.purple },
      { key: "upper", title: "Upper Band", color: C.green },
      { key: "lower", title: "Lower Band", color: C.red },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      // ta.percentile_nearest_rank(x, len, 50)
      const median = ta.fill(bars.length);
      for (let i = len - 1; i < bars.length; i++) {
        const w = x.slice(i - len + 1, i + 1).sort((a, c) => a - c);
        median[i] = w[Math.max(0, Math.ceil(len * 0.5) - 1)];
      }
      const band = ta.scale(ta.atr(bars, n(p, "atrLength")), n(p, "atrMult"));
      const e = ta.ema(median, len);
      return {
        plots: { median, ema: e, upper: ta.add(median, band), lower: ta.sub(median, band) },
        fills: [{ a: "median", b: "ema", color: median.map((m, i) => (m > e[i] ? alpha(C.green, 0.25) : alpha(C.purple, 0.25))) }],
      };
    },
  },
  {
    id: "env", name: "Envelope", short: "Env", category: "Bands & Channels", overlay: true,
    inputs: [int("length", "Length", 20), float("percent", "Percent", 10, 0.1, 0), src(), bool("exponential", "Exponential", false)],
    plots: [
      { key: "basis", title: "Basis", color: C.orange },
      { key: "upper", title: "Upper", color: C.blue },
      { key: "lower", title: "Lower", color: C.blue },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const basis = b(p, "exponential") ? ta.ema(x, n(p, "length")) : ta.sma(x, n(p, "length"));
      const k = n(p, "percent") / 100;
      return {
        plots: { basis, upper: ta.scale(basis, 1 + k), lower: ta.scale(basis, 1 - k) },
        fills: [{ a: "upper", b: "lower", color: alpha(C.lightBlue, 0.05) }],
      };
    },
  },
  {
    id: "linregch", name: "Linear Regression Channel", short: "LinReg", category: "Trend", overlay: true,
    inputs: [src(), int("length", "Count", 100, 2), float("upperMult", "Upper Deviation", 2), float("lowerMult", "Lower Deviation", 2)],
    plots: [
      { key: "base", title: "Base", color: "#FF5252" },
      { key: "upper", title: "Upper", color: C.blue },
      { key: "lower", title: "Lower", color: C.blue },
      { key: "r", title: "Pearson's R", color: C.gray, display: "legend" },
    ],
    precision: 2,
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = Math.min(n(p, "length"), bars.length);
      const last = bars.length - 1;
      const base = ta.fill(bars.length);
      const upper = ta.fill(bars.length);
      const lower = ta.fill(bars.length);
      const r = ta.fill(bars.length);
      if (len < 2) return { plots: { base, upper, lower, r } };
      // Port of TradingView's calcSlope/calcDev: x counts 1..len going back in time.
      let sumX = 0, sumY = 0, sumXSqr = 0, sumXY = 0;
      for (let i = 0; i < len; i++) {
        const v = x[last - i];
        const per = i + 1;
        sumX += per; sumY += v; sumXSqr += per * per; sumXY += v * per;
      }
      const slope = (len * sumXY - sumX * sumY) / (len * sumXSqr - sumX * sumX);
      const average = sumY / len;
      const intercept = average - (slope * sumX) / len + slope;
      const periods = len - 1;
      const daY = intercept + (slope * periods) / 2;
      let val = intercept, stdAcc = 0, dsxx = 0, dsyy = 0, dsxy = 0;
      for (let j = 0; j <= periods; j++) {
        const price = x[last - j];
        const dxt = price - average;
        const dyt = val - daY;
        stdAcc += (price - val) ** 2;
        dsxx += dxt * dxt; dsyy += dyt * dyt; dsxy += dxt * dyt;
        val += slope;
      }
      const sd = Math.sqrt(stdAcc / (periods === 0 ? 1 : periods));
      const pearson = dsxx === 0 || dsyy === 0 ? 0 : dsxy / Math.sqrt(dsxx * dsyy);
      for (let k = 0; k < len; k++) {
        const v = intercept + slope * k;
        base[last - k] = v;
        upper[last - k] = v + n(p, "upperMult") * sd;
        lower[last - k] = v - n(p, "lowerMult") * sd;
      }
      r[last] = pearson;
      return {
        plots: { base, upper, lower, r },
        fills: [
          { a: "base", b: "upper", color: alpha(C.blue, 0.1) },
          { a: "base", b: "lower", color: alpha(C.red, 0.1) },
        ],
      };
    },
  },
  {
    id: "alligator", name: "Williams Alligator", short: "Alligator", category: "Trend", overlay: true,
    inputs: [
      int("jawLength", "Jaw Length", 13), int("teethLength", "Teeth Length", 8), int("lipsLength", "Lips Length", 5),
      int("jawOffset", "Jaw Offset", 8, -500), int("teethOffset", "Teeth Offset", 5, -500), int("lipsOffset", "Lips Offset", 3, -500),
    ],
    plots: [
      { key: "jaw", title: "Jaw", color: C.blue },
      { key: "teeth", title: "Teeth", color: C.pink },
      { key: "lips", title: "Lips", color: "#66BB6A" },
    ],
    compute: (bars, p) => {
      const hl2 = ta.source(bars, "hl2");
      return {
        plots: { jaw: ta.rma(hl2, n(p, "jawLength")), teeth: ta.rma(hl2, n(p, "teethLength")), lips: ta.rma(hl2, n(p, "lipsLength")) },
        offsets: { jaw: n(p, "jawOffset"), teeth: n(p, "teethOffset"), lips: n(p, "lipsOffset") },
      };
    },
  },
  {
    id: "vwap", name: "Volume Weighted Average Price", short: "VWAP", category: "Moving Averages", overlay: true,
    inputs: [
      select("anchor", "Anchor Period", ["Session", "Week", "Month", "Quarter", "Year", "Decade"], "Session"),
      src("hlc3"),
      bool("band1", "Bands Multiplier #1", true), float("mult1", "Multiplier #1", 1),
      bool("band2", "Bands Multiplier #2", false), float("mult2", "Multiplier #2", 2),
      bool("band3", "Bands Multiplier #3", false), float("mult3", "Multiplier #3", 3),
    ],
    plots: [
      { key: "vwap", title: "VWAP", color: C.blue },
      { key: "u1", title: "Upper Band #1", color: C.green },
      { key: "l1", title: "Lower Band #1", color: C.green },
      { key: "u2", title: "Upper Band #2", color: "#808000" },
      { key: "l2", title: "Lower Band #2", color: "#808000" },
      { key: "u3", title: "Upper Band #3", color: "#00897B" },
      { key: "l3", title: "Lower Band #3", color: "#00897B" },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const keys = ta.periodKeys(bars.time, s(p, "anchor") as Anchor);
      const len = bars.length;
      const vwap = ta.fill(len);
      const sd = ta.fill(len);
      let sv = 0, v = 0, ssv = 0;
      for (let i = 0; i < len; i++) {
        if (i === 0 || keys[i] !== keys[i - 1]) { sv = 0; v = 0; ssv = 0; }
        sv += x[i] * bars.volume[i];
        ssv += x[i] * x[i] * bars.volume[i];
        v += bars.volume[i];
        if (v > 0) {
          vwap[i] = sv / v;
          sd[i] = Math.sqrt(Math.max(ssv / v - vwap[i] ** 2, 0));
        }
      }
      const plots: Record<string, Series> = { vwap };
      const fills = [];
      const fillColors = [C.green, "#808000", "#00897B"];
      for (const k of [1, 2, 3]) {
        if (!b(p, `band${k}`)) continue;
        const m = n(p, `mult${k}`);
        plots[`u${k}`] = ta.zip(vwap, sd, (w, d) => w + d * m);
        plots[`l${k}`] = ta.zip(vwap, sd, (w, d) => w - d * m);
        fills.push({ a: `u${k}`, b: `l${k}`, color: alpha(fillColors[k - 1], 0.05) });
      }
      return { plots, fills };
    },
  },
  {
    id: "twap", name: "Time Weighted Average Price", short: "TWAP", category: "Moving Averages", overlay: true,
    inputs: [select("anchor", "Anchor Period", ["Session", "Week", "Month", "Quarter", "Year"], "Session"), src("ohlc4"), offset],
    plots: [{ key: "twap", title: "TWAP", color: C.orange }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const keys = ta.periodKeys(bars.time, s(p, "anchor") as Anchor);
      const out = ta.fill(bars.length);
      let sum = 0, count = 0;
      for (let i = 0; i < bars.length; i++) {
        if (i === 0 || keys[i] !== keys[i - 1]) { sum = 0; count = 0; }
        sum += x[i];
        count++;
        out[i] = sum / count;
      }
      return { plots: { twap: out }, offsets: { twap: n(p, "offset") } };
    },
  },
];
