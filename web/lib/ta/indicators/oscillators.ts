import * as ta from "../core";
import { type Series } from "../core";
import { C, alpha, b, bool, float, int, n, s, select, src, type Color, type IndicatorDef, type IndicatorResult } from "../types";

const bandFill = (upper: number, lower: number, color: string) => ({ a: upper, b: lower, color: alpha(color, 0.1) });
const lines = (color: string, ...prices: number[]) => prices.map((price) => ({ price, color, dashed: true }));

/** MACD-style histogram coloring: strong/weak shades by sign and slope. */
function histColors(h: Series): Color[] {
  return h.map((v, i) => {
    const prev = i > 0 ? h[i - 1] : NaN;
    return v >= 0 ? (prev < v ? "#26A69A" : "#B2DFDB") : prev < v ? "#FFCDD2" : "#FF5252";
  });
}

function oscillatorPair(bars: ta.Bars, x: Series, fast: number, slow: number, sig: number, percent: boolean, oscType = "EMA", sigType = "EMA"): IndicatorResult {
  const f = ta.maByType(oscType, x, fast, bars.volume);
  const sl = ta.maByType(oscType, x, slow, bars.volume);
  const line = ta.zip(f, sl, (a, c) => (percent ? ((a - c) / c) * 100 : a - c));
  const signal = ta.maByType(sigType, line, sig, bars.volume);
  const hist = ta.sub(line, signal);
  return {
    plots: { hist, line, signal },
    colors: { hist: histColors(hist) },
    hlines: [{ price: 0, color: C.gray, dashed: true }],
  };
}

const pairPlots = [
  { key: "hist", title: "Histogram", color: "#26A69A", style: "histogram" as const },
  { key: "line", title: "MACD", color: C.blue },
  { key: "signal", title: "Signal", color: C.orange },
];

export const oscillators: IndicatorDef[] = [
  {
    id: "rsi", name: "Relative Strength Index", short: "RSI", category: "Oscillators", overlay: false,
    inputs: [int("length", "RSI Length", 14), src(), select("maType", "MA Type", ["None", ...ta.MA_TYPES], "SMA"), int("maLength", "MA Length", 14)],
    plots: [
      { key: "rsi", title: "RSI", color: C.purple },
      { key: "ma", title: "RSI-based MA", color: C.yellow },
    ],
    compute: (bars, p) => {
      const r = ta.rsi(ta.source(bars, s(p, "source")), n(p, "length"));
      const plots: Record<string, Series> = { rsi: r };
      if (s(p, "maType") !== "None") plots.ma = ta.maByType(s(p, "maType"), r, n(p, "maLength"));
      return { plots, hlines: lines(C.gray, 70, 50, 30), fills: [bandFill(70, 30, C.purple)] };
    },
  },
  {
    id: "stoch", name: "Stochastic", short: "Stoch", category: "Oscillators", overlay: false,
    inputs: [int("periodK", "%K Length", 14), int("smoothK", "%K Smoothing", 1), int("periodD", "%D Smoothing", 3)],
    plots: [
      { key: "k", title: "%K", color: C.blue },
      { key: "d", title: "%D", color: C.orange },
    ],
    compute: (bars, p) => {
      const k = ta.sma(ta.stoch(bars.close, bars.high, bars.low, n(p, "periodK")), n(p, "smoothK"));
      return { plots: { k, d: ta.sma(k, n(p, "periodD")) }, hlines: lines(C.gray, 80, 50, 20), fills: [bandFill(80, 20, C.lightBlue)] };
    },
  },
  {
    id: "stochrsi", name: "Stochastic RSI", short: "Stoch RSI", category: "Oscillators", overlay: false,
    inputs: [int("smoothK", "K", 3), int("smoothD", "D", 3), int("lengthRsi", "RSI Length", 14), int("lengthStoch", "Stochastic Length", 14), src()],
    plots: [
      { key: "k", title: "K", color: C.blue },
      { key: "d", title: "D", color: C.orange },
    ],
    compute: (bars, p) => {
      const r = ta.rsi(ta.source(bars, s(p, "source")), n(p, "lengthRsi"));
      const k = ta.sma(ta.stoch(r, r, r, n(p, "lengthStoch")), n(p, "smoothK"));
      return { plots: { k, d: ta.sma(k, n(p, "smoothD")) }, hlines: lines(C.gray, 80, 50, 20), fills: [bandFill(80, 20, C.lightBlue)] };
    },
  },
  {
    id: "macd", name: "MACD", short: "MACD", category: "Momentum", overlay: false,
    inputs: [
      int("fast", "Fast Length", 12), int("slow", "Slow Length", 26), src(), int("signal", "Signal Smoothing", 9, 1, 50),
      select("oscType", "Oscillator MA Type", ["EMA", "SMA"], "EMA"), select("sigType", "Signal Line MA Type", ["EMA", "SMA"], "EMA"),
    ],
    plots: pairPlots,
    compute: (bars, p) =>
      oscillatorPair(bars, ta.source(bars, s(p, "source")), n(p, "fast"), n(p, "slow"), n(p, "signal"), false, s(p, "oscType"), s(p, "sigType")),
  },
  {
    id: "ppo", name: "Percentage Price Oscillator", short: "PPO", category: "Momentum", overlay: false,
    inputs: [int("fast", "Fast Length", 12), int("slow", "Slow Length", 26), src(), int("signal", "Signal Smoothing", 9)],
    plots: [pairPlots[0], { ...pairPlots[1], title: "PPO" }, pairPlots[2]],
    compute: (bars, p) => oscillatorPair(bars, ta.source(bars, s(p, "source")), n(p, "fast"), n(p, "slow"), n(p, "signal"), true),
  },
  {
    id: "cci", name: "Commodity Channel Index", short: "CCI", category: "Oscillators", overlay: false,
    inputs: [int("length", "Length", 20), src("hlc3"), select("maType", "Smoothing Type", ["None", ...ta.MA_TYPES], "SMA"), int("maLength", "Smoothing Length", 14)],
    plots: [
      { key: "cci", title: "CCI", color: C.blue },
      { key: "ma", title: "Smoothing Line", color: C.yellow },
    ],
    compute: (bars, p) => {
      const c = ta.cci(ta.source(bars, s(p, "source")), n(p, "length"));
      const plots: Record<string, Series> = { cci: c };
      if (s(p, "maType") !== "None") plots.ma = ta.maByType(s(p, "maType"), c, n(p, "maLength"));
      return { plots, hlines: lines(C.gray, 100, 0, -100), fills: [bandFill(100, -100, C.lightBlue)] };
    },
  },
  {
    id: "wpr", name: "Williams %R", short: "%R", category: "Oscillators", overlay: false,
    inputs: [int("length", "Length", 14), src()],
    plots: [{ key: "r", title: "%R", color: C.purple }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const hh = ta.highest(bars.high, len);
      const ll = ta.lowest(bars.low, len);
      const x = ta.source(bars, s(p, "source"));
      return {
        plots: { r: x.map((v, i) => (100 * (v - hh[i])) / (hh[i] - ll[i])) },
        hlines: lines(C.gray, -20, -50, -80),
        fills: [bandFill(-20, -80, C.purple)],
      };
    },
  },
  {
    id: "mom", name: "Momentum", short: "Mom", category: "Momentum", overlay: false,
    inputs: [int("length", "Length", 10), src()],
    plots: [{ key: "mom", title: "Mom", color: C.blue }],
    compute: (bars, p) => ({ plots: { mom: ta.change(ta.source(bars, s(p, "source")), n(p, "length")) }, hlines: lines(C.gray, 0) }),
  },
  {
    id: "roc", name: "Rate Of Change", short: "ROC", category: "Momentum", overlay: false,
    inputs: [int("length", "Length", 9), src()],
    plots: [{ key: "roc", title: "ROC", color: C.blue }],
    compute: (bars, p) => ({ plots: { roc: ta.roc(ta.source(bars, s(p, "source")), n(p, "length")) }, hlines: lines(C.gray, 0) }),
  },
  {
    id: "ao", name: "Awesome Oscillator", short: "AO", category: "Momentum", overlay: false,
    inputs: [],
    plots: [{ key: "ao", title: "AO", color: C.teal, style: "histogram" }],
    compute: (bars) => {
      const hl2 = ta.source(bars, "hl2");
      const ao = ta.sub(ta.sma(hl2, 5), ta.sma(hl2, 34));
      const ch = ta.change(ao);
      return { plots: { ao }, colors: { ao: ch.map((c) => (c <= 0 ? "#F44336" : "#009688")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "uo", name: "Ultimate Oscillator", short: "UO", category: "Oscillators", overlay: false,
    inputs: [int("fast", "Fast Length", 7), int("middle", "Middle Length", 14), int("slow", "Slow Length", 28)],
    plots: [{ key: "uo", title: "UO", color: C.red }],
    compute: (bars, p) => {
      const pc = ta.shift(bars.close, 1);
      const bp = bars.close.map((c, i) => c - Math.min(bars.low[i], pc[i]));
      const trr = bars.close.map((_, i) => Math.max(bars.high[i], pc[i]) - Math.min(bars.low[i], pc[i]));
      const avg = (len: number) => ta.div(ta.sum(bp, len), ta.sum(trr, len));
      const a7 = avg(n(p, "fast"));
      const a14 = avg(n(p, "middle"));
      const a28 = avg(n(p, "slow"));
      return { plots: { uo: a7.map((v, i) => (100 * (4 * v + 2 * a14[i] + a28[i])) / 7) } };
    },
  },
  {
    id: "adx", name: "Average Directional Index", short: "ADX", category: "Trend", overlay: false,
    inputs: [int("adxSmoothing", "ADX Smoothing", 14, 1, 50), int("diLength", "DI Length", 14)],
    plots: [{ key: "adx", title: "ADX", color: "#F50057" }],
    compute: (bars, p) => ({ plots: { adx: ta.dmi(bars, n(p, "diLength"), n(p, "adxSmoothing")).adx } }),
  },
  {
    id: "dmi", name: "Directional Movement Index", short: "DMI", category: "Trend", overlay: false,
    inputs: [int("adxSmoothing", "ADX Smoothing", 14, 1, 50), int("diLength", "DI Length", 14)],
    plots: [
      { key: "adx", title: "ADX", color: "#F50057" },
      { key: "plus", title: "+DI", color: C.blue },
      { key: "minus", title: "-DI", color: C.orange },
    ],
    compute: (bars, p) => ({ plots: ta.dmi(bars, n(p, "diLength"), n(p, "adxSmoothing")) }),
  },
  {
    id: "aroon", name: "Aroon", short: "Aroon", category: "Trend", overlay: false,
    inputs: [int("length", "Length", 14)],
    plots: [
      { key: "up", title: "Aroon Up", color: "#FB8C00" },
      { key: "down", title: "Aroon Down", color: C.blue },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      return {
        plots: {
          up: ta.map(ta.highestbars(bars.high, len + 1), (o) => (100 * (o + len)) / len),
          down: ta.map(ta.lowestbars(bars.low, len + 1), (o) => (100 * (o + len)) / len),
        },
      };
    },
  },
  {
    id: "aroonosc", name: "Aroon Oscillator", short: "Aroon Osc", category: "Trend", overlay: false,
    inputs: [int("length", "Length", 14)],
    plots: [{ key: "osc", title: "Aroon Oscillator", color: C.blue }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const up = ta.highestbars(bars.high, len + 1);
      const down = ta.lowestbars(bars.low, len + 1);
      return { plots: { osc: up.map((u, i) => (100 * (u - down[i])) / len) }, hlines: lines(C.gray, 90, 0, -90) };
    },
  },
  {
    id: "bop", name: "Balance of Power", short: "BOP", category: "Momentum", overlay: false,
    inputs: [],
    plots: [{ key: "bop", title: "BOP", color: C.red }],
    compute: (bars) => ({ plots: { bop: bars.close.map((c, i) => (c - bars.open[i]) / (bars.high[i] - bars.low[i])) }, hlines: lines(C.gray, 0) }),
  },
  {
    id: "bbpower", name: "Bull Bear Power", short: "BBP", category: "Momentum", overlay: false,
    inputs: [int("length", "Length", 13)],
    plots: [{ key: "bbp", title: "BBPower", color: C.teal, style: "histogram" }],
    compute: (bars, p) => {
      const e = ta.ema(bars.close, n(p, "length"));
      const bbp = bars.close.map((_, i) => bars.high[i] - e[i] + (bars.low[i] - e[i]));
      return { plots: { bbp }, colors: { bbp: bbp.map((v) => (v >= 0 ? "#26A69A" : "#FF5252")) } };
    },
  },
  {
    id: "cmo", name: "Chande Momentum Oscillator", short: "ChandeMO", category: "Momentum", overlay: false,
    inputs: [int("length", "Length", 9), src()],
    plots: [{ key: "cmo", title: "Chande MO", color: C.blue }],
    compute: (bars, p) => {
      const m = ta.change(ta.source(bars, s(p, "source")));
      const len = n(p, "length");
      const su = ta.sum(ta.map(m, (v) => (ta.isNa(v) ? NaN : v >= 0 ? v : 0)), len);
      const sd = ta.sum(ta.map(m, (v) => (ta.isNa(v) ? NaN : v >= 0 ? 0 : -v)), len);
      return { plots: { cmo: ta.zip(su, sd, (u, d) => (100 * (u - d)) / (u + d)) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "chop", name: "Choppiness Index", short: "CHOP", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 14), int("offset", "Offset", 0, -500)],
    plots: [{ key: "chop", title: "CHOP", color: C.blue }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const atrSum = ta.sum(ta.atr(bars, 1), len);
      const hh = ta.highest(bars.high, len);
      const ll = ta.lowest(bars.low, len);
      return {
        plots: { chop: atrSum.map((a, i) => (100 * Math.log10(a / (hh[i] - ll[i]))) / Math.log10(len)) },
        offsets: { chop: n(p, "offset") },
        hlines: lines(C.gray, 61.8, 38.2),
        fills: [bandFill(61.8, 38.2, C.lightBlue)],
      };
    },
  },
  {
    id: "chopzone", name: "Chop Zone", short: "Chop Zone", category: "Trend", overlay: false,
    inputs: [],
    plots: [{ key: "zone", title: "Chop Zone", color: C.gray, style: "histogram" }],
    precision: 0,
    compute: (bars) => {
      const avg = ta.source(bars, "hlc3");
      const hh = ta.highest(bars.high, 30);
      const ll = ta.lowest(bars.low, 30);
      const e = ta.ema(bars.close, 34);
      const colors: Color[] = [];
      const zone = bars.close.map((_, i) => {
        const span = (25 / (hh[i] - ll[i])) * ll[i];
        const y2 = i > 0 ? ((e[i - 1] - e[i]) / avg[i]) * span : NaN;
        const c = Math.sqrt(1 + y2 * y2);
        const angle1 = Math.round((180 * Math.acos(1 / c)) / Math.PI);
        const angle = y2 > 0 ? -angle1 : angle1;
        colors.push(
          ta.isNa(angle) ? undefined
          : angle >= 5 ? "#26C6DA" : angle >= 3.57 ? "#43A047" : angle >= 2.14 ? "#A5D6A7" : angle >= 0.71 ? "#009688"
          : angle <= -5 ? "#D50000" : angle <= -3.57 ? "#E91E63" : angle <= -2.14 ? "#FF6D00" : angle <= -0.71 ? "#FFB74D" : "#FDD835"
        );
        return ta.isNa(angle) ? NaN : 1;
      });
      return { plots: { zone }, colors: { zone: colors } };
    },
  },
  {
    id: "crsi", name: "Connors RSI", short: "CRSI", category: "Oscillators", overlay: false,
    inputs: [int("lenRsi", "RSI Length", 3), int("lenUpDown", "UpDown Length", 2), int("lenRoc", "ROC Length", 100), src()],
    plots: [{ key: "crsi", title: "CRSI", color: C.blue }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      let ud = 0;
      const updown = x.map((v, i) => {
        if (i === 0) return (ud = 0);
        ud = v === x[i - 1] ? 0 : v > x[i - 1] ? (ud <= 0 ? 1 : ud + 1) : ud >= 0 ? -1 : ud - 1;
        return ud;
      });
      const r = ta.rsi(x, n(p, "lenRsi"));
      const udr = ta.rsi(updown, n(p, "lenUpDown"));
      const pr = ta.percentrank(ta.roc(x, 1), n(p, "lenRoc"));
      return { plots: { crsi: r.map((v, i) => (v + udr[i] + pr[i]) / 3) }, hlines: lines(C.gray, 70, 30), fills: [bandFill(70, 30, C.purple)] };
    },
  },
  {
    id: "coppock", name: "Coppock Curve", short: "Coppock", category: "Momentum", overlay: false,
    inputs: [int("wmaLength", "WMA Length", 10), int("longRoc", "Long RoC Length", 14), int("shortRoc", "Short RoC Length", 11), src()],
    plots: [{ key: "curve", title: "Coppock Curve", color: C.blue }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      return { plots: { curve: ta.wma(ta.add(ta.roc(x, n(p, "longRoc")), ta.roc(x, n(p, "shortRoc"))), n(p, "wmaLength")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "dpo", name: "Detrended Price Oscillator", short: "DPO", category: "Oscillators", overlay: false,
    inputs: [int("period", "Length", 21), bool("centered", "Centered", false)],
    plots: [{ key: "dpo", title: "Detrended Price Oscillator", color: "#43A047" }],
    compute: (bars, p) => {
      const period = n(p, "period");
      const back = Math.floor(period / 2) + 1;
      const ma = ta.sma(bars.close, period);
      const centered = b(p, "centered");
      const dpo = centered ? ta.sub(ta.shift(bars.close, back), ma) : ta.sub(bars.close, ta.shift(ma, back));
      return { plots: { dpo }, offsets: { dpo: centered ? -back : 0 }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "fisher", name: "Fisher Transform", short: "Fisher", category: "Oscillators", overlay: false,
    inputs: [int("length", "Length", 9)],
    plots: [
      { key: "fisher", title: "Fisher", color: C.blue },
      { key: "trigger", title: "Trigger", color: C.orange },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      const hl2 = ta.source(bars, "hl2");
      const hh = ta.highest(hl2, len);
      const ll = ta.lowest(hl2, len);
      const round = (v: number) => (v > 0.99 ? 0.999 : v < -0.99 ? -0.999 : v);
      const value = ta.fill(bars.length);
      const fisher = ta.fill(bars.length);
      for (let i = 0; i < bars.length; i++) {
        const pv = i > 0 ? ta.nz(value[i - 1]) : 0;
        value[i] = round(0.66 * ((hl2[i] - ll[i]) / (hh[i] - ll[i]) - 0.5) + 0.67 * pv);
        const pf = i > 0 ? ta.nz(fisher[i - 1]) : 0;
        fisher[i] = 0.5 * Math.log((1 + value[i]) / (1 - value[i])) + 0.5 * pf;
      }
      return {
        plots: { fisher, trigger: ta.shift(fisher, 1) },
        hlines: [
          { price: 1.5, color: "#E91E63", dashed: true }, { price: 0.75, color: C.gray, dashed: true },
          { price: 0, color: "#E91E63", dashed: true }, { price: -0.75, color: C.gray, dashed: true },
          { price: -1.5, color: "#E91E63", dashed: true },
        ],
      };
    },
  },
  {
    id: "kst", name: "Know Sure Thing", short: "KST", category: "Momentum", overlay: false,
    inputs: [
      int("roc1", "ROC Length #1", 10), int("roc2", "ROC Length #2", 15), int("roc3", "ROC Length #3", 20), int("roc4", "ROC Length #4", 30),
      int("sma1", "SMA Length #1", 10), int("sma2", "SMA Length #2", 10), int("sma3", "SMA Length #3", 10), int("sma4", "SMA Length #4", 15),
      int("signal", "Signal Line Length", 9),
    ],
    plots: [
      { key: "kst", title: "KST", color: "#009688" },
      { key: "signal", title: "Signal", color: "#F44336" },
    ],
    compute: (bars, p) => {
      const part = (k: number) => ta.sma(ta.roc(bars.close, n(p, `roc${k}`)), n(p, `sma${k}`));
      const [a, c, d, e] = [part(1), part(2), part(3), part(4)];
      const kst = a.map((v, i) => v + 2 * c[i] + 3 * d[i] + 4 * e[i]);
      return { plots: { kst, signal: ta.sma(kst, n(p, "signal")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "pmo", name: "Price Momentum Oscillator", short: "PMO", category: "Momentum", overlay: false,
    inputs: [src(), int("len1", "Length 1", 35), int("len2", "Length 2", 20), int("sigLen", "Signal Length", 10)],
    plots: [
      { key: "pmo", title: "PMO", color: C.blue },
      { key: "signal", title: "Signal", color: C.orange },
    ],
    compute: (bars, p) => {
      // EMA with a 2/length smoothing factor (DecisionPoint's custom smoothing).
      const csf = (x: Series, len: number) => {
        const seed = ta.sma(x, len);
        const out = ta.fill(x.length);
        for (let i = 0; i < x.length; i++) {
          const prev = i > 0 ? out[i - 1] : NaN;
          out[i] = ta.isNa(prev) ? seed[i] : prev + (x[i] - prev) * (2 / len);
        }
        return out;
      };
      const first = csf(ta.roc(ta.source(bars, s(p, "source")), 1), n(p, "len1"));
      const pmo = csf(ta.scale(first, 10), n(p, "len2"));
      return { plots: { pmo, signal: ta.ema(pmo, n(p, "sigLen")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "specialk", name: "Pring's Special K", short: "Special K", category: "Momentum", overlay: false,
    inputs: [src(), int("sig1", "Signal Length 1", 100), int("sig2", "Signal Length 2", 100)],
    plots: [
      { key: "k", title: "Special K", color: C.blue },
      { key: "signal", title: "Signal", color: C.orange },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const parts: Array<[number, number, number]> = [
        [10, 10, 1], [15, 10, 2], [20, 10, 3], [30, 15, 4], [40, 50, 1], [65, 65, 2],
        [75, 75, 3], [100, 100, 4], [195, 130, 1], [265, 130, 2], [390, 130, 3], [530, 195, 4],
      ];
      let k = ta.fill(bars.length, 0);
      for (const [rocLen, smaLen, w] of parts) k = ta.add(k, ta.scale(ta.sma(ta.roc(x, rocLen), smaLen), w));
      return { plots: { k, signal: ta.sma(ta.sma(k, n(p, "sig1")), n(p, "sig2")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "rci", name: "Rank Correlation Index", short: "RCI", category: "Oscillators", overlay: false,
    inputs: [int("length", "Length", 10, 2), src()],
    plots: [{ key: "rci", title: "RCI", color: C.blue }],
    compute: (bars, p) => ({ plots: { rci: ta.rci(ta.source(bars, s(p, "source")), n(p, "length")) }, hlines: lines(C.gray, 80, 0, -80) }),
  },
  {
    id: "rciribbon", name: "RCI Ribbon", short: "RCI Ribbon", category: "Oscillators", overlay: false,
    inputs: [int("short", "Short RCI Length", 10, 2), int("middle", "Middle RCI Length", 30, 2), int("long", "Long RCI Length", 50, 2), src()],
    plots: [
      { key: "short", title: "Short RCI", color: C.red },
      { key: "middle", title: "Middle RCI", color: C.blue },
      { key: "long", title: "Long RCI", color: C.green },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      return {
        plots: { short: ta.rci(x, n(p, "short")), middle: ta.rci(x, n(p, "middle")), long: ta.rci(x, n(p, "long")) },
        hlines: lines(C.gray, 80, 0, -80),
      };
    },
  },
  {
    id: "rvgi", name: "Relative Vigor Index", short: "RVGI", category: "Oscillators", overlay: false,
    inputs: [int("length", "Length", 10)],
    plots: [
      { key: "rvi", title: "RVGI", color: "#008000" },
      { key: "signal", title: "Signal", color: "#FF0000" },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      const num = ta.sum(ta.swma(ta.sub(bars.close, bars.open)), len);
      const den = ta.sum(ta.swma(ta.sub(bars.high, bars.low)), len);
      const rvi = ta.div(num, den);
      return { plots: { rvi, signal: ta.swma(rvi) } };
    },
  },
  {
    id: "smiergodic", name: "SMI Ergodic Indicator", short: "SMII", category: "Momentum", overlay: false,
    inputs: [int("longLen", "Long Length", 20), int("shortLen", "Short Length", 5), int("sigLen", "Signal Line Length", 5)],
    plots: [
      { key: "smi", title: "SMI", color: C.blue },
      { key: "signal", title: "Signal", color: C.orange },
    ],
    compute: (bars, p) => {
      const erg = ta.tsi(bars.close, n(p, "shortLen"), n(p, "longLen"));
      return { plots: { smi: erg, signal: ta.ema(erg, n(p, "sigLen")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "smiergodicosc", name: "SMI Ergodic Oscillator", short: "SMIO", category: "Momentum", overlay: false,
    inputs: [int("longLen", "Long Length", 20), int("shortLen", "Short Length", 5), int("sigLen", "Signal Line Length", 5)],
    plots: [{ key: "osc", title: "SMI Ergodic Oscillator", color: "#FF5252", style: "histogram" }],
    compute: (bars, p) => {
      const erg = ta.tsi(bars.close, n(p, "shortLen"), n(p, "longLen"));
      return { plots: { osc: ta.sub(erg, ta.ema(erg, n(p, "sigLen"))) } };
    },
  },
  {
    id: "smi", name: "Stochastic Momentum Index", short: "SMI", category: "Oscillators", overlay: false,
    inputs: [int("lengthK", "%K Length", 10), int("lengthD", "%D Length", 3), int("lengthEma", "EMA Length", 3)],
    plots: [
      { key: "smi", title: "SMI", color: C.blue },
      { key: "ema", title: "SMI-based EMA", color: C.orange },
    ],
    compute: (bars, p) => {
      const lenK = n(p, "lengthK");
      const lenD = n(p, "lengthD");
      const hh = ta.highest(bars.high, lenK);
      const ll = ta.lowest(bars.low, lenK);
      const range = ta.sub(hh, ll);
      const rel = bars.close.map((c, i) => c - (hh[i] + ll[i]) / 2);
      const ee = (x: Series) => ta.ema(ta.ema(x, lenD), lenD);
      const smi = ta.zip(ee(rel), ee(range), (a, c) => 200 * (a / c));
      return { plots: { smi, ema: ta.ema(smi, n(p, "lengthEma")) }, hlines: lines(C.gray, 40, 0, -40), fills: [bandFill(40, -40, C.lightBlue)] };
    },
  },
  {
    id: "trix", name: "TRIX", short: "TRIX", category: "Momentum", overlay: false,
    inputs: [int("length", "Length", 18)],
    plots: [{ key: "trix", title: "TRIX", color: "#F44336" }],
    compute: (bars, p) => {
      const len = n(p, "length");
      const e3 = ta.ema(ta.ema(ta.ema(ta.map(bars.close, Math.log), len), len), len);
      return { plots: { trix: ta.scale(ta.change(e3), 10000) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "tsi", name: "True Strength Index", short: "TSI", category: "Momentum", overlay: false,
    inputs: [int("longLen", "Long Length", 25), int("shortLen", "Short Length", 13), int("sigLen", "Signal Length", 13)],
    plots: [
      { key: "tsi", title: "True Strength Index", color: C.blue },
      { key: "signal", title: "Signal", color: C.pink },
    ],
    compute: (bars, p) => {
      const t = ta.scale(ta.tsi(bars.close, n(p, "shortLen"), n(p, "longLen")), 100);
      return { plots: { tsi: t, signal: ta.ema(t, n(p, "sigLen")) }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "trendstrength", name: "Trend Strength Index", short: "TSI Trend", category: "Trend", overlay: false,
    inputs: [int("length", "Length", 14, 2)],
    plots: [{ key: "tsi", title: "Trend Strength Index", color: C.green }],
    precision: 3,
    compute: (bars, p) => {
      const idx = bars.close.map((_, i) => i);
      const t = ta.correlation(bars.close, idx, n(p, "length"));
      return {
        plots: { tsi: t },
        colors: { tsi: t.map((v) => (v >= 0 ? C.green : C.red)) },
        fills: [{ a: "tsi", b: 0, color: t.map((v) => (v >= 0 ? alpha(C.green, 0.15) : alpha(C.red, 0.15))) }],
        hlines: lines(C.gray, 0),
      };
    },
  },
  {
    id: "woodiescci", name: "Woodies CCI", short: "Woodies CCI", category: "Oscillators", overlay: false,
    inputs: [int("turbo", "CCI Turbo Length", 6, 3), int("length", "CCI 14 Length", 14, 7)],
    plots: [
      { key: "hist", title: "Histogram", color: "#9598A1", style: "histogram" },
      { key: "turbo", title: "CCI Turbo", color: "#4CAF50" },
      { key: "cci", title: "CCI 14", color: "#FF0000" },
    ],
    compute: (bars, p) => {
      const turbo = ta.cci(bars.close, n(p, "turbo"));
      const c14 = ta.cci(bars.close, n(p, "length"));
      const colors = c14.map((_, i) => {
        const prev = [1, 2, 3, 4, 5].map((k) => (i - k >= 0 ? c14[i - k] : NaN));
        return prev.every((v) => v > 0) ? alpha("#5B9CF6", 0.4) : prev.every((v) => v < 0) ? alpha("#EF5350", 0.4) : alpha("#9598A1", 0.4);
      });
      return {
        plots: { hist: c14, turbo, cci: c14 },
        colors: { hist: colors },
        hlines: lines(C.gray, 200, 100, 0, -100, -200),
      };
    },
  },
  {
    id: "bbpb", name: "Bollinger Bands %B", short: "BB %B", category: "Bands & Channels", overlay: false,
    inputs: [int("length", "Length", 20), src(), float("mult", "StdDev", 2, 0.1, 0.001)],
    plots: [{ key: "bbr", title: "Bollinger Bands %B", color: C.teal }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const basis = ta.sma(x, len);
      const dev = ta.scale(ta.stdev(x, len), n(p, "mult"));
      return {
        plots: { bbr: x.map((v, i) => (v - (basis[i] - dev[i])) / (2 * dev[i])) },
        hlines: lines(C.gray, 1, 0.5, 0),
        fills: [bandFill(1, 0, C.teal)],
      };
    },
  },
  {
    id: "bbw", name: "Bollinger BandWidth", short: "BBW", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 20), src(), float("mult", "StdDev", 2, 0.1, 0.001), int("expansion", "Highest Expansion Length", 125), int("contraction", "Lowest Contraction Length", 125)],
    plots: [
      { key: "bbw", title: "Bollinger BandWidth", color: C.blue },
      { key: "high", title: "Highest Expansion", color: C.red },
      { key: "low", title: "Lowest Contraction", color: C.green },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const basis = ta.sma(x, len);
      const dev = ta.scale(ta.stdev(x, len), n(p, "mult"));
      const bbw = basis.map((m, i) => ((2 * dev[i]) / m) * 100);
      return { plots: { bbw, high: ta.highest(bbw, n(p, "expansion")), low: ta.lowest(bbw, n(p, "contraction")) } };
    },
  },
  {
    id: "bbtrend", name: "BBTrend", short: "BBTrend", category: "Trend", overlay: false,
    inputs: [int("short", "Short BB Length", 20), int("long", "Long BB Length", 50), float("mult", "StdDev", 2, 0.1, 0.001)],
    plots: [{ key: "trend", title: "BBTrend", color: C.green, style: "histogram" }],
    compute: (bars, p) => {
      const bb = (len: number) => {
        const m = ta.sma(bars.close, len);
        const d = ta.scale(ta.stdev(bars.close, len), n(p, "mult"));
        return { m, u: ta.add(m, d), l: ta.sub(m, d) };
      };
      const sh = bb(n(p, "short"));
      const lo = bb(n(p, "long"));
      const trend = sh.m.map((m, i) => ((Math.abs(sh.l[i] - lo.l[i]) - Math.abs(sh.u[i] - lo.u[i])) / m) * 100);
      const colors = trend.map((v, i) => {
        const prev = i > 0 ? trend[i - 1] : NaN;
        return v > 0 ? (v > prev ? "#089981" : "#B2DFDB") : v < prev ? "#F23645" : "#FFCDD2";
      });
      return { plots: { trend }, colors: { trend: colors }, hlines: lines(C.gray, 0) };
    },
  },
  {
    id: "massindex", name: "Mass Index", short: "Mass Index", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 10)],
    plots: [{ key: "mi", title: "Mass Index", color: C.blue }],
    compute: (bars, p) => {
      const span = ta.sub(bars.high, bars.low);
      const e1 = ta.ema(span, 9);
      return { plots: { mi: ta.sum(ta.div(e1, ta.ema(e1, 9)), n(p, "length")) } };
    },
  },
  {
    id: "vortex", name: "Vortex Indicator", short: "VI", category: "Trend", overlay: false,
    inputs: [int("period", "Length", 14, 2)],
    plots: [
      { key: "plus", title: "VI +", color: C.blue },
      { key: "minus", title: "VI -", color: C.pink },
    ],
    compute: (bars, p) => {
      const len = n(p, "period");
      const vmp = ta.sum(bars.high.map((h, i) => (i > 0 ? Math.abs(h - bars.low[i - 1]) : NaN)), len);
      const vmm = ta.sum(bars.low.map((l, i) => (i > 0 ? Math.abs(l - bars.high[i - 1]) : NaN)), len);
      const str = ta.sum(ta.atr(bars, 1), len);
      return { plots: { plus: ta.div(vmp, str), minus: ta.div(vmm, str) } };
    },
  },
];
