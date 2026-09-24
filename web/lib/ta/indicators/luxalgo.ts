// Ports of LuxAlgo scripts published on TradingView.
//
// This file is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0
// (CC BY-NC-SA 4.0, https://creativecommons.org/licenses/by-nc-sa/4.0/), as the scripts it
// is derived from are — © LuxAlgo. It is NOT covered by the repository's MIT license:
// non-commercial use only, and adaptations must keep this license and attribution.
//
// - Universal Signal Backtester [LuxAlgo]  (Pine v6)
// - Arbitrage Matrix [LuxAlgo]             (Pine v6)

import * as ta from "../core";
import { type Series } from "../core";
import { colorNew, formatMintick, formatPattern, formatVolume, fromGradient, inferMintick, timeParts } from "../pine";
import {
  b,
  bool,
  colorInput,
  float,
  int,
  n,
  s,
  select,
  type ChartContext,
  type DrawSize,
  type ExternalData,
  type IndicatorDef,
  type IndicatorTable,
  type InputDef,
  type Label,
  type Line,
  type Marker,
  type TableCell,
} from "../types";

export const luxalgo: IndicatorDef[] = [];

const GREEN = "#089981";
const RED = "#f23645";

const TABLE_POSITION = { "Top Right": "top_right", "Bottom Right": "bottom_right", "Bottom Left": "bottom_left" } as const;
const TABLE_SIZE: Record<string, DrawSize> = { Tiny: "tiny", Small: "small", Normal: "normal", Large: "large", Huge: "huge" };

/** An input.source value: price sources, or another indicator's plot on the chart. */
function sourceSeries(bars: ta.Bars, key: string, ext?: ExternalData): Series {
  if (!key.startsWith("plot:")) return ta.source(bars, key);
  const plot = ext?.plots?.[key];
  if (!plot) throw new Error("source indicator was removed from the chart");
  return plot;
}

const externalSource = (key: string, label: string, def: string): InputDef => ({ key, label, type: "source", default: def, external: true });

// =====================================================================================
// Universal Signal Backtester [LuxAlgo]
// =====================================================================================

const BT_DATA = "#DBDBDB";
const BT_HEADERS = "#808080";
const BT_BACKGROUND = "#161616";
const BT_BORDERS = "#2E2E2E";

const SIGNAL_LOGIC = ["Not NA (Plotshape/Markers)", "Crosses Over 0", "Crosses Under 0", "Value Changes", "Greater Than 0", "Less Than 0"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function blockChar(ratio: number): string {
  return ratio < 0.125 ? " " : ratio < 0.25 ? "▂" : ratio < 0.375 ? "▃" : ratio < 0.5 ? "▄" : ratio < 0.625 ? "▅" : ratio < 0.75 ? "▆" : ratio < 0.875 ? "▇" : "█";
}

const getBlockChar = (val: number, maxVal: number) => (maxVal === 0 || val === 0 ? " " : blockChar(Math.abs(val) / maxVal));

function heatmapColor(val: number, maxV: number, minV: number): string {
  if (val > 0 && maxV > 0) return fromGradient(val, 0, maxV, colorNew(GREEN, 80), colorNew(GREEN, 10))!;
  if (val < 0 && minV < 0) return fromGradient(val, minV, 0, colorNew(RED, 10), colorNew(RED, 80))!;
  return BT_BACKGROUND;
}

const formatDays = (ms: number) => `${Math.round(ms / 86_400_000)}d`;

type Slot = { active: boolean; px: number; hit: boolean; line: Line | null; label: Label | null };
const newSlot = (): Slot => ({ active: false, px: 0, hit: false, line: null, label: null });

export type BacktestStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  grossWin: number;
  grossLoss: number;
  currentEq: number;
  maxDd: number;
  maxStagMs: number;
  tpHits: [number, number, number];
  tradePnl: number[];
};

luxalgo.push({
  id: "luxalgo-usb",
  name: "Universal Signal Backtester [LuxAlgo]",
  short: "LuxAlgo - Universal Signal Backtester",
  category: "Community",
  overlay: true,
  description:
    "Backtests EMA/SMA crosses, any two sources, or another indicator's signals on this chart with three take-profits and three stop-losses, and reports the results in a dashboard.",
  legendInputs: [],
  inputs: [
    select("sourceMode", "Source Mode", ["Predefined Crosses", "External Sources (Crossovers)", "External Signals (Triggers)"], "Predefined Crosses"),
    select("predefCross", "Predefined Cross", ["9/21 EMA Cross", "12/26 EMA Cross", "Golden/Death Cross (50/200 SMA)"], "9/21 EMA Cross"),
    externalSource("fastSource", "External Fast Source", "close"),
    externalSource("slowSource", "External Slow Source", "open"),
    externalSource("extLongSignal", "External Long Signal", "close"),
    externalSource("extShortSignal", "External Short Signal", "close"),
    select("signalLogic", "External Signal Logic", SIGNAL_LOGIC, "Not NA (Plotshape/Markers)"),
    select("tradeDirection", "Trade Direction", ["Both", "Long Only", "Short Only"], "Both"),
    bool("useAtrFilter", "Use ATR Choppiness Filter", false),
    int("atrFilterLen", "ATR Smoothing Length", 50),
    select("distType", "Distance Type", ["ATR", "Ticks", "Points/Fiat"], "ATR"),
    int("atrLen", "ATR Length", 14),
    bool("useTp1", "Take Profit 1", true),
    float("tp1Val", "Take Profit 1 Distance", 1, 0.5),
    bool("useTp2", "Take Profit 2", true),
    float("tp2Val", "Take Profit 2 Distance", 2, 0.5),
    bool("useTp3", "Take Profit 3", true),
    float("tp3Val", "Take Profit 3 Distance", 3, 0.5),
    bool("useSl1", "Stop Loss 1", true),
    float("sl1Val", "Stop Loss 1 Distance", 1.5, 0.5),
    bool("useSl2", "Stop Loss 2", true),
    float("sl2Val", "Stop Loss 2 Distance", 2.5, 0.5),
    bool("useSl3", "Stop Loss 3", true),
    float("sl3Val", "Stop Loss 3 Distance", 3.5, 0.5),
    bool("showDash", "Show Dashboard", true),
    select("dashPos", "Dashboard Position", ["Top Right", "Bottom Right", "Bottom Left"], "Top Right"),
    select("dashSize", "Dashboard Size", ["Tiny", "Small", "Normal", "Large"], "Small"),
    select("heatmapPeriod", "Heatmap Period", ["Days of Week", "Months"], "Days of Week"),
    select("suggestMetric", "Suggested TP Metric", ["Hit Rate", "Expected Profit", "Total Profit", "Risk/Reward"], "Hit Rate"),
    bool("useCandleColor", "Gradient Candle Coloring", true),
    bool("useCosts", "Simulate Spread & Commission", false),
    select("costProfile", "Cost Profile", ["Manual", "Forex (Avg)", "Crypto (Tier 1)", "Stocks (US)"], "Manual"),
    float("manualSpread", "Manual Spread (Ticks)", 1, 0.1),
    float("manualComm", "Manual Commission (%)", 0.01, 0.01),
    // Not in the script: TradingView knows syminfo.mintick, these feeds don't.
    float("tickSize", "Tick Size (0 = from prices)", 0, 0.0001, 0),
  ],
  plots: [
    { key: "fast", title: "Fast Source", color: GREEN },
    ...Array.from({ length: 9 }, (_, k) => ({ key: `r${k + 1}`, title: `Ribbon ${k + 1}`, color: GREEN })),
    { key: "slow", title: "Slow Source", color: GREEN },
  ],
  compute: (bars, p, ext) => backtest(bars, p, ext).result,
});

/** The script bar by bar. Exported with its running totals for tests. */
export function backtest(bars: ta.Bars, p: Record<string, number | string | boolean>, ext?: ExternalData) {
  const len = bars.length;
  const { high, low, close, time } = bars;
  const timezone = ext?.chart?.timezone ?? "Etc/UTC";
  const mintick = n(p, "tickSize") > 0 ? n(p, "tickSize") : inferMintick(bars);

  // ---- strategy logic ----
  const predef = s(p, "predefCross");
  const [fastLen, slowLen, isEma] =
    predef === "12/26 EMA Cross" ? [12, 26, true] : predef === "Golden/Death Cross (50/200 SMA)" ? [50, 200, false] : [9, 21, true];
  const ribbonMa = (length: number) => {
    const l = Math.round(length);
    return isEma ? ta.ema(close, l) : ta.sma(close, l);
  };
  const builtInFast = ribbonMa(fastLen);
  const builtInSlow = ribbonMa(slowLen);
  const stepLen = (slowLen - fastLen) / 10;
  const ribbons = Array.from({ length: 9 }, (_, k) => ribbonMa(fastLen + stepLen * (k + 1)));

  const mode = s(p, "sourceMode");
  const isPredef = mode === "Predefined Crosses";
  const isExtCross = mode === "External Sources (Crossovers)";
  const isExtSig = mode === "External Signals (Triggers)";

  const activeFast = isPredef ? builtInFast : sourceSeries(bars, s(p, "fastSource"), ext);
  const activeSlow = isPredef ? builtInSlow : sourceSeries(bars, s(p, "slowSource"), ext);
  const extLong = isExtSig ? sourceSeries(bars, s(p, "extLongSignal"), ext) : ta.fill(len);
  const extShort = isExtSig ? sourceSeries(bars, s(p, "extShortSignal"), ext) : ta.fill(len);

  const atrFilterVal = ta.atr(bars, 14).map((v) => ta.nz(v));
  const atrFilterMa = ta.sma(atrFilterVal, n(p, "atrFilterLen"));
  const useAtrFilter = b(p, "useAtrFilter");

  const logic = s(p, "signalLogic");
  const isNa = Number.isNaN;
  const base = (x: Series, i: number): boolean => {
    switch (logic) {
      case "Crosses Over 0":
        return i > 0 && x[i] > 0 && x[i - 1] <= 0;
      case "Crosses Under 0":
        return i > 0 && x[i] < 0 && x[i - 1] >= 0;
      case "Value Changes":
        return i > 0 && x[i] - x[i - 1] !== 0 && !isNa(x[i] - x[i - 1]);
      case "Greater Than 0":
        return x[i] > 0;
      case "Less Than 0":
        return x[i] < 0;
      default: // Not NA
        return !isNa(x[i]) && (i === 0 || isNa(x[i - 1]));
    }
  };

  const direction = s(p, "tradeDirection");
  const canLong = direction === "Both" || direction === "Long Only";
  const canShort = direction === "Both" || direction === "Short Only";

  const atrVal = ta.atr(bars, n(p, "atrLen")).map((v) => ta.nz(v));
  const distType = s(p, "distType");
  const useTp = [b(p, "useTp1"), b(p, "useTp2"), b(p, "useTp3")];
  const useSl = [b(p, "useSl1"), b(p, "useSl2"), b(p, "useSl3")];
  const tpVal = [n(p, "tp1Val"), n(p, "tp2Val"), n(p, "tp3Val")];
  const slVal = [n(p, "sl1Val"), n(p, "sl2Val"), n(p, "sl3Val")];

  // ---- costs ----
  let spreadTicks = 0;
  let commPerc = 0;
  if (b(p, "useCosts")) {
    const profile = s(p, "costProfile");
    [spreadTicks, commPerc] =
      profile === "Forex (Avg)" ? [1, 0.005] : profile === "Crypto (Tier 1)" ? [1, 0.12] : profile === "Stocks (US)" ? [2, 0] : [n(p, "manualSpread"), n(p, "manualComm")];
  }

  // ---- state ----
  let isActive = false;
  let tradeDir = 0;
  let entryPx = 0;
  let entryTime = 0;
  let qtyLeft = 0;
  let tradePnl = 0;
  const tp = [newSlot(), newSlot(), newSlot()];
  const sl = [newSlot(), newSlot(), newSlot()];

  const hourlyPnL = new Array<number>(24).fill(0);
  const activeYears: number[] = [];
  const activeWeeks: number[] = [];
  const monthlyMap = new Map<number, number>();
  const dailyMap = new Map<number, number>();
  const allTradePnL: number[] = [];
  const equityCurve: number[] = [];

  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let maxEq = 0;
  let currentEq = 0;
  let maxDd = 0;
  let lastHighTime = len > 0 ? time[0] * 1000 : 0;
  let maxStagMs = 0;
  const tpHits: [number, number, number] = [0, 0, 0];

  const lines: Line[] = [];
  const labels: Label[] = [];
  const markers: Marker[] = [];
  const barColors: Array<string | undefined> = new Array(len).fill(undefined);

  const costTicks = (qty: number) => (spreadTicks + (entryPx * (commPerc / 100)) / mintick) * qty;
  const pnlTicks = (exitPx: number, qty: number) => ((exitPx - entryPx) * tradeDir) / mintick * qty;
  const tpHitNow = (k: number, h: number, l: number) => (tradeDir === 1 && h >= tp[k].px) || (tradeDir === -1 && l <= tp[k].px);
  const slHitNow = (k: number, h: number, l: number) => (tradeDir === 1 && l <= sl[k].px) || (tradeDir === -1 && h >= sl[k].px);

  for (let i = 0; i < len; i++) {
    const h = high[i];
    const l = low[i];
    const t = time[i] * 1000;
    // Predefined and external crossovers cross fast over slow; external triggers read the signal logic.
    const atrFilter = !useAtrFilter || atrFilterVal[i] > atrFilterMa[i];
    const longSignal = (isPredef || isExtCross ? ta.crossover(activeFast, activeSlow, i) : base(extLong, i)) && atrFilter;
    const shortSignal = (isPredef || isExtCross ? ta.crossunder(activeFast, activeSlow, i) : base(extShort, i)) && atrFilter;

    const d = [tpVal, slVal].map((vals) => vals.map((v) => v * (distType === "ATR" ? atrVal[i] : distType === "Ticks" ? mintick : 1)));
    const [dTp, dSl] = d;

    // Extend lines visually until hit or new signal.
    for (const slot of [...tp, ...sl]) {
      if (slot.active && !slot.hit) {
        if (slot.line) slot.line.x2 = i;
        if (slot.label) slot.label.index = i;
      }
    }

    let isLongWin = false;
    let isLongLoss = false;
    let isShortWin = false;
    let isShortLoss = false;

    if (isActive) {
      let closedThisBar = false;

      // 1. Stops first (conservative).
      for (let k = 0; k < 3; k++) {
        if (sl[k].active && !sl[k].hit && slHitNow(k, h, l)) {
          sl[k].hit = true;
          if (sl[k].label) sl[k].label!.text = `SL ${k + 1} ✗`;
        }
      }
      if (sl[0].hit || sl[1].hit || sl[2].hit) {
        const exitPx = sl[0].hit ? sl[0].px : sl[1].hit ? sl[1].px : sl[2].px;
        tradePnl += pnlTicks(exitPx, qtyLeft) - costTicks(qtyLeft);
        qtyLeft = 0;
        closedThisBar = true;
      }

      // 2. Take-profits (partial exits).
      if (!closedThisBar) {
        const tpQty = 1 / Math.max(1, tp.filter((x) => x.active).length);
        for (let k = 0; k < 3; k++) {
          if (tp[k].active && !tp[k].hit && tpHitNow(k, h, l)) {
            tp[k].hit = true;
            tpHits[k] += 1;
            tradePnl += pnlTicks(tp[k].px, tpQty) - costTicks(tpQty);
            qtyLeft -= tpQty;
            if (tp[k].label) tp[k].label!.text = `TP ${k + 1} ✓`;
          }
        }
        if (qtyLeft <= 0.001) closedThisBar = true;
      }

      // 3. Opposite signal reversal.
      if (!closedThisBar && ((tradeDir === 1 && shortSignal) || (tradeDir === -1 && longSignal))) {
        tradePnl += pnlTicks(close[i], qtyLeft) - costTicks(qtyLeft);
        qtyLeft = 0;
        closedThisBar = true;
      }

      if (closedThisBar) {
        isActive = false;
        totalTrades += 1;
        allTradePnL.push(tradePnl);
        if (tradePnl > 0) {
          wins += 1;
          grossWin += tradePnl;
          if (tradeDir === 1) isLongWin = true;
          else isShortWin = true;
        } else if (tradePnl < 0) {
          losses += 1;
          grossLoss += Math.abs(tradePnl);
          if (tradeDir === 1) isLongLoss = true;
          else isShortLoss = true;
        }
        currentEq += tradePnl;
        equityCurve.push(currentEq);
        if (currentEq > maxEq) {
          maxEq = currentEq;
          lastHighTime = t;
        }
        maxStagMs = Math.max(maxStagMs, t - lastHighTime);
        maxDd = Math.max(maxDd, maxEq - currentEq);

        const at = timeParts(entryTime / 1000, timezone);
        hourlyPnL[at.hour] += tradePnl;
        const yM = at.year * 100 + (at.month - 1);
        if (!activeYears.includes(at.year)) activeYears.push(at.year);
        monthlyMap.set(yM, (monthlyMap.get(yM) ?? 0) + tradePnl);
        const yW = at.year * 100 + at.weekofyear;
        const yWD = yW * 100 + (at.dayofweek - 1);
        if (!activeWeeks.includes(yW)) activeWeeks.push(yW);
        dailyMap.set(yWD, (dailyMap.get(yWD) ?? 0) + tradePnl);
      }
    }

    // Lines left over from a closed trade keep being marked when price reaches them.
    if (!isActive) {
      for (let k = 0; k < 3; k++) {
        if (tp[k].active && !tp[k].hit && tpHitNow(k, h, l)) {
          tp[k].hit = true;
          if (tp[k].label) tp[k].label!.text = `TP ${k + 1} ✓`;
        }
      }
      for (let k = 0; k < 3; k++) {
        if (sl[k].active && !sl[k].hit && slHitNow(k, h, l)) {
          sl[k].hit = true;
          if (sl[k].label) sl[k].label!.text = `SL ${k + 1} ✗`;
        }
      }
    }

    maxStagMs = Math.max(maxStagMs, t - lastHighTime);

    // New entries.
    if (!isActive) {
      const newDir = longSignal && canLong ? 1 : shortSignal && canShort ? -1 : 0;
      if (newDir !== 0) {
        isActive = true;
        tradeDir = newDir;
        entryPx = close[i];
        entryTime = t;
        qtyLeft = 1;
        tradePnl = 0;

        const tr = Math.max(1, totalTrades);
        const rates = tpHits.map((hits) => hits / tr);
        const slDist = Math.max(mintick, dSl[0]);
        const metric = s(p, "suggestMetric");
        const v = rates.map((rate, k) =>
          metric === "Expected Profit" ? rate * dTp[k] : metric === "Total Profit" ? tpHits[k] * dTp[k] : metric === "Risk/Reward" ? dTp[k] / slDist : rate * 100
        );
        let bestV = v[0];
        let bestTp = 1;
        let bestRate = rates[0] * 100;
        for (const k of [1, 2]) {
          if (v[k] > bestV && useTp[k]) {
            bestV = v[k];
            bestTp = k + 1;
            bestRate = rates[k] * 100;
          }
        }
        const text = `TP${bestTp} ${formatPattern(bestRate, "#.#")}%`;
        const offset = atrVal[i] !== 0 ? atrVal[i] : h - l;
        const color = newDir === 1 ? GREEN : RED;
        const y1 = newDir === 1 ? l : h;
        const y2 = newDir === 1 ? l - offset * 1.5 : h + offset * 1.5;
        lines.push({ x1: i, y1, x2: i, y2, color, dashed: true });
        labels.push({ index: i, price: y2, text: "", style: "circle", bg: colorNew(color, 80), size: "huge" });
        labels.push({ index: i, price: y2, text, style: "center", bg: "#363a45", textColor: "#ffffff", size: "small" });

        for (let k = 0; k < 3; k++) {
          tp[k] = { active: useTp[k], px: close[i] + newDir * dTp[k], hit: false, line: null, label: null };
          sl[k] = { active: useSl[k], px: close[i] - newDir * dSl[k], hit: false, line: null, label: null };
        }
        for (const [slots, name, c] of [
          [tp, "TP", GREEN],
          [sl, "SL", RED],
        ] as const) {
          slots.forEach((slot, k) => {
            if (!slot.active) return;
            slot.line = { x1: i, y1: slot.px, x2: i, y2: slot.px, color: c, dashed: true };
            slot.label = { index: i, price: slot.px, text: `${name} ${k + 1}`, style: "left", textColor: c, size: "tiny" };
            lines.push(slot.line);
            labels.push(slot.label);
          });
        }
      }
    }

    if (isLongWin) markers.push({ index: i, position: "aboveBar", shape: "xcross", color: GREEN });
    if (isLongLoss) markers.push({ index: i, position: "aboveBar", shape: "xcross", color: RED });
    if (isShortWin) markers.push({ index: i, position: "belowBar", shape: "xcross", color: GREEN });
    if (isShortLoss) markers.push({ index: i, position: "belowBar", shape: "xcross", color: RED });
  }

  // ---- visuals ----
  const plots: Record<string, Series> = {};
  const colors: Record<string, Array<string | undefined>> = {};
  const ribbonColor = (k: number) => activeFast.map((f, i) => colorNew(f > activeSlow[i] ? GREEN : RED, k * 8));
  plots.fast = isPredef ? builtInFast : activeFast;
  colors.fast = isPredef ? ribbonColor(0) : new Array(len).fill("#2962ff");
  ribbons.forEach((r, k) => {
    plots[`r${k + 1}`] = isPredef ? r : ta.fill(len);
    colors[`r${k + 1}`] = ribbonColor(k + 1);
  });
  plots.slow = isPredef ? builtInSlow : activeSlow;
  colors.slow = isPredef ? ribbonColor(10) : new Array(len).fill("#ff6d00");

  if (b(p, "useCandleColor")) {
    const cDist = activeFast.map((f, i) => f - activeSlow[i]);
    const maxDist = ta.sma(cDist.map(Math.abs), 100).map((v) => ta.nz(v) * 2);
    for (let i = 0; i < len; i++) barColors[i] = fromGradient(cDist[i], -maxDist[i], maxDist[i], RED, GREEN);
  }

  const stats: BacktestStats = { totalTrades, wins, losses, grossWin, grossLoss, currentEq, maxDd, maxStagMs, tpHits, tradePnl: allTradePnL };
  const table = b(p, "showDash")
    ? dashboard(p, stats, equityCurve, hourlyPnL, activeYears, activeWeeks, monthlyMap, dailyMap)
    : undefined;

  return {
    stats,
    result: {
      plots,
      colors,
      // max_lines_count / max_labels_count = 500: Pine drops the oldest drawings.
      lines: lines.slice(-500),
      labels: labels.slice(-500),
      markers,
      barColors: b(p, "useCandleColor") ? barColors : undefined,
      table,
    },
  };
}

function dashboard(
  p: Record<string, number | string | boolean>,
  st: BacktestStats,
  equityCurve: number[],
  hourlyPnL: number[],
  activeYears: number[],
  activeWeeks: number[],
  monthlyMap: Map<number, number>,
  dailyMap: Map<number, number>
): IndicatorTable {
  const size = TABLE_SIZE[s(p, "dashSize")] ?? "small";
  const cells: TableCell[] = [];
  const cell = (col: number, row: number, text: string, color: string, extra: Partial<TableCell> = {}) =>
    cells.push({ col, row, text, color, size, ...extra });
  const merged = (from: number, to: number, row: number, text: string, color: string, extra: Partial<TableCell> = {}) =>
    cell(from, row, text, color, { colSpan: to - from + 1, ...extra });

  const years = [...activeYears].sort((x, y) => x - y);
  const weeks = [...activeWeeks].sort((x, y) => x - y);

  const { totalTrades, wins, losses, grossWin, grossLoss, currentEq, maxDd, maxStagMs, tpHits } = st;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.9 : 0;
  const netProfit = grossWin - grossLoss;
  const recoveryFactor = maxDd > 0 ? netProfit / maxDd : netProfit > 0 ? 99.9 : 0;
  const count = st.tradePnl.length;
  const mean = count > 0 ? st.tradePnl.reduce((a, v) => a + v, 0) / count : 0;
  const stdDev = count > 0 ? Math.sqrt(st.tradePnl.reduce((a, v) => a + (v - mean) ** 2, 0) / count) : 0;
  const sharpe = stdDev > 0 ? mean / stdDev : 0;
  void losses;

  let eqStr = "";
  if (equityCurve.length > 0) {
    const bins = 24;
    const step = equityCurve.length / bins;
    const minE = Math.min(...equityCurve);
    const rangeE = Math.max(0.0001, Math.max(...equityCurve) - minE);
    for (let i = 0; i < bins; i++) {
      const idx = Math.min(equityCurve.length - 1, Math.floor(i * step));
      eqStr += blockChar((equityCurve[idx] - minE) / rangeE);
    }
  }
  const tpStr = (k: number) => `${tpHits[k]} (${formatPattern(totalTrades > 0 ? (tpHits[k] / totalTrades) * 100 : 0, "#.#")}%)`;

  merged(0, 23, 0, "Advanced Backtest Analytics", BT_DATA, { bg: BT_BORDERS });

  merged(0, 5, 1, "Total Trades", BT_HEADERS);
  merged(6, 11, 1, "Win Rate", BT_HEADERS);
  merged(12, 17, 1, "Profit Factor", BT_HEADERS);
  merged(18, 23, 1, "Total PnL (Ticks)", BT_HEADERS);
  merged(0, 5, 2, String(totalTrades), BT_DATA);
  merged(6, 11, 2, `${formatPattern(winRate, "#.#")}%`, winRate >= 50 ? GREEN : RED);
  merged(12, 17, 2, formatPattern(pf, "#.##"), pf >= 1 ? GREEN : RED);
  merged(18, 23, 2, formatPattern(currentEq, "#.##"), currentEq >= 0 ? GREEN : RED);

  merged(0, 7, 3, "Sharpe Ratio", BT_HEADERS);
  merged(8, 15, 3, "Recovery Factor", BT_HEADERS);
  merged(16, 23, 3, "Max Stagnation", BT_HEADERS);
  merged(0, 7, 4, formatPattern(sharpe, "#.##"), BT_DATA);
  merged(8, 15, 4, formatPattern(recoveryFactor, "#.##"), BT_DATA);
  merged(16, 23, 4, formatDays(maxStagMs), BT_DATA);

  merged(0, 7, 5, "TP 1 Hits", BT_HEADERS);
  merged(8, 15, 5, "TP 2 Hits", BT_HEADERS);
  merged(16, 23, 5, "TP 3 Hits", BT_HEADERS);
  merged(0, 7, 6, tpStr(0), BT_DATA);
  merged(8, 15, 6, tpStr(1), BT_DATA);
  merged(16, 23, 6, tpStr(2), BT_DATA);

  merged(0, 23, 7, `Equity Curve  ${eqStr}`, GREEN, { align: "left" });
  merged(0, 23, 8, "", BT_BORDERS, { thin: true });

  merged(0, 23, 9, "Performance by Hour of Day", BT_HEADERS);
  const absMaxH = Math.max(Math.abs(Math.max(...hourlyPnL)), Math.abs(Math.min(...hourlyPnL)));
  for (let i = 0; i < 24; i++) {
    cell(i, 10, getBlockChar(hourlyPnL[i], absMaxH), hourlyPnL[i] >= 0 ? GREEN : RED);
    cell(i, 11, String(i), BT_HEADERS, { size: "tiny" });
  }
  merged(0, 23, 12, "", BT_BORDERS, { thin: true });

  const period = s(p, "heatmapPeriod");
  merged(0, 23, 13, `Performance by ${period}`, BT_HEADERS);
  let startRow = 14;
  const tiny = { size: "tiny" as const, align: "center" as const };

  if (period === "Months") {
    const all = [...monthlyMap.values()];
    const maxM = all.length > 0 ? Math.max(...all) : 0;
    const minM = all.length > 0 ? Math.min(...all) : 0;
    merged(4, 5, startRow, "Year", BT_HEADERS, tiny);
    MONTHS.forEach((m, i) => cell(6 + i, startRow, m, BT_HEADERS, tiny));
    merged(18, 19, startRow, "Total", BT_HEADERS, tiny);
    startRow += 1;
    const shown = years.slice(-10);
    shown.forEach((y, i) => {
      const row = startRow + i;
      merged(4, 5, row, String(y), BT_DATA, tiny);
      let rowTotal = 0;
      for (let m = 0; m < 12; m++) {
        const val = monthlyMap.get(y * 100 + m) ?? 0;
        rowTotal += val;
        cell(6 + m, row, val === 0 ? "-" : formatPattern(val, "#.#"), BT_DATA, { ...tiny, bg: val === 0 ? BT_BACKGROUND : heatmapColor(val, maxM, minM) });
      }
      merged(18, 19, row, formatPattern(rowTotal, "#.#"), BT_DATA, { ...tiny, bg: rowTotal === 0 ? BT_BACKGROUND : heatmapColor(rowTotal, maxM * 3, minM * 3) });
    });
  } else {
    const all = [...dailyMap.values()];
    const maxD = all.length > 0 ? Math.max(...all) : 0;
    const minD = all.length > 0 ? Math.min(...all) : 0;
    merged(3, 5, startRow, "Week", BT_HEADERS, tiny);
    DAYS.forEach((d, i) => merged(6 + i * 2, 7 + i * 2, startRow, d, BT_HEADERS, tiny));
    merged(20, 22, startRow, "Total", BT_HEADERS, tiny);
    startRow += 1;
    const shown = weeks.slice(-10);
    shown.forEach((yW, i) => {
      const row = startRow + i;
      merged(3, 5, row, `${Math.floor(yW / 100)}-W${yW % 100}`, BT_DATA, tiny);
      let rowTotal = 0;
      for (let d = 0; d < 7; d++) {
        const val = dailyMap.get(yW * 100 + d) ?? 0;
        rowTotal += val;
        merged(6 + d * 2, 7 + d * 2, row, val === 0 ? "-" : formatPattern(val, "#.#"), BT_DATA, { ...tiny, bg: val === 0 ? BT_BACKGROUND : heatmapColor(val, maxD, minD) });
      }
      merged(20, 22, row, formatPattern(rowTotal, "#.#"), BT_DATA, { ...tiny, bg: rowTotal === 0 ? BT_BACKGROUND : heatmapColor(rowTotal, maxD * 3, minD * 3) });
    });
  }

  return { position: TABLE_POSITION[s(p, "dashPos") as keyof typeof TABLE_POSITION] ?? "top_right", bg: BT_BACKGROUND, frame: BT_BORDERS, border: BT_BACKGROUND, cells };
}

// =====================================================================================
// Arbitrage Matrix [LuxAlgo]
// =====================================================================================

// Checkbox order of the script's inputs, and the order it pushes them into its list.
const CRYPTO_INPUTS = ["CRYPTOCOM", "BINANCE", "BYBIT", "WEBULLPAY", "GEMINI", "CRYPTO", "BINANCEUS", "KRAKEN", "BTSE", "BITSTAMP", "KUCOIN", "HTX", "COINBASE", "BITGET", "GATE", "WHITEBIT", "COINEX", "MEXC", "OKX"];
const FX_INPUTS = ["PEPPERSTONE", "EIGHTCAP", "OANDA", "CMCMARKETS", "TICKMILL", "SAXO", "CAPITALCOM", "FOREXCOM", "IBKR", "ICMARKETS", "VANTAGE", "FX", "IG"];
const CRYPTO_ORDER = ["BITSTAMP", "COINBASE", "CRYPTO", "BINANCE", "KRAKEN", "OKX", "GEMINI", "CRYPTOCOM", "WEBULLPAY", "BINANCEUS", "BTSE", "WHITEBIT", "BYBIT", "KUCOIN", "MEXC", "BITGET", "COINEX", "HTX", "GATE"];
const FX_ORDER = ["TICKMILL", "FX", "OANDA", "FOREXCOM", "PEPPERSTONE", "CMCMARKETS", "ICMARKETS", "IBKR", "IG", "EIGHTCAP", "SAXO", "CAPITALCOM", "VANTAGE"];

const PRICE_LAST = "Last Price";
const PRICE_AVG = "Avg Price";
const VOLUME_LAST = "Last Volume";
const VOLUME_AVG = "Avg Volume";

type TvBar = { time: number; close: number; volume: number | null };

function arbitrageExchanges(p: Record<string, number | string | boolean>, chart: ChartContext): string[] {
  const source = s(p, "sources");
  const useCrypto = source === "Crypto Exchanges" || (source === "Auto" && chart.type === "crypto");
  return (useCrypto ? CRYPTO_ORDER : FX_ORDER).filter((e) => b(p, `ex_${e}`));
}

/** Chart timeframe as a TradingView resolution. */
export function tvResolution(intervalSeconds: number): string {
  if (intervalSeconds >= 28 * 86_400) return "1M";
  if (intervalSeconds >= 7 * 86_400) return "1W";
  if (intervalSeconds >= 86_400) return "1D";
  return String(Math.max(1, Math.round(intervalSeconds / 60)));
}

function arbitragePath(p: Record<string, number | string | boolean>, chart: ChartContext): string | null {
  const exchanges = arbitrageExchanges(p, chart);
  if (exchanges.length === 0) return null;
  const symbols = exchanges.map((e) => `${e}:${chart.ticker}`).join(",");
  return `/api/tv/bars?symbols=${encodeURIComponent(symbols)}&resolution=${tvResolution(chart.intervalSeconds)}&count=${Math.max(1, n(p, "averageLength"))}`;
}

const avg = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;

luxalgo.push({
  id: "luxalgo-arbitrage",
  name: "Arbitrage Matrix [LuxAlgo]",
  short: "LuxAlgo - Arbitrage Matrix",
  category: "Community",
  overlay: true,
  description: "Price or volume differences of this ticker across 19 crypto exchanges or 13 forex brokers, as a matrix.",
  legendInputs: [],
  inputs: [
    select("sources", "Sources", ["Auto", "Crypto Exchanges", "Forex Brokers"], "Auto"),
    int("averageLength", "Average Length", 20),
    ...CRYPTO_INPUTS.map((e) => bool(`ex_${e}`, e, true)),
    ...FX_INPUTS.map((e) => bool(`ex_${e}`, e, true)),
    select("data", "Data", [PRICE_LAST, PRICE_AVG, VOLUME_LAST, VOLUME_AVG], PRICE_LAST),
    select("position", "Position", ["Top Right", "Bottom Right", "Bottom Left"], "Top Right"),
    select("size", "Size", ["Tiny", "Small", "Normal", "Large", "Huge"], "Small"),
    colorInput("bullish", "Bullish", GREEN),
    colorInput("bearish", "Bearish", "#F23645"),
    bool("background", "Background Gradient", true),
  ],
  plots: [],
  fetches: (p, chart) => {
    const path = arbitragePath(p, chart);
    return path ? [path] : [];
  },
  compute: (bars, p, ext) => {
    const chart = ext?.chart;
    const path = chart ? arbitragePath(p, chart) : null;
    const data = path ? (ext?.fetched?.[path] as Record<string, TvBar[] | null> | undefined) : undefined;
    if (!chart || !data) return { plots: {} };
    return { plots: {}, table: arbitrageTable(bars, p, chart, data) };
  },
});

export function arbitrageTable(
  bars: ta.Bars,
  p: Record<string, number | string | boolean>,
  chart: ChartContext,
  data: Record<string, TvBar[] | null>,
  now = Date.now() / 1000
): IndicatorTable {
  const exchanges = arbitrageExchanges(p, chart);
  const length = Math.max(1, n(p, "averageLength"));
  // Only confirmed bars are gathered; the one still forming isn't.
  const assets = exchanges.map((e) => {
    const rows = (data[`${e}:${chart.ticker}`] ?? []).filter((r) => r.time + chart.intervalSeconds <= now).slice(-length);
    return {
      prices: rows.map((r) => r.close).filter(Number.isFinite),
      volumes: rows.map((r) => r.volume).filter((v): v is number => v !== null && Number.isFinite(v)),
    };
  });

  const mode = s(p, "data");
  const isPrice = mode === PRICE_LAST || mode === PRICE_AVG;
  const value = (k: number) => {
    const a = assets[k];
    return mode === PRICE_LAST ? a.prices.at(-1)! : mode === VOLUME_LAST ? a.volumes.at(-1)! : mode === PRICE_AVG ? avg(a.prices) : avg(a.volumes);
  };
  const hasData = (k: number) => {
    const xs = isPrice ? assets[k].prices : assets[k].volumes;
    return xs.length !== 0 && avg(xs) !== 0;
  };
  // currentData: every exchange with any values, whatever its average.
  const current = assets
    .map((a, k) => ((isPrice ? a.prices : a.volumes).length !== 0 ? value(k) : NaN))
    .filter(Number.isFinite);
  const maxDelta = current.length > 0 ? Math.max(...current) - Math.min(...current) : NaN;

  const mintick = inferMintick(bars);
  const size = TABLE_SIZE[s(p, "size")] ?? "small";
  const bull = s(p, "bullish");
  const bear = s(p, "bearish");
  const cells = new Map<string, TableCell>();
  const put = (c: TableCell) => cells.set(`${c.row}:${c.col}`, c);

  put({ col: 0, row: 0, text: chart.ticker, color: colorNew("#ffffff", 20), size, align: "center", bold: true });
  exchanges.forEach((rowEx, row) => {
    if (!hasData(row)) return;
    put({ col: 0, row: row + 1, text: rowEx, color: "#ffffff", size, align: "left" });
    exchanges.forEach((colEx, column) => {
      if (!hasData(column)) return;
      const delta = value(row) - value(column);
      const base = delta > 0 ? bull : bear;
      const extreme = Math.abs(delta) === maxDelta;
      put({ col: column + 1, row: 0, text: colEx, color: "#ffffff", size, align: "center" });
      put({
        col: column + 1,
        row: row + 1,
        text: delta !== 0 ? (isPrice ? formatMintick(delta, mintick) : formatVolume(delta)) : "",
        color: extreme ? "#ffffff" : fromGradient(Math.abs(delta), 0, maxDelta, colorNew(base, 50), colorNew(base, 0)),
        bg: extreme ? base : b(p, "background") ? fromGradient(Math.abs(delta), 0, maxDelta, colorNew(base, 100), colorNew(base, 70)) : undefined,
        bold: extreme,
        size,
        align: "center",
        tooltip: `${rowEx} vs ${colEx}`,
      });
    });
  });

  return {
    position: TABLE_POSITION[s(p, "position") as keyof typeof TABLE_POSITION] ?? "top_right",
    bg: "#1e222d",
    frame: "#373a46",
    border: "#373a46",
    cells: [...cells.values()],
  };
}
