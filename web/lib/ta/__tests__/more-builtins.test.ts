import { describe, expect, it } from "vitest";
import ratingsFixture from "./fixtures/tradingview-ratings.json";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Bars, type Params } from "../index";
import { findGaps, moonPhaseTime, relativeVolumeAtTime, technicalRatings, zigzagPivots } from "../indicators/more";
import * as ta from "../core";

type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; tradingview: Record<string, number> };

const run = (id: string, bars: Bars, params: Params = {}, ext?: Parameters<NonNullable<ReturnType<typeof INDICATOR_BY_ID.get>>["compute"]>[2]) => {
  const def = INDICATOR_BY_ID.get(id)!;
  return def.compute(bars, { ...defaultParams(def), ...params }, ext);
};

function barsFrom(rows: Array<[o: number, h: number, l: number, c: number, v?: number]>, start = Date.UTC(2026, 0, 5) / 1000, step = 86_400) {
  return candlesToBars(rows.map(([open, high, low, close, volume = 1], i) => ({ time: start + i * step, open, high, low, close, volume })));
}

const wave = (count: number, f = (i: number) => 100 + 10 * Math.sin(i / 6) + i * 0.05) =>
  barsFrom(Array.from({ length: count }, (_, i) => {
    const c = f(i);
    return [f(i - 1), Math.max(c, f(i - 1)) + 1, Math.min(c, f(i - 1)) - 1, c, 1000 + (i % 7) * 100] as [number, number, number, number, number];
  }));

describe("Technical Ratings match TradingView's scanner", () => {
  for (const [symbol, row] of Object.entries(ratingsFixture.symbols as Record<string, Row>)) {
    it(symbol, () => {
      const bars: Bars = { ...row, length: row.close.length };
      const r = technicalRatings(bars);
      expect(r.ma.at(-1)).toBeCloseTo(row.tradingview["Recommend.MA"], 9);
      expect(r.other.at(-1)).toBeCloseTo(row.tradingview["Recommend.Other"], 9);
      expect(r.all.at(-1)).toBeCloseTo(row.tradingview["Recommend.All"], 9);
    });
  }
});

describe("classic studies", () => {
  it("Accumulative Swing Index sums Wilder's swing index", () => {
    // Bar 1: C=12, Cy=10, O=11, Oy=9, H=13, L=10.5 → TR1=3 is largest: R = 3 − 0.25 + 0.25 = 3, K = 3.
    const bars = barsFrom([[9, 10.5, 8.5, 10], [11, 13, 10.5, 12]]);
    const si = ((50 * (12 - 10 + 0.5 * (12 - 11) + 0.25 * (10 - 9))) / 3) * (3 / 10000);
    expect(run("asi", bars).plots.asi[1]).toBeCloseTo(si, 12);
  });

  it("EMA Cross marks each crossing", () => {
    const bars = wave(120);
    const out = run("emacross", bars).plots;
    out.cross.forEach((v, i) => {
      if (Number.isFinite(v)) expect(Math.sign(out.short[i] - out.long[i])).not.toBe(Math.sign(out.short[i - 1] - out.long[i - 1]));
    });
    expect(out.cross.some(Number.isFinite)).toBe(true);
  });

  it("Moving Average Hamming weights the middle of the window most", () => {
    const x = Array.from({ length: 5 }, (_, i) => (i === 2 ? 1 : 0));
    const bars = barsFrom(x.map((c) => [c, c, c, c]));
    // Hamming weights for 5: 0.08, 0.54, 1, 0.54, 0.08 (sum 2.24).
    expect(run("hamming", bars, { length: 5 }).plots.ma[4]).toBeCloseTo(1 / 2.24, 12);
  });

  it("Standard Error is zero on a straight line and bands centre on the regression", () => {
    const line = barsFrom(Array.from({ length: 30 }, (_, i) => [i, i, i, i] as [number, number, number, number]));
    expect(run("stderr", line, { length: 10 }).plots.se.at(-1)).toBeCloseTo(0, 9);
    const bands = run("sebands", line, { length: 10, smoothing: 1 }).plots;
    expect(bands.middle.at(-1)).toBeCloseTo(29, 9);
    expect(bands.upper.at(-1)).toBeCloseTo(29, 9);
  });

  it("Majority Rule is the share of rising closes", () => {
    const closes = [1, 2, 1, 2, 3, 4, 3];
    const out = run("majority", barsFrom(closes.map((c) => [c, c, c, c])), { length: 4 }).plots.mr;
    expect(out.at(-1)).toBe(75); // last four changes: 1→2, 2→3, 3→4 up, 4→3 down
  });

  it("Volatility Close-to-Close annualises the stdev of log returns", () => {
    const bars = wave(40);
    const r = bars.close.map((c, i) => (i ? Math.log(c / bars.close[i - 1]) : NaN));
    expect(run("volc2c", bars).plots.v.at(-1)).toBeCloseTo(100 * ta.stdev(r, 10).at(-1)! * Math.sqrt(252), 9);
  });
});

describe("newer built-ins", () => {
  it("Gaps open on a gap and close once price fills it", () => {
    const bars = barsFrom([[10, 11, 9, 10], [13, 14, 12, 13], [13, 13.5, 11.5, 12], [12, 12.5, 10.5, 11]]);
    const [gap] = findGaps(bars, 15, true, 0);
    // Gap from the first bar's high (11) up to the second's low (12); bar 2 trades into it (low 11.5),
    // bar 3 fills it (low 10.5 ≤ 11).
    expect(gap).toMatchObject({ x1: 0, bottom: 11, top: 11.5, x2: 3 });
  });

  it("Moon Phases land on known new and full moons", () => {
    const near = (t: number, iso: string) => expect(Math.abs(t - Date.parse(iso) / 1000)).toBeLessThan(5 * 60);
    const k = (iso: string) => Math.round((Date.parse(iso) / 1000 - 947182440) / 86_400 / 29.530588853);
    near(moonPhaseTime(k("2024-10-02T18:49Z"), 0), "2024-10-02T18:49Z");
    near(moonPhaseTime(k("2024-09-03T01:55Z"), 0), "2024-09-03T01:55Z");
    near(moonPhaseTime(k("2024-09-03T01:55Z"), 0.5), "2024-09-18T02:34Z");
    near(moonPhaseTime(k("2026-01-18T19:52Z"), 0), "2026-01-18T19:52Z");
  });

  it("Moon Phases marks the bar that holds each event", () => {
    const bars = barsFrom(Array.from({ length: 40 }, () => [1, 1, 1, 1] as [number, number, number, number]), Date.UTC(2024, 8, 1) / 1000);
    const markers = run("moon", bars).markers!;
    expect(markers.map((m) => [new Date(bars.time[m.index] * 1000).toISOString().slice(0, 10), m.text])).toEqual([
      ["2024-09-03", "New moon"],
      ["2024-09-18", "Full moon"],
      ["2024-10-02", "New moon"],
    ]);
  });

  it("Auto Fib draws the levels of the last swing", () => {
    const bars = wave(200);
    const pivots = zigzagPivots(bars, 3, 10);
    const [start, end] = pivots.slice(-2);
    const out = run("autofib", bars);
    const level = (x: number) => end.price + (start.price - end.price) * x;
    const prices = out.lines!.filter((l) => l.y1 === l.y2).map((l) => l.y1);
    for (const x of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) expect(prices.some((p) => Math.abs(p - level(x)) < 1e-9)).toBe(true);
    expect(out.labels!.find((l) => Math.abs(l.price - level(0.618)) < 1e-9)?.text).toMatch(/^0\.618 \(/);
  });

  it("Trading Sessions boxes each session's range on intraday charts", () => {
    // 2026-01-06 (Tue) hourly bars in UTC; New York 09:30–16:00 = 14:30–21:00 UTC.
    const start = Date.UTC(2026, 0, 6, 0) / 1000;
    const bars = barsFrom(Array.from({ length: 24 }, (_, h) => [100 + h, 101 + h, 99 + h, 100 + h] as [number, number, number, number]), start, 3600);
    const boxes = run("sessions", bars, { tokyo: false, london: false }).boxes!;
    expect(boxes).toHaveLength(1);
    // Bars opening 15:00–20:00 UTC fall inside (14:00 opens before 09:30 New York).
    expect(boxes[0]).toMatchObject({ x1: 15, x2: 20, top: 121, bottom: 114, text: "New York" });
    expect(run("sessions", wave(50)).boxes).toEqual([]);
  });

  it("Rolling VWAP weights price by volume over the window", () => {
    const bars = barsFrom([[10, 10, 10, 10, 100], [20, 20, 20, 20, 300]]);
    const out = run("rollingvwap", bars, { fixed: true, days: 30, minBars: 1 }).plots;
    expect(out.vwap[1]).toBeCloseTo((10 * 100 + 20 * 300) / 400, 12);
  });

  it("Relative Volume at Time compares with the same time of past sessions", () => {
    // Three UTC days of 4 hourly bars; day 3 trades twice day 1's and day 2's volume.
    const rows: Array<[number, number, number, number, number]> = [];
    const times: number[] = [];
    for (let d = 0; d < 3; d++) for (let h = 0; h < 4; h++) {
      rows.push([1, 1, 1, 1, d === 2 ? 200 : 100]);
      times.push(Date.UTC(2026, 0, 5 + d, h) / 1000);
    }
    const bars = candlesToBars(rows.map(([o, h, l, c, v], i) => ({ time: times[i], open: o, high: h, low: l, close: c, volume: v })));
    const rvol = relativeVolumeAtTime(bars, 10, true, "Etc/UTC");
    expect(rvol.slice(0, 4).every(Number.isNaN)).toBe(true);
    expect(rvol.slice(4, 8)).toEqual([1, 1, 1, 1]);
    expect(rvol.slice(8)).toEqual([2, 2, 2, 2]);
  });

  it("Correlation Coefficient aligns the other symbol by time", () => {
    const bars = wave(60);
    const candles = bars.time.map((time, i) => ({ time, open: 0, high: 0, low: 0, close: bars.close[i] * 2 + 5, volume: 1 }));
    const chart = { symbol: "X", ticker: "X", type: "stock" as const, timezone: "Etc/UTC", intervalSeconds: 86_400, range: "1Y" };
    const def = INDICATOR_BY_ID.get("corrcoef")!;
    const params = { ...defaultParams(def), symbol: "SPY" };
    const [path] = def.fetches!(params, chart);
    expect(path).toBe("/api/history/SPY?range=1Y");
    const cc = def.compute(bars, params, { chart, fetched: { [path]: candles } }).plots.cc;
    expect(cc.at(-1)).toBeCloseTo(1, 9);
  });
});
