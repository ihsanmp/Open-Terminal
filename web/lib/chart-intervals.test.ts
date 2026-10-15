import { describe, expect, it } from "vitest";
import { INTERVALS, INTERVAL_GROUPS, INTERVAL_LABEL, INTERVAL_SOURCE, MIN_VISIBLE_BARS, RANGE_PRESETS, futureTimes, latestBarsView, loadRange, orderedFavorites, parseIntervalInput, presetStart, resolveInterval } from "./chart-intervals";

describe("chart intervals", () => {
  it("labels intervals as TradingView's toolbar does and groups every one in the menu", () => {
    expect(INTERVALS.map((i) => INTERVAL_LABEL[i])).toEqual([
      "1m", "5m", "15m", "30m", "H1", "H2", "H4", "H6", "D1", "D2", "D3", "D4", "D5", "W", "M", "1R", "10R", "100R", "1000R",
    ]);
    expect(INTERVAL_GROUPS.flatMap(([, list]) => list)).toEqual([...INTERVALS]);
  });

  it("keeps favorites in menu order and drops unknown ones", () => {
    expect(orderedFavorites(["1D", "15m", "2h", "1h", "7h"])).toEqual(["15m", "1h", "2h", "1D"]);
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
    // Built intervals load what they are built from.
    expect(loadRange("2h")).toBe("1Y");
    expect(loadRange("3D")).toBe("5Y");
    expect(loadRange("100R")).toBe("5D");
  });

  it("builds the intervals the API lacks from those it serves", () => {
    expect(INTERVAL_SOURCE["2h"]).toEqual({ base: "1h", group: 2 });
    expect(INTERVAL_SOURCE["5D"]).toEqual({ base: "1D", group: 5 });
    expect(INTERVAL_SOURCE["1000R"]).toEqual({ base: "1m", ticks: 1000 });
    expect(INTERVAL_SOURCE["4h"]).toEqual({ base: "4h" });
  });

  it("opens on the latest bars at a readable width", () => {
    // 1400 px at 7 px a bar: 200 bars, the newest two bars' width in from the right edge.
    expect(latestBarsView(5000, 1400)).toEqual({ from: 4800.5, to: 5001 });
    // A narrow chart still shows MIN_VISIBLE_BARS.
    const narrow = latestBarsView(5000, 100);
    expect(narrow.to - narrow.from).toBeCloseTo(MIN_VISIBLE_BARS + 0.5, 6);
  });
});

describe("intervals typed on the chart and the range buttons", () => {
  it("reads a typed interval as TradingView's box does", () => {
    expect(parseIntervalInput("15")).toBe("15m");
    expect(parseIntervalInput("30")).toBe("30m");
    expect(parseIntervalInput("240")).toBe("4h");
    expect(parseIntervalInput("4h")).toBe("4h");
    expect(parseIntervalInput("1D")).toBe("1D");
    expect(parseIntervalInput("3d")).toBe("3D");
    expect(parseIntervalInput("7D")).toBe("1W");
    expect(parseIntervalInput("1W")).toBe("1W");
    expect(parseIntervalInput("1M")).toBe("1M");
    expect(parseIntervalInput("1m")).toBe("1m");
    expect(parseIntervalInput("10R")).toBe("10R");
    expect(parseIntervalInput("7")).toBeNull();
    expect(parseIntervalInput("")).toBeNull();
    expect(parseIntervalInput("0")).toBeNull();
  });

  it("starts a range preset where its span begins", () => {
    const day = 86_400;
    const times = Array.from({ length: 400 }, (_, i) => Date.UTC(2026, 0, 1) / 1000 - 100 * day + i * day);
    expect(presetStart(times, "all")).toBe(0);
    expect(times[presetStart(times, 30)]).toBe(times[times.length - 1] - 30 * day);
    expect(times[presetStart(times, "ytd")]).toBe(Date.UTC(new Date(times[times.length - 1] * 1000).getUTCFullYear(), 0, 1) / 1000);
    expect(presetStart([], 30)).toBe(0);
    expect(RANGE_PRESETS.map((p) => p.label)).toEqual(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"]);
  });
});

describe("futureTimes", () => {
  const d = (s: string) => Date.parse(s) / 1000;
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  it("steps monthly bars by calendar months, so the axis stays on the 1st", () => {
    const monthly = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map(d);
    const out = futureTimes(monthly, 15).map(iso);
    expect(out.slice(0, 4)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(out.at(-1)).toBe("2028-01-01");
  });

  it("skips weekends after weekday daily bars, and goes on from a later time when asked", () => {
    const daily = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map(d);
    expect(futureTimes(daily, 3).map(iso)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(futureTimes(daily, 2, d("2026-10-23")).map(iso)).toEqual(["2026-10-26", "2026-10-27"]);
  });

  it("keeps weekends for markets that trade them", () => {
    const crypto = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(d);
    expect(futureTimes(crypto, 2).map(iso)).toEqual(["2026-10-19", "2026-10-20"]);
    // With no weekend among the bars yet, the weekday rule holds.
    expect(futureTimes(crypto.slice(0, 3), 2).map(iso)).toEqual(["2026-10-19", "2026-10-20"]);
  });
});
