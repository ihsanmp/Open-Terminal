// Fixes from comparing the built-ins with TradingView's own Pine source (pine-facade, STD;… and
// the TradingView/ta library): each check restates TradingView's formula and compares.
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tradingview-daily.json";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Bars, type Params } from "../index";
import * as ta from "../core";

type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
const r = (fixture.symbols as Record<string, Row>).AAPL;
const AAPL = candlesToBars(r.time.map((time, i) => ({ time, open: r.open[i], high: r.high[i], low: r.low[i], close: r.close[i], volume: r.volume[i] })));

function run(id: string, bars: Bars, params: Params = {}) {
  const def = INDICATOR_BY_ID.get(id)!;
  return def.compute(bars, { ...defaultParams(def), ...params });
}

/** The library's ewma: alpha × x + (1 − alpha) × nz(previous, x). */
function ewma(x: number[], a: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const prev = i > 0 ? out[i - 1] : NaN;
    out.push(a * x[i] + (1 - a) * (Number.isNaN(prev) ? x[i] : prev));
  }
  return out;
}

describe("built-ins as TradingView computes them", () => {
  it("PMO starts its smoothing from the first value, and its signal is ema2", () => {
    const res = run("pmo", AAPL);
    const roc = ta.roc(AAPL.close, 1);
    const pmo = ewma(ewma(roc, 2 / 35).map((v) => 10 * v), 2 / 20);
    const signal = ewma(pmo, 2 / 11);
    for (const i of [5, 40, 400, AAPL.length - 1]) {
      expect(res.plots.pmo[i]).toBeCloseTo(pmo[i], 10);
      expect(res.plots.signal[i]).toBeCloseTo(signal[i], 10);
    }
  });

  it("Chandelier Exit is the highest high less 3 ATR and the lowest low plus it, both drawn", () => {
    const res = run("chandelier", AAPL);
    const atr = ta.atr(AAPL, 22);
    const hh = ta.highest(AAPL.high, 22);
    const ll = ta.lowest(AAPL.low, 22);
    for (const i of [30, 700, AAPL.length - 1]) {
      expect(res.plots.long[i]).toBeCloseTo(hh[i] - 3 * atr[i], 8);
      expect(res.plots.short[i]).toBeCloseTo(ll[i] + 3 * atr[i], 8);
    }
    // The trailing community version is still there, under its own name.
    expect(INDICATOR_BY_ID.get("chandelier-everget")?.category).toBe("Community");
  });

  it("KAMA's efficiency ratio length defaults to 10", () => {
    expect(defaultParams(INDICATOR_BY_ID.get("kama")!).length).toBe(10);
  });

  it("Pivot Points High Low labels prices at the symbol's precision", () => {
    const tiny = candlesToBars(r.time.map((time, i) => ({ time, open: r.open[i] * 1e-7, high: r.high[i] * 1e-7, low: r.low[i] * 1e-7, close: r.close[i] * 1e-7, volume: r.volume[i] })));
    const texts = (run("pivotshl", tiny).markers ?? []).map((m) => m.text ?? "");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => Number(t) > 0)).toBe(true);
  });

  it("Gaps need 30% of the 14-bar average range by default and close fully", () => {
    const def = INDICATOR_BY_ID.get("gaps")!;
    expect(defaultParams(def)).toMatchObject({ partial: false, minSize: 30 });
    const day = 86_400;
    // Ranges of 10; a gap up of 1 (10% of the range) and one of 5 (50%).
    const rows = Array.from({ length: 30 }, (_, i) => ({ time: i * day, open: 100, high: 105, low: 95, close: 100, volume: 1 }));
    rows[20] = { time: 20 * day, open: 107, high: 116, low: 106, close: 110, volume: 1 };
    rows[21] = { time: 21 * day, open: 125, high: 130, low: 121, close: 125, volume: 1 };
    for (let i = 22; i < 30; i++) rows[i] = { time: i * day, open: 125, high: 130, low: 121, close: 125, volume: 1 };
    const boxes = run("gaps", candlesToBars(rows)).boxes ?? [];
    expect(boxes.map((b) => [b.bottom, b.top])).toEqual([[116, 121]]);
  });

  it("Connors RSI's up/down streak starts at -1, BBTrend is strong on a tie, Chop Zone has a column on every bar", () => {
    const crsi = run("crsi", AAPL).plots.crsi;
    expect(Number.isFinite(crsi[AAPL.length - 1])).toBe(true);
    const bb = run("bbtrend", AAPL);
    const t = bb.plots.trend;
    for (let i = 60; i < t.length; i++) {
      const expected = t[i] > 0 && t[i] >= t[i - 1] ? "rgba(8,153,129,0.75)" : t[i] > 0 ? "rgba(8,153,129,0.5)" : t[i] < 0 && t[i] > t[i - 1] ? "rgba(242,54,69,0.5)" : t[i] < 0 ? "rgba(242,54,69,0.75)" : "rgba(8,153,129,0.5)";
      expect(bb.colors!.trend[i]?.replace(/\s/g, "")).toBe(expected);
    }
    expect(run("chopzone", AAPL).plots.zone.every((v) => v === 1)).toBe(true);
  });

  it("RCI and RVI draw TradingView's SMA 14 of themselves", () => {
    const rci = run("rci", AAPL);
    expect(rci.plots.ma[500]).toBeCloseTo(ta.sma(rci.plots.rci, 14)[500], 10);
    const rvi = run("rvi", AAPL);
    expect(rvi.plots.ma[500]).toBeCloseTo(ta.sma(rvi.plots.rvi, 14)[500], 10);
  });
});
