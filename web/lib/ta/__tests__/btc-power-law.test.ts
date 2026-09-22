import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Params } from "../index";

// The published script counts days from 2009-01-01 (first BLX bar + 564 days).
const EPOCH = Date.UTC(2009, 0, 1) / 1000;
const A = -16.98212206;
const B = 5.83430649;
const def = INDICATOR_BY_ID.get("btcpowerlaw")!;

const midlineAt = (time: number, a = A, b = B) => Math.pow(10, a + b * Math.log10(Math.max(1, Math.floor((time - EPOCH) / 86_400))));

/** Daily bars whose close is the power-law midline times `factor(i)`. */
function series(count: number, factor: (i: number) => number, startIso = "2012-01-01", coef: [number, number] = [A, B]) {
  const start = Date.parse(startIso) / 1000;
  const candles = Array.from({ length: count }, (_, i) => {
    const time = start + i * 86_400;
    const close = midlineAt(time, coef[0], coef[1]) * factor(i);
    return { time, open: close, high: close, low: close, close, volume: 0 };
  });
  return candlesToBars(candles);
}

const run = (bars: ReturnType<typeof candlesToBars>, params: Params = {}) =>
  def.compute(bars, { ...defaultParams(def), ...params });

describe("Bitcoin Power Law Oscillator", () => {
  it("reports zero distance when price sits on the midline", () => {
    const out = run(series(400, () => 1));
    for (const d of out.plots.distance.slice(-10)) expect(d).toBe(0);
  });

  it("is positive above the midline and negative below it", () => {
    // distance = round((midline / price - 1) * 100), then the sign is flipped.
    const rich = run(series(300, () => 2));
    const cheap = run(series(300, () => 0.5));
    expect(rich.plots.distance.at(-1)).toBe(-50); // midline is half of price
    expect(cheap.plots.distance.at(-1)).toBe(100);
    // Both sides normalize against their own flat history, so check the raw distance sign.
    expect(Math.sign(-rich.plots.distance.at(-1)!)).toBe(1);
    expect(Math.sign(-cheap.plots.distance.at(-1)!)).toBe(-1);
  });

  it("hits +1 at the priciest bar so far and -1 at the cheapest", () => {
    const osc = run(series(400, (i) => 1 + 0.5 * Math.sin(i / 10))).plots.osc;
    const late = osc.slice(100);
    expect(Math.max(...late)).toBeCloseTo(1, 6);
    expect(Math.min(...late)).toBeCloseTo(-1, 6);
  });

  it("stays inside -1…+1", () => {
    const osc = run(series(500, (i) => 1 + Math.sin(i / 20))).plots.osc.filter(Number.isFinite);
    expect(Math.max(...osc)).toBeLessThanOrEqual(1);
    expect(Math.min(...osc)).toBeGreaterThanOrEqual(-1);
  });

  it("ignores bars before 2011 when learning the extremes", () => {
    // A 10x spike in 2010 must not widen the range used from 2011 on.
    const bars = series(600, (i) => (i === 10 ? 10 : 1 + 0.5 * Math.sin(i / 10)), "2010-06-01");
    const osc = run(bars).plots.osc;
    const after2011 = bars.time.map((t, i) => (t >= Date.parse("2011-01-01") / 1000 ? osc[i] : NaN)).filter(Number.isFinite);
    expect(Math.max(...after2011)).toBeCloseTo(1, 6);
    expect(Math.min(...after2011)).toBeCloseTo(-1, 6);
  });

  it("fits its own coefficients when asked", () => {
    const bars = series(400, () => 1, "2012-01-01", [-14, 5.1]);
    expect(Math.abs(run(bars, { fit: false }).plots.distance.at(-1)!)).toBeGreaterThan(1);
    for (const d of run(bars, { fit: true }).plots.distance.slice(-10)) expect(Math.abs(d)).toBeLessThanOrEqual(1);
  });

  it("draws the moving average only when enabled", () => {
    const bars = series(400, (i) => 1 + 0.2 * Math.sin(i / 8));
    expect(run(bars, { plotMa: true }).plots.ma.some(Number.isFinite)).toBe(true);
    expect(run(bars, { plotMa: false }).plots.ma.some(Number.isFinite)).toBe(false);
  });
});
