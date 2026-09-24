import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Params } from "../index";
import { arbitrageTable, backtest, tvResolution } from "../indicators/luxalgo";
import { formatMintick, formatPattern, formatVolume, fromGradient, inferMintick, timeParts, weekOfYear } from "../pine";
import * as ta from "../core";

const DAY = 86_400;
const START = Date.UTC(2026, 0, 5) / 1000; // a Monday

type C = [open: number, high: number, low: number, close: number];

function barsOf(rows: C[], step = DAY) {
  return candlesToBars(rows.map(([open, high, low, close], i) => ({ time: START + i * step, open, high, low, close, volume: 1 })));
}

const usb = INDICATOR_BY_ID.get("luxalgo-usb")!;

/** External trigger mode with long/short signals at the given bars, distances in points. */
function run(rows: C[], longAt: number[], shortAt: number[] = [], params: Params = {}) {
  const bars = barsOf(rows);
  const mark = (at: number[]) => bars.time.map((_, i) => (at.includes(i) ? 1 : NaN));
  const p = {
    ...defaultParams(usb),
    sourceMode: "External Signals (Triggers)",
    extLongSignal: "plot:sig:long",
    extShortSignal: "plot:sig:short",
    distType: "Points/Fiat",
    tickSize: 1,
    ...params,
  };
  return backtest(bars, p, { plots: { "plot:sig:long": mark(longAt), "plot:sig:short": mark(shortAt) } });
}

const flat = (px: number): C => [px, px, px, px];

describe("Universal Signal Backtester — trade simulation", () => {
  it("scales out a third at each take-profit", () => {
    const { stats, result } = run([flat(100), flat(100), [100, 102.5, 99.6, 102], [102, 103.2, 101, 103]], [1]);
    // TP1 (+1) and TP2 (+2) on bar 2, TP3 (+3) on bar 3, a third of the position each.
    expect(stats.totalTrades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.tpHits).toEqual([1, 1, 1]);
    expect(stats.currentEq).toBeCloseTo(2, 9);
    const texts = result.labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(["TP 1 ✓", "TP 2 ✓", "TP 3 ✓", "SL 1", "SL 2", "SL 3"]));
    expect(result.markers).toEqual([{ index: 3, position: "aboveBar", shape: "xcross", color: "#089981" }]);
  });

  it("checks stops before targets and exits everything at the first stop", () => {
    const { stats, result } = run([flat(100), flat(100), [100, 103.5, 98, 99]], [1]);
    expect(stats.tpHits).toEqual([0, 0, 0]);
    expect(stats.currentEq).toBeCloseTo(-1.5, 9);
    expect(stats.losses).toBe(1);
    // Once the trade is closed, targets on the same bar are still ticked off on the chart.
    const texts = result.labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(["SL 1 ✗", "TP 1 ✓", "TP 3 ✓"]));
    expect(texts).not.toContain("SL 2 ✗");
  });

  it("reverses on the opposite signal at the close", () => {
    const { stats, result } = run([flat(100), flat(100), flat(100.5), flat(100.2)], [1], [2]);
    // Long 100 → closed at 100.5 by the short signal, which then opens a short at 100.5.
    expect(stats.totalTrades).toBe(1);
    expect(stats.currentEq).toBeCloseTo(0.5, 9);
    const entries = result.labels.filter((l) => l.style === "center").map((l) => l.index);
    expect(entries).toEqual([1, 2]);
  });

  it("respects the trade direction", () => {
    const { result } = run([flat(100), flat(100), flat(100.5)], [1], [2], { tradeDirection: "Short Only" });
    expect(result.labels.filter((l) => l.style === "center").map((l) => l.index)).toEqual([2]);
  });

  it("charges spread and commission per exit, in ticks", () => {
    const rows: C[] = [flat(100), flat(100), [100, 103.2, 99.6, 103]];
    const free = run(rows, [1]).stats.currentEq;
    const spread = run(rows, [1], [], { useCosts: true, costProfile: "Manual", manualSpread: 1, manualComm: 0 }).stats.currentEq;
    expect(free - spread).toBeCloseTo(1, 9); // one tick per round trip
    const comm = run(rows, [1], [], { useCosts: true, costProfile: "Manual", manualSpread: 0, manualComm: 1 }).stats.currentEq;
    expect(free - comm).toBeCloseTo(1, 9); // 1% of the 100 entry, in 1-point ticks
  });

  it("labels each entry with the best take-profit so far", () => {
    const rows: C[] = [flat(100), flat(100), [100, 101.2, 99.6, 101], flat(101), flat(101)];
    const { result } = run(rows, [1, 4], [3]);
    const entryTexts = result.labels.filter((l) => l.style === "center").map((l) => l.text);
    // Long (TP1 hit) reversed into a short on bar 3, which bar 4 reverses again: the third
    // entry has seen two closed trades, one of which reached TP1.
    expect(entryTexts).toEqual(["TP1 0%", "TP1 100%", "TP1 50%"]);
  });

  it("reads trigger logics like the script", () => {
    const bars = barsOf([flat(1), flat(1), flat(1), flat(1), flat(1)]);
    const p = { ...defaultParams(usb), sourceMode: "External Signals (Triggers)", extLongSignal: "plot:s:x", extShortSignal: "close", distType: "Points/Fiat", tickSize: 1 };
    const entriesFor = (signalLogic: string, x: number[]) =>
      backtest(bars, { ...p, signalLogic, tradeDirection: "Long Only" }, { plots: { "plot:s:x": x } })
        .result.labels.filter((l) => l.style === "center")
        .map((l) => l.index);
    expect(entriesFor("Crosses Over 0", [-1, 1, 1, -1, 1])).toEqual([1]);
    expect(entriesFor("Not NA (Plotshape/Markers)", [NaN, 5, 5, NaN, 5])).toEqual([1]);
  });

  it("keeps only the newest 500 lines and labels", () => {
    const rows: C[] = Array.from({ length: 400 }, (_, i) => flat(100 + (i % 2)));
    const longs = Array.from({ length: 200 }, (_, k) => 2 * k);
    const shorts = longs.map((x) => x + 1);
    const { result } = run(rows, longs, shorts);
    expect(result.lines.length).toBe(500);
    expect(result.labels.length).toBe(500);
    expect(result.lines.at(-1)!.x1).toBe(399);
  });

  it("draws the 9-line ribbon between the predefined averages", () => {
    const bars = barsOf(Array.from({ length: 80 }, (_, i) => flat(100 + Math.sin(i / 4) * 5)));
    const out = usb.compute(bars, defaultParams(usb));
    // 9/21 in ten steps: 10.2, 11.4, 12.6 … rounded.
    expect(out.plots.r3.at(-1)).toBeCloseTo(ta.ema(bars.close, 13).at(-1)!, 12);
    expect(out.plots.r5.at(-1)).toBeCloseTo(ta.ema(bars.close, 15).at(-1)!, 12);
    expect(out.plots.slow.at(-1)).toBeCloseTo(ta.ema(bars.close, 21).at(-1)!, 12);
  });
});

describe("Universal Signal Backtester — dashboard", () => {
  const cellText = (table: NonNullable<ReturnType<typeof run>["result"]["table"]>, row: number, col: number) =>
    table.cells.find((c) => c.row === row && c.col === col)?.text;

  it("reports the headline numbers", () => {
    const { result } = run([flat(100), flat(100), [100, 103.2, 99.6, 103], flat(103), [103, 103, 101, 101]], [1, 3]);
    const t = result.table!;
    expect(cellText(t, 2, 0)).toBe("2"); // total trades
    expect(cellText(t, 2, 6)).toBe("50%"); // win rate
    expect(cellText(t, 2, 18)).toBe("0.5"); // +2 then -1.5 ticks
    expect(cellText(t, 6, 0)).toBe("1 (50%)"); // TP1 hits
    expect(t.cells.find((c) => c.row === 0)?.colSpan).toBe(24);
  });

  it("buckets PnL by the entry's weekday and week", () => {
    const { result } = run([flat(100), flat(100), [100, 103.2, 99.6, 103]], [1]);
    const t = result.table!;
    // Entry on Tue 2026-01-06 (UTC) → week 2 of 2026, Tuesday column (6 + 2·2).
    expect(cellText(t, 15, 3)).toBe("2026-W2");
    expect(cellText(t, 15, 10)).toBe("2");
    expect(cellText(t, 15, 20)).toBe("2");
  });
});

describe("Arbitrage Matrix", () => {
  const chart = { symbol: "BTC-USD", ticker: "BTCUSDT", type: "crypto" as const, timezone: "Etc/UTC", intervalSeconds: 3600 };
  const arb = INDICATOR_BY_ID.get("luxalgo-arbitrage")!;
  const onlyThree = Object.fromEntries(arb.inputs.filter((i) => i.key.startsWith("ex_")).map((i) => [i.key, ["ex_BINANCE", "ex_COINBASE", "ex_KRAKEN", "ex_BTSE"].includes(i.key)]));
  const p = { ...defaultParams(arb), ...onlyThree, averageLength: 3 };
  const now = 10 * 3600 + 60; // inside the 10:00 bar, which is still forming
  const series = (closes: number[], vols: number[]) => closes.map((close, k) => ({ time: (7 + k) * 3600, close, volume: vols[k] }));
  const data = {
    "COINBASE:BTCUSDT": series([100, 101, 102, 999], [5, 5, 5, 5]),
    "BINANCE:BTCUSDT": series([100, 100, 100.5, 999], [10, 20, 30, 40]),
    "KRAKEN:BTCUSDT": series([99, 99, 101, 999], [1, 1, 1, 1]),
    "BTSE:BTCUSDT": null,
  };
  const bars = barsOf([[100, 100.01, 99.99, 100]]);
  const text = (t: ReturnType<typeof arbitrageTable>, row: number, col: number) => t.cells.find((c) => c.row === row && c.col === col)?.text;

  it("lists exchanges in the script's order and skips ones without the ticker", () => {
    const t = arbitrageTable(bars, p, chart, data, now);
    // Script order: COINBASE, BINANCE, KRAKEN, BTSE.
    expect([1, 2, 3].map((c) => text(t, 0, c))).toEqual(["COINBASE", "BINANCE", "KRAKEN"]);
    expect(t.cells.some((c) => c.text === "BTSE")).toBe(false);
    expect(text(t, 0, 0)).toBe("BTCUSDT");
  });

  it("shows row minus column of the last confirmed close", () => {
    const t = arbitrageTable(bars, p, chart, data, now);
    // Last closed bar (09:00): COINBASE 102, BINANCE 100.5, KRAKEN 101 — the 10:00 bar is ignored.
    expect(text(t, 1, 2)).toBe("1.50"); // COINBASE − BINANCE
    expect(text(t, 2, 1)).toBe("-1.50");
    expect(text(t, 3, 2)).toBe("0.50"); // KRAKEN − BINANCE
    expect(text(t, 1, 1)).toBe("");
    const extreme = t.cells.find((c) => c.row === 1 && c.col === 2)!;
    expect(extreme.bold).toBe(true);
    expect(extreme.bg).toBe("#089981");
  });

  it("averages over the confirmed bars and formats volume", () => {
    const avgPrice = arbitrageTable(bars, { ...p, data: "Avg Price" }, chart, data, now);
    expect(text(avgPrice, 1, 2)).toBe("0.83"); // 101 − 100.1666…
    const vol = arbitrageTable(bars, { ...p, data: "Last Volume" }, chart, data, now);
    expect(text(vol, 2, 1)).toBe("25"); // BINANCE 30 − COINBASE 5
  });

  it("asks for the chart's timeframe", () => {
    expect(tvResolution(300)).toBe("5");
    expect(tvResolution(3600)).toBe("60");
    expect(tvResolution(86_400)).toBe("1D");
    expect(tvResolution(7 * 86_400)).toBe("1W");
    expect(tvResolution(30 * 86_400)).toBe("1M");
    const [path] = arb.fetches!(p, chart);
    expect(decodeURIComponent(path)).toBe("/api/tv/bars?symbols=COINBASE:BTCUSDT,BINANCE:BTCUSDT,KRAKEN:BTCUSDT,BTSE:BTCUSDT&resolution=60&count=3");
  });

  it("uses forex brokers for non-crypto charts on Auto", () => {
    const [path] = arb.fetches!(defaultParams(arb), { ...chart, ticker: "EURUSD", type: "forex" });
    expect(decodeURIComponent(path)).toContain("TICKMILL:EURUSD,FX:EURUSD,OANDA:EURUSD");
  });
});

describe("Pine runtime helpers", () => {
  it("formats number patterns like str.tostring", () => {
    expect(formatPattern(45, "#.#")).toBe("45");
    expect(formatPattern(45.25, "#.#")).toBe("45.2"); // half-even
    expect(formatPattern(45.35, "#.#")).toBe("45.4");
    expect(formatPattern(-3.456, "#.##")).toBe("-3.46");
    expect(formatMintick(1.5, 0.01)).toBe("1.50");
    expect(formatVolume(1_234_567)).toBe("1.235M");
    expect(formatVolume(-25)).toBe("-25");
  });

  it("counts weeks from the one holding January 1st, Sunday first", () => {
    expect(weekOfYear(2026, 1, 1)).toBe(1);
    expect(weekOfYear(2026, 1, 3)).toBe(1);
    expect(weekOfYear(2026, 1, 4)).toBe(2);
    expect(weekOfYear(2025, 12, 31)).toBe(1); // same week as 2026-01-01
    expect(weekOfYear(2025, 12, 27)).toBe(52);
  });

  it("reads calendar fields in the exchange time zone", () => {
    const t = Date.UTC(2026, 0, 6, 2, 30) / 1000; // Tue 02:30 UTC = Mon 21:30 New York
    expect(timeParts(t, "Etc/UTC")).toMatchObject({ hour: 2, dayofweek: 3, day: 6 });
    expect(timeParts(t, "America/New_York")).toMatchObject({ hour: 21, dayofweek: 2, day: 5 });
  });

  it("infers the tick size from prices, tolerating float32 feeds", () => {
    expect(inferMintick(barsOf([[337.0199890136719, 338.5, 336, 337.25]]))).toBeCloseTo(0.01, 12);
    expect(inferMintick(barsOf([[1.13765, 1.1378, 1.1371, 1.1377]]))).toBeCloseTo(0.00001, 12);
    expect(inferMintick(barsOf([[36000, 36100, 35900, 36050]]))).toBe(1);
  });

  it("blends colors including transparency", () => {
    expect(fromGradient(5, 0, 10, "#000000", "#ffffff")).toBe("rgba(128,128,128,1)");
    expect(fromGradient(-1, 0, 10, "rgba(0,0,0,0)", "#ffffff")).toBe("rgba(0,0,0,0)");
    expect(fromGradient(NaN, 0, 10, "#000000", "#ffffff")).toBeUndefined();
  });
});
