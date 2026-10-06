// "BTC: Profit/Loss Momentum Meter" — after MarktQuant's indicator of that name on TradingView.
// That script is closed-source; this is an independent implementation (MIT, like the repository)
// of its published description:
//   - the percentage of Bitcoin in profit and in loss, from an external source;
//   - the momentum: their difference, averaged over 7 days (the "Length" input);
//   - horizontal sentiment levels, and a threshold for buy and sell signals that colors the bars
//     and the background (red to sell, green to buy).
//
// Data (daily, via /api/onchain/btc-supply-mvrv): the share of BTC supply in profit from
// BGeometrics (in loss is the rest). The original reads IntoTheBlock's series on TradingView,
// which stopped updating in Aug 2025; the supply's share in profit tracks it closely and is live.

import * as ta from "../core";
import { type Bars } from "../core";
import { alignDaily, type SupplyMvrv } from "./btc-spl-mvrv";
import { b, bool, colorInput, int, n, s, type Color, type IndicatorDef, type IndicatorResult, type Params } from "../types";

const PATH = "/api/onchain/btc-supply-mvrv";

export const btcPlMomentum: IndicatorDef = {
  id: "btc-pl-momentum",
  name: "BTC: Profit/Loss Momentum Meter",
  short: "BTC P/L Momentum",
  category: "Community",
  overlay: false,
  precision: 2,
  aliases: ["MarktQuant", "Profit Loss Momentum", "In the money", "Supply in profit"],
  description: "The 7-day average of BTC's share in profit minus its share in loss, with sentiment levels and buy/sell signals at a threshold.",
  legendInputs: ["length", "threshold"],
  inputs: [
    int("length", "Length (days)", 7, 1, 365),
    int("threshold", "Signal Threshold", 90, 50, 100),
    bool("barColors", "Color Bars", true),
    bool("background", "Color Background", true),
    colorInput("buyColor", "Buy", "#089981"),
    colorInput("sellColor", "Sell", "#F23645"),
  ],
  plots: [{ key: "momentum", title: "Momentum Meter", color: "#4DD0A1", width: 2 }],
  fetches: () => [PATH],
  compute: (bars, p, ext) => btcProfitLossMomentum(bars, p, (ext?.fetched?.[PATH] as SupplyMvrv | undefined) ?? null),
};

/** A color at a given opacity (#rrggbb → rgba). */
const alpha = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};

export function btcProfitLossMomentum(bars: Bars, p: Params, data: SupplyMvrv | null): IndicatorResult {
  if (!data?.supply.time.length) return { plots: {} };

  // Profit % − loss %, from the share in profit (the loss is the rest), averaged by day.
  const diff = ta.fixnan(data.supply.inProfit).map((share) => 100 * (share - (1 - share)));
  const momentum = alignDaily(bars, data.supply.time, ta.sma(diff, n(p, "length")));

  // Above the threshold is a sell; as far below the top as the threshold is from it, a buy.
  const sellAt = n(p, "threshold");
  const buyAt = 100 - sellAt;
  const [buy, sell] = [s(p, "buyColor"), s(p, "sellColor")];
  const signal = (v: number): string | undefined => (!Number.isFinite(v) ? undefined : v >= sellAt ? sell : v <= buyAt ? buy : undefined);

  return {
    plots: { momentum },
    hlines: [
      { price: 100, color: "#787B86", title: "Max" },
      { price: 80, color: alpha(sell, 0.8), dashed: true, title: "Greed" },
      { price: 40, color: "#787B86", dashed: true, title: "Neutral" },
      { price: 20, color: alpha(buy, 0.8), dashed: true, title: "Fear" },
      { price: 0, color: "#787B86", title: "Zero" },
    ],
    fills: [
      { a: 100, b: 80, color: alpha(sell, 0.25) },
      { a: 20, b: 0, color: alpha(buy, 0.25) },
    ],
    barColors: b(p, "barColors") ? momentum.map((v) => signal(v) as Color) : undefined,
    bgColors: b(p, "background") ? momentum.map((v) => { const c = signal(v); return (c ? alpha(c, 0.25) : undefined) as Color; }) : undefined,
  };
}
