import * as ta from "../core";
import { type Series } from "../core";
import { C, alpha, b, bool, int, float, n, s, select, src, type IndicatorDef } from "../types";

const zero = [{ price: 0, color: C.gray, dashed: true }];

const adlSeries = (bars: ta.Bars) =>
  ta.cum(
    bars.close.map((c, i) => {
      const h = bars.high[i];
      const l = bars.low[i];
      return (c === h && c === l) || h === l ? 0 : ((2 * c - l - h) / (h - l)) * bars.volume[i];
    })
  );

function volumeIndex(bars: ta.Bars, emaLen: number, when: (v: number, prev: number) => boolean) {
  const out = ta.fill(bars.length);
  out[0] = 1000;
  for (let i = 1; i < bars.length; i++) {
    const pct = (bars.close[i] - bars.close[i - 1]) / bars.close[i - 1];
    out[i] = when(bars.volume[i], bars.volume[i - 1]) ? out[i - 1] * (1 + pct) : out[i - 1];
  }
  return { plots: { index: out, ema: ta.ema(out, emaLen) } };
}

export const volume: IndicatorDef[] = [
  {
    id: "volume", name: "Volume", short: "Vol", category: "Volume", overlay: true, volumeOverlay: true,
    inputs: [bool("showMa", "Show Volume MA", false), int("maLength", "MA Length", 20), bool("prevClose", "Color Based on Previous Close", false)],
    plots: [
      { key: "vol", title: "Volume", color: alpha(C.green, 0.5), style: "histogram" },
      { key: "ma", title: "Volume MA", color: C.blue },
    ],
    precision: 0,
    compute: (bars, p) => {
      const byPrev = b(p, "prevClose");
      const plots: Record<string, Series> = { vol: bars.volume };
      if (b(p, "showMa")) plots.ma = ta.sma(bars.volume, n(p, "maLength"));
      return {
        plots,
        colors: {
          vol: bars.close.map((c, i) =>
            (byPrev ? i > 0 && c >= bars.close[i - 1] : c >= bars.open[i]) ? alpha(C.green, 0.5) : alpha(C.red, 0.5)
          ),
        },
      };
    },
  },
  {
    id: "obv", name: "On Balance Volume", short: "OBV", category: "Volume", overlay: false,
    inputs: [select("maType", "Smoothing Type", ["None", ...ta.MA_TYPES], "None"), int("maLength", "Smoothing Length", 14)],
    plots: [
      { key: "obv", title: "OnBalanceVolume", color: C.blue },
      { key: "ma", title: "Smoothing Line", color: C.yellow },
    ],
    precision: 0,
    compute: (bars, p) => {
      const obv = ta.cum(ta.change(bars.close).map((c, i) => (ta.isNa(c) ? NaN : Math.sign(c) * bars.volume[i])));
      const plots: Record<string, Series> = { obv };
      if (s(p, "maType") !== "None") plots.ma = ta.maByType(s(p, "maType"), obv, n(p, "maLength"), bars.volume);
      return { plots };
    },
  },
  {
    id: "adl", name: "Accumulation/Distribution", short: "Accum/Dist", category: "Volume", overlay: false,
    inputs: [],
    plots: [{ key: "ad", title: "Accumulation/Distribution", color: "#999915" }],
    precision: 0,
    compute: (bars) => ({ plots: { ad: adlSeries(bars) } }),
  },
  {
    id: "cmf", name: "Chaikin Money Flow", short: "CMF", category: "Volume", overlay: false,
    inputs: [int("length", "Length", 20)],
    plots: [{ key: "cmf", title: "MF", color: "#43A047" }],
    precision: 3,
    compute: (bars, p) => {
      const len = n(p, "length");
      const ad = bars.close.map((c, i) => {
        const h = bars.high[i];
        const l = bars.low[i];
        return (c === h && c === l) || h === l ? 0 : ((2 * c - l - h) / (h - l)) * bars.volume[i];
      });
      return { plots: { cmf: ta.div(ta.sum(ad, len), ta.sum(bars.volume, len)) }, hlines: zero };
    },
  },
  {
    id: "chaikinosc", name: "Chaikin Oscillator", short: "Chaikin Osc", category: "Volume", overlay: false,
    inputs: [int("fast", "Fast Length", 3), int("slow", "Slow Length", 10)],
    plots: [{ key: "osc", title: "Chaikin Oscillator", color: "#EC407A" }],
    precision: 0,
    compute: (bars, p) => {
      const ad = adlSeries(bars);
      return { plots: { osc: ta.sub(ta.ema(ad, n(p, "fast")), ta.ema(ad, n(p, "slow"))) }, hlines: zero };
    },
  },
  {
    id: "efi", name: "Elder Force Index", short: "EFI", category: "Volume", overlay: false,
    inputs: [int("length", "Length", 13)],
    plots: [{ key: "efi", title: "Elder Force Index", color: "#F44336" }],
    precision: 0,
    compute: (bars, p) => ({ plots: { efi: ta.ema(ta.mul(ta.change(bars.close), bars.volume), n(p, "length")) }, hlines: zero }),
  },
  {
    id: "eom", name: "Ease of Movement", short: "EOM", category: "Volume", overlay: false,
    inputs: [int("length", "Length", 14), int("divisor", "Divisor", 10000)],
    plots: [{ key: "eom", title: "EOM", color: "#43A047" }],
    precision: 4,
    compute: (bars, p) => {
      const hl2 = ta.source(bars, "hl2");
      const ch = ta.change(hl2);
      const raw = ch.map((c, i) => (n(p, "divisor") * c * (bars.high[i] - bars.low[i])) / bars.volume[i]);
      return { plots: { eom: ta.sma(raw, n(p, "length")) }, hlines: zero };
    },
  },
  {
    id: "klinger", name: "Klinger Oscillator", short: "KVO", category: "Volume", overlay: false,
    inputs: [int("fast", "Fast Length", 34), int("slow", "Slow Length", 55), int("signal", "Signal Length", 13)],
    plots: [
      { key: "kvo", title: "Klinger Oscillator", color: C.blue },
      { key: "signal", title: "Signal", color: "#43A047" },
    ],
    precision: 0,
    compute: (bars, p) => {
      const ch = ta.change(ta.source(bars, "hlc3"));
      const sv = ch.map((c, i) => (ta.isNa(c) ? NaN : c >= 0 ? bars.volume[i] : -bars.volume[i]));
      const kvo = ta.sub(ta.ema(sv, n(p, "fast")), ta.ema(sv, n(p, "slow")));
      return { plots: { kvo, signal: ta.ema(kvo, n(p, "signal")) }, hlines: zero };
    },
  },
  {
    id: "mfi", name: "Money Flow Index", short: "MFI", category: "Volume", overlay: false,
    inputs: [int("length", "Length", 14)],
    plots: [{ key: "mfi", title: "MF", color: C.purple }],
    compute: (bars, p) => ({
      plots: { mfi: ta.mfi(ta.source(bars, "hlc3"), bars.volume, n(p, "length")) },
      hlines: [80, 50, 20].map((price) => ({ price, color: C.gray, dashed: true })),
      fills: [{ a: 80, b: 20, color: alpha(C.purple, 0.1) }],
    }),
  },
  {
    id: "nvi", name: "Negative Volume Index", short: "NVI", category: "Volume", overlay: false,
    inputs: [int("emaLength", "EMA Length", 255)],
    plots: [
      { key: "index", title: "NVI", color: C.blue },
      { key: "ema", title: "EMA", color: C.orange },
    ],
    compute: (bars, p) => volumeIndex(bars, n(p, "emaLength"), (v, prev) => v < prev),
  },
  {
    id: "pvi", name: "Positive Volume Index", short: "PVI", category: "Volume", overlay: false,
    inputs: [int("emaLength", "EMA Length", 255)],
    plots: [
      { key: "index", title: "PVI", color: C.blue },
      { key: "ema", title: "EMA", color: C.orange },
    ],
    compute: (bars, p) => volumeIndex(bars, n(p, "emaLength"), (v, prev) => v > prev),
  },
  {
    id: "pvt", name: "Price Volume Trend", short: "PVT", category: "Volume", overlay: false,
    inputs: [src()],
    plots: [{ key: "pvt", title: "PVT", color: C.blue }],
    precision: 0,
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      return { plots: { pvt: ta.cum(x.map((v, i) => (i > 0 ? ((v - x[i - 1]) / x[i - 1]) * bars.volume[i] : NaN))) } };
    },
  },
  {
    id: "netvolume", name: "Net Volume", short: "Net Volume", category: "Volume", overlay: false,
    inputs: [],
    plots: [{ key: "nv", title: "Net Volume", color: C.blue }],
    precision: 0,
    compute: (bars) => ({
      plots: { nv: ta.change(bars.close).map((c, i) => (ta.isNa(c) ? NaN : c > 0 ? bars.volume[i] : c < 0 ? -bars.volume[i] : 0)) },
      hlines: zero,
    }),
  },
  {
    id: "pvo", name: "Percentage Volume Oscillator", short: "PVO", category: "Volume", overlay: false,
    inputs: [int("fast", "Fast Length", 12), int("slow", "Slow Length", 26), int("signal", "Signal Length", 9)],
    plots: [
      { key: "hist", title: "Histogram", color: "#26A69A", style: "histogram" },
      { key: "pvo", title: "PVO", color: C.blue },
      { key: "signal", title: "Signal", color: C.orange },
    ],
    compute: (bars, p) => {
      const f = ta.ema(bars.volume, n(p, "fast"));
      const sl = ta.ema(bars.volume, n(p, "slow"));
      const pvo = f.map((v, i) => ((v - sl[i]) / sl[i]) * 100);
      const signal = ta.ema(pvo, n(p, "signal"));
      const hist = ta.sub(pvo, signal);
      return {
        plots: { hist, pvo, signal },
        colors: { hist: hist.map((v, i) => (v >= 0 ? (i > 0 && hist[i - 1] < v ? "#26A69A" : "#B2DFDB") : i > 0 && hist[i - 1] < v ? "#FFCDD2" : "#FF5252")) },
        hlines: zero,
      };
    },
  },
];

export const volatility: IndicatorDef[] = [
  {
    id: "atr", name: "Average True Range", short: "ATR", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 14), select("smoothing", "Smoothing", ["RMA", "SMA", "EMA", "WMA"], "RMA")],
    plots: [{ key: "atr", title: "ATR", color: "#B71C1C" }],
    compute: (bars, p) => ({ plots: { atr: ta.maByType(s(p, "smoothing"), ta.tr(bars, true), n(p, "length")) } }),
  },
  {
    id: "adr", name: "Average Daily Range", short: "ADR", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 14)],
    plots: [{ key: "adr", title: "ADR", color: C.blue }],
    compute: (bars, p) => ({ plots: { adr: ta.sma(ta.sub(bars.high, bars.low), n(p, "length")) } }),
  },
  {
    id: "hv", name: "Historical Volatility", short: "HV", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 10)],
    plots: [{ key: "hv", title: "HV", color: C.blue }],
    compute: (bars, p) => {
      const spacing = ta.barSpacing(bars.time);
      // TradingView: annual = 365, per = 1 for intraday/daily bars, 7 otherwise.
      const per = spacing <= 86_400 * 1.5 ? 1 : 7;
      const logRet = bars.close.map((c, i) => (i > 0 ? Math.log(c / bars.close[i - 1]) : NaN));
      return { plots: { hv: ta.scale(ta.stdev(logRet, n(p, "length")), 100 * Math.sqrt(365 / per)) } };
    },
  },
  {
    id: "ulcer", name: "Ulcer Index", short: "Ulcer", category: "Volatility", overlay: false,
    inputs: [src(), int("length", "Length", 14)],
    plots: [{ key: "ulcer", title: "Ulcer Index", color: C.blue }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const hh = ta.highest(x, n(p, "length"));
      const dd2 = x.map((v, i) => ((100 * (v - hh[i])) / hh[i]) ** 2);
      return { plots: { ulcer: ta.map(ta.sma(dd2, n(p, "length")), Math.sqrt) } };
    },
  },
  {
    id: "rvi", name: "Relative Volatility Index", short: "RVI", category: "Volatility", overlay: false,
    inputs: [int("length", "Length", 10), src(), int("offset", "Offset", 0, -500)],
    plots: [{ key: "rvi", title: "RVI", color: C.purple }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const sd = ta.stdev(x, n(p, "length"));
      const ch = ta.change(x);
      const upper = ta.ema(sd.map((v, i) => (ta.isNa(ch[i]) || ta.isNa(v) ? NaN : ch[i] <= 0 ? 0 : v)), 14);
      const lower = ta.ema(sd.map((v, i) => (ta.isNa(ch[i]) || ta.isNa(v) ? NaN : ch[i] > 0 ? 0 : v)), 14);
      return {
        plots: { rvi: ta.zip(upper, lower, (u, l) => (u / (u + l)) * 100) },
        offsets: { rvi: n(p, "offset") },
        hlines: [80, 50, 20].map((price) => ({ price, color: C.gray, dashed: true })),
        fills: [{ a: 80, b: 20, color: alpha(C.purple, 0.1) }],
      };
    },
  },
];

// ---- community scripts, rebuilt from their published descriptions ---------

const ALMA_SD_VOL = ["Price StdDev", "Return StdDev"] as const;

export const community: IndicatorDef[] = [
  {
    id: "atrz", name: "ATR Z-Score [RZ]", short: "ATR Z", category: "Community", overlay: false,
    description: "How unusual the current ATR is versus its own recent history, in standard deviations.",
    inputs: [
      int("atrLength", "ATR Length", 14), int("lookback", "Z-Score Lookback", 100, 2),
      int("maLength", "Z-Score MA Length", 14), select("maType", "Z-Score MA Type", ["SMA", "EMA", "WMA", "RMA"], "SMA"),
      float("threshold", "Extreme Threshold", 2, 0.1, 0), bool("background", "Highlight Extremes", true),
    ],
    plots: [
      { key: "z", title: "ATR Z-Score", color: C.orange, style: "histogram" },
      { key: "ma", title: "Z-Score MA", color: C.yellow },
    ],
    compute: (bars, p) => {
      const a = ta.atr(bars, n(p, "atrLength"));
      const look = n(p, "lookback");
      const mean = ta.sma(a, look);
      const sd = ta.stdev(a, look);
      const z = a.map((v, i) => (sd[i] === 0 ? 0 : (v - mean[i]) / sd[i]));
      const th = n(p, "threshold");
      return {
        plots: { z, ma: ta.maByType(s(p, "maType"), z, n(p, "maLength")) },
        colors: { z: z.map((v) => (v >= 0 ? alpha("#FF9800", 0.75) : alpha(C.teal, 0.75))) },
        hlines: [
          { price: th, color: C.red, dashed: true },
          { price: 0, color: C.gray, dashed: true },
          { price: -th, color: C.green, dashed: true },
        ],
        bgColors: b(p, "background")
          ? z.map((v) => (v > th ? alpha(C.red, 0.15) : v < -th ? alpha(C.green, 0.15) : undefined))
          : undefined,
      };
    },
  },
  {
    id: "almasd", name: "ALMA SD Bands [RakoQuant]", short: "ALMA SD", category: "Community", overlay: true,
    description: "ALMA baseline with ALMA-smoothed standard deviation bands and a deadband regime filter.",
    inputs: [
      src(), int("length", "ALMA Length", 50, 2), float("offset", "ALMA Offset", 0.85, 0.01, 0), float("sigma", "ALMA Sigma", 6, 0.1, 0.1),
      select("volMode", "Volatility Mode", ALMA_SD_VOL, "Price StdDev"), int("sdLength", "StdDev Length", 30, 2),
      int("volSmooth", "Volatility Smoothing (ALMA)", 14, 1), float("mult", "Band Multiplier", 1.5, 0.1, 0),
      float("deadband", "Deadband (x volatility)", 0.25, 0.05, 0), bool("colorCandles", "Color Candles", false),
    ],
    plots: [
      { key: "basis", title: "Basis", color: C.gray, width: 2 },
      { key: "upper", title: "Upper Band", color: alpha(C.gray, 0.8) },
      { key: "lower", title: "Lower Band", color: alpha(C.gray, 0.8) },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const basis = ta.alma(x, n(p, "length"), n(p, "offset"), n(p, "sigma"));
      const rawVol =
        s(p, "volMode") === "Return StdDev"
          ? ta.mul(ta.stdev(x.map((v, i) => (i > 0 ? Math.log(v / x[i - 1]) : NaN)), n(p, "sdLength")), basis)
          : ta.stdev(x, n(p, "sdLength"));
      const vol = ta.alma(rawVol, n(p, "volSmooth"), n(p, "offset"), n(p, "sigma"));
      const upper = basis.map((m, i) => m + n(p, "mult") * vol[i]);
      const lower = basis.map((m, i) => m - n(p, "mult") * vol[i]);
      let regime = 0;
      const regimes = x.map((v, i) => {
        if (ta.isNa(basis[i]) || ta.isNa(vol[i])) return 0;
        const db = n(p, "deadband") * vol[i];
        if (v > basis[i] + db) regime = 1;
        else if (v < basis[i] - db) regime = -1;
        return regime;
      });
      const tint = (r: number, a: number) => (r === 1 ? alpha(C.green, a) : r === -1 ? alpha(C.red, a) : alpha(C.gray, a));
      return {
        plots: { basis, upper, lower },
        colors: { basis: regimes.map((r) => tint(r, 1)) },
        fills: [{ a: "upper", b: "lower", color: regimes.map((r) => tint(r, 0.08)) }],
        barColors: b(p, "colorCandles") ? regimes.map((r) => tint(r, 1)) : undefined,
      };
    },
  },
  {
    id: "ate", name: "Adaptive Trend Envelope [BackQuant]", short: "ATE", category: "Community", overlay: true,
    description: "Volatility-blended EMA spine with an EWMA log-return envelope, hysteresis and 3-state regimes.",
    inputs: [
      src(), int("fast", "Fast EMA", 21), int("slow", "Slow EMA", 89), int("volShort", "Short Volatility Length", 20, 2),
      int("volLong", "Long Volatility Length", 100, 2), int("smooth", "Spine Smoothing", 5), float("lambda", "EWMA Decay (lambda)", 0.94, 0.01, 0.5),
      float("mult", "Envelope Multiplier", 2, 0.1, 0), float("inner", "Inner Band (fraction of envelope)", 0.5, 0.05, 0),
      int("confirm", "Confirmation Bars", 2), bool("colorCandles", "Color Candles", true), bool("signals", "Show Signals", true),
    ],
    plots: [
      { key: "spine", title: "Trend Spine", color: C.gray, width: 2 },
      { key: "upper", title: "Upper Envelope", color: alpha(C.gray, 0.6) },
      { key: "lower", title: "Lower Envelope", color: alpha(C.gray, 0.6) },
      { key: "active", title: "Active Trend Line", color: C.gray, width: 2 },
      { key: "price", title: "Price", color: C.gray, display: "none" },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = bars.length;
      const ret = x.map((v, i) => (i > 0 ? Math.log(v / x[i - 1]) : NaN));
      const volS = ta.stdev(ret, n(p, "volShort"));
      const volL = ta.stdev(ret, n(p, "volLong"));
      const emaF = ta.ema(x, n(p, "fast"));
      const emaS = ta.ema(x, n(p, "slow"));
      // Calm markets (short vol < long vol) lean on the fast EMA, turbulent ones on the slow EMA.
      const blend = x.map((_, i) => {
        const ratio = volS[i] / volL[i];
        const w = ta.isNa(ratio) ? 0.5 : Math.min(1, Math.max(0, 1.5 - ratio));
        return w * emaF[i] + (1 - w) * emaS[i];
      });
      const spine = ta.ema(blend, n(p, "smooth"));
      const lambda = n(p, "lambda");
      const sigma = ta.fill(len);
      let variance = NaN;
      for (let i = 1; i < len; i++) {
        if (ta.isNa(ret[i])) continue;
        variance = ta.isNa(variance) ? ret[i] * ret[i] : lambda * variance + (1 - lambda) * ret[i] * ret[i];
        sigma[i] = Math.sqrt(variance);
      }
      const k = n(p, "mult");
      const upper = spine.map((m, i) => m * (1 + k * sigma[i]));
      const lower = spine.map((m, i) => m * (1 - k * sigma[i]));
      const innerK = k * n(p, "inner");
      const confirm = n(p, "confirm");
      const active = ta.fill(len);
      const stateColors: Array<string | undefined> = new Array(len);
      const fillColors: Array<string | undefined> = new Array(len);
      const barColors: Array<string | undefined> = new Array(len);
      const markers = [];
      let state = 0, above = 0, below = 0;
      for (let i = 0; i < len; i++) {
        if (ta.isNa(upper[i])) continue;
        above = x[i] > upper[i] ? above + 1 : 0;
        below = x[i] < lower[i] ? below + 1 : 0;
        const prev = state;
        if (state !== 1 && above >= confirm) state = 1;
        else if (state !== -1 && below >= confirm) state = -1;
        else if (state === 1 && x[i] < spine[i] * (1 - innerK * sigma[i])) state = 0;
        else if (state === -1 && x[i] > spine[i] * (1 + innerK * sigma[i])) state = 0;
        active[i] = state === 1 ? lower[i] : state === -1 ? upper[i] : x[i];
        const col = state === 1 ? C.green : state === -1 ? C.red : C.gray;
        stateColors[i] = col;
        fillColors[i] = state === 0 ? undefined : alpha(col, 0.18);
        barColors[i] = state === 0 ? alpha(C.gray, 0.9) : col;
        if (b(p, "signals") && state !== prev) {
          if (state === 1) markers.push({ index: i, position: "belowBar" as const, shape: "arrowUp" as const, color: C.green, text: "Buy" });
          if (state === -1) markers.push({ index: i, position: "aboveBar" as const, shape: "arrowDown" as const, color: C.red, text: "Sell" });
        }
      }
      return {
        plots: { spine, upper, lower, active, price: x },
        colors: { spine: stateColors, active: stateColors },
        fills: [{ a: "price", b: "active", color: fillColors }],
        markers,
        barColors: b(p, "colorCandles") ? barColors : undefined,
      };
    },
  },
];

// Bitcoin Power Law Oscillator [InvestorUnknown] — ported from the published Pine v6
// source (MPL-2.0). Fair value follows price ≈ 10^(A + B·log10(days since 2009-01-01));
// the oscillator is how far price sits from that midline, rescaled to -1…+1 against the
// extremes seen so far. Built for a BTC chart — the model is Bitcoin's, not a generic one.
const POWER_LAW_EPOCH = Date.UTC(2009, 0, 1) / 1000; // the script's day count: barssince(first BLX bar) + 564
const NORMALIZATION_START = Date.UTC(2011, 0, 1) / 1000;

/** Linear blend between two hex colors, like Pine's color.from_gradient. */
function gradient(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * clamped);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

community.push({
  id: "btcpowerlaw",
  name: "Bitcoin Power Law Oscillator [InvestorUnknown]",
  short: "BTC Power Law",
  category: "Community",
  overlay: false,
  description: "Distance from the Bitcoin power-law midline, rescaled to -1…+1. Meant for a BTC chart; other assets need the fitted mode.",
  inputs: [
    src(),
    float("coefA", "Regression Coef. A", -16.98212206, 0.00000001),
    float("coefB", "Regression Coef. B", 5.83430649, 0.00000001),
    bool("fit", "Fit A and B to the loaded range", false),
    bool("plotMa", "Plot Moving Average", true),
    select("maType", "Moving Average Type", ["SMA", "EMA"], "SMA"),
    int("maLength", "Moving Average Length", 200),
  ],
  plots: [
    { key: "osc", title: "Power Law Oscillator", color: C.red, width: 2 },
    { key: "ma", title: "Moving Average", color: "#9C27B0", width: 2 },
    { key: "midline", title: "Power law midline", color: C.gray, display: "legend" },
    { key: "distance", title: "Midline distance %", color: C.gray, display: "legend" },
  ],
  precision: 3,
  compute: (bars, p) => {
    const price = ta.source(bars, s(p, "source"));
    const days = bars.time.map((t) => Math.max(1, Math.floor((t - POWER_LAW_EPOCH) / 86_400)));
    const logDays = days.map(Math.log10);

    let intercept = n(p, "coefA");
    let slope = n(p, "coefB");
    if (b(p, "fit")) {
      // Least squares of log10(price) on log10(days) over the loaded bars, so the same
      // oscillator can be read on assets the Bitcoin coefficients don't describe.
      const pts = price.map((v, i) => [logDays[i], Math.log10(v)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (pts.length >= 2) {
        const mean = (get: (pt: number[]) => number) => pts.reduce((sum, pt) => sum + get(pt), 0) / pts.length;
        const mx = mean((pt) => pt[0]);
        const my = mean((pt) => pt[1]);
        const cov = pts.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
        const varX = pts.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
        if (varX > 0) {
          slope = cov / varX;
          intercept = my - slope * mx;
        }
      }
    }

    const midline = logDays.map((ld) => Math.pow(10, intercept + slope * ld));
    // The script rounds the percentage distance to whole points before normalizing.
    const distance = price.map((v, i) => (v > 0 ? Math.round((midline[i] / v - 1) * 100) : NaN));

    // Running extremes from 2011 onwards; nothing is plotted until both exist.
    const osc = ta.fill(bars.length);
    let min = NaN;
    let max = NaN;
    for (let i = 0; i < bars.length; i++) {
      const value = -distance[i];
      if (!Number.isFinite(value)) continue;
      if (bars.time[i] >= NORMALIZATION_START) {
        if (!Number.isFinite(max) || value > max) max = value;
        if (!Number.isFinite(min) || value < min) min = value;
      }
      if (Number.isFinite(min) && Number.isFinite(max) && max !== min) {
        osc[i] = (2 * (value - min)) / (max - min) - 1;
      }
    }

    const ma = b(p, "plotMa") ? ta.maByType(s(p, "maType"), osc, n(p, "maLength")) : ta.fill(bars.length);
    // Green at -1 through red at +1, with the fill to the zero line fading out at zero.
    const line = osc.map((v) => (Number.isFinite(v) ? gradient("#4CAF50", "#F23645", (v + 1) / 2) : undefined));
    const fill = osc.map((v) =>
      Number.isFinite(v) ? alpha(v >= 0 ? "#F23645" : "#4CAF50", Math.min(0.7, 0.7 * Math.abs(v))) : undefined
    );

    return {
      plots: { osc, ma, midline, distance },
      colors: { osc: line },
      fills: [{ a: "osc", b: 0, color: fill }],
      hlines: [
        { price: 1, color: C.gray, dashed: true },
        { price: 0, color: C.gray, dashed: true },
        { price: -1, color: C.gray, dashed: true },
      ],
    };
  },
});

// Bitcoin Thermocap [InvestorUnknown] — ported from the published Pine v5 source (MPL-2.0).
// Thermocap is the running total of what miners were paid: every day's blocks mined times
// that day's price. The script plots price over that total (x1e6), its log, the log over
// its own moving average, or that ratio normalized against decaying extremes since 2012.
//
// Like the script (INDEX:BTCUSD and BTC_BLOCKSMINED via request.security) it reads daily
// Bitcoin data whatever the chart shows, and it runs over the full history from 2010 before
// sampling onto the chart's bars — so a short chart range shows the same values as a daily
// chart of all of Bitcoin's history would.
const THERMOCAP_NORMALIZATION_START = Date.UTC(2012, 0, 1) / 1000;
const THERMOCAP_MODES = ["RAW", "LOG", "MA Oscillator", "Normalized MA Oscillator"] as const;

export type ThermocapSeries = { thermocap: Series; log: Series; maOsc: Series; normalized: Series };

/** The script's calculations, one value per day of `daily`. */
export function thermocapDaily(
  daily: { time: number[]; price: number[]; blocks: number[] },
  p: { maType: string; maLen: number; lim: number; neg: boolean; decay: number }
): ThermocapSeries {
  const len = daily.time.length;
  const thermocap = ta.fill(len);
  let historical = NaN;
  for (let i = 0; i < len; i++) {
    if (Number.isNaN(historical)) historical = 0;
    historical += daily.blocks[i] * daily.price[i];
    // Pine division by zero is na, e.g. before the first priced day.
    thermocap[i] = historical !== 0 ? (daily.price[i] / historical) * 1_000_000 : NaN;
  }
  const log = thermocap.map((v) => Math.log(v));
  const ma = p.maType === "SMA" ? ta.sma(log, p.maLen) : ta.ema(log, p.maLen);
  const maOsc = log.map((v, i) => v / ma[i]);

  const normalized = ta.fill(len);
  let min = NaN;
  let max = NaN;
  for (let i = 0; i < len; i++) {
    const x = maOsc[i];
    if (daily.time[i] >= THERMOCAP_NORMALIZATION_START) {
      // `x > max or na(max)`: an na oscillator resets an na extreme to na, as in Pine.
      if (x > max || Number.isNaN(max)) max = x;
      if (min > x || Number.isNaN(min)) min = x;
      max *= p.decay;
      min *= p.decay;
    }
    const scale = p.lim * (p.neg ? 2 : 1);
    const range = max - min; // Pine: dividing by zero is na
    normalized[i] = range !== 0 ? (scale * (x - min)) / range - (p.neg ? p.lim : 0) : NaN;
  }
  return { thermocap, log, maOsc, normalized };
}

/** For each chart bar, the index of the daily row Pine's request.security("1D") would
 *  return: the bar's own day on daily-or-faster charts, the last day inside the bar on
 *  weekly and monthly ones. -1 before the data starts. */
function dailyIndexForBars(barTimes: number[], dayTimes: number[]): number[] {
  const multiDay = ta.barSpacing(barTimes) > 1.5 * 86_400;
  const out: number[] = [];
  let j = -1;
  for (let i = 0; i < barTimes.length; i++) {
    const end = multiDay ? (i + 1 < barTimes.length ? barTimes[i + 1] - 1 : Infinity) : barTimes[i];
    const day = Number.isFinite(end) ? Math.floor(end / 86_400) * 86_400 : Infinity;
    while (j + 1 < dayTimes.length && dayTimes[j + 1] <= day) j++;
    out.push(j);
  }
  return out;
}

community.push({
  id: "btcthermocap",
  name: "Bitcoin Thermocap [InvestorUnknown]",
  short: "BTC Thermocap",
  category: "Community",
  overlay: false,
  needs: ["btcDaily"],
  description: "Bitcoin price over cumulative miner revenue (blocks mined × price), from daily on-chain data whatever the chart shows.",
  inputs: [
    select("mode", "Display Mode", THERMOCAP_MODES, "MA Oscillator"),
    select("maType", "Moving Average Type", ["SMA", "EMA"], "EMA"),
    int("maLen", "MA Length", 365),
    float("lim", "Limit", 1, 0.1, 0),
    bool("neg", "Allow Negatives", true),
    { key: "decay", label: "Decay", type: "float", default: 0.99998, step: 0.00001, min: 0, max: 1 },
    bool("gradient", "Use Gradient Colors", true),
  ],
  plots: [{ key: "value", title: "Plot Value", color: "#4CAF50", width: 3 }],
  precision: 4,
  compute: (bars, p, ext) => {
    const value = ta.fill(bars.length);
    const daily = ext?.btcDaily;
    if (!daily || daily.time.length === 0) return { plots: { value } };

    const lim = n(p, "lim");
    const neg = b(p, "neg");
    const series = thermocapDaily(daily, { maType: s(p, "maType"), maLen: n(p, "maLen"), lim, neg, decay: n(p, "decay") });
    const mode = s(p, "mode");
    const source =
      mode === "RAW" ? series.thermocap : mode === "LOG" ? series.log : mode === "MA Oscillator" ? series.maOsc : series.normalized;

    const index = dailyIndexForBars(bars.time, daily.time);
    for (let i = 0; i < bars.length; i++) if (index[i] >= 0) value[i] = source[index[i]];

    // Pine's color.blue / color.red / color.green / color.orange.
    const fixed = mode === "RAW" ? "#2196F3" : mode === "LOG" ? "#F23645" : mode === "MA Oscillator" ? "#4CAF50" : null;
    if (fixed) return { plots: { value }, colors: { value: value.map(() => fixed) } };

    const bottom = neg ? -lim : 0;
    const colors = value.map((v) =>
      !Number.isFinite(v) ? undefined : b(p, "gradient") ? gradient("#4CAF50", "#F23645", (v - bottom) / (lim - bottom)) : "#FF9800"
    );
    return { plots: { value }, colors: { value: colors } };
  },
});
