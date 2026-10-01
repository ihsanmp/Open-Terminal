import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Params } from "../index";
import {
  aspectsCompute,
  astroEvents,
  bradleyCompute,
  bradleyPotential,
  declinationCompute,
  fourierCompute,
  gannSquare9Compute,
  gannTimeCompute,
  moonPhasesCompute,
  retrogradeCompute,
} from "../indicators/astro-time";

const DAY = 86_400;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const daily = (from: string, count: number, close: (i: number) => number = () => 100) =>
  candlesToBars(
    Array.from({ length: count }, (_, i) => {
      const c = close(i);
      return { time: day(from) + i * DAY, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
    })
  );
const params = (id: string, over: Params = {}): Params => ({ ...defaultParams(INDICATOR_BY_ID.get(id)!), ...over });
const dateOf = (bars: ReturnType<typeof daily>, i: number) => new Date((bars.time[0] + i * DAY) * 1000).toISOString().slice(0, 10);

describe("astro events land on the right days", () => {
  const bars = daily("2024-01-01", 500);

  it("Planetary Aspects: the Sun–Mars opposition of 16 Jan 2025, ahead of a chart ending in 2025", () => {
    const r = aspectsCompute(bars, params("astro-aspects", { projectDays: 400 }));
    const opp = r.labels!.filter((l) => l.text.startsWith("☉☍♂"));
    expect(opp.map((l) => dateOf(bars, l.index))).toContain("2025-01-16");
    // Inside the 2° orb that day's bar would be shaded; this chart ends on 14 May 2025.
    expect(r.bgColors!.length).toBe(bars.length);
  });

  it("Moon Phases: the full moon of 25 Jan 2024 and the new moon of 8 Apr 2024", () => {
    const r = moonPhasesCompute(bars, params("moon-phases"));
    const at = (prefix: string) => r.labels!.filter((l) => l.text.startsWith(prefix)).map((l) => dateOf(bars, l.index));
    expect(at("🌕")).toContain("2024-01-25");
    expect(at("🌑")).toContain("2024-04-08");
  });

  it("Planetary Retrograde: Mercury retrograde from 1 to 25 Apr 2024", () => {
    const r = retrogradeCompute(bars, params("astro-retrograde"));
    const stations = r.labels!.map((l) => [l.text.slice(0, 4), dateOf(bars, l.index)]);
    expect(stations).toContainEqual(["☿ Rx", "2024-04-01"]);
    expect(stations).toContainEqual(["☿ D", "2024-04-25"]);
    const i = (iso: string) => (day(iso) - bars.time[0]) / DAY;
    expect(r.bgColors![i("2024-04-10")]).toBeDefined();
    expect(r.bgColors![i("2024-03-20")]).toBeUndefined();
  });

  it("Declination: the Sun reaches the 23.44° bound at the June solstice", () => {
    const r = declinationCompute(bars, params("astro-declination", { Sun: true }));
    const solstice = (day("2024-06-20") - bars.time[0]) / DAY;
    expect(r.plots.Sun[solstice]).toBeGreaterThan(23.3);
    expect(r.hlines![0].price).toBeCloseTo(23.44, 1);
  });

  it("Astro Time Window counts Mercury's station as two events, and only exact aspects", () => {
    const p = params("astro-time-window", { moon: false, oob: false });
    const quiet = params("astro-time-window", { moon: false, oob: false, stations: false });
    const days = ["2024-03-31", "2024-04-01", "2024-04-02"].map(day);
    const sum = (q: Params) => days.reduce((a, d) => a + astroEvents(d, q), 0);
    expect(sum(p) - sum(quiet)).toBe(2);
    // Over a year, exact aspects among the Sun … Pluto come to well under one a day on average.
    const year = Array.from({ length: 365 }, (_, k) => astroEvents(day("2025-01-01") + k * DAY, quiet)).reduce((a, v) => a + v, 0);
    expect(year).toBeGreaterThan(100);
    expect(year).toBeLessThan(365);
  });
});

describe("Bradley Siderograph", () => {
  it("is the running total of the daily potential, projected ahead", () => {
    const bars = daily("2025-01-01", 120);
    const r = bradleyCompute(bars, params("bradley-siderograph", { projectDays: 60, mode: "Running total (classic)" }));
    const s = r.plots.sidero;
    expect(s[10] - s[9]).toBeCloseTo(bradleyPotential(bars.time[10] + DAY / 2), 6);
    expect(r.offsets!.siderop).toBe(60);
    expect(r.plots.siderop.findIndex(Number.isFinite)).toBe(bars.length - 1 - 60);
    for (const l of r.labels!) expect(l.index).toBeGreaterThan(bars.length - 1);
  });
});

describe("Gann", () => {
  it("Square of 9 levels from a 100 low are (10 ± ½)² a 90° step apart; big prices are scaled", () => {
    const bars = daily("2025-01-01", 50, (i) => (i === 20 ? 101 : 150));
    const r = gannSquare9Compute(bars, params("gann-square-of-9", { levels: 2 }));
    const prices = r.lines!.map((l) => +l.y1.toFixed(4));
    expect(prices).toEqual([81, 90.25, 100, 110.25, 121]);
    expect(r.lines![0].x1).toBe(20);
    const btc = daily("2025-01-01", 50, (i) => (i === 20 ? 57_801 : 80_000));
    const big = gannSquare9Compute(btc, params("gann-square-of-9", { levels: 1 }));
    expect(big.lines!.map((l) => Math.round(l.y1))).toEqual([55_421, 57_800, 60_229]);
  });

  it("time counts run on from the high into the future", () => {
    const bars = daily("2025-01-01", 100, (i) => (i === 40 ? 200 : 100));
    const r = gannTimeCompute(bars, params("gann-time-cycles", { years: false }));
    expect(r.lines!.map((l) => l.x1)).toEqual([30, 45, 60, 90, 120, 144, 180, 225, 270, 315, 360].map((d) => 40 + d));
  });
});

describe("Fourier Cycles (Hurst)", () => {
  it("finds the cycles a series is made of", () => {
    const bars = daily("2020-01-01", 800, (i) => 100 * Math.exp(0.0005 * i + 0.05 * Math.sin((2 * Math.PI * i) / 40) + 0.03 * Math.sin((2 * Math.PI * i) / 25)));
    const r = fourierCompute(bars, params("fourier-cycles", { lookback: 800, cycles: 2 }));
    const periods = r.table!.cells.filter((c) => c.col === 1 && c.row > 0).map((c) => Number(c.text));
    expect(periods).toEqual([40, 25]);
    const last = bars.length - 1;
    expect(r.plots.model[last]).toBeCloseTo(r.plots.detrended[last], 2);
  });
});
