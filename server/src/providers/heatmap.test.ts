import { describe, expect, it } from "vitest";
import { isHeatmapMarket, perfOf, usCells } from "./heatmap.js";
import type { MarketRow } from "./tradingview.js";

describe("heatmap", () => {
  it("reads the day's change and each longer period's in order", () => {
    expect(perfOf(1.5, [2, 3, 4, 5, 6, 7])).toEqual({ "1D": 1.5, "1W": 2, "1M": 3, "3M": 4, "6M": 5, YTD: 6, "1Y": 7 });
    expect(perfOf(null, [NaN, "x"])).toMatchObject({ "1D": null, "1W": null, "1M": null, "1Y": null });
  });

  it("maps US rows to boxes sized by market cap, with the day's change as 1D", () => {
    const row = (symbol: string, marketCap: number | null): MarketRow => ({
      symbol, name: symbol, price: 1, changePercent: 0.5, volume: 1, marketCap, sector: "Tech", exchange: "NASDAQ", perf: { YTD: 12 },
    });
    const cells = usCells([row("AAPL", 3e12), row("NOCAP", null)]);
    expect(cells).toEqual([{ symbol: "AAPL", label: "AAPL", name: "AAPL", group: "Tech", size: 3e12, perf: { YTD: 12, "1D": 0.5 } }]);
  });

  it("knows its markets", () => {
    expect(isHeatmapMarket("indonesia")).toBe(true);
    expect(isHeatmapMarket("crypto")).toBe(true);
    expect(isHeatmapMarket("mars")).toBe(false);
  });
});
