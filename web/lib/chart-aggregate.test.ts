import { describe, expect, it } from "vitest";
import { groupDays, groupHours, rangeBars } from "./chart-aggregate";
import { gridBars, zonedTimes } from "./chart-grid";

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 1) => ({ time, open, high, low, close, volume });
const at = (iso: string) => Date.parse(iso) / 1000;

describe("intervals built in the browser", () => {
  it("H2 for crypto by the clock, for a US stock from the session's first bar", () => {
    const crypto = Array.from({ length: 24 }, (_, h) => bar(at("2026-10-01T00:00Z") + h * 3600, h, h + 1, h - 1, h + 0.5));
    const h2 = groupHours(crypto, 2, "crypto", "Etc/UTC");
    expect(h2).toHaveLength(12);
    expect(h2[1]).toEqual({ time: at("2026-10-01T02:00Z"), open: 2, high: 4, low: 1, close: 3.5, volume: 2 });
    // NYSE hourly bars 09:30 … 15:30 (13:30 … 19:30 UTC in October): H2 opens 09:30, 11:30, 13:30, 15:30.
    const stock = Array.from({ length: 7 }, (_, i) => bar(at("2026-10-01T13:30Z") + i * 3600, 1, 2, 0, 1));
    expect(groupHours(stock, 2, "stock", "America/New_York").map((b) => new Date(b.time * 1000).toISOString().slice(11, 16))).toEqual(["13:30", "15:30", "17:30", "19:30"]);
  });

  it("D3 at fixed places: calendar days for crypto, weekdays for stocks", () => {
    const days = Array.from({ length: 9 }, (_, i) => bar(at("2026-10-01T00:00Z") + i * 86_400, i, i, i, i));
    const d3 = groupDays(days, 3, "crypto");
    expect(d3.reduce((n, b) => n + b.volume, 0)).toBe(9);
    // The same day always starts a bar, wherever the history starts.
    expect(groupDays(days.slice(1), 3, "crypto").map((b) => b.time)).toContain(d3[1].time);
    // Stocks: Monday 5 Oct … Friday 16 Oct 2026, ten weekdays, five to a D5 bar = Monday-to-Friday weeks.
    const weekdays = [5, 6, 7, 8, 9, 12, 13, 14, 15, 16].map((d) => bar(at(`2026-10-${String(d).padStart(2, "0")}T00:00Z`), d, d, d, d));
    expect(groupDays(weekdays, 5, "stock").map((b) => new Date(b.time * 1000).getUTCDate())).toEqual([5, 12]);
  });

  it("range bars each span the range, the next opening where the last closed", () => {
    // A rise from 100 to 110 in one minute, then a fall to 104: 1-point bars.
    const bars = rangeBars([bar(1000, 100, 110, 100, 110, 5), bar(1060, 110, 110, 104, 104, 3)], 1);
    const done = bars.slice(0, -1);
    expect(done.every((b) => Math.abs(b.high - b.low - 1) < 1e-9)).toBe(true);
    expect(done.slice(0, 10).every((b) => b.close > b.open)).toBe(true);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].open).toBeCloseTo(bars[i - 1].close, 9);
      expect(bars[i].time).toBeGreaterThan(bars[i - 1].time);
    }
    // Only the newest are kept.
    expect(rangeBars([bar(1000, 100, 200, 100, 200)], 0.01, 300)).toHaveLength(300);
  });
});

describe("the grid follows the interval", () => {
  const hourly = Array.from({ length: 24 * 30 }, (_, i) => at("2026-09-01T00:00Z") + i * 3600);
  const daily = Array.from({ length: 365 }, (_, i) => at("2025-10-01T00:00Z") + i * 86_400);
  it("rules H1 by days, D1 by months, and steps up when zoomed out", () => {
    const z = zonedTimes(hourly, "Etc/UTC");
    expect(gridBars(z, 0, 24 * 7, 3600, 4).unit).toBe("day"); // a week at 4 px a bar
    expect(gridBars(z, 0, 24 * 7, 3600, 7).unit).toBe("12h"); // as the time axis labels it
    expect(gridBars(z, 0, 24 * 30, 3600, 1).unit).toBe("week"); // a month at 1 px a bar
    expect(gridBars(z, 0, 48, 3600, 30).unit).toMatch(/^\d+h$/); // zoomed in: hours, finer than days
    const d = zonedTimes(daily, "Etc/UTC");
    const months = gridBars(d, 0, 364, 86_400, 3);
    expect(months.unit).toBe("month");
    expect(months.bars.every((i) => new Date(daily[i] * 1000).getUTCDate() === 1)).toBe(true);
    // Never finer than two bars: a daily chart isn't ruled by hours.
    expect(gridBars(d, 0, 20, 86_400, 200).unit).not.toMatch(/h$/);
  });
});

describe("the grid of minute and range charts", () => {
  it("rules a 1-minute chart by minutes, each line on the minute it names", () => {
    const minutes = Array.from({ length: 240 }, (_, i) => at("2026-10-01T00:00Z") + i * 60);
    const g = gridBars(zonedTimes(minutes, "Etc/UTC"), 0, 239, 60, 7);
    expect(g.unit).toBe("10m"); // 70 px apart at 7 px a bar
    expect(g.bars.every((i) => new Date(minutes[i] * 1000).getUTCMinutes() % 10 === 0)).toBe(true);
    expect(gridBars(zonedTimes(minutes, "Etc/UTC"), 0, 239, 60, 3).unit).toBe("30m"); // zoomed out
  });
});
