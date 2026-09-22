import { describe, expect, it } from "vitest";
import { barIntervalSeconds, formatCountdown, intervalLabel, isIntradayInterval, secondsToClose } from "./candle-time";

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
