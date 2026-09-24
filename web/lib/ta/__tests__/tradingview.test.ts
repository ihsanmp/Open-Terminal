import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tradingview-daily.json";
import { INDICATOR_BY_ID, defaultParams, type Bars, type Params } from "../index";

// Reference values were captured from TradingView's own scanner on the same
// daily candles, so every check here is "does it match TradingView".
type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; tradingview: Record<string, number> };

function lastValue(bars: Bars, id: string, plot: string, params: Params = {}, barsBack = 0): number {
  const def = INDICATOR_BY_ID.get(id)!;
  const series = def.compute(bars, { ...defaultParams(def), ...params }).plots[plot];
  return series[series.length - 1 - barsBack];
}

const pivot = (type: string, level: string) => (b: Bars) => lastValue(b, "pivots", level, { type, timeframe: "Monthly" });

const CHECKS: Array<[column: string, ours: (b: Bars) => number]> = [
  ["RSI", (b) => lastValue(b, "rsi", "rsi")],
  // The scanner's Stochastic uses %K smoothing 3 (the chart default is 1).
  ["Stoch.K", (b) => lastValue(b, "stoch", "k", { smoothK: 3 })],
  ["Stoch.D", (b) => lastValue(b, "stoch", "d", { smoothK: 3 })],
  ["Stoch.RSI.K", (b) => lastValue(b, "stochrsi", "k")],
  ["Stoch.RSI.D", (b) => lastValue(b, "stochrsi", "d")],
  ["MACD.macd", (b) => lastValue(b, "macd", "line")],
  ["MACD.signal", (b) => lastValue(b, "macd", "signal")],
  ["ADX", (b) => lastValue(b, "dmi", "adx")],
  ["ADX+DI", (b) => lastValue(b, "dmi", "plus")],
  ["ADX-DI", (b) => lastValue(b, "dmi", "minus")],
  ["AO", (b) => lastValue(b, "ao", "ao")],
  ["Mom", (b) => lastValue(b, "mom", "mom")],
  ["CCI20", (b) => lastValue(b, "cci", "cci")],
  ["W.R", (b) => lastValue(b, "wpr", "r")],
  ["UO", (b) => lastValue(b, "uo", "uo")],
  ["BBPower", (b) => lastValue(b, "bbpower", "bbp")],
  ["Ichimoku.CLine", (b) => lastValue(b, "ichimoku", "conversion")],
  ["Ichimoku.BLine", (b) => lastValue(b, "ichimoku", "base")],
  // Leading spans are plotted 25 bars ahead; the scanner reports the value under the current bar.
  ["Ichimoku.Lead1", (b) => lastValue(b, "ichimoku", "leadA", {}, 25)],
  ["Ichimoku.Lead2", (b) => lastValue(b, "ichimoku", "leadB", {}, 25)],
  ["VWMA", (b) => lastValue(b, "vwma", "ma")],
  ["HullMA9", (b) => lastValue(b, "hma", "ma")],
  ["EMA20", (b) => lastValue(b, "ema", "ma", { length: 20 })],
  ["SMA20", (b) => lastValue(b, "sma", "ma", { length: 20 })],
  ["EMA50", (b) => lastValue(b, "ema", "ma", { length: 50 })],
  ["SMA50", (b) => lastValue(b, "sma", "ma", { length: 50 })],
  ["EMA200", (b) => lastValue(b, "ema", "ma", { length: 200 })],
  ["SMA200", (b) => lastValue(b, "sma", "ma", { length: 200 })],
  ["P.SAR", (b) => lastValue(b, "psar", "sar")],
  ["ATR", (b) => lastValue(b, "atr", "atr")],
  ["BB.upper", (b) => lastValue(b, "bb", "upper")],
  ["BB.lower", (b) => lastValue(b, "bb", "lower")],
  ["KltChnl.upper", (b) => lastValue(b, "kc", "upper")],
  ["KltChnl.lower", (b) => lastValue(b, "kc", "lower")],
  ["DonchCh20.Upper", (b) => lastValue(b, "dc", "upper")],
  ["DonchCh20.Lower", (b) => lastValue(b, "dc", "lower")],
  ["Aroon.Up", (b) => lastValue(b, "aroon", "up")],
  ["Aroon.Down", (b) => lastValue(b, "aroon", "down")],
  ["ChaikinMoneyFlow", (b) => lastValue(b, "cmf", "cmf")],
  ["MoneyFlow", (b) => lastValue(b, "mfi", "mfi")],
  ["ROC", (b) => lastValue(b, "roc", "roc")],
  ["ADR", (b) => lastValue(b, "adr", "adr")],
  ["VWAP", (b) => lastValue(b, "vwap", "vwap")],
  ["Pivot.M.Classic.Middle", pivot("Classic", "P")],
  ["Pivot.M.Classic.R1", pivot("Classic", "R1")],
  ["Pivot.M.Classic.S3", pivot("Classic", "S3")],
  ["Pivot.M.Fibonacci.R1", pivot("Fibonacci", "R1")],
  ["Pivot.M.Fibonacci.S2", pivot("Fibonacci", "S2")],
  ["Pivot.M.Camarilla.R1", pivot("Camarilla", "R1")],
  ["Pivot.M.Camarilla.S3", pivot("Camarilla", "S3")],
  ["Pivot.M.Woodie.R1", pivot("Woodie", "R1")],
  ["Pivot.M.Woodie.S2", pivot("Woodie", "S2")],
  ["Pivot.M.Demark.Middle", pivot("DM", "P")],
  ["Pivot.M.Demark.R1", pivot("DM", "R1")],
];

for (const [symbol, row] of Object.entries(fixture.symbols as Record<string, Row>)) {
  const bars: Bars = { ...row, length: row.close.length };

  describe(`matches TradingView on ${symbol} (daily)`, () => {
    it.each(CHECKS)("%s", (column, ours) => {
      const expected = row.tradingview[column];
      // TradingView rounds to ~1e-4 relative in the scanner; SMA/EMA200 carry float noise.
      expect(ours(bars)).toBeCloseTo(expected, Math.abs(expected) > 100 ? 2 : 3);
    });
  });
}

describe("every indicator", () => {
  const row = (fixture.symbols as Record<string, Row>).AAPL;
  const bars: Bars = { ...row, length: row.close.length };

  // Synthetic on-chain history reaching past the fixture, for indicators that read it.
  const firstDay = Date.UTC(2010, 7, 18) / 1000;
  const days = Math.ceil((bars.time[bars.length - 1] - firstDay) / 86_400) + 1;
  const btcDaily = {
    time: Array.from({ length: days }, (_, i) => firstDay + i * 86_400),
    price: Array.from({ length: days }, (_, i) => 0.1 + i * 20 + 500 * Math.sin(i / 90) ** 2),
    blocks: Array.from({ length: days }, (_, i) => 130 + (i % 30)),
  };

  // Another symbol for request.security-style inputs (Correlation Coefficient reads candles).
  const jpm = (fixture.symbols as Record<string, Row>).JPM;
  const otherCandles = jpm.time.map((time, i) => ({ time, open: jpm.open[i], high: jpm.high[i], low: jpm.low[i], close: jpm.close[i], volume: jpm.volume[i] }));
  const chart = { symbol: "AAPL", ticker: "AAPL", type: "stock" as const, timezone: "America/New_York", intervalSeconds: 86_400, range: "5Y" };
  // Relative Volume at Time only means something on intraday bars.
  const INTRADAY_ONLY = new Set(["rvat"]);

  it.each([...INDICATOR_BY_ID.values()].filter((d) => !INTRADAY_ONLY.has(d.id)).map((d) => [d.id, d] as const))("%s computes aligned, finite output", (_id, def) => {
    const params = defaultParams(def);
    const fetched: Record<string, unknown> = {};
    for (const path of def.fetches?.(params, chart) ?? []) if (path.startsWith("/api/history/")) fetched[path] = otherCandles;
    const result = def.compute(bars, params, { btcDaily, chart, fetched });
    for (const plot of def.plots) {
      const series = result.plots[plot.key];
      if (!series) continue; // optional plots (e.g. an MA set to "None")
      expect(series).toHaveLength(bars.length);
      expect(series.some((v) => Number.isFinite(v))).toBe(true);
      expect(series.some((v) => v === Infinity || v === -Infinity)).toBe(false);
    }
    for (const colors of Object.values(result.colors ?? {})) expect(colors).toHaveLength(bars.length);
    for (const m of result.markers ?? []) expect(m.index).toBeLessThan(bars.length);
  });
});
