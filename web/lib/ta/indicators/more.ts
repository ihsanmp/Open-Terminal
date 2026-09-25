// The rest of TradingView's built-in indicators that can be computed from the chart's own
// bars (plus, for Correlation Coefficient, one other symbol): the classic studies still in
// TradingView's list (Accumulative Swing Index, EMA Cross, Guppy, the Moving Average
// Double/Triple/Multiple/Channel/Hamming family, Standard Error Bands, the Volatility
// estimators…) and newer ones (Technical Ratings, Auto Fib Retracement, Gaps, Trading
// Sessions, Moon Phases, Rolling VWAP, Relative Volume at Time).

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { colorNew, timeParts } from "../pine";
import { historyQuery } from "../../chart-context";
import { C, alpha, b, bool, float, int, n, s, select, src, text, type Box, type IndicatorDef, type Label, type Line, type Marker } from "../types";

const zero = { price: 0, color: C.gray, dashed: true };
const offsetInput = int("offset", "Offset", 0, -500, 500);

/** Crosses of two series, as plot(ta.cross(a, b) ? a : na, style=cross). */
function crossPoints(a: Series, bSeries: Series): Series {
  return a.map((v, i) => (i > 0 && ((v > bSeries[i] && a[i - 1] <= bSeries[i - 1]) || (v < bSeries[i] && a[i - 1] >= bSeries[i - 1])) ? v : NaN));
}

const MA_METHODS = ["Simple", "Exponential", "Weighted"] as const;
const maMethod = (method: string, x: Series, len: number) => (method === "Exponential" ? ta.ema(x, len) : method === "Weighted" ? ta.wma(x, len) : ta.sma(x, len));

/** Hamming-window weighted average. */
function hammingMa(x: Series, len: number): Series {
  const w = Array.from({ length: len }, (_, k) => (len === 1 ? 1 : 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (len - 1))));
  const norm = w.reduce((a, v) => a + v, 0);
  return x.map((_, i) => {
    if (i < len - 1) return NaN;
    let sum = 0;
    for (let k = 0; k < len; k++) {
      const v = x[i - len + 1 + k];
      if (Number.isNaN(v)) return NaN;
      sum += v * w[k];
    }
    return sum / norm;
  });
}

/** Standard error of the least-squares line over each window. */
function standardError(x: Series, len: number): Series {
  return x.map((_, i) => {
    if (i < len - 1 || len < 3) return NaN;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let k = 0; k < len; k++) {
      const y = x[i - len + 1 + k];
      if (Number.isNaN(y)) return NaN;
      sx += k; sy += y; sxx += k * k; sxy += k * y;
    }
    const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
    const icpt = (sy - slope * sx) / len;
    let sse = 0;
    for (let k = 0; k < len; k++) sse += (x[i - len + 1 + k] - (icpt + slope * k)) ** 2;
    return Math.sqrt(sse / (len - 2));
  });
}

const logReturns = (close: Series) => close.map((c, i) => (i > 0 && c > 0 && close[i - 1] > 0 ? Math.log(c / close[i - 1]) : NaN));

export const more: IndicatorDef[] = [
  // ---- classic studies ------------------------------------------------------------
  {
    id: "asi", name: "Accumulative Swing Index", short: "ASI", category: "Trend", overlay: false,
    description: "Wilder's swing index accumulated bar by bar.",
    inputs: [float("limitMove", "Limit Move Value", 10000, 1, 0.1)],
    plots: [{ key: "asi", title: "ASI", color: C.blue }],
    compute: (bars, p) => {
      const T = n(p, "limitMove");
      const { open, high, low, close } = bars;
      const si = close.map((c, i) => {
        if (i === 0) return NaN;
        const cy = close[i - 1], oy = open[i - 1];
        const tr1 = Math.abs(high[i] - cy), tr2 = Math.abs(low[i] - cy), tr3 = high[i] - low[i];
        const r = tr1 >= tr2 && tr1 >= tr3 ? tr1 - 0.5 * tr2 + 0.25 * Math.abs(cy - oy)
          : tr2 >= tr1 && tr2 >= tr3 ? tr2 - 0.5 * tr1 + 0.25 * Math.abs(cy - oy)
          : tr3 + 0.25 * Math.abs(cy - oy);
        const k = Math.max(tr1, tr2);
        return r === 0 ? 0 : ((50 * (c - cy + 0.5 * (c - open[i]) + 0.25 * (cy - oy))) / r) * (k / T);
      });
      return { plots: { asi: ta.cum(si) }, hlines: [zero] };
    },
  },
  {
    id: "emacross", name: "EMA Cross", short: "EMA Cross", category: "Moving Averages", overlay: true,
    inputs: [int("shortLen", "Short EMA Length", 9), int("longLen", "Long EMA Length", 26)],
    plots: [
      { key: "short", title: "Short", color: "#FF6D00" },
      { key: "long", title: "Long", color: "#43A047" },
      { key: "cross", title: "Cross", color: C.blue, style: "circles", width: 4 },
    ],
    compute: (bars, p) => {
      const short = ta.ema(bars.close, n(p, "shortLen"));
      const long = ta.ema(bars.close, n(p, "longLen"));
      return { plots: { short, long, cross: crossPoints(short, long) } };
    },
  },
  {
    id: "maemacross", name: "MA with EMA Cross", short: "MA/EMA Cross", category: "Moving Averages", overlay: true,
    inputs: [int("lenMA", "Length MA", 10), int("lenEMA", "Length EMA", 10)],
    plots: [
      { key: "ma", title: "MA", color: C.blue },
      { key: "ema", title: "EMA", color: C.orange },
      { key: "cross", title: "Crossing", color: "#43A047", style: "circles", width: 4 },
    ],
    compute: (bars, p) => {
      const ma = ta.sma(bars.close, n(p, "lenMA"));
      const ema = ta.ema(bars.close, n(p, "lenEMA"));
      return { plots: { ma, ema, cross: crossPoints(ma, ema) } };
    },
  },
  {
    id: "gmma", name: "Guppy Multiple Moving Average", short: "GMMA", category: "Moving Averages", overlay: true,
    aliases: ["Guppy"],
    inputs: [src()],
    plots: [
      ...[3, 5, 8, 10, 12, 15].map((len, k) => ({ key: `s${len}`, title: `Short ${len}`, color: colorNew("#00BCD4", k * 8) })),
      ...[30, 35, 40, 45, 50, 60].map((len, k) => ({ key: `l${len}`, title: `Long ${len}`, color: colorNew("#F23645", k * 8) })),
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const plots: Record<string, Series> = {};
      for (const len of [3, 5, 8, 10, 12, 15]) plots[`s${len}`] = ta.ema(x, len);
      for (const len of [30, 35, 40, 45, 50, 60]) plots[`l${len}`] = ta.ema(x, len);
      return { plots };
    },
  },
  {
    id: "linregslope", name: "Linear Regression Slope", short: "LRS", category: "Trend", overlay: false,
    inputs: [int("length", "Length", 14, 2), src()],
    plots: [{ key: "slope", title: "Slope", color: C.blue }],
    precision: 4,
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const now = ta.linreg(x, len, 0);
      const prev = ta.linreg(x, len, 1);
      return { plots: { slope: now.map((v, i) => v - prev[i]) }, hlines: [zero] };
    },
  },
  {
    id: "majority", name: "Majority Rule", short: "MR", category: "Momentum", overlay: false,
    description: "Share of bars in the window that closed higher than the bar before.",
    inputs: [int("length", "Rolling Period", 14)],
    plots: [{ key: "mr", title: "MR", color: C.blue }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const up = bars.close.map((c, i) => (i === 0 ? NaN : c > bars.close[i - 1] ? 1 : 0));
      return { plots: { mr: ta.sum(up, len).map((v) => (100 * v) / len) }, hlines: [{ price: 50, color: C.gray, dashed: true }] };
    },
  },
  {
    id: "machannel", name: "Moving Average Channel", short: "MAC", category: "Bands & Channels", overlay: true,
    inputs: [int("upperLen", "Upper Length", 20), int("lowerLen", "Lower Length", 20), int("upperOffset", "Upper Offset", 0, -500, 500), int("lowerOffset", "Lower Offset", 0, -500, 500)],
    plots: [
      { key: "upper", title: "Upper", color: C.blue },
      { key: "lower", title: "Lower", color: C.blue },
    ],
    compute: (bars, p) => ({
      plots: { upper: ta.sma(bars.high, n(p, "upperLen")), lower: ta.sma(bars.low, n(p, "lowerLen")) },
      offsets: { upper: n(p, "upperOffset"), lower: n(p, "lowerOffset") },
      fills: [{ a: "upper", b: "lower", color: alpha(C.blue, 0.1) }],
    }),
  },
  {
    id: "madouble", name: "Moving Average Double", short: "MA Double", category: "Moving Averages", overlay: true,
    inputs: [int("len1", "1st Period", 9), int("len2", "2nd Period", 26), select("method", "Method", MA_METHODS, "Simple"), src()],
    plots: [
      { key: "ma1", title: "MA 1", color: C.red },
      { key: "ma2", title: "MA 2", color: C.blue },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      return { plots: { ma1: maMethod(s(p, "method"), x, n(p, "len1")), ma2: maMethod(s(p, "method"), x, n(p, "len2")) } };
    },
  },
  {
    id: "matriple", name: "Moving Average Triple", short: "MA Triple", category: "Moving Averages", overlay: true,
    inputs: [int("len1", "1st Period", 9), int("len2", "2nd Period", 26), int("len3", "3rd Period", 52), select("method", "Method", MA_METHODS, "Simple"), src()],
    plots: [
      { key: "ma1", title: "MA 1", color: C.red },
      { key: "ma2", title: "MA 2", color: C.blue },
      { key: "ma3", title: "MA 3", color: C.green },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const m = s(p, "method");
      return { plots: { ma1: maMethod(m, x, n(p, "len1")), ma2: maMethod(m, x, n(p, "len2")), ma3: maMethod(m, x, n(p, "len3")) } };
    },
  },
  {
    id: "mamultiple", name: "Moving Average Multiple", short: "MA Multiple", category: "Moving Averages", overlay: true,
    inputs: [
      int("len1", "Period 1", 9), int("len2", "Period 2", 21), int("len3", "Period 3", 50),
      int("len4", "Period 4", 100), int("len5", "Period 5", 150), int("len6", "Period 6", 200),
      select("method", "Method", MA_METHODS, "Simple"), src(),
    ],
    plots: [C.red, C.orange, C.yellow, C.green, C.blue, C.purple].map((color, k) => ({ key: `ma${k + 1}`, title: `MA ${k + 1}`, color })),
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const plots: Record<string, Series> = {};
      for (let k = 1; k <= 6; k++) plots[`ma${k}`] = maMethod(s(p, "method"), x, n(p, `len${k}`));
      return { plots };
    },
  },
  {
    id: "hamming", name: "Moving Average Hamming", short: "HMA (Hamming)", category: "Moving Averages", overlay: true,
    inputs: [int("length", "Length", 10), src(), offsetInput],
    plots: [{ key: "ma", title: "Hamming MA", color: C.blue }],
    compute: (bars, p) => ({ plots: { ma: hammingMa(ta.source(bars, s(p, "source")), n(p, "length")) }, offsets: { ma: n(p, "offset") } }),
  },
  {
    id: "pricechannel", name: "Price Channel", short: "PC", category: "Bands & Channels", overlay: true,
    inputs: [int("length", "Length", 20), offsetInput],
    plots: [
      { key: "hh", title: "Highest", color: "#F50057" },
      { key: "ll", title: "Lowest", color: "#F50057" },
      { key: "mid", title: "Center", color: C.blue },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      const hh = ta.highest(bars.high, len);
      const ll = ta.lowest(bars.low, len);
      const off = n(p, "offset");
      return { plots: { hh, ll, mid: hh.map((h, i) => (h + ll[i]) / 2) }, offsets: { hh: off, ll: off, mid: off } };
    },
  },
  {
    id: "stdev", name: "Standard Deviation", short: "StDev", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 20), src()],
    plots: [{ key: "sd", title: "StDev", color: C.blue }],
    compute: (bars, p) => ({ plots: { sd: ta.stdev(ta.source(bars, s(p, "source")), n(p, "length")) } }),
  },
  {
    id: "stderr", name: "Standard Error", short: "StdErr", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 21, 3), src()],
    plots: [{ key: "se", title: "Standard Error", color: C.blue }],
    compute: (bars, p) => ({ plots: { se: standardError(ta.source(bars, s(p, "source")), n(p, "length")) } }),
  },
  {
    id: "sebands", name: "Standard Error Bands", short: "SEB", category: "Bands & Channels", overlay: true,
    inputs: [int("length", "Periods", 21, 3), float("mult", "Standard Errors", 2, 0.5), int("smoothing", "Smoothing Periods", 3), src()],
    plots: [
      { key: "upper", title: "Upper", color: C.blue },
      { key: "middle", title: "Middle", color: C.orange },
      { key: "lower", title: "Lower", color: C.blue },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const sm = n(p, "smoothing");
      const middle = ta.sma(ta.linreg(x, len, 0), sm);
      const se = ta.sma(standardError(x, len), sm).map((v) => v * n(p, "mult"));
      return {
        plots: { upper: middle.map((m, i) => m + se[i]), middle, lower: middle.map((m, i) => m - se[i]) },
        fills: [{ a: "upper", b: "lower", color: alpha(C.blue, 0.08) }],
      };
    },
  },
  {
    id: "typprice", name: "Typical Price", short: "TP", category: "Moving Averages", overlay: true,
    inputs: [],
    plots: [{ key: "tp", title: "Typical Price", color: C.blue }],
    compute: (bars) => ({ plots: { tp: ta.source(bars, "hlc3") } }),
  },
  {
    id: "volosc", name: "Volume Oscillator", short: "Volume Osc", category: "Volume", overlay: false,
    inputs: [int("shortLen", "Short Length", 5), int("longLen", "Long Length", 10)],
    plots: [{ key: "osc", title: "Volume Osc", color: C.blue }],
    precision: 2,
    compute: (bars, p) => {
      const short = ta.ema(bars.volume, n(p, "shortLen"));
      const long = ta.ema(bars.volume, n(p, "longLen"));
      return { plots: { osc: short.map((v, i) => (100 * (v - long[i])) / long[i]) }, hlines: [zero] };
    },
  },
  {
    id: "volc2c", name: "Volatility Close-to-Close", short: "Vol C2C", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 10, 2), int("annual", "Periods per Year", 252)],
    plots: [{ key: "v", title: "Volatility", color: C.blue }],
    compute: (bars, p) => ({
      plots: { v: ta.stdev(logReturns(bars.close), n(p, "length")).map((sd) => 100 * sd * Math.sqrt(n(p, "annual"))) },
    }),
  },
  {
    id: "volzt", name: "Volatility Zero Trend Close-to-Close", short: "Vol ZT", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 10, 2), int("annual", "Periods per Year", 252)],
    plots: [{ key: "v", title: "Volatility", color: C.blue }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const sq = logReturns(bars.close).map((r) => r * r);
      return { plots: { v: ta.sum(sq, len).map((s2) => 100 * Math.sqrt((s2 / len) * n(p, "annual"))) } };
    },
  },
  {
    id: "volohlc", name: "Volatility O-H-L-C", short: "Vol OHLC", category: "Volatility", overlay: false,
    description: "Garman–Klass estimator, with the overnight gap weighted by the share of time the market is closed.",
    inputs: [int("length", "Length", 10, 2), float("closed", "Market Closed Percentage", 0, 1, 0), int("annual", "Periods per Year", 252)],
    plots: [{ key: "v", title: "Volatility", color: C.blue }],
    compute: (bars, p) => {
      const f = Math.min(99, n(p, "closed")) / 100;
      const { open, high, low, close } = bars;
      const perBar = close.map((c, i) => {
        const u = Math.log(high[i] / open[i]);
        const d = Math.log(low[i] / open[i]);
        const cc = Math.log(c / open[i]);
        const gk = 0.511 * (u - d) ** 2 - 0.019 * (cc * (u + d) - 2 * u * d) - 0.383 * cc * cc;
        if (f === 0) return gk;
        if (i === 0) return NaN;
        const gap = Math.log(open[i] / close[i - 1]) ** 2;
        return (0.12 * gap) / f + (0.88 * gk) / (1 - f);
      });
      return { plots: { v: ta.sma(perBar, n(p, "length")).map((v2) => 100 * Math.sqrt(v2 * n(p, "annual"))) } };
    },
  },

  // ---- newer built-ins --------------------------------------------------------------
  {
    id: "techratings", name: "Technical Ratings", short: "Technical Ratings", category: "Oscillators", overlay: false,
    aliases: ["Recommendation", "Buy Sell rating"],
    description: "TradingView's summary of 15 moving averages and 11 oscillators, from Strong Sell (-1) to Strong Buy (+1).",
    inputs: [select("show", "Rating is based on", ["MAs and Oscillators", "MAs", "Oscillators"], "MAs and Oscillators")],
    plots: [
      { key: "rating", title: "Rating", color: C.blue, style: "histogram" },
      { key: "ma", title: "MAs rating", color: C.gray, display: "legend" },
      { key: "osc", title: "Oscillators rating", color: C.gray, display: "legend" },
    ],
    precision: 3,
    compute: (bars, p) => {
      const r = technicalRatings(bars);
      const show = s(p, "show");
      const rating = show === "MAs" ? r.ma : show === "Oscillators" ? r.other : r.all;
      return {
        plots: { rating, ma: r.ma, osc: r.other },
        colors: { rating: rating.map((v) => (Number.isFinite(v) ? ratingColor(v) : undefined)) },
        hlines: [
          { price: 0.5, color: C.gray, dashed: true },
          { price: 0.1, color: C.gray, dashed: true },
          { price: -0.1, color: C.gray, dashed: true },
          { price: -0.5, color: C.gray, dashed: true },
        ],
      };
    },
  },
  {
    id: "autofib", name: "Auto Fib Retracement", short: "Auto Fib", category: "Support & Resistance", overlay: true,
    aliases: ["Fibonacci"],
    autoscale: false,
    inputs: [
      float("deviation", "Deviation", 3, 0.5, 0.1), int("depth", "Depth", 10, 2),
      bool("reverse", "Reverse", false), bool("extendLeft", "Extend Left", false), bool("extendRight", "Extend Right", true),
      bool("showPrices", "Prices", true), bool("showLevels", "Levels", true),
      bool("l0", "0", true), bool("l236", "0.236", true), bool("l382", "0.382", true), bool("l5", "0.5", true),
      bool("l618", "0.618", true), bool("l786", "0.786", true), bool("l1", "1", true),
      bool("l1618", "1.618", false), bool("l2618", "2.618", false), bool("l3618", "3.618", false), bool("l4236", "4.236", false),
    ],
    plots: [],
    compute: (bars, p) => autoFib(bars, p),
  },
  {
    id: "gaps", name: "Gaps", short: "Gaps", category: "Support & Resistance", overlay: true,
    autoscale: false,
    inputs: [int("maxGaps", "Max Number of Gaps", 15, 1, 500), bool("partial", "Close Gaps Partially", true), float("minSize", "Minimal Deviation (%)", 0, 0.1, 0)],
    plots: [],
    compute: (bars, p) => ({ plots: {}, boxes: findGaps(bars, n(p, "maxGaps"), b(p, "partial"), n(p, "minSize")) }),
  },
  {
    id: "sessions", name: "Trading Sessions", short: "Sessions", category: "Volatility", overlay: true,
    autoscale: false,
    inputs: [bool("tokyo", "Tokyo (09:00–15:00 Tokyo)", true), bool("london", "London (08:00–16:30 London)", true), bool("newyork", "New York (09:30–16:00 New York)", true), bool("showLabels", "Labels", true)],
    plots: [],
    compute: (bars, p) => ({ plots: {}, boxes: tradingSessions(bars, p) }),
  },
  {
    id: "moon", name: "Moon Phases", short: "Moon Phases", category: "Support & Resistance", overlay: true,
    inputs: [],
    plots: [],
    compute: (bars) => ({ plots: {}, markers: moonMarkers(bars.time) }),
  },
  {
    id: "rollingvwap", name: "Rolling VWAP", short: "RVWAP", category: "Moving Averages", overlay: true,
    inputs: [
      bool("fixed", "Use a fixed time period", false), int("days", "Days", 1, 0, 3650), int("hours", "Hours", 0, 0, 23), int("minutes", "Minutes", 0, 0, 59),
      int("minBars", "Bars (minimum)", 10), src("hlc3"),
      bool("band1", "Band #1", true), float("mult1", "Band #1 Multiplier", 1, 0.5, 0),
      bool("band2", "Band #2", false), float("mult2", "Band #2 Multiplier", 2, 0.5, 0),
      bool("band3", "Band #3", false), float("mult3", "Band #3 Multiplier", 3, 0.5, 0),
    ],
    plots: [
      { key: "vwap", title: "Rolling VWAP", color: C.blue },
      { key: "u1", title: "Upper Band #1", color: C.green },
      { key: "l1", title: "Lower Band #1", color: C.green },
      { key: "u2", title: "Upper Band #2", color: "#808000" },
      { key: "l2", title: "Lower Band #2", color: "#808000" },
      { key: "u3", title: "Upper Band #3", color: C.teal },
      { key: "l3", title: "Lower Band #3", color: C.teal },
    ],
    compute: (bars, p) => rollingVwap(bars, p),
  },
  {
    id: "rvat", name: "Relative Volume at Time", short: "RelVol", category: "Volume", overlay: false,
    aliases: ["RVOL"],
    description: "Volume so far in the session against the same point of the previous sessions (intraday charts).",
    inputs: [int("length", "Length (sessions)", 10), select("mode", "Calculation Mode", ["Cumulative", "Regular"], "Cumulative")],
    plots: [{ key: "rvol", title: "Relative Volume", color: C.teal, style: "histogram" }],
    precision: 2,
    compute: (bars, p, ext) => {
      const rvol = relativeVolumeAtTime(bars, n(p, "length"), s(p, "mode") === "Cumulative", ext?.chart?.timezone ?? "Etc/UTC");
      return {
        plots: { rvol },
        colors: { rvol: rvol.map((v) => (Number.isFinite(v) ? (v >= 1 ? alpha(C.teal, 0.8) : alpha(C.red, 0.8)) : undefined)) },
        hlines: [{ price: 1, color: C.gray, dashed: true }],
      };
    },
  },
  {
    id: "corrcoef", name: "Correlation Coefficient", short: "CC", category: "Momentum", overlay: false,
    aliases: ["Correlation"],
    inputs: [text("symbol", "Symbol", "GOOG"), src(), int("length", "Length", 20, 2)],
    plots: [{ key: "cc", title: "Correlation", color: C.blue, style: "area" }],
    precision: 3,
    fetches: (p, chart) => (s(p, "symbol").trim() ? [`/api/history/${encodeURIComponent(s(p, "symbol").trim().toUpperCase())}?${historyQuery(chart)}`] : []),
    compute: (bars, p, ext) => {
      const sym = s(p, "symbol").trim().toUpperCase();
      const path = ext?.chart ? `/api/history/${encodeURIComponent(sym)}?${historyQuery(ext.chart)}` : "";
      const other = ext?.fetched?.[path] as Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> | undefined;
      if (!other?.length) return { plots: { cc: ta.fill(bars.length) } };
      const otherBars = ta.source(
        { time: other.map((c) => c.time), open: other.map((c) => c.open), high: other.map((c) => c.high), low: other.map((c) => c.low), close: other.map((c) => c.close), volume: other.map((c) => c.volume), length: other.length },
        s(p, "source")
      );
      // request.security with gaps off: the other symbol's latest value at each bar.
      const aligned = ta.fill(bars.length);
      let j = -1;
      for (let i = 0; i < bars.length; i++) {
        while (j + 1 < other.length && other[j + 1].time <= bars.time[i]) j++;
        if (j >= 0) aligned[i] = otherBars[j];
      }
      return {
        plots: { cc: ta.correlation(ta.source(bars, s(p, "source")), aligned, n(p, "length")) },
        hlines: [zero, { price: 1, color: C.gray, dashed: true }, { price: -1, color: C.gray, dashed: true }],
      };
    },
  },
];

// ---- Technical Ratings --------------------------------------------------------------

function ratingColor(v: number): string {
  if (v > 0.5) return "#2962FF";
  if (v > 0.1) return alpha("#2962FF", 0.6);
  if (v >= -0.1) return C.gray;
  if (v >= -0.5) return alpha("#F23645", 0.6);
  return "#F23645";
}

const rate = (buy: boolean, sell: boolean) => (buy ? 1 : sell ? -1 : 0);

/** TradingView's Technical Ratings, per bar: MA rating (15 averages), oscillator rating
 *  (11 oscillators) and their mean — what the scanner reports as Recommend.MA / .Other / .All.
 *  The oscillator rules were fitted to the scanner on 19 US stocks (tests/fixtures): CCI is
 *  read on hlc3, ADX must be rising, and Stoch RSI needs no K/D cross. */
export function technicalRatings(bars: Bars): { ma: Series; other: Series; all: Series } {
  const { close, high, low, volume } = bars;
  const len = bars.length;
  const mas = [10, 20, 30, 50, 100, 200].flatMap((l) => [ta.sma(close, l), ta.ema(close, l)]);
  mas.push(ta.hma(close, 9), ta.vwma(close, volume, 20));
  const donchian = (l: number) => {
    const hh = ta.highest(high, l);
    const ll = ta.lowest(low, l);
    return hh.map((h, i) => (h + ll[i]) / 2);
  };
  const conv = donchian(9);
  const base = donchian(26);
  const lead1 = conv.map((c, i) => (c + base[i]) / 2);
  const lead2 = donchian(52);

  const rsi = ta.rsi(close, 14);
  const k = ta.sma(ta.stoch(close, high, low, 14), 3);
  const d = ta.sma(k, 3);
  // The scanner rates CCI on hlc3 (its CCI20 column), not close.
  const cci = ta.cci(ta.source(bars, "hlc3"), 20);
  const dmi = ta.dmi(bars, 14, 14);
  const hl2 = ta.source(bars, "hl2");
  const sma34 = ta.sma(hl2, 34);
  const ao = ta.sma(hl2, 5).map((v, i) => v - sma34[i]);
  const mom = close.map((c, i) => (i >= 10 ? c - close[i - 10] : NaN));
  const ema26 = ta.ema(close, 26);
  const macd = ta.ema(close, 12).map((v, i) => v - ema26[i]);
  const signal = ta.ema(macd, 9);
  const srK = ta.sma(ta.stoch(rsi, rsi, rsi, 14), 3);
  const srD = ta.sma(srK, 3);
  const hh14 = ta.highest(high, 14);
  const ll14 = ta.lowest(low, 14);
  const wr = close.map((c, i) => (100 * (c - hh14[i])) / (hh14[i] - ll14[i]));
  const ema13 = ta.ema(close, 13);
  const bull = high.map((h, i) => h - ema13[i]);
  const bear = low.map((l, i) => l - ema13[i]);
  const pc = ta.shift(close, 1);
  const bp = close.map((c, i) => c - Math.min(low[i], pc[i]));
  const trr = close.map((_, i) => Math.max(high[i], pc[i]) - Math.min(low[i], pc[i]));
  const uoAvg = (l: number) => ta.div(ta.sum(bp, l), ta.sum(trr, l));
  const [a7, a14, a28] = [uoAvg(7), uoAvg(14), uoAvg(28)];
  const uo = a7.map((v, i) => (100 * (4 * v + 2 * a14[i] + a28[i])) / 7);
  const ema50 = ta.ema(close, 50);

  const ok = (...xs: number[]) => xs.every((x) => !Number.isNaN(x));
  const out = { ma: ta.fill(len), other: ta.fill(len), all: ta.fill(len) };
  for (let i = 0; i < len; i++) {
    const c = close[i];
    let maSum = 0;
    let maCount = 0;
    for (const m of mas) {
      if (!ok(m[i], c)) continue;
      maSum += m[i] === c ? 0 : m[i] < c ? 1 : -1;
      maCount++;
    }
    if (i > 0 && ok(lead1[i], lead2[i], c, close[i - 1], base[i], conv[i])) {
      maSum += rate(
        lead1[i] > lead2[i] && c > lead1[i] && c < base[i] && close[i - 1] < conv[i] && c > conv[i],
        lead2[i] > lead1[i] && c < lead2[i] && c > base[i] && close[i - 1] > conv[i] && c < conv[i]
      );
      maCount++;
    }

    let oSum = 0;
    let oCount = 0;
    const add = (valid: boolean, buy: boolean, sell: boolean) => {
      if (!valid) return;
      oSum += rate(buy, sell);
      oCount++;
    };
    const up = c > ema50[i];
    const down = c < ema50[i];
    if (i > 0) {
      add(ok(rsi[i], rsi[i - 1]), rsi[i] < 30 && rsi[i - 1] < rsi[i], rsi[i] > 70 && rsi[i - 1] > rsi[i]);
      add(ok(k[i], d[i], k[i - 1], d[i - 1]), k[i] < 20 && d[i] < 20 && k[i] > d[i] && k[i - 1] < d[i - 1], k[i] > 80 && d[i] > 80 && k[i] < d[i] && k[i - 1] > d[i - 1]);
      add(ok(cci[i], cci[i - 1]), cci[i] < -100 && cci[i] > cci[i - 1], cci[i] > 100 && cci[i] < cci[i - 1]);
      // A strengthening trend (ADX above 20 and rising) votes with the leading DI line.
      const trending = dmi.adx[i] > 20 && dmi.adx[i] > dmi.adx[i - 1];
      add(ok(dmi.adx[i], dmi.adx[i - 1], dmi.plus[i], dmi.minus[i]), trending && dmi.plus[i] > dmi.minus[i], trending && dmi.plus[i] < dmi.minus[i]);
    }
    if (i > 1) {
      add(
        ok(ao[i], ao[i - 1], ao[i - 2]),
        (ao[i] > 0 && ao[i - 1] <= 0) || (ao[i] > 0 && ao[i - 1] > 0 && ao[i] > ao[i - 1] && ao[i - 2] > ao[i - 1]),
        (ao[i] < 0 && ao[i - 1] >= 0) || (ao[i] < 0 && ao[i - 1] < 0 && ao[i] < ao[i - 1] && ao[i - 2] < ao[i - 1])
      );
    }
    if (i > 0) {
      add(ok(mom[i], mom[i - 1]), mom[i] > mom[i - 1], mom[i] < mom[i - 1]);
    }
    add(ok(macd[i], signal[i]), macd[i] > signal[i], macd[i] < signal[i]);
    if (i > 0) {
      // Stoch RSI: oversold and turning up in a downtrend, or the reverse; no K/D cross needed.
      add(ok(srK[i], srD[i]), down && srK[i] < 20 && srD[i] < 20 && srK[i] > srD[i], up && srK[i] > 80 && srD[i] > 80 && srK[i] < srD[i]);
      add(ok(wr[i], wr[i - 1]), wr[i] < -80 && wr[i] > wr[i - 1], wr[i] > -20 && wr[i] < wr[i - 1]);
      add(ok(ema50[i], bear[i], bear[i - 1], bull[i], bull[i - 1]), up && bear[i] < 0 && bear[i] > bear[i - 1], down && bull[i] > 0 && bull[i] < bull[i - 1]);
    }
    add(ok(uo[i]), uo[i] > 70, uo[i] < 30);

    const ma = maCount > 0 ? maSum / maCount : NaN;
    const other = oCount > 0 ? oSum / oCount : NaN;
    out.ma[i] = ma;
    out.other[i] = other;
    out.all[i] = Number.isNaN(ma) ? other : Number.isNaN(other) ? ma : (ma + other) / 2;
  }
  return out;
}

// ---- Auto Fib Retracement -------------------------------------------------------------

const FIB_LEVELS: Array<[key: string, level: number, color: string]> = [
  ["l0", 0, "#787b86"], ["l236", 0.236, "#f44336"], ["l382", 0.382, "#81c784"], ["l5", 0.5, "#4caf50"],
  ["l618", 0.618, "#009688"], ["l786", 0.786, "#64b5f6"], ["l1", 1, "#787b86"], ["l1618", 1.618, "#2962ff"],
  ["l2618", 2.618, "#f44336"], ["l3618", 3.618, "#9c27b0"], ["l4236", 4.236, "#e91e63"],
];

/** Zig-zag pivots whose swings exceed `deviation` × ATR(10) as a percentage of price. */
export function zigzagPivots(bars: Bars, deviation: number, depth: number) {
  const legs = Math.max(1, Math.floor(depth / 2));
  const atr = ta.atr(bars, 10);
  type Pivot = { index: number; price: number; isHigh: boolean };
  const pivots: Pivot[] = [];
  for (let i = 2 * legs; i < bars.length; i++) {
    const c = i - legs;
    const threshold = (atr[i] / bars.close[i]) * 100 * deviation;
    const isPivot = (x: number[], high: boolean) => {
      for (let j = c - legs; j <= c + legs; j++) if (j !== c && (high ? x[j] > x[c] : x[j] < x[c])) return false;
      return true;
    };
    for (const [x, high] of [[bars.high, true], [bars.low, false]] as const) {
      if (!isPivot(x, high)) continue;
      const price = x[c];
      const last = pivots[pivots.length - 1];
      if (!last) pivots.push({ index: c, price, isHigh: high });
      else if (last.isHigh === high) {
        if (high ? price > last.price : price < last.price) pivots[pivots.length - 1] = { index: c, price, isHigh: high };
      } else if (Number.isFinite(threshold) && Math.abs((100 * (price - last.price)) / last.price) >= threshold) {
        pivots.push({ index: c, price, isHigh: high });
      }
    }
  }
  return pivots;
}

function autoFib(bars: Bars, p: Record<string, number | string | boolean>) {
  const pivots = zigzagPivots(bars, n(p, "deviation"), n(p, "depth"));
  if (pivots.length < 2) return { plots: {} };
  let [start, end] = pivots.slice(-2);
  if (b(p, "reverse")) [start, end] = [end, start];
  const diff = start.price - end.price;
  const last = bars.length - 1;
  const x1 = b(p, "extendLeft") ? 0 : Math.min(start.index, end.index);
  const x2 = b(p, "extendRight") ? last + 20 : Math.max(start.index, end.index);
  const lines: Line[] = [];
  const labels: Label[] = [];
  const decimals = Math.max(2, -Math.floor(Math.log10(Math.abs(end.price) || 1)) + 4);
  for (const [key, level, color] of FIB_LEVELS) {
    if (!b(p, key)) continue;
    const price = end.price + diff * level;
    lines.push({ x1, y1: price, x2, y2: price, color });
    const parts = [b(p, "showLevels") ? String(level) : "", b(p, "showPrices") ? `(${price.toFixed(Math.min(8, decimals))})` : ""].filter(Boolean);
    if (parts.length) labels.push({ index: x1, price, text: parts.join(" "), style: "right", textColor: color, size: "small" });
  }
  // The swing the levels come from.
  lines.push({ x1: start.index, y1: start.price, x2: end.index, y2: end.price, color: C.gray, dashed: true });
  return { plots: {}, lines, labels };
}

// ---- Gaps ------------------------------------------------------------------------------

export function findGaps(bars: Bars, maxGaps: number, partial: boolean, minSizePct: number): Box[] {
  const { high, low } = bars;
  type Gap = Box & { up: boolean; open: boolean };
  const gaps: Gap[] = [];
  const last = bars.length - 1;
  for (let i = 1; i < bars.length; i++) {
    // Earlier gaps first: price on this bar may fill them.
    for (const g of gaps) {
      if (!g.open) continue;
      g.x2 = i;
      if (g.up) {
        if (low[i] <= g.bottom) g.open = false;
        else if (partial && low[i] < g.top) g.top = low[i];
      } else {
        if (high[i] >= g.top) g.open = false;
        else if (partial && high[i] > g.bottom) g.bottom = high[i];
      }
    }
    const minMove = (bars.close[i - 1] * minSizePct) / 100;
    if (low[i] > high[i - 1] && low[i] - high[i - 1] > minMove) {
      gaps.push({ x1: i - 1, x2: i, top: low[i], bottom: high[i - 1], up: true, open: true, bg: alpha(C.green, 0.25), border: alpha(C.green, 0.6) });
    } else if (high[i] < low[i - 1] && low[i - 1] - high[i] > minMove) {
      gaps.push({ x1: i - 1, x2: i, top: low[i - 1], bottom: high[i], up: false, open: true, bg: alpha(C.red, 0.25), border: alpha(C.red, 0.6) });
    }
  }
  for (const g of gaps) if (g.open) g.x2 = last;
  return gaps.slice(-maxGaps).map(({ up: _up, open: _open, ...box }) => box);
}

// ---- Trading Sessions --------------------------------------------------------------------

const SESSIONS = [
  { key: "tokyo", name: "Tokyo", tz: "Asia/Tokyo", from: 9 * 60, to: 15 * 60, color: "#9C27B0" },
  { key: "london", name: "London", tz: "Europe/London", from: 8 * 60, to: 16 * 60 + 30, color: "#2962FF" },
  { key: "newyork", name: "New York", tz: "America/New_York", from: 9 * 60 + 30, to: 16 * 60, color: "#FF9800" },
];

function tradingSessions(bars: Bars, p: Record<string, number | string | boolean>): Box[] {
  if (ta.barSpacing(bars.time) >= 86_400) return [];
  const boxes: Box[] = [];
  for (const sess of SESSIONS) {
    if (!b(p, sess.key)) continue;
    let run: { from: number; to: number; hi: number; lo: number } | null = null;
    const close = () => {
      if (run) {
        boxes.push({ x1: run.from, x2: run.to, top: run.hi, bottom: run.lo, bg: colorNew(sess.color, 90), border: colorNew(sess.color, 40), text: b(p, "showLabels") ? sess.name : undefined, textColor: sess.color });
      }
      run = null;
    };
    for (let i = 0; i < bars.length; i++) {
      const t = timeParts(bars.time[i], sess.tz);
      const minutes = t.hour * 60 + t.minute;
      const inSession = t.dayofweek >= 2 && t.dayofweek <= 6 && minutes >= sess.from && minutes < sess.to;
      if (!inSession) {
        close();
        continue;
      }
      if (run && bars.time[i] - bars.time[run.to] > 6 * 3600) close();
      if (!run) run = { from: i, to: i, hi: bars.high[i], lo: bars.low[i] };
      run.to = i;
      run.hi = Math.max(run.hi, bars.high[i]);
      run.lo = Math.min(run.lo, bars.low[i]);
    }
    close();
  }
  return boxes;
}

// ---- Moon Phases -------------------------------------------------------------------------

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Unix time of the new moon (phase 0) or full moon (phase 0.5) of lunation k (Meeus, ch. 49). */
export function moonPhaseTime(k: number, phase: 0 | 0.5): number {
  const kk = Math.floor(k) + phase;
  const T = kk / 1236.85;
  const jde = 2451550.09766 + 29.530588861 * kk + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = rad(2.5534 + 29.1053567 * kk - 0.0000014 * T * T - 0.00000011 * T ** 3);
  const Mp = rad(201.5643 + 385.81693528 * kk + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4);
  const F = rad(160.7108 + 390.67050284 * kk - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4);
  const Om = rad(124.7746 - 1.56375588 * kk + 0.0020672 * T * T + 0.00000215 * T ** 3);
  const c = phase === 0
    ? [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208]
    : [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
  const corr =
    c[0] * Math.sin(Mp) + c[1] * E * Math.sin(M) + c[2] * Math.sin(2 * Mp) + c[3] * Math.sin(2 * F) +
    c[4] * E * Math.sin(Mp - M) + c[5] * E * Math.sin(Mp + M) + c[6] * E * E * Math.sin(2 * M) -
    0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M) -
    0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F) -
    0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(Om);
  // JDE is Terrestrial Time, about 69 s ahead of UTC today.
  return (jde + corr - 2440587.5) * 86_400 - 69;
}

function moonMarkers(time: number[]): Marker[] {
  if (time.length === 0) return [];
  const markers: Marker[] = [];
  const first = time[0];
  const end = time[time.length - 1] + Math.max(86_400, ta.barSpacing(time));
  const k0 = Math.floor(((first - 947182440) / 86_400) / 29.530588853) - 1;
  for (let k = k0; ; k++) {
    const events: Array<[number, boolean]> = [[moonPhaseTime(k, 0), true], [moonPhaseTime(k, 0.5), false]];
    if (events[0][0] > end) break;
    for (const [t, isNew] of events) {
      if (t < first || t >= end || t > Date.now() / 1000) continue;
      // The bar whose span holds the event.
      let lo = 0;
      let hi = time.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (time[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      markers.push({ index: lo, position: "aboveBar", shape: "circle", color: isNew ? "#787B86" : "#FFFFFF", text: isNew ? "New moon" : "Full moon" });
    }
  }
  return markers;
}

// ---- Rolling VWAP -------------------------------------------------------------------------

function rollingVwap(bars: Bars, p: Record<string, number | string | boolean>) {
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  const tf = ta.barSpacing(bars.time) * 1000;
  const window = b(p, "fixed")
    ? n(p, "days") * DAY + n(p, "hours") * HOUR + n(p, "minutes") * MIN
    : tf <= MIN ? HOUR : tf <= 5 * MIN ? 4 * HOUR : tf <= HOUR ? DAY : tf <= 4 * HOUR ? 3 * DAY : tf <= 12 * HOUR ? 7 * DAY : tf <= DAY ? 30.4375 * DAY : tf <= 7 * DAY ? 90 * DAY : 365 * DAY;
  const minBars = n(p, "minBars");
  const x = ta.source(bars, s(p, "source"));
  const len = bars.length;
  const vwap = ta.fill(len);
  const sd = ta.fill(len);
  for (let i = 0; i < len; i++) {
    let pv = 0, v = 0, pv2 = 0;
    const cutoff = bars.time[i] * 1000 - window;
    for (let j = i, count = 0; j >= 0; j--, count++) {
      if (count >= minBars && bars.time[j] * 1000 <= cutoff) break;
      pv += x[j] * bars.volume[j];
      pv2 += x[j] * x[j] * bars.volume[j];
      v += bars.volume[j];
    }
    if (v > 0) {
      vwap[i] = pv / v;
      sd[i] = Math.sqrt(Math.max(0, pv2 / v - vwap[i] ** 2));
    }
  }
  const plots: Record<string, Series> = { vwap };
  const fills: Array<{ a: string; b: string; color: string }> = [];
  for (const [k, color] of [[1, C.green], [2, "#808000"], [3, C.teal]] as const) {
    if (!b(p, `band${k}`)) continue;
    const m = n(p, `mult${k}`);
    plots[`u${k}`] = vwap.map((v, i) => v + m * sd[i]);
    plots[`l${k}`] = vwap.map((v, i) => v - m * sd[i]);
    fills.push({ a: `u${k}`, b: `l${k}`, color: alpha(color, 0.05) });
  }
  return { plots, fills };
}

// ---- Relative Volume at Time ------------------------------------------------------------------

export function relativeVolumeAtTime(bars: Bars, length: number, cumulative: boolean, timezone: string): Series {
  const out = ta.fill(bars.length);
  if (ta.barSpacing(bars.time) >= 86_400) return out;
  type Session = { tods: number[]; values: number[] };
  const sessions: Session[] = [];
  let key = "";
  for (let i = 0; i < bars.length; i++) {
    const t = timeParts(bars.time[i], timezone);
    const k = `${t.year}-${t.month}-${t.day}`;
    if (k !== key) {
      key = k;
      sessions.push({ tods: [], values: [] });
    }
    const sess = sessions[sessions.length - 1];
    const prev = sess.values.length ? sess.values[sess.values.length - 1] : 0;
    sess.tods.push(t.hour * 60 + t.minute);
    sess.values.push(cumulative ? prev + bars.volume[i] : bars.volume[i]);
  }
  // Value of a past session at a time of day: cumulative uses the last bar at or before it,
  // regular needs a bar at exactly that time.
  const at = (sess: Session, tod: number) => {
    let found = NaN;
    for (let j = 0; j < sess.tods.length && sess.tods[j] <= tod; j++) if (cumulative || sess.tods[j] === tod) found = sess.values[j];
    return found;
  };
  let i = 0;
  sessions.forEach((sess, si) => {
    for (let j = 0; j < sess.tods.length; j++, i++) {
      const past: number[] = [];
      for (let back = si - 1; back >= 0 && past.length < length; back--) {
        const v = at(sessions[back], sess.tods[j]);
        if (Number.isFinite(v)) past.push(v);
      }
      if (past.length === 0) continue;
      const avg = past.reduce((a, v) => a + v, 0) / past.length;
      out[i] = avg > 0 ? sess.values[j] / avg : NaN;
    }
  });
  return out;
}

