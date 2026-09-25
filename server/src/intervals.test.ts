import { describe, expect, it } from "vitest";
import { MAX_BARS, MIN_BARS, clip, groupCandles, isInterval, loadStart, rangeStart, yahooPlan } from "./intervals.js";

const NOW = Date.UTC(2026, 8, 25, 12) / 1000; // Fri 2026-09-25 12:00 UTC
const DAY = 86_400;
const bar = (time: number, o: number, h: number, l: number, c: number, volume = 1) => ({ time, open: o, high: h, low: l, close: c, volume });

describe("chart intervals", () => {
  it("accepts only the menu's intervals", () => {
    for (const ok of ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"]) expect(isInterval(ok)).toBe(true);
    for (const bad of ["auto", "2h", "1d", "", undefined]) expect(isInterval(bad)).toBe(false);
  });

  it("builds 4h bars from 1h within each session, restarting after gaps", () => {
    // A US session: seven 1h bars 13:30–19:30 UTC, then the next day's first bar.
    const day1 = Date.UTC(2026, 8, 24, 13, 30) / 1000;
    const hours = Array.from({ length: 7 }, (_, k) => bar(day1 + k * 3600, 10 + k, 11 + k, 9 + k, 10.5 + k, 100));
    const next = bar(day1 + DAY, 20, 21, 19, 20.5, 100);
    const out = groupCandles([...hours, next], 4, 3600);
    expect(out.map((c) => new Date(c.time * 1000).toISOString().slice(8, 16))).toEqual(["24T13:30", "24T17:30", "25T13:30"]);
    expect(out[0]).toMatchObject({ open: 10, high: 14, low: 9, close: 13.5, volume: 400 });
    expect(out[1]).toMatchObject({ open: 14, high: 17, low: 13, close: 16.5, volume: 300 });
  });

  it("loads at least MIN_BARS bars whatever the range", () => {
    // 5D at 1D on crypto: a thousand days back, not five.
    expect(loadStart("5D", "1D", true, NOW)).toBeCloseTo(NOW - MIN_BARS * DAY * 0.99, 0);
    // Stocks need more calendar time per bar (weekends, and 6.5 trading hours a day intraday).
    expect(loadStart("5D", "1h", false, NOW)!).toBeLessThan(NOW - MIN_BARS * 3600 * 5);
    // A long range reaches further than MIN_BARS already needs.
    expect(loadStart("5Y", "1W", true, NOW)).toBe(Math.min(rangeStart("5Y", NOW)!, NOW - MIN_BARS * 604_800 * 0.99));
    expect(loadStart("MAX", "1D", true, NOW)).toBeNull();
    // Crypto 1D at 1m: one day (1440 bars), not the five days stocks reach back over weekends.
    expect(loadStart("1D", "1m", true, NOW)).toBe(NOW - DAY);
    expect(loadStart("1D", "1m", false, NOW)).toBeLessThan(NOW - 4 * DAY);
  });

  it("asks Yahoo only for what it keeps", () => {
    expect(yahooPlan("1Y", "5m", NOW)).toMatchObject({ interval: "5m", from: NOW - 59 * DAY });
    expect(yahooPlan("5D", "1m", NOW)).toMatchObject({ interval: "1m", from: NOW - 7 * DAY });
    // A thousand 4h stock bars need ~2.6 years, beyond the 729 days Yahoo keeps 1h bars for.
    expect(yahooPlan("1M", "4h", NOW)).toMatchObject({ interval: "60m", group: 4, from: NOW - 729 * DAY });
    expect(yahooPlan("1M", "1D", NOW).from).toBe(loadStart("1M", "1D", false, NOW));
    expect(yahooPlan("MAX", "1D", NOW).from).toBeNull();
  });

  it("keeps the newest MAX_BARS", () => {
    const many = Array.from({ length: MAX_BARS + 10 }, (_, k) => bar(k * 60, k, k, k, k));
    const kept = clip(many);
    expect(kept).toHaveLength(MAX_BARS);
    expect(kept.at(-1)!.close).toBe(MAX_BARS + 9);
  });
});

describe("Yahoo's trailing last-trade point", () => {
  it("folds into the candle still open", async () => {
    const { foldLiveTick } = await import("./providers/yahoo.js");
    const h = (hh: number, mm: number) => Date.UTC(2026, 8, 24, hh, mm) / 1000;
    // 1h bars 18:30 and 19:30, then a 20:00 point at the close.
    const hourly = [bar(h(18, 30), 1, 2, 0.5, 1.5, 10), bar(h(19, 30), 1.5, 3, 1, 2, 20), bar(h(20, 0), 2.5, 2.5, 2.5, 2.5, 5)];
    expect(foldLiveTick(hourly, "60m")).toEqual([hourly[0], { ...hourly[1], close: 2.5, volume: 20 }]);
    // 5m bars up to 19:55 plus the 20:00 point: same gap as a bar, but at the close with no volume.
    const fives = [bar(h(19, 50), 1, 1, 1, 1), bar(h(19, 55), 1, 1, 1, 1), bar(h(20, 0), 1.2, 1.2, 1.2, 1.2, 0)];
    // Yahoo reports today's session end; yesterday's close is the same time of day.
    expect(foldLiveTick(fives, "5m", h(20, 0) + DAY)).toHaveLength(2);
    expect(foldLiveTick(fives, "5m")).toHaveLength(3);
    // A bar that just opened mid-session (with trades) stays.
    const live = [bar(h(14, 30), 1, 1, 1, 1), bar(h(14, 35), 1, 1, 1, 1, 50)];
    expect(foldLiveTick(live, "5m", h(20, 0) + DAY)).toHaveLength(2);
    // Daily bars a day apart are left alone.
    expect(foldLiveTick([bar(h(13, 30) - DAY, 1, 1, 1, 1), bar(h(13, 30), 1, 1, 1, 1)], "1d")).toHaveLength(2);
  });
});

describe("weekly and monthly bars from daily ones", () => {
  it("groups Monday-start weeks and calendar months", async () => {
    const { aggregateByPeriod } = await import("./intervals.js");
    // Thu 2026-09-17 … Tue 2026-09-22 (a weekend in between), then 2026-10-01.
    const d = (m: number, day: number) => Date.UTC(2026, m - 1, day, 13, 30) / 1000;
    const daily = [bar(d(9, 17), 1, 2, 0.5, 1.5, 10), bar(d(9, 18), 1.5, 3, 1, 2, 10), bar(d(9, 21), 2, 2.5, 1.8, 2.2, 10), bar(d(9, 22), 2.2, 4, 2, 3, 10), bar(d(10, 1), 3, 3.5, 2.9, 3.1, 10)];
    const weeks = aggregateByPeriod(daily, "week");
    expect(weeks.map((w) => [new Date(w.time * 1000).toISOString().slice(0, 10), w.open, w.high, w.low, w.close, w.volume])).toEqual([
      ["2026-09-17", 1, 3, 0.5, 2, 20],
      ["2026-09-21", 2, 4, 1.8, 3, 20],
      ["2026-10-01", 3, 3.5, 2.9, 3.1, 10],
    ]);
    expect(aggregateByPeriod(daily, "month").map((m) => [m.open, m.close, m.volume])).toEqual([[1, 3, 40], [3, 3.1, 10]]);
  });
});
