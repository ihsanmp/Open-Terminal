import { describe, expect, it } from "vitest";
import { MIN_VISIBLE_BARS, defaultInterval, initialVisibleRange, rangeStartIndex, resolveChartView } from "./chart-intervals";

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

  it("opens on the range's window with the rest of the history to scroll back into", () => {
    const now = Date.UTC(2026, 8, 25, 12) / 1000;
    // Daily bars for three years: 6M opens on its last ~183 days.
    const days = Array.from({ length: 1100 }, (_, k) => now - (1099 - k) * 86_400);
    const six = rangeStartIndex(days, "6M", now);
    expect(days.length - six).toBeGreaterThan(180);
    expect(days.length - six).toBeLessThan(186);
    expect(initialVisibleRange(days, "6M", now)).toEqual({ from: six - 0.5, to: 1101 });
    // 5D at 1D would be five giant candles: widen to MIN_VISIBLE_BARS.
    expect(initialVisibleRange(days, "5D", now).from).toBe(1100 - MIN_VISIBLE_BARS - 0.5);
    expect(rangeStartIndex(days, "MAX", now)).toBe(0);
  });

  it("counts 1D and 5D in sessions with data", () => {
    // Hourly stock bars Thu and Fri, viewed on Sunday: 1D is Friday's session.
    const thu = Date.UTC(2026, 8, 24, 13, 30) / 1000;
    const bars = [...Array.from({ length: 7 }, (_, k) => thu + k * 3600), ...Array.from({ length: 7 }, (_, k) => thu + 86_400 + k * 3600)];
    expect(rangeStartIndex(bars, "1D", Date.UTC(2026, 8, 27) / 1000)).toBe(7);
    expect(rangeStartIndex(bars, "5D", Date.UTC(2026, 8, 27) / 1000)).toBe(0);
    // Crypto 1D is the last 24 hours, across midnight UTC.
    const hourly = Array.from({ length: 48 }, (_, k) => Date.UTC(2026, 8, 24, 10) / 1000 + k * 3600);
    expect(rangeStartIndex(hourly, "1D", hourly[47], true)).toBe(24);
  });

  it("keeps a chosen interval and upgrades old saved views", () => {
    expect(resolveChartView("5D", "1m", "AAPL")).toEqual({ range: "5D", interval: "1m" });
    // Widgets saved with the old "auto" (or nothing) show the range's real interval.
    expect(resolveChartView("5D", "auto", "AAPL")).toEqual({ range: "5D", interval: "15m" });
    expect(resolveChartView(undefined, undefined, "BTC-USD")).toEqual({ range: "6M", interval: "4h" });
  });
});
