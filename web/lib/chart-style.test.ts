import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_STYLE, TRANSPARENT, candleOptions, formatChartTime, formatTick, prevCloseColors, resolveChartStyle, risingBars, utcOffsetLabel } from "./chart-style";

describe("chart style (TradingView's Symbol and Canvas settings)", () => {
  it("completes a partial saved style with the defaults", () => {
    const s = resolveChartStyle({ body: { up: "#7E57C2" } as never, precision: 3 });
    expect(s.body).toEqual({ visible: true, up: "#7E57C2", down: DEFAULT_CHART_STYLE.body.down });
    expect(s.wick).toEqual(DEFAULT_CHART_STYLE.wick);
    expect(s.precision).toBe(3);
    expect(resolveChartStyle(undefined)).toEqual(DEFAULT_CHART_STYLE);
  });

  it("maps body, borders and wick onto the candlestick series", () => {
    const s = resolveChartStyle({ body: { visible: false, up: "#fff", down: "#000" }, wick: { visible: false, up: "#1", down: "#2" } });
    const o = candleOptions(s);
    expect(o.upColor).toBe(TRANSPARENT);
    expect(o.downColor).toBe(TRANSPARENT);
    expect(o.wickVisible).toBe(false);
    expect(o.borderVisible).toBe(true);
  });

  it("colors bars against the previous close when asked", () => {
    const candles = [
      { open: 10, close: 11 },
      { open: 12, close: 11.5 }, // falls on the day, but closes above 11
      { open: 11, close: 10 },
    ];
    expect(risingBars(candles, false)).toEqual([true, false, false]);
    expect(risingBars(candles, true)).toEqual([true, true, false]);
    expect(prevCloseColors(candles, DEFAULT_CHART_STYLE)).toBeUndefined();
    const colors = prevCloseColors(candles, { ...DEFAULT_CHART_STYLE, colorByPrevClose: true })!;
    expect(colors.map((c) => c.color)).toEqual([DEFAULT_CHART_STYLE.body.up, DEFAULT_CHART_STYLE.body.up, DEFAULT_CHART_STYLE.body.down]);
  });

  it("shows intraday times in the chosen zone and daily bars as dates", () => {
    const t = Date.UTC(2026, 8, 25, 13, 30) / 1000; // 13:30 UTC
    expect(formatChartTime(t, true, "Asia/Jakarta")).toContain("20:30");
    expect(formatChartTime(t, true, "America/New_York")).toContain("09:30");
    // A crypto daily bar at 00:00 UTC stays on its date in New York.
    const day = Date.UTC(2026, 8, 25) / 1000;
    expect(formatChartTime(day, false, "America/New_York")).toContain("25 Sept");
    expect(formatTick(t, 3, true, "Asia/Jakarta")).toBe("20:30");
    expect(formatTick(day, 2, false, "America/New_York")).toBe("25");
    expect(formatTick(day, 0, false, "UTC")).toBe("2026");
  });

  it("labels zones with their UTC offset", () => {
    expect(utcOffsetLabel("Asia/Jakarta")).toBe("(UTC+7)");
    expect(utcOffsetLabel("UTC")).toBe("(UTC)");
  });
});
