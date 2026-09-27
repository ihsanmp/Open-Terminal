// Machine Learning: Lorentzian Classification — a port of jdehorty's TradingView script and
// the two libraries it imports (jdehorty/MLExtensions/2, jdehorty/KernelFunctions/2).
//
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy
// of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// © jdehorty (original Pine Script); this file is the TypeScript adaptation.

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { colorNew, formatPattern } from "../pine";
import { bool, float, int, n, s, b, select, src, type Color, type IndicatorDef, type IndicatorResult, type IndicatorTable, type Label, type Marker, type Params } from "../types";

// ---- jdehorty/MLExtensions/2 -------------------------------------------------------------

/** Rescales to [min, max] using the highest and lowest values seen so far. */
export function normalize(x: Series, min: number, max: number): Series {
  let hMin = 10e10;
  let hMax = -10e10;
  return x.map((v) => {
    hMin = Math.min(ta.nz(v, hMin), hMin);
    hMax = Math.max(ta.nz(v, hMax), hMax);
    return min + ((max - min) * (v - hMin)) / Math.max(hMax - hMin, 10e-10);
  });
}

export const rescale = (v: number, oldMin: number, oldMax: number, newMin: number, newMax: number) =>
  newMin + ((newMax - newMin) * (v - oldMin)) / Math.max(oldMax - oldMin, 10e-10);

export const nRsi = (x: Series, n1: number, n2: number) => ta.ema(ta.rsi(x, n1), n2).map((v) => rescale(v, 0, 100, 0, 1));

export const nCci = (x: Series, n1: number, n2: number) => normalize(ta.ema(ta.cci(x, n1), n2), 0, 1);

export function nWt(x: Series, n1: number, n2: number): Series {
  const ema1 = ta.ema(x, n1);
  const ema2 = ta.ema(x.map((v, i) => Math.abs(v - ema1[i])), n1);
  const ci = x.map((v, i) => (v - ema1[i]) / (0.015 * ema2[i]));
  const wt1 = ta.ema(ci, n2);
  const wt2 = ta.sma(wt1, 4);
  return normalize(wt1.map((v, i) => v - wt2[i]), 0, 1);
}

/** The libraries' own ADX: Wilder sums seeded at 0 with nz() on the previous bar. */
function adx(bars: Bars, closeSrc: Series, length: number): Series {
  const { high, low } = bars;
  let trS = 0, plusS = 0, minusS = 0;
  const dx = high.map((h, i) => {
    const pc = ta.nz(closeSrc[i - 1]);
    const ph = ta.nz(high[i - 1]);
    const pl = ta.nz(low[i - 1]);
    const tr = Math.max(Math.max(h - low[i], Math.abs(h - pc)), Math.abs(low[i] - pc));
    const plus = h - ph > pl - low[i] ? Math.max(h - ph, 0) : 0;
    const minus = pl - low[i] > h - ph ? Math.max(pl - low[i], 0) : 0;
    trS = trS - trS / length + tr;
    plusS = plusS - plusS / length + plus;
    minusS = minusS - minusS / length + minus;
    const diP = (plusS / trS) * 100;
    const diN = (minusS / trS) * 100;
    return (Math.abs(diP - diN) / (diP + diN)) * 100;
  });
  return ta.rma(dx, length);
}

export const nAdx = (bars: Bars, n1: number) => adx(bars, bars.close, n1).map((v) => rescale(v, 0, 100, 0, 1));

export function regimeFilter(bars: Bars, x: Series, threshold: number, use: boolean): boolean[] {
  let v1 = 0, v2 = 0, klmf = 0;
  const absSlope = x.map((v, i) => {
    v1 = 0.2 * (v - x[i - 1]) + 0.8 * ta.nz(v1);
    v2 = 0.1 * (bars.high[i] - bars.low[i]) + 0.8 * ta.nz(v2);
    const omega = Math.abs(v1 / v2);
    const alpha = (-(omega ** 2) + Math.sqrt(omega ** 4 + 16 * omega ** 2)) / 8;
    const prev = klmf;
    klmf = alpha * v + (1 - alpha) * ta.nz(klmf);
    return Math.abs(klmf - (i > 0 ? prev : NaN));
  });
  const avg = ta.ema(absSlope, 200);
  return absSlope.map((v, i) => (use ? (v - avg[i]) / avg[i] >= threshold : true));
}

export const filterAdx = (bars: Bars, x: Series, length: number, threshold: number, use: boolean) =>
  adx(bars, x, length).map((v) => (use ? v > threshold : true));

export function filterVolatility(bars: Bars, minLength: number, maxLength: number, use: boolean): boolean[] {
  const recent = ta.atr(bars, minLength);
  const historical = ta.atr(bars, maxLength);
  return recent.map((v, i) => (use ? v > historical[i] : true));
}

// ---- jdehorty/KernelFunctions/2 ----------------------------------------------------------

/** Nadaraya-Watson with a rational quadratic kernel over the last `startAtBar + 2` bars. */
export function rationalQuadratic(x: Series, lookback: number, relativeWeight: number, startAtBar: number): Series {
  return x.map((_, i) => {
    let cur = 0, cum = 0;
    for (let k = 0; k <= 1 + startAtBar; k++) {
      const w = Math.pow(1 + k ** 2 / (lookback ** 2 * 2 * relativeWeight), -relativeWeight);
      cur += (i - k >= 0 ? x[i - k] : NaN) * w;
      cum += w;
    }
    return cur / cum;
  });
}

export function gaussian(x: Series, lookback: number, startAtBar: number): Series {
  return x.map((_, i) => {
    let cur = 0, cum = 0;
    for (let k = 0; k <= 1 + startAtBar; k++) {
      const w = Math.exp(-(k ** 2) / (2 * lookback ** 2));
      cur += (i - k >= 0 ? x[i - k] : NaN) * w;
      cum += w;
    }
    return cur / cum;
  });
}

// ---- The indicator -------------------------------------------------------------------------

const FEATURES = ["RSI", "WT", "CCI", "ADX"] as const;
const FEATURE_DEFAULTS: Array<[string, number, number]> = [
  ["RSI", 14, 1],
  ["WT", 10, 11],
  ["CCI", 20, 1],
  ["ADX", 20, 2],
  ["RSI", 9, 1],
];
const GREEN = "#009988";
const RED = "#CC3311";

export const lorentzian: IndicatorDef = {
  id: "lorentzian-classification",
  name: "Machine Learning: Lorentzian Classification",
  short: "Lorentzian Classification v2.0",
  category: "Community",
  overlay: true,
  precision: 4,
  aliases: ["Lorentzian", "Machine Learning", "KNN"],
  legendInputs: ["source", "neighborsCount", "maxBarsBack", "featureCount"],
  inputs: [
    src("close"),
    int("neighborsCount", "Neighbors Count", 8, 1, 100),
    int("maxBarsBack", "Max Bars Back", 2000, 1, 100000),
    int("featureCount", "Feature Count", 5, 2, 5),
    int("colorCompression", "Color Compression", 1, 1, 10),
    bool("showExits", "Show Default Exits", false),
    bool("useDynamicExits", "Use Dynamic Exits", false),
    bool("showTradeStats", "Show Trade Stats", true),
    bool("useWorstCase", "Use Worst Case Estimates", false),
    bool("includeFullHistory", "Include Full History", false),
    bool("useVolatilityFilter", "Use Volatility Filter", true),
    bool("useRegimeFilter", "Use Regime Filter", true),
    float("regimeThreshold", "Regime Threshold", -0.1, 0.1, -10),
    bool("useAdxFilter", "Use ADX Filter", false),
    int("adxThreshold", "ADX Threshold", 20, 0, 100),
    ...FEATURE_DEFAULTS.flatMap(([f, a, bb], k) => [
      select(`f${k + 1}`, `Feature ${k + 1}`, FEATURES, f),
      int(`f${k + 1}a`, `Feature ${k + 1} Parameter A`, a, 1),
      int(`f${k + 1}b`, `Feature ${k + 1} Parameter B`, bb, 1),
    ]),
    bool("useEmaFilter", "Use EMA Filter", false),
    int("emaPeriod", "EMA Period", 200, 1),
    bool("useSmaFilter", "Use SMA Filter", false),
    int("smaPeriod", "SMA Period", 200, 1),
    bool("useKernelFilter", "Trade with Kernel", true),
    bool("showKernelEstimate", "Show Kernel Estimate", true),
    bool("useKernelSmoothing", "Enhance Kernel Smoothing", false),
    int("h", "Lookback Window", 8, 3),
    float("r", "Relative Weighting", 8, 0.25, 0),
    int("x", "Regression Level", 25, 0),
    int("lag", "Lag", 2, 0),
    bool("showBarColors", "Show Bar Colors", true),
    bool("showBarPredictions", "Show Bar Prediction Values", true),
    bool("useAtrOffset", "Use ATR Offset", true),
    float("barPredictionsOffset", "Bar Prediction Offset", 0, 0.1, 0),
    bool("useConfidenceGradient", "Use Confidence Gradient", true),
    select("barColorScheme", "Bar Color Scheme", ["Default", "Solid"], "Default"),
  ],
  plots: [
    { key: "kernel", title: "Kernel Regression Estimate", color: colorNew(GREEN, 20), width: 2 },
    { key: "backTestStream", title: "Backtest Stream", color: "#787b86", display: "none" },
  ],
  compute: (bars, p) => lorentzianClassification(bars, p),
};

function featureSeries(bars: Bars, name: string, a: number, bb: number): Series {
  switch (name) {
    case "RSI":
      return nRsi(bars.close, a, bb);
    case "WT":
      return nWt(ta.source(bars, "hlc3"), a, bb);
    case "CCI":
      return nCci(bars.close, a, bb);
    default:
      return nAdx(bars, a);
  }
}

/** Pine's `for i = from to to`: counts down when from > to. */
function* pineRange(from: number, to: number) {
  if (from <= to) for (let i = from; i <= to; i++) yield i;
  else for (let i = from; i >= to; i--) yield i;
}

const truthy = (v: number) => Number.isFinite(v) && v !== 0;

/** ta.barssince(cond) for every bar. */
function barsSince(cond: boolean[]): number[] {
  let last = NaN;
  return cond.map((c, i) => (c ? (last = i, 0) : Number.isNaN(last) ? NaN : i - last));
}

export function lorentzianClassification(bars: Bars, p: Params): IndicatorResult {
  const len = bars.length;
  const last = len - 1;
  const source = ta.source(bars, s(p, "source"));
  const { high, low, close } = bars;
  const neighbors = n(p, "neighborsCount");
  const maxBarsBack = n(p, "maxBarsBack");
  const featureCount = n(p, "featureCount");
  const useGradient = b(p, "useConfidenceGradient");

  const features = [1, 2, 3, 4, 5].slice(0, featureCount).map((k) => featureSeries(bars, s(p, `f${k}`), n(p, `f${k}a`), n(p, `f${k}b`)));
  const yTrain = source.map((v, i) => {
    const past = i >= 4 ? source[i - 4] : NaN;
    return past < v ? -1 : past > v ? 1 : 0;
  });

  const volatility = filterVolatility(bars, 1, 10, b(p, "useVolatilityFilter"));
  const regime = regimeFilter(bars, ta.source(bars, "ohlc4"), n(p, "regimeThreshold"), b(p, "useRegimeFilter"));
  const adxOk = filterAdx(bars, source, 14, n(p, "adxThreshold"), b(p, "useAdxFilter"));

  const maxBarsBackIndex = last >= maxBarsBack ? last - maxBarsBack : 0;
  const startIndex = b(p, "includeFullHistory") ? 0 : maxBarsBackIndex;
  const predictions: number[] = [];
  const distances: number[] = [];
  let prediction = 0;
  const predictionAt = new Array<number>(len).fill(0);
  const signal = new Array<number>(len).fill(0);

  for (let bar = 0; bar < len; bar++) {
    if (bar >= maxBarsBackIndex) {
      let lastDistance = -1;
      const size = Math.min(maxBarsBack - 1, bar);
      const sizeLoop = Math.min(maxBarsBack - 1, size);
      for (const i of pineRange(startIndex, sizeLoop)) {
        if (i > bar) break; // array.get past the end: the Pine script would stop with an error here
        let d = 0;
        for (const f of features) d += Math.log(1 + Math.abs(f[bar] - f[i]));
        if (d >= lastDistance && i % 4 !== 0) {
          lastDistance = d;
          distances.push(d);
          predictions.push(Math.round(yTrain[i]));
          if (predictions.length > neighbors) {
            lastDistance = distances[Math.round((neighbors * 3) / 4)];
            distances.shift();
            predictions.shift();
          }
        }
      }
      prediction = predictions.reduce((a, v) => a + v, 0);
    }
    predictionAt[bar] = prediction;
    const all = volatility[bar] && regime[bar] && adxOk[bar];
    signal[bar] = prediction > 0 && all ? 1 : prediction < 0 && all ? -1 : bar > 0 ? signal[bar - 1] : 0;
  }

  const ema = ta.ema(close, n(p, "emaPeriod"));
  const sma = ta.sma(close, n(p, "smaPeriod"));
  const emaUp = close.map((c, i) => (b(p, "useEmaFilter") ? c > ema[i] : true));
  const emaDown = close.map((c, i) => (b(p, "useEmaFilter") ? c < ema[i] : true));
  const smaUp = close.map((c, i) => (b(p, "useSmaFilter") ? c > sma[i] : true));
  const smaDown = close.map((c, i) => (b(p, "useSmaFilter") ? c < sma[i] : true));

  const change = (i: number) => (i >= 1 ? signal[i] - signal[i - 1] : NaN);
  let barsHeld = 0;
  const held = signal.map((_, i) => (barsHeld = truthy(change(i)) ? 0 : barsHeld + 1));
  const isEarlyFlip = signal.map((_, i) => truthy(change(i)) && (truthy(change(i - 1)) || truthy(change(i - 2)) || truthy(change(i - 3))));
  const isBuy = signal.map((v, i) => v === 1 && emaUp[i] && smaUp[i]);
  const isSell = signal.map((v, i) => v === -1 && emaDown[i] && smaDown[i]);
  const isLastBuy = signal.map((_, i) => i >= 4 && signal[i - 4] === 1 && emaUp[i - 4] && smaUp[i - 4]);
  const isLastSell = signal.map((_, i) => i >= 4 && signal[i - 4] === -1 && emaDown[i - 4] && smaDown[i - 4]);
  const isNewBuy = isBuy.map((v, i) => v && truthy(change(i)));
  const isNewSell = isSell.map((v, i) => v && truthy(change(i)));

  const yhat1 = rationalQuadratic(source, n(p, "h"), n(p, "r"), n(p, "x"));
  const yhat2 = gaussian(source, n(p, "h") - n(p, "lag"), n(p, "x"));
  const smoothing = b(p, "useKernelSmoothing");
  const isBearishRate = yhat1.map((v, i) => yhat1[i - 1] > v);
  const isBullishRate = yhat1.map((v, i) => yhat1[i - 1] < v);
  const isBearishChange = yhat1.map((_, i) => isBearishRate[i] && yhat1[i - 2] < yhat1[i - 1]);
  const isBullishChange = yhat1.map((_, i) => isBullishRate[i] && yhat1[i - 2] > yhat1[i - 1]);
  const isBullishSmooth = yhat2.map((v, i) => v >= yhat1[i]);
  const isBearishSmooth = yhat2.map((v, i) => v <= yhat1[i]);
  const alertBullish = yhat1.map((_, i) => (smoothing ? ta.crossover(yhat2, yhat1, i) : isBullishChange[i]));
  const alertBearish = yhat1.map((_, i) => (smoothing ? ta.crossunder(yhat2, yhat1, i) : isBearishChange[i]));
  const isBullish = yhat1.map((_, i) => (b(p, "useKernelFilter") ? (smoothing ? isBullishSmooth[i] : isBullishRate[i]) : true));
  const isBearish = yhat1.map((_, i) => (b(p, "useKernelFilter") ? (smoothing ? isBearishSmooth[i] : isBearishRate[i]) : true));

  const cGreen = colorNew(GREEN, 20);
  const cRed = colorNew(RED, 20);
  const kernelColors: Color[] = yhat1.map((_, i) =>
    b(p, "showKernelEstimate") ? ((smoothing ? isBullishSmooth[i] : isBullishRate[i]) ? cGreen : cRed) : colorNew("#000000", 100)
  );

  const startLong = isNewBuy.map((v, i) => v && isBullish[i] && emaUp[i] && smaUp[i]);
  const startShort = isNewSell.map((v, i) => v && isBearish[i] && emaDown[i] && smaDown[i]);
  const sinceLong = barsSince(startLong);
  const sinceShort = barsSince(startShort);
  const sinceBullAlert = barsSince(alertBullish);
  const sinceBearAlert = barsSince(alertBearish);
  const validShortExit = sinceShort.map((v, i) => sinceBullAlert[i] > v);
  const validLongExit = sinceLong.map((v, i) => sinceBearAlert[i] > v);
  const endLongDynamic = isBearishChange.map((v, i) => v && i > 0 && validLongExit[i - 1]);
  const endShortDynamic = isBullishChange.map((v, i) => v && i > 0 && validShortExit[i - 1]);
  const endLongStrict = held.map(
    (h, i) => ((h === 4 && isLastBuy[i]) || (h > 0 && h < 4 && isNewSell[i] && isLastBuy[i])) && i >= 4 && startLong[i - 4]
  );
  const endShortStrict = held.map(
    (h, i) => ((h === 4 && isLastSell[i]) || (h > 0 && h < 4 && isNewBuy[i] && isLastSell[i])) && i >= 4 && startShort[i - 4]
  );
  const dynamicValid = !b(p, "useEmaFilter") && !b(p, "useSmaFilter") && !smoothing;
  const dynamic = b(p, "useDynamicExits") && dynamicValid;
  const endLong = dynamic ? endLongDynamic : endLongStrict;
  const endShort = dynamic ? endShortDynamic : endShortStrict;

  const shade = (base: string, pred: number) => {
    if (!useGradient) return base;
    const scaled = Math.min(Math.abs(pred), 10);
    return scaled >= 9 ? base : colorNew(base, 10 * (9 - Math.max(0, Math.floor(scaled))));
  };
  const markers: Marker[] = [];
  const labels: Label[] = [];
  for (let i = 0; i < len; i++) {
    const pred = predictionAt[i];
    if (startLong[i]) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: shade(GREEN, pred) });
    if (startShort[i]) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: shade(RED, -pred) });
    if (endLong[i] && b(p, "showExits")) labels.push({ index: i, price: high[i], text: "", style: "cross", bg: useGradient ? cGreen : GREEN, size: "tiny" });
    if (endShort[i] && b(p, "showExits")) labels.push({ index: i, price: low[i], text: "", style: "cross", bg: useGradient ? cRed : RED, size: "tiny" });
  }

  // Per-bar prediction values (the script's label.new on every bar; the chart keeps the last 500).
  const cNeutral = colorNew("#787b86", 25);
  const cPred = predictionAt.map((v) => (v > 0 ? shade(GREEN, v) : v < 0 ? shade(RED, -v) : cNeutral));
  const atr1 = ta.atr(bars, 1);
  const hl2 = ta.source(bars, "hl2");
  if (b(p, "showBarPredictions")) {
    for (let i = Math.max(0, len - 500); i < len; i++) {
      const v = predictionAt[i];
      const y = b(p, "useAtrOffset")
        ? v > 0 ? high[i] + atr1[i] : low[i] - atr1[i]
        : v > 0 ? high[i] + (hl2[i] * n(p, "barPredictionsOffset")) / 20 : low[i] - (hl2[i] * n(p, "barPredictionsOffset")) / 30;
      labels.push({ index: i, price: y, text: formatPattern(v, "#.####"), style: v > 0 ? "down" : "up", textColor: cPred[i], size: "normal" });
    }
  }

  const compression = Math.max(neighbors / n(p, "colorCompression"), 1);
  const solid = (pred: number) => {
    if (pred === 0) return "#787B86";
    const idx = Math.trunc(Math.min(Math.round((Math.abs(pred) / compression) * 9), 9));
    const f = (idx + 1) / 10;
    const [r, g, bl] = pred > 0 ? [0, 153, 136] : [204, 51, 17];
    const c = (to: number) => Math.trunc(255 - f * (255 - to));
    return `rgb(${c(r)},${c(g)},${c(bl)})`;
  };
  const barColors: Color[] | undefined = b(p, "showBarColors")
    ? predictionAt.map((v, i) => (s(p, "barColorScheme") === "Solid" ? solid(v) : colorNew(cPred[i], useGradient ? 50 : 30)))
    : undefined;

  const backTestStream = startLong.map((_, i) => (startLong[i] ? 1 : endLong[i] ? 2 : startShort[i] ? -1 : endShort[i] ? -2 : NaN));

  let table: IndicatorTable | undefined;
  if (b(p, "showTradeStats")) {
    const st = tradeStats(bars, source, startLong, endLong, startShort, endShort, isEarlyFlip, maxBarsBackIndex, b(p, "useWorstCase"));
    const cell = (col: number, row: number, text: string) => ({ col, row, text, color: "#787b86", size: "normal" as const, align: "center" as const });
    table = {
      position: "top_right",
      bg: "rgba(0,0,0,0)",
      frame: "rgba(0,0,0,0)",
      border: "rgba(0,0,0,0)",
      cells: [
        cell(0, 0, "📈 Trade Stats"),
        cell(0, 1, "Winrate"),
        cell(1, 1, st.trades ? `${formatPattern((st.wins / st.trades) * 100, "#.#")}%` : "NaN"),
        cell(0, 2, "Trades"),
        cell(1, 2, `${st.trades} (${st.wins}|${st.losses})`),
        cell(0, 5, "WL Ratio"),
        cell(1, 5, st.losses ? (st.wins / st.losses).toFixed(2) : "NaN"),
        cell(0, 6, "Early Signal Flips"),
        cell(1, 6, String(st.earlyFlips)),
      ],
    };
  }

  return {
    // The backtest stream is empty until the model has signalled.
    plots: backTestStream.some(Number.isFinite) ? { kernel: yhat1, backTestStream } : { kernel: yhat1 },
    colors: { kernel: kernelColors },
    markers,
    labels,
    barColors,
    table,
  };
}

/** MLExtensions.backtest: a calibration aid, not a real backtest (wins/losses per closed trade). */
function tradeStats(
  bars: Bars,
  source: Series,
  startLong: boolean[],
  endLong: boolean[],
  startShort: boolean[],
  endShort: boolean[],
  isEarlyFlip: boolean[],
  maxBarsBackIndex: number,
  worstCase: boolean
) {
  let longEntry = 0, shortEntry = 0, wins = 0, losses = 0, trades = 0, earlyFlips = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i <= maxBarsBackIndex) continue;
    const price = worstCase ? source[i] : (bars.high[i] + bars.low[i] + bars.open[i] + bars.open[i]) / 4;
    if (startLong[i]) (shortEntry = 0), (longEntry = price), (trades += 1);
    if (endLong[i]) {
      if (isEarlyFlip[i]) earlyFlips += 1;
      const delta = price - longEntry;
      if (delta > 0) wins += 1;
      else if (delta < 0) losses += 1;
    }
    if (startShort[i]) (longEntry = 0), (shortEntry = price), (trades += 1);
    if (endShort[i]) {
      if (isEarlyFlip[i]) earlyFlips += 1;
      const delta = shortEntry - price;
      if (delta > 0) wins += 1;
      else if (delta < 0) losses += 1;
    }
  }
  return { wins, losses, trades, earlyFlips };
}
