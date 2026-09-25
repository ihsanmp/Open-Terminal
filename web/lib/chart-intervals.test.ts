import { describe, expect, it } from "vitest";
import { defaultInterval, resolveChartView } from "./chart-intervals";

describe("chart ranges and intervals", () => {
  it("opens each range at its usual interval", () => {
    expect(defaultInterval("1D", "AAPL")).toBe("5m");
    expect(defaultInterval("5D", "AAPL")).toBe("15m");
    expect(defaultInterval("1M", "AAPL")).toBe("1h");
    expect(defaultInterval("6M", "AAPL")).toBe("1D");
    expect(defaultInterval("6M", "BTC-USD")).toBe("4h");
    expect(defaultInterval("1Y", "AAPL")).toBe("1D");
    expect(defaultInterval("5Y", "AAPL")).toBe("1W");
    expect(defaultInterval("MAX", "AAPL")).toBe("1M");
  });

  it("keeps a chosen interval and upgrades old saved views", () => {
    expect(resolveChartView("5D", "1m", "AAPL")).toEqual({ range: "5D", interval: "1m" });
    // Widgets saved with the old "auto" (or nothing) show the range's real interval.
    expect(resolveChartView("5D", "auto", "AAPL")).toEqual({ range: "5D", interval: "15m" });
    expect(resolveChartView(undefined, undefined, "BTC-USD")).toEqual({ range: "6M", interval: "4h" });
  });
});
