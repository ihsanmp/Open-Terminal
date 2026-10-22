import { describe, expect, it } from "vitest";
import type { Bars } from "../core";
import { barAt, chartDate, htfOpens, isoWeek, labelText, periodOpens, periodOpensIndicator, sessionOpens, shownKinds, tradeDate } from "../indicators/period-opens";
import type { ChartContext, Params } from "../types";

const defaults = (): Params => Object.fromEntries(periodOpensIndicator.inputs.map((i) => [i.key, i.default]));

/** 15-minute bars from a UTC start, opening at 100 + the bar's number. */
function bars15(startUtc: number, count: number): Bars {
  const time = Array.from({ length: count }, (_, i) => startUtc / 1000 + i * 900);
  const open = time.map((_, i) => 100 + i);
  return { time, open, high: open.map((v) => v + 1), low: open.map((v) => v - 1), close: open, volume: open.map(() => 0), length: count };
}

const chart = (intervalSeconds: number, type: ChartContext["type"] = "crypto"): ChartContext =>
  type === "forex" ? { symbol: "EURUSD=X", ticker: "EURUSD", type, timezone: "America/New_York", intervalSeconds } : { symbol: "BTC-USD", ticker: "BTCUSD", type, timezone: "Etc/UTC", intervalSeconds };

describe("period opens", () => {
  it("files a session opening the evening before under the next day", () => {
    expect(tradeDate(Date.UTC(2026, 9, 18, 21) / 1000)).toBe("2026-10-19"); // forex Sunday 17:00 New York
    expect(tradeDate(Date.UTC(2026, 9, 19, 13, 30) / 1000)).toBe("2026-10-19");
    expect(isoWeek("2026-10-19")).toBe(isoWeek("2026-10-23"));
    expect(isoWeek("2026-10-19")).not.toBe(isoWeek("2026-10-26"));
  });

  it("starts a forex day at 17:00 New York, a crypto one at midnight UTC", () => {
    const fx = chart(900, "forex");
    expect(chartDate(Date.UTC(2026, 9, 20, 20, 45) / 1000, fx)).toBe("2026-10-20");
    expect(chartDate(Date.UTC(2026, 9, 20, 21, 0) / 1000, fx)).toBe("2026-10-21"); // 17:00 New York (summer)
    expect(chartDate(Date.UTC(2026, 9, 20, 23, 59) / 1000, chart(900))).toBe("2026-10-20");
  });

  it("takes each period's first bar as its open", () => {
    const day = (d: number, open: number) => ({ time: Date.UTC(2026, 0, d, 0) / 1000, open });
    // Thu 1 Jan … Mon 5 Jan 2026, then Mon 2 Feb.
    const ev = htfOpens([day(1, 10), day(2, 11), day(5, 12), { time: Date.UTC(2026, 1, 2) / 1000, open: 13 }]);
    const of = (k: string) => ev.filter((e) => e.kind === k).map((e) => e.price);
    expect(of("daily")).toEqual([10, 11, 12, 13]);
    expect(of("weekly")).toEqual([10, 12, 13]);
    expect(of("monthly")).toEqual([10, 13]);
    expect(of("yearly")).toEqual([10]);
  });

  it("finds London at 08:00 London time and New York at 09:30 New York time, summer and winter", () => {
    // 20 Oct 2026 (summer time in both): London 07:00 UTC, New York 13:30 UTC.
    const summer = sessionOpens(bars15(Date.UTC(2026, 9, 20, 0), 96), { auto: true, londonDst: false, nyDst: false });
    expect(summer.map((e) => [e.kind, new Date(e.time * 1000).toISOString().slice(11, 16)])).toEqual([
      ["london", "07:00"],
      ["ny", "13:30"],
    ]);
    // 1 Dec 2026 (winter): London 08:00 UTC, New York 14:30 UTC.
    const winter = sessionOpens(bars15(Date.UTC(2026, 11, 1, 0), 96), { auto: true, londonDst: false, nyDst: false });
    expect(winter.map((e) => new Date(e.time * 1000).toISOString().slice(11, 16))).toEqual(["08:00", "14:30"]);
    // The original's fixed hours: 08:00 and 13:30 UTC unless its DST boxes are ticked.
    const fixed = sessionOpens(bars15(Date.UTC(2026, 9, 20, 0), 96), { auto: false, londonDst: false, nyDst: false });
    expect(fixed.map((e) => new Date(e.time * 1000).toISOString().slice(11, 16))).toEqual(["08:00", "13:30"]);
    // No session opens on a Saturday.
    expect(sessionOpens(bars15(Date.UTC(2026, 9, 24, 0), 96), { auto: true, londonDst: false, nyDst: false })).toEqual([]);
  });

  it("labels as the original does", () => {
    expect(labelText("daily", "2026-10-21", "Names")).toBe("Wednesday");
    expect(labelText("weekly", "2026-10-19", "Names")).toBe("19/10");
    expect(labelText("monthly", "2026-10-01", "Names")).toBe("October");
    expect(labelText("yearly", "2026-01-02", "Names")).toBe("2026");
    expect(labelText("daily", "2026-10-21", "MM/DD/YY")).toBe("10/21/26");
    expect(labelText("daily", "2026-10-21", "DD/MM/YY")).toBe("21/10/26");
    expect(labelText("ny", "2026-10-21", "Names")).toBe("NY Open");
  });

  it("shows only what the time frame allows", () => {
    const p = defaults();
    expect(shownKinds(900, p)).toEqual(["london", "ny", "daily", "weekly", "monthly", "yearly"]);
    expect(shownKinds(3600, p)).toEqual(["daily", "weekly", "monthly", "yearly"]);
    expect(shownKinds(86_400, p)).toEqual(["weekly", "monthly", "yearly"]);
    expect(shownKinds(30 * 86_400, p)).toEqual(["yearly"]);
  });

  it("finds a time's bar", () => {
    expect(barAt([10, 20, 30], 15)).toBe(1);
    expect(barAt([10, 20, 30], 10)).toBe(0);
    expect(barAt([10, 20, 30], 31)).toBe(-1);
  });

  it("draws the last opens of each kind to the right of the last bar, labelled", () => {
    // Two days of 15-minute bars, Tue 20 – Wed 21 Oct 2026, the opens read from the chart.
    const bars = bars15(Date.UTC(2026, 9, 20, 0), 192);
    const p = { ...defaults(), discover: true };
    const out = periodOpens(bars, p, chart(900), undefined);
    const last = bars.length - 1;
    const labelsOf = (text: string) => out.labels!.filter((l) => l.text === text);
    // Today's open (Wednesday) and yesterday's (Tuesday), each a label.
    expect(labelsOf("Wednesday")).toHaveLength(1);
    expect(labelsOf("Tuesday")).toHaveLength(1);
    expect(labelsOf("Wednesday")[0].price).toBe(100 + 96);
    // The newest daily open runs out to the offset; the week/month/year opens share Tuesday's price
    // in this sample, so their labels step right of the day's.
    expect(labelsOf("Wednesday")[0].index).toBe(last + 20);
    expect(labelsOf("NY Open")).toHaveLength(2);
    expect(labelsOf("London Open")).toHaveLength(2);
    expect(out.plots.daily[last]).toBe(196);
    expect(out.plots.ny[last]).toBe(100 + 96 + 54); // 13:30 UTC on the 21st
  });

  it("uses the daily bars' opens when it has them", () => {
    const bars = bars15(Date.UTC(2026, 9, 20, 0), 192);
    const daily = [
      { time: Date.UTC(2026, 9, 19, 0) / 1000, open: 50 },
      { time: Date.UTC(2026, 9, 20, 0) / 1000, open: 60 },
      { time: Date.UTC(2026, 9, 21, 0) / 1000, open: 70 },
    ];
    const out = periodOpens(bars, defaults(), chart(900), daily);
    expect(out.labels!.find((l) => l.text === "Wednesday")!.price).toBe(70);
    // The week began on Monday the 19th, before the chart's first bar: its line starts at bar 0.
    const week = out.lines!.find((l) => l.y1 === 50)!;
    expect(week.x1).toBe(0);
    expect(out.labels!.some((l) => l.text === "19/10")).toBe(true);
  });
});
