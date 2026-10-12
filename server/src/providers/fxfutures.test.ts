import { describe, expect, it } from "vitest";
import { asPairBars, asPairTrade, cotRows, fxFutureOf, fxPair } from "./fxfutures.js";
import { clvFlows } from "./moneyflow.js";

describe("a currency pair's money flow from its CME future", () => {
  it("finds the future for the pair however it's written", () => {
    expect(["EURUSD=X", "FX:EURUSD", "USDJPY=X", "JPY=X", "GBPUSD", "EURJPY=X", "AAPL"].map(fxPair)).toEqual(["EURUSD", "EURUSD", "USDJPY", "USDJPY", "GBPUSD", null, null]);
    expect(fxFutureOf("JPY=X")).toMatchObject({ tv: "CME:6J1!", invert: true });
  });

  it("values a futures trade in dollars, as the pair's", () => {
    const eur = fxFutureOf("EURUSD=X")!;
    expect(asPairTrade({ time: 1, price: 1.12, size: 10, value: 11.2, side: "buy" as const }, eur)).toEqual({ time: 1, price: 1.12, size: 10, value: 10 * 125_000 * 1.12, side: "buy" });
    // Buying yen futures is selling USDJPY, at 1/0.00625 = 160 yen.
    const jpy = fxFutureOf("USDJPY=X")!;
    const t = asPairTrade({ time: 1, price: 0.00625, size: 2, value: 0.0125, side: "buy" as const }, jpy);
    expect(t).toMatchObject({ side: "sell", price: 160 });
    expect(t.value).toBeCloseTo(2 * 12_500_000 * 0.00625, 6);
  });

  it("turns a yen future's bars over: the dollars stay, the shape is USDJPY's", () => {
    const jpy = fxFutureOf("USDJPY=X")!;
    // The future closes at its high: yen up, so USDJPY closes at its low.
    const bar = { time: 0, open: 0.0062, high: 0.0064, low: 0.0062, close: 0.0064, volume: 100 };
    const [pairBar] = asPairBars([bar], jpy);
    expect(pairBar.high).toBeCloseTo(1 / 0.0062, 6);
    expect(pairBar.low).toBeCloseTo(1 / 0.0064, 6);
    const [flow] = clvFlows([pairBar]);
    const dollars = ((bar.high + bar.low + bar.close) / 3) * bar.volume * jpy.size;
    expect(flow.inflow + flow.outflow).toBeCloseTo(dollars, 2);
    expect(flow.outflow).toBeCloseTo(dollars, 2); // all of it out of USDJPY
    // The euro's are left as they are, in dollars.
    const eur = fxFutureOf("EURUSD=X")!;
    expect(asPairBars([{ ...bar, high: 1.13, low: 1.11, close: 1.13, open: 1.11 }], eur)[0].volume).toBe(100 * 125_000);
  });

  it("reads each group's weekly change from the CFTC report", () => {
    const rows = cotRows([
      { report_date_as_yyyy_mm_dd: "2026-10-06T00:00:00.000", change_in_asset_mgr_long: "-904", change_in_asset_mgr_short: "29818", change_in_lev_money_long: "10510", change_in_lev_money_short: "15506", change_in_dealer_long_all: "641", change_in_dealer_short_all: "-35011", asset_mgr_positions_long: "499449", asset_mgr_positions_short: "309568", lev_money_positions_long: "135367", lev_money_positions_short: "179628", dealer_positions_long_all: "48187", dealer_positions_short_all: "224701" },
      { report_date_as_yyyy_mm_dd: "2026-09-29T00:00:00.000" },
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-29", "2026-10-06"]);
    expect(rows[1]).toMatchObject({ assetManagers: -30_722, leveragedFunds: -4_996, dealers: 35_652, netAssetManagers: 189_881, netLeveragedFunds: -44_261, netDealers: -176_514 });
  });
});
