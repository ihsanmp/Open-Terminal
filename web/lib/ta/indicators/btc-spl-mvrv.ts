// "BTC Spl-P/L & MVRV RoC" — after BaseTrustCapital's "BTC Spl-P/L & MVRV RoC - SandiB" on
// TradingView. That script is closed-source; this is an independent implementation (MIT, like
// the repository) of its published description:
//   a. Supply in profit/loss: its short-term moving average against its long-term one,
//   b. MVRV rate of change above 2 = long, below = short,
//   c. the final signal is the average of a and b (+1 long, 0 mixed, −1 short).
//
// Data (daily, via /api/onchain/btc-supply-mvrv): BTC supply in profit and in loss from BGeometrics,
// and MVRV from Coin Metrics. The share of supply in profit is scaled to its own trailing range
// (0 … 1), as the published chart's pane is; a one-year range with 30- and 150-day averages comes
// closest to the published chart (BGeometrics' free API reaches back 4 years, so the lines start
// in early 2024 and grow from there). IntoTheBlock's on-chain series on TradingView, the obvious
// source, stopped updating in Aug 2025.

import * as ta from "../core";
import { type Bars, type Series } from "../core";
import { b, bool, colorInput, float, int, n, s, type Color, type IndicatorDef, type IndicatorResult, type IndicatorTable, type Params } from "../types";

/** The server's /onchain/btc-supply-mvrv response. */
export type SupplyMvrv = {
  supply: { time: number[]; inProfit: number[] };
  mvrv: { time: number[]; value: number[] };
};

const PATH = "/api/onchain/btc-supply-mvrv";

export const btcSplMvrv: IndicatorDef = {
  id: "btc-spl-mvrv-roc",
  name: "BTC Spl-P/L & MVRV RoC",
  short: "BTC Spl-P/L & MVRV RoC",
  category: "Community",
  overlay: false,
  precision: 2,
  aliases: ["SandiB", "Supply in Profit", "MVRV RoC", "BaseTrustCapital"],
  description: "Trend signal from BTC supply in profit/loss (short vs long average) and MVRV rate of change, from BGeometrics and Coin Metrics on-chain data.",
  legendInputs: ["shortLen", "longLen", "rocLen"],
  inputs: [
    int("normLen", "Profit/Loss Scaling Lookback (days)", 365, 30, 5000),
    int("shortLen", "Short-term MA (days)", 30, 1),
    int("longLen", "Long-term MA (days)", 150, 1),
    int("rocLen", "MVRV RoC Length (days)", 30, 1),
    float("rocThreshold", "MVRV RoC Threshold %", 2, 0.5, -100),
    bool("barColors", "Color Bars by Final Signal", true),
    bool("showTable", "Show Table", true),
    colorInput("longColor", "Long", "#00E5FF"),
    colorInput("shortColor", "Short", "#C2185B"),
    colorInput("neutralColor", "Neutral", "#787B86"),
  ],
  plots: [
    { key: "fast", title: "Supply P/L (short MA)", color: "#00BCD4", width: 2 },
    { key: "slow", title: "Supply P/L (long MA)", color: "#FFEB3B", width: 2 },
    { key: "signal", title: "Final Signal", color: "#FF9800", display: "legend" },
  ],
  fetches: () => [PATH],
  compute: (bars, p, ext) => btcSplMvrvRoc(bars, p, (ext?.fetched?.[PATH] as SupplyMvrv | undefined) ?? null),
};

/** Where each value sits in its own trailing `w`-bar range (0 low … 1 high). */
function rangePosition(x: Series, w: number): Series {
  const hi = ta.highest(x, w);
  const lo = ta.lowest(x, w);
  return x.map((v, i) => (hi[i] > lo[i] ? (v - lo[i]) / (hi[i] - lo[i]) : Number.isFinite(hi[i]) ? 0.5 : NaN));
}

/** The latest daily value at or before each chart bar (on-chain data is daily). */
function alignDaily(bars: Bars, times: number[], values: Series): Series {
  const out = ta.fill(bars.length);
  let j = -1;
  for (let i = 0; i < bars.length; i++) {
    while (j + 1 < times.length && times[j + 1] <= bars.time[i]) j++;
    if (j >= 0) out[i] = values[j];
  }
  return out;
}

const sign = (v: number) => (Number.isFinite(v) ? (v > 0 ? 1 : -1) : NaN);

export function btcSplMvrvRoc(bars: Bars, p: Params, data: SupplyMvrv | null): IndicatorResult {
  if (!data?.supply.time.length || !data.mvrv.time.length) return { plots: {} };

  // a. Supply in profit/loss: the share of supply in profit, scaled to its trailing range.
  const days = data.supply.time;
  const scaled = rangePosition(ta.fixnan(data.supply.inProfit), n(p, "normLen"));
  const fast = ta.sma(scaled, n(p, "shortLen"));
  const slow = ta.sma(scaled, n(p, "longLen"));
  const plSignal = fast.map((f, i) => sign(f - slow[i]));

  // b. MVRV rate of change (%) against the threshold.
  const mv = data.mvrv.value;
  const roc = ta.change(mv, n(p, "rocLen")).map((d, i) => (100 * d) / mv[i - n(p, "rocLen")]);
  const rocSignal = roc.map((r) => sign(r - n(p, "rocThreshold")));

  const fastC = alignDaily(bars, days, fast);
  const slowC = alignDaily(bars, days, slow);
  const plC = alignDaily(bars, days, plSignal);
  const rocC = alignDaily(bars, data.mvrv.time, rocSignal);
  // c. Final signal: the average of the two.
  const signal = plC.map((a, i) => (Number.isFinite(a) && Number.isFinite(rocC[i]) ? (a + rocC[i]) / 2 : NaN));

  const [long, short, neutral] = [s(p, "longColor"), s(p, "shortColor"), s(p, "neutralColor")];
  const colorOf = (v: number): Color => (!Number.isFinite(v) ? undefined : v > 0 ? long : v < 0 ? short : neutral);

  let table: IndicatorTable | undefined;
  const last = bars.length - 1;
  if (b(p, "showTable") && last >= 0 && Number.isFinite(signal[last])) {
    const valueColor = (v: number) => (v > 0 ? "#00E676" : v < 0 ? "#FF5252" : "#B2B5BE");
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const row = (r: number, label: string, v: number, labelColor = "#FFFFFF") => [
      { col: 0, row: r, text: label, color: labelColor, size: "normal" as const, align: "left" as const },
      { col: 1, row: r, text: fmt(v), color: valueColor(v), size: "normal" as const },
    ];
    table = {
      position: "bottom_right",
      bg: "#000000",
      frame: "#FFFFFF",
      border: "#434651",
      cells: [...row(0, "Sup. P/L", plC[last]), ...row(1, "MVRV ROC", rocC[last]), ...row(2, "Final Signal", signal[last], "#FF9800")],
    };
  }

  return {
    plots: { fast: fastC, slow: slowC, signal },
    hlines: [{ price: 0.5, color: "#787B86", dashed: true }],
    barColors: b(p, "barColors") ? signal.map(colorOf) : undefined,
    table,
  };
}
