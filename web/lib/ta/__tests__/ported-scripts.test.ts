import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tradingview-daily.json";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type Bars, type Params } from "../index";
import { colorNew } from "../pine";
import { chaosSeries, kmeans, smtDivergences } from "../indicators/luxalgo2";
import { gaussian, normalize, rationalQuadratic } from "../indicators/lorentzian";
import { exchangeTimestamp } from "../indicators/community2";

const DAY = 86_400;
const START = Date.UTC(2026, 0, 5) / 1000;

type C = [open: number, high: number, low: number, close: number, volume?: number];
function barsOf(rows: C[], step = DAY, start = START): Bars {
  return candlesToBars(rows.map(([open, high, low, close, volume = 1], i) => ({ time: start + i * step, open, high, low, close, volume })));
}
const flat = (px: number): C => [px, px + 0.5, px - 0.5, px];

function run(id: string, bars: Bars, params: Params = {}, chart?: object) {
  const def = INDICATOR_BY_ID.get(id)!;
  return def.compute(bars, { ...defaultParams(def), ...params }, chart ? { chart: chart as never } : undefined);
}

type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
const aapl = (fixture.symbols as Record<string, Row>).AAPL;
const AAPL = candlesToBars(aapl.time.map((time, i) => ({ time, open: aapl.open[i], high: aapl.high[i], low: aapl.low[i], close: aapl.close[i], volume: aapl.volume[i] })));

describe("Pine runtime", () => {
  it("color.new replaces a color's transparency rather than stacking it", () => {
    expect(colorNew("rgba(0,153,136,0.2)", 50)).toBe("rgba(0,153,136,0.5)");
    expect(colorNew("#089981", 70)).toBe("rgba(8,153,129,0.3)");
  });

  it("timestamp(y, m, d) is midnight in the exchange time zone", () => {
    expect(exchangeTimestamp("Etc/UTC", [2024, 4, 19])).toBe(Date.UTC(2024, 3, 19) / 1000);
    expect(exchangeTimestamp("America/New_York", [2024, 4, 19])).toBe(Date.UTC(2024, 3, 19, 4) / 1000);
  });
});

describe("Supertrend (KivancOzbulgen)", () => {
  it("tracks the same line as TradingView's built-in Supertrend with the default settings", () => {
    const ours = run("supertrend-kivanc", AAPL);
    const builtIn = run("supertrend", AAPL);
    const line = (r: typeof ours, a: string, b: string) => r.plots[a].map((v, i) => (Number.isFinite(v) ? v : r.plots[b][i]));
    const a = line(ours, "up", "dn");
    const b = line(builtIn, "up", "down");
    for (let i = AAPL.length - 100; i < AAPL.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
  });

  it("labels trend flips with Buy/Sell", () => {
    const rows: C[] = [...Array.from({ length: 30 }, () => flat(100)), ...Array.from({ length: 15 }, (_, i) => flat(100 - 3 * (i + 1))), ...Array.from({ length: 15 }, (_, i) => flat(55 + 5 * (i + 1)))];
    const texts = (run("supertrend-kivanc", barsOf(rows)).labels ?? []).map((l) => l.text).filter(Boolean);
    expect(texts).toEqual(["Sell", "Buy"]);
  });
});

describe("UT Bot Alerts", () => {
  it("buys when price crosses above the ATR trailing stop and colors bars by side", () => {
    const rows: C[] = [...Array.from({ length: 20 }, (_, i) => flat(100 - i)), ...Array.from({ length: 10 }, (_, i) => flat(81 + 4 * (i + 1)))];
    const r = run("ut-bot-alerts", barsOf(rows));
    const buys = (r.markers ?? []).filter((m) => m.text === "Buy");
    expect(buys).toHaveLength(1);
    expect(buys[0].index).toBeGreaterThanOrEqual(20);
    expect(r.barColors?.[rows.length - 1]).toBe("#4CAF50");
    expect(r.barColors?.[15]).toBe("#FF5252");
  });
});

describe("Volume Profile / Fixed Range", () => {
  it("draws up/down rows for every level and a POC inside the value area", () => {
    const r = run("volume-profile-fixed-range", AAPL);
    expect(r.boxes).toHaveLength(48);
    const poc = r.lines![0].y1;
    const hi = Math.max(...AAPL.high.slice(-150));
    const lo = Math.min(...AAPL.low.slice(-150));
    expect(poc).toBeGreaterThan(lo);
    expect(poc).toBeLessThan(hi);
    expect(r.labels![0].text).toMatch(/^POC: \d/);
  });
});

describe("Fair Value Gap [LuxAlgo]", () => {
  it("boxes a bullish gap and removes it once a close fills it", () => {
    const rows: C[] = [flat(100), [100, 106, 100, 105.8], [106, 108, 104, 107], [107, 107.5, 105, 107], flat(107), flat(107), [107, 107, 99, 99]];
    const bars = barsOf(rows);
    const before = run("luxalgo-fvg", barsOf(rows.slice(0, 6)), { showDash: true });
    expect(before.boxes).toHaveLength(1);
    expect(before.boxes![0]).toMatchObject({ x1: 0, top: 104, bottom: 100.5 });
    const after = run("luxalgo-fvg", bars, { mitigationLevels: true, showDash: true });
    expect(after.boxes).toHaveLength(0);
    expect(after.lines).toHaveLength(1);
    expect(after.table!.cells.find((c) => c.col === 1 && c.row === 2)!.text).toBe("100.00%");
  });
});

describe("Chaos Weighted RSI [LuxAlgo]", () => {
  it("reads a straight line as orderly and noise as chaotic", () => {
    const line = Array.from({ length: 40 }, (_, i) => i);
    const zigzag = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : 0));
    // Sevcik's FDI of a straight line: 1 + ln(√2) / ln(2·19), i.e. chaos ≈ 0.19.
    expect(chaosSeries(line, 20)[39]).toBeCloseTo((2 * Math.log(Math.SQRT2)) / Math.log(38), 10);
    expect(chaosSeries(zigzag, 20)[39]).toBeGreaterThan(0.9);
  });

  it("stays within 0–100", () => {
    const wrsi = run("luxalgo-chaos-rsi", AAPL).plots.wrsi.filter(Number.isFinite);
    expect(Math.min(...wrsi)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...wrsi)).toBeLessThanOrEqual(100);
  });
});

describe("Clusters Volume Profile [LuxAlgo]", () => {
  it("k-means splits two price groups", () => {
    const { assignments, centroids } = kmeans([10, 11, 10.5, 50, 51, 49], [1, 1, 1, 1, 1, 1], 2, 10);
    expect(new Set(assignments.slice(0, 3)).size).toBe(1);
    expect(assignments[0]).not.toBe(assignments[3]);
    expect(centroids.sort((a, b) => a - b)).toEqual([10.5, 50]);
  });

  it("draws one POC line per non-empty cluster", () => {
    const r = run("luxalgo-clusters-vp", AAPL);
    expect(r.lines!.length).toBeGreaterThan(0);
    expect(r.lines!.length).toBeLessThanOrEqual(5);
  });
});

describe("Order Block Detector [LuxAlgo]", () => {
  it("keeps at most the configured number of blocks per side, extended right", () => {
    const r = run("luxalgo-ob-detector", AAPL);
    expect(r.boxes!.length).toBeLessThanOrEqual(6);
    for (const b of r.boxes!) expect(b.extendRight).toBe(true);
  });
});

describe("SMT Divergences [LuxAlgo]", () => {
  it("flags a higher high on the chart that the comparison symbol doesn't confirm", () => {
    // Chart: swing highs 110 then 120. Comparison: 210 then 205.
    // The first swing only seeds the comparison (Pine: `na != x` is false), so three swings.
    const shape = (h0: number, h1: number, h2: number) =>
      [96, 97, 98, 100, 104, h0, 104, 100, 98, 100, 104, h1, 104, 100, 98, 100, 104, h2, 104, 100, 98, 97, 96].map((h) => ({ high: h, low: h - 2, close: h - 1 }));
    const chart = shape(105, 110, 120);
    const bars = barsOf(chart.map((c) => [c.close, c.high, c.low, c.close]));
    const other = shape(200, 210, 205).map((c, i) => ({ time: bars.time[i], ...c }));
    const def = INDICATOR_BY_ID.get("luxalgo-smt")!;
    const r = smtDivergences(bars, { ...defaultParams(def), useSym2: false }, other, null, "CME_MINI_DL:ES1!", "CBOT_MINI_DL:YM1!");
    expect(r.lines).toHaveLength(1);
    expect(r.labels!.map((l) => l.text)).toEqual(["ES1!"]);
  });
});

describe("Harmonic Resonance Oscillator [LuxAlgo]", () => {
  it("averages three normalized cycles into 0–100", () => {
    const osc = run("luxalgo-hro", AAPL).plots.osc.filter(Number.isFinite);
    expect(osc.length).toBeGreaterThan(100);
    expect(Math.min(...osc)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...osc)).toBeLessThanOrEqual(100);
  });
});

describe("Lorentzian Classification", () => {
  it("kernels are weighted averages that reproduce a constant", () => {
    const x = Array.from({ length: 40 }, () => 5);
    expect(rationalQuadratic(x, 8, 8, 25)[39]).toBeCloseTo(5, 10);
    expect(gaussian(x, 6, 25)[39]).toBeCloseTo(5, 10);
    expect(Number.isNaN(rationalQuadratic(x, 8, 8, 25)[20])).toBe(true);
  });

  it("normalize uses the range seen so far", () => {
    expect(normalize([5, 10, 0, 5], 0, 1)).toEqual([0, 1, 0, 0.5]);
  });

  it("labels the last bars with the model's prediction and shows trade stats", () => {
    const r = run("lorentzian-classification", AAPL);
    const labels = (r.labels ?? []).filter((l) => l.style !== "cross");
    expect(labels.length).toBe(Math.min(500, AAPL.length));
    for (const l of labels) expect(Math.abs(Number(l.text))).toBeLessThanOrEqual(8);
    // The ADX feature once went na on bar 0 and silenced the model; it must vote and trade.
    expect(labels.some((l) => Number(l.text) !== 0)).toBe(true);
    expect((r.markers ?? []).length).toBeGreaterThan(0);
    expect(r.table!.cells[0].text).toBe("📈 Trade Stats");
    expect(r.barColors).toHaveLength(AAPL.length);
  });
});

describe("Pivot Hilo Support n Resistance Levels", () => {
  const peak: C[] = [...[100, 101, 102, 103, 104, 110, 104, 103, 102, 101, 100, 99].map((h): C => [h - 1, h, h - 2, h - 1])];

  it("marks a pivot high once the right side and the shunt bar have closed", () => {
    const r = run("pivot-hilo-levels", barsOf(peak));
    expect(r.plots.hiDot[5]).toBe(110);
    expect(r.plots.top[5]).toBe(110);
    expect(r.plots.top[peak.length - 1]).toBe(110);
  });

  it("can draw the levels as a fractal chaos channel from the confirmation bar", () => {
    const r = run("pivot-hilo-levels", barsOf(peak), { channel: true });
    expect(r.plots.topChannel[10]).toBeNaN();
    expect(r.plots.topChannel[11]).toBe(110);
  });
});

describe("Bitcoin Halving Cycle Profit", () => {
  it("marks each halving on a weekly chart with its profit and DCA zones", () => {
    const start = Date.UTC(2012, 0, 2) / 1000; // a Monday
    const weeks = 740;
    const rows: C[] = Array.from({ length: weeks }, () => flat(100));
    const bars = barsOf(rows, 7 * DAY, start);
    const r = run("btc-halving-cycle", bars, {}, { timezone: "Etc/UTC", intervalSeconds: 7 * DAY });
    const halvingLines = (r.lines ?? []).filter((l) => l.style === "dashed");
    expect(halvingLines).toHaveLength(4);
    expect((r.labels ?? []).filter((l) => l.text.includes("Halving"))).toHaveLength(4);
    expect(r.bgColors!.some(Boolean)).toBe(true);
  });
});
