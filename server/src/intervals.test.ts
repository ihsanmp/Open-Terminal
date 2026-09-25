import { describe, expect, it } from "vitest";
import { MAX_BARS, clip, groupCandles, isInterval, rangeStart, yahooPlan } from "./intervals.js";

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

  it("asks Yahoo only for what it keeps", () => {
    expect(yahooPlan("1Y", "5m", NOW)).toMatchObject({ interval: "5m", from: NOW - 59 * DAY });
    expect(yahooPlan("5D", "1m", NOW)).toMatchObject({ interval: "1m", from: NOW - 7 * DAY });
    expect(yahooPlan("1M", "4h", NOW)).toMatchObject({ interval: "60m", group: 4, from: rangeStart("1M", NOW) });
    expect(yahooPlan("MAX", "1D", NOW).from).toBeNull();
  });

  it("clips 1D and 5D to the last sessions with data, not the last 24 hours", () => {
    // Saturday: Friday's session is still "1D".
    const sat = Date.UTC(2026, 8, 26, 12) / 1000;
    const fri = Date.UTC(2026, 8, 25, 14) / 1000;
    const thu = fri - DAY;
    const candles = [bar(thu, 1, 1, 1, 1), bar(fri, 2, 2, 2, 2), bar(fri + 3600, 3, 3, 3, 3)];
    expect(clip(candles, "1D", sat).map((c) => c.close)).toEqual([2, 3]);
    expect(clip(candles, "5D", sat)).toHaveLength(3);
  });

  it("clips calendar ranges and keeps the newest MAX_BARS", () => {
    const start = rangeStart("6M", NOW)!;
    expect(clip([bar(start - 60, 1, 1, 1, 1), bar(start + 60, 2, 2, 2, 2)], "6M", NOW).map((c) => c.close)).toEqual([2]);
    const many = Array.from({ length: MAX_BARS + 10 }, (_, k) => bar(k * 60, k, k, k, k));
    const kept = clip(many, "MAX", NOW);
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
