import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type BtcDaily, type Params } from "../index";
import { thermocapDaily } from "../indicators/volume";
import * as ta from "../core";

const DAY = 86_400;
const def = INDICATOR_BY_ID.get("btcthermocap")!;
const defaults = { maType: "EMA", maLen: 365, lim: 1, neg: true, decay: 0.99998 };

function daily(count: number, price: (i: number) => number, blocks: (i: number) => number = () => 144, startIso = "2010-08-18"): BtcDaily {
  const start = Date.parse(startIso) / 1000;
  return {
    time: Array.from({ length: count }, (_, i) => start + i * DAY),
    price: Array.from({ length: count }, (_, i) => price(i)),
    blocks: Array.from({ length: count }, (_, i) => blocks(i)),
  };
}

function barsAt(times: number[]) {
  return candlesToBars(times.map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 })));
}

const run = (bars: ReturnType<typeof barsAt>, btcDaily: BtcDaily | undefined, params: Params = {}) =>
  def.compute(bars, { ...defaultParams(def), ...params }, { btcDaily });

describe("Bitcoin Thermocap", () => {
  it("divides price by the running total of blocks × price", () => {
    const d = daily(10, () => 50, () => 100);
    const { thermocap, log } = thermocapDaily(d, defaults);
    // Constant price and blocks: day i has paid 100 × 50 × (i + 1) in total.
    thermocap.forEach((v, i) => expect(v).toBeCloseTo((50 / (5_000 * (i + 1))) * 1e6, 9));
    log.forEach((v, i) => expect(v).toBeCloseTo(Math.log(thermocap[i]), 12));
  });

  it("is na until the first priced day", () => {
    const { thermocap } = thermocapDaily(daily(5, (i) => (i < 2 ? 0 : 10)), defaults);
    expect(thermocap.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(thermocap[2]).toBeCloseTo(1e6 / 144, 9);
  });

  it("divides the log by its SMA or EMA", () => {
    const d = daily(60, (i) => 10 + Math.sin(i / 3) * 4 + i);
    for (const maType of ["SMA", "EMA"]) {
      const { log, maOsc } = thermocapDaily(d, { ...defaults, maType, maLen: 20 });
      const ma = maType === "SMA" ? ta.sma(log, 20) : ta.ema(log, 20);
      expect(maOsc[10]).toBeNaN();
      for (let i = 19; i < 60; i++) expect(maOsc[i]).toBeCloseTo(log[i] / ma[i], 12);
    }
  });

  it("normalizes only from 2012 on, between -limit and +limit", () => {
    const d = daily(900, (i) => 5 + 3 * Math.sin(i / 15) + i / 50, () => 144, "2011-06-01");
    const p = { ...defaults, maLen: 30, decay: 1 };
    const { normalized } = thermocapDaily(d, p);
    const from2012 = d.time.findIndex((t) => t >= Date.UTC(2012, 0, 1) / 1000);
    expect(normalized.slice(0, from2012).every(Number.isNaN)).toBe(true);
    const later = normalized.slice(from2012 + 1);
    expect(Math.max(...later)).toBeCloseTo(1, 9);
    expect(Math.min(...later)).toBeCloseTo(-1, 9);

    const positive = thermocapDaily(d, { ...p, neg: false, lim: 2 }).normalized.slice(from2012 + 1);
    expect(Math.max(...positive)).toBeCloseTo(2, 9);
    expect(Math.min(...positive)).toBeCloseTo(0, 9);
  });

  it("decays the extremes every bar", () => {
    const d = daily(40, (i) => 10 + i, () => 144, "2011-12-25");
    const decay = 0.9;
    const { maOsc, normalized } = thermocapDaily(d, { ...defaults, maType: "SMA", maLen: 3, decay });
    // Replay the script by hand.
    let min = NaN;
    let max = NaN;
    d.time.forEach((t, i) => {
      const x = maOsc[i];
      if (t >= Date.UTC(2012, 0, 1) / 1000) {
        if (x > max || Number.isNaN(max)) max = x;
        if (min > x || Number.isNaN(min)) min = x;
        max *= decay;
        min *= decay;
      }
      const want = max - min !== 0 ? (2 * (x - min)) / (max - min) - 1 : NaN;
      if (Number.isNaN(want)) expect(normalized[i]).toBeNaN();
      else expect(normalized[i]).toBeCloseTo(want, 12);
    });
  });

  it("samples the daily values onto the chart's bars", () => {
    const d = daily(40, (i) => 100 + i * 3, () => 144, "2024-01-01");
    const raw = thermocapDaily(d, defaults).thermocap;
    const day = (i: number) => d.time[i];

    // Daily bars (and a bar before the data starts).
    const dailyOut = run(barsAt([day(0) - DAY, day(0), day(1), day(2), day(3)]), d, { mode: "RAW" }).plots.value;
    expect(dailyOut[0]).toBeNaN();
    for (let k = 0; k < 4; k++) expect(dailyOut[k + 1]).toBeCloseTo(raw[k], 12);

    // Intraday bars read their own day.
    const hourly = Array.from({ length: 30 }, (_, k) => day(5) + k * 3600);
    const hourlyOut = run(barsAt(hourly), d, { mode: "RAW" }).plots.value;
    expect(hourlyOut[0]).toBeCloseTo(raw[5], 12);
    expect(hourlyOut[29]).toBeCloseTo(raw[6], 12);

    // Weekly bars read the last day inside the bar; the live bar reads the latest day.
    const weekly = [day(0), day(7), day(14)];
    const weeklyOut = run(barsAt(weekly), d, { mode: "RAW" }).plots.value;
    expect(weeklyOut[0]).toBeCloseTo(raw[6], 12);
    expect(weeklyOut[1]).toBeCloseTo(raw[13], 12);
    expect(weeklyOut[2]).toBeCloseTo(raw[39], 12);
  });

  it("plots nothing until the on-chain data arrives", () => {
    const out = run(barsAt([Date.UTC(2024, 0, 1) / 1000]), undefined);
    expect(out.plots.value.every(Number.isNaN)).toBe(true);
  });

  it("colors each mode like the script", () => {
    const d = daily(900, (i) => 5 + 3 * Math.sin(i / 15) + i / 50, () => 144, "2011-06-01");
    const bars = barsAt(d.time.slice(-5));
    expect(run(bars, d, { mode: "RAW" }).colors?.value[0]).toBe("#2196F3");
    expect(run(bars, d, { mode: "LOG" }).colors?.value[0]).toBe("#F23645");
    expect(run(bars, d, { mode: "MA Oscillator" }).colors?.value[0]).toBe("#4CAF50");
    expect(run(bars, d, { mode: "Normalized MA Oscillator", gradient: false }).colors?.value[0]).toBe("#FF9800");
    expect(run(bars, d, { mode: "Normalized MA Oscillator" }).colors?.value[0]).toMatch(/^rgb\(/);
  });
});
