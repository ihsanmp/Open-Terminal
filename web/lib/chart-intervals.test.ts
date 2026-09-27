import { describe, expect, it } from "vitest";
import { INTERVALS, INTERVAL_GROUPS, INTERVAL_LABEL, MIN_VISIBLE_BARS, latestBarsView, loadRange, orderedFavorites, resolveInterval } from "./chart-intervals";

describe("chart intervals", () => {
  it("labels intervals as TradingView's toolbar does and groups every one in the menu", () => {
    expect(INTERVALS.map((i) => INTERVAL_LABEL[i])).toEqual(["1m", "5m", "15m", "1h", "4h", "D", "W", "M"]);
    expect(INTERVAL_GROUPS.flatMap(([, list]) => list)).toEqual([...INTERVALS]);
  });

  it("keeps favorites in menu order and drops unknown ones", () => {
    expect(orderedFavorites(["1D", "15m", "2h", "1h"])).toEqual(["15m", "1h", "1D"]);
    expect(orderedFavorites([])).toEqual([]);
  });

  it("keeps a saved interval, else opens on daily candles", () => {
    expect(resolveInterval("4h")).toBe("4h");
    expect(resolveInterval("auto")).toBe("1D");
    expect(resolveInterval(undefined)).toBe("1D");
  });

  it("asks the server for enough history at each interval", () => {
    expect(loadRange("5m")).toBe("5D");
    expect(loadRange("4h")).toBe("1Y");
    expect(loadRange("1D")).toBe("5Y");
    expect(loadRange("1W")).toBe("MAX");
    expect(loadRange("1M")).toBe("MAX");
  });

  it("opens on the latest bars at a readable width", () => {
    // 1400 px at 7 px a bar: 200 bars, the newest two bars' width in from the right edge.
    expect(latestBarsView(5000, 1400)).toEqual({ from: 4800.5, to: 5001 });
    // A narrow chart still shows MIN_VISIBLE_BARS.
    const narrow = latestBarsView(5000, 100);
    expect(narrow.to - narrow.from).toBeCloseTo(MIN_VISIBLE_BARS + 0.5, 6);
  });
});
