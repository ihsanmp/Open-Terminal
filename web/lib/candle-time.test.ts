import { describe, expect, it } from "vitest";
import { barIntervalSeconds, candleCloseTime, formatAxisCountdown, formatCountdown, intervalLabel, isIntradayInterval, secondsToClose, secondsUntilClose } from "./candle-time";

const series = (startIso: string, stepSeconds: number, count: number) => {
  const start = Math.floor(Date.parse(startIso) / 1000);
  return Array.from({ length: count }, (_, i) => start + i * stepSeconds);
};

describe("barIntervalSeconds", () => {
  it("reads the interval from the bars", () => {
    expect(barIntervalSeconds(series("2026-09-21T13:30:00Z", 300, 40))).toBe(300);
    expect(barIntervalSeconds(series("2026-09-21T13:30:00Z", 3_600, 40))).toBe(3_600);
    expect(barIntervalSeconds(series("2026-01-02T00:00:00Z", 86_400, 40))).toBe(86_400);
  });

  it("ignores overnight and weekend gaps by taking the median", () => {
    const times = [...series("2026-09-18T13:30:00Z", 300, 78), ...series("2026-09-21T13:30:00Z", 300, 78)];
    expect(barIntervalSeconds(times)).toBe(300);
  });

  it("falls back to daily when there is too little data", () => {
    expect(barIntervalSeconds([])).toBe(86_400);
    expect(barIntervalSeconds([1, 2])).toBe(86_400);
  });
});

describe("labels", () => {
  it("names intervals", () => {
    expect(intervalLabel(300)).toBe("5m");
    expect(intervalLabel(3_600)).toBe("1h");
    expect(intervalLabel(86_400)).toBe("1D");
    expect(intervalLabel(7 * 86_400)).toBe("1W");
    expect(intervalLabel(30 * 86_400)).toBe("1M");
  });

  it("separates intraday from daily", () => {
    expect(isIntradayInterval(3_600)).toBe(true);
    expect(isIntradayInterval(86_400)).toBe(false);
  });
});

describe("countdown", () => {
  const barTime = Math.floor(Date.parse("2026-09-21T16:55:00Z") / 1000);

  it("counts down to the close of the open candle", () => {
    expect(secondsToClose(barTime, 300, Date.parse("2026-09-21T16:57:23Z"))).toBe(157);
    expect(secondsToClose(barTime, 300, Date.parse("2026-09-21T16:59:59Z"))).toBe(1);
  });

  it("is null once the candle has closed", () => {
    expect(secondsToClose(barTime, 300, Date.parse("2026-09-21T17:00:00Z"))).toBeNull();
    expect(secondsToClose(barTime, 300, Date.parse("2026-09-21T18:00:00Z"))).toBeNull();
  });

  it("formats mm:ss and h:mm:ss", () => {
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(157)).toBe("02:37");
    expect(formatCountdown(3_723)).toBe("1:02:03");
  });
});

describe("candle close times", () => {
  const us = { type: "stock" as const, timezone: "America/New_York" };
  const crypto = { type: "crypto" as const, timezone: "Etc/UTC" };
  const at = (iso: string) => Date.parse(iso) / 1000;
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);

  it("runs crypto bars their full length, months to the calendar month", () => {
    expect(iso(candleCloseTime(at("2026-09-25T08:00Z"), 14_400, crypto))).toBe("2026-09-25T12:00");
    expect(iso(candleCloseTime(at("2026-09-01T00:00Z"), 2_592_000, crypto))).toBe("2026-10-01T00:00");
  });

  it("ends stock bars with the session", () => {
    // 4h bars at 09:30 and 13:30 New York (EDT): the second closes at 16:00, not 17:30.
    expect(iso(candleCloseTime(at("2026-09-24T13:30Z"), 14_400, us))).toBe("2026-09-24T17:30");
    expect(iso(candleCloseTime(at("2026-09-24T17:30Z"), 14_400, us))).toBe("2026-09-24T20:00");
    // Daily bar stamped at the open or at midnight New York: closes 16:00 that day.
    expect(iso(candleCloseTime(at("2026-09-24T13:30Z"), 86_400, us))).toBe("2026-09-24T20:00");
    expect(iso(candleCloseTime(at("2026-09-24T04:00Z"), 86_400, us))).toBe("2026-09-24T20:00");
    // Winter time (EST): 16:00 New York is 21:00 UTC.
    expect(iso(candleCloseTime(at("2026-01-15T14:30Z"), 86_400, us))).toBe("2026-01-15T21:00");
    // Weekly bar from Monday: Friday's close. Monthly: the last weekday (Oct 31 2026 is a Saturday).
    expect(iso(candleCloseTime(at("2026-09-21T04:00Z"), 604_800, us))).toBe("2026-09-25T20:00");
    expect(iso(candleCloseTime(at("2026-10-01T04:00Z"), 2_592_000, us))).toBe("2026-10-30T20:00");
    // Jakarta closes at 16:00 WIB = 09:00 UTC.
    expect(iso(candleCloseTime(at("2026-09-25T02:00Z"), 86_400, { type: "stock", timezone: "Asia/Jakarta" }))).toBe("2026-09-25T09:00");
  });

  it("counts down only while the candle is open", () => {
    const bar = at("2026-09-24T17:30Z");
    expect(secondsUntilClose(bar, 14_400, us, at("2026-09-24T19:48:12Z") * 1000)).toBe(708);
    expect(secondsUntilClose(bar, 14_400, us, at("2026-09-24T20:30Z") * 1000)).toBeNull(); // after the close
    expect(secondsUntilClose(bar, 14_400, us, at("2026-09-24T17:00Z") * 1000)).toBeNull(); // before it opened
  });

  it("formats the axis countdown like TradingView", () => {
    expect(formatAxisCountdown(708)).toBe("11:48");
    expect(formatAxisCountdown(3 * 3600 + 5 * 60 + 12)).toBe("3:05:12");
    expect(formatAxisCountdown(2 * 86_400 + 3 * 3600 + 59)).toBe("2d 03h");
  });
});
