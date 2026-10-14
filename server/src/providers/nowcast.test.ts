import { describe, expect, it } from "vitest";
import { biasOf, compare, gdpRow, parseClevelandCharts, type MonthNowcast } from "./nowcast.js";
import type { EconEvent } from "./econcalendar.js";

const chart = (month: string, cpi: number[], actual?: number) => ({
  chart: { subcaption: month, _comment: "2026-10-13 00:00" },
  dataset: [
    { seriesname: "CPI Inflation", data: cpi.map((v) => ({ value: String(v) })) },
    { seriesname: "Actual CPI Inflation", data: actual === undefined ? [{ value: "" }] : [{ value: "" }, { value: String(actual) }] },
  ],
});

const ev = (title: string, ref: string, date: string, forecast: string | null, actual: string | null, previous: string | null = null): EconEvent => ({
  title, country: "USD", region: "US", date, impact: "High", forecast, previous, actual, referenceDate: ref,
});

describe("nowcasts against the consensus", () => {
  it("reads the Cleveland Fed's charts: the latest nowcast and the actual print", () => {
    const [m] = parseClevelandCharts([chart("2026-9", [0.4, 0.5, 0.53], 0.6)]);
    expect(m).toEqual({ month: "2026-09", asOf: "2026-10-13", nowcast: { "CPI Inflation": 0.53 }, actual: { "CPI Inflation": 0.6 } });
  });

  it("calls the next print hotter or cooler than expected", () => {
    expect([biasOf(0.07, 0.05), biasOf(-0.069, 0.05), biasOf(0.002, 0.05), biasOf(null, 0.05)]).toEqual(["hawkish", "dovish", "neutral", null]);
  });

  it("nowcasts the oldest month not yet out, and keeps a track record of the months that are", () => {
    const month: MonthNowcast[] = [
      { month: "2026-07", asOf: null, nowcast: { "CPI Inflation": 0.3 }, actual: { "CPI Inflation": 0.35 } },
      { month: "2026-08", asOf: null, nowcast: { "CPI Inflation": 0.5 }, actual: {} },
      { month: "2026-09", asOf: null, nowcast: { "CPI Inflation": 0.53 }, actual: {} },
      { month: "2026-10", asOf: null, nowcast: { "CPI Inflation": 0.27 }, actual: {} },
    ];
    const events = [
      ev("Inflation Rate MoM", "2026-07-31", "2026-08-12T12:30:00Z", "0.2", "0.4"),
      ev("Inflation Rate MoM", "2026-08-31", "2026-09-11T12:30:00Z", "0.3", "0.4"),
      ev("Inflation Rate MoM", "2026-09-30", "2026-10-14T12:30:00Z", "0.6", null, "0.4"),
    ];
    const [cpi] = compare({ month, year: [] }, events);
    expect(cpi).toMatchObject({ key: "cpi_mom", period: "2026-09", release: "2026-10-14T12:30:00Z", nowcast: 0.53, consensus: 0.6, previous: 0.4, diff: -0.07, bias: "dovish" });
    // July and August: the nowcast missed by 0.1 each, the consensus by 0.2 and 0.1; both nowcasts
    // were above the consensus and so were both prints.
    expect(cpi.track).toMatchObject({ months: 2, sideRight: 2, sideCalls: 2 });
    expect(cpi.track!.nowcastMiss).toBeCloseTo(0.1, 6);
    expect(cpi.track!.consensusMiss).toBeCloseTo(0.15, 6);
  });

  it("puts GDPNow beside the advance estimate's consensus for its quarter", () => {
    const row = gdpRow([{ date: "2026-07-01", value: 3.5862 }], [ev("GDP Growth Rate QoQ Adv", "2026-09-30", "2026-10-29T12:30:00Z", "2.8", null)]);
    expect(row).toEqual({ quarter: "2026 Q3", gdpNow: 3.5862, consensus: 2.8, release: "2026-10-29T12:30:00Z", actual: null, diff: 0.79 });
  });
});
