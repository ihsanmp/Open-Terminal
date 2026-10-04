import { describe, expect, it } from "vitest";
import { distanceTo, shapesFor, type Anchor, type GeometryContext, type Shape } from "./geometry";
import { TOOLS, logicalOfTime, timeOfLogical, type ToolId } from "./tools";

// A 1000 × 600 pane: 10 px per bar from bar 0 at x = 0; price 100 at the bottom, 200 at the top.
const xOf = (l: number) => l * 10;
const yOf = (p: number) => 600 - (p - 100) * 6;
const at = (logical: number, price: number): Anchor => ({ x: xOf(logical), y: yOf(price), logical, price });
const ctx = (anchors: Anchor[]): GeometryContext => ({
  anchors,
  width: 1000,
  height: 600,
  xOf,
  yOf,
  formatPrice: (p) => p.toFixed(2),
  drawing: { color: "#2962FF", width: 1 },
});
const segs = (shapes: Shape[]) => shapes.filter((s): s is Extract<Shape, { t: "seg" }> => s.t === "seg");
const labels = (shapes: Shape[]) => shapes.filter((s): s is Extract<Shape, { t: "text" }> => s.t === "text").map((s) => s.text);

describe("drawing points ⇄ the chart's bars", () => {
  const times = [1000, 1060, 1120, 1240]; // a gap before the last bar
  it("maps times to bar indexes and back, past either end at the interval", () => {
    for (const t of [940, 1000, 1030, 1120, 1180, 1240, 1300, 1600]) expect(timeOfLogical(times, 60, logicalOfTime(times, 60, t))).toBeCloseTo(t, 6);
    expect(logicalOfTime(times, 60, 1180)).toBeCloseTo(2.5, 6);
    expect(logicalOfTime(times, 60, 1360)).toBeCloseTo(5, 6); // two bars into the future
    expect(logicalOfTime(times, 60, 880)).toBeCloseTo(-2, 6);
  });
});

describe("Fibonacci and Gann tools", () => {
  it("retracement: 1 at the move's start, 0 at its end, each level at its price", () => {
    const s = shapesFor("fibRetracement", ctx([at(10, 120), at(50, 170)]));
    const level = (l: number) => segs(s).find((g) => g.y1 === yOf(170 + (120 - 170) * l) && g.x1 === 100 && g.x2 === 500);
    for (const l of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]) expect(level(l), String(l)).toBeDefined();
    expect(labels(s)).toContain("0.618 (139.10)");
  });

  it("trend-based extension lays the move off from the third point", () => {
    const s = shapesFor("fibExtension", ctx([at(10, 120), at(30, 160), at(40, 140)]));
    expect(labels(s)).toContain("1 (180.00)"); // 140 + (160 − 120)
    expect(labels(s)).toContain("0.618 (164.72)");
  });

  it("time zones fall at Fibonacci multiples of the span", () => {
    const s = shapesFor("fibTimeZone", ctx([at(10, 150), at(14, 150)]));
    const xs = segs(s).map((g) => g.x1);
    for (const n of [0, 1, 2, 3, 5, 8, 13]) expect(xs).toContain(xOf(10 + 4 * n));
  });

  it("trend-based fib time projects the span from the third point", () => {
    const s = shapesFor("fibTrendTime", ctx([at(10, 150), at(20, 160), at(30, 150)]));
    expect(segs(s).map((g) => g.x1)).toContain(xOf(30 + 10 * 1.618));
  });

  it("Gann fan's 1/1 line runs through the second point", () => {
    const A = at(10, 120);
    const B = at(30, 140);
    const s = shapesFor("gannFan", ctx([A, B]));
    const one = segs(s).find((g) => g.color === "#2962FF")!;
    expect(distanceTo(one, B.x, B.y)).toBeLessThan(0.5);
    expect(labels(s)).toEqual(expect.arrayContaining(["1/8", "1/1", "8/1"]));
  });

  it("a parallel channel's second line keeps the third point's offset", () => {
    const s = shapesFor("channel", ctx([at(10, 120), at(30, 140), at(20, 150)]));
    // At bar 20 the trend line is at 130, so the parallel is 20 above it all along.
    expect(segs(s).some((g) => g.y1 === yOf(140) && g.y2 === yOf(160))).toBe(true);
  });

  it("Gann square fixed keeps the price per bar it was drawn with", () => {
    const s = shapesFor("gannSquareFixed", { ...ctx([at(10, 120), at(30, 190)]), drawing: { color: "#FF9800", width: 1, ratio: 1 } });
    const box = s.find((g) => g.t === "poly") as Extract<Shape, { t: "poly" }>;
    const ys = box.pts.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(yOf(120) - yOf(140), 6); // 20 bars × 1 per bar
  });

  it("every tool draws from its points, and from fewer while being placed", () => {
    const pts = [at(10, 120), at(30, 160), at(45, 140)];
    for (const t of TOOLS) {
      const full = shapesFor(t.id as ToolId, ctx(pts.slice(0, t.points)));
      expect(full.length, t.id).toBeGreaterThan(0);
      for (const shape of full) expect(Number.isNaN(distanceTo(shape, 200, 300)), t.id).toBe(false);
      expect(() => shapesFor(t.id as ToolId, ctx(pts.slice(0, 1)))).not.toThrow();
    }
  });
});

describe("picking a drawing", () => {
  it("measures the distance to lines, ellipses and filled boxes", () => {
    expect(distanceTo({ t: "seg", x1: 0, y1: 0, x2: 100, y2: 0, color: "" }, 50, 4)).toBeCloseTo(4);
    expect(distanceTo({ t: "ellipse", cx: 0, cy: 0, rx: 50, ry: 50, color: "" }, 53, 0)).toBeCloseTo(3);
    // Only the half drawn counts.
    expect(distanceTo({ t: "ellipse", cx: 0, cy: 0, rx: 50, ry: 50, start: Math.PI, end: 2 * Math.PI, color: "" }, 0, 50)).toBe(Infinity);
    expect(distanceTo({ t: "poly", pts: [[0, 0], [10, 0], [10, 10], [0, 10]], fill: "x", closed: true }, 5, 5)).toBe(0);
  });
});

describe("each tool's settings", () => {
  const style = (options: object) => ({ color: "#2962FF", width: 1 as const, options });
  const withOpts = (tool: ToolId, anchors: Anchor[], options: object) => shapesFor(tool, { ...ctx(anchors), drawing: style(options) });

  it("fib levels: hidden ones go, values and colors are the user's, more can be added", async () => {
    const { defaultLevels } = await import("./geometry");
    const levels = defaultLevels("fibRetracement")!.map((l) => (l.value === 0.236 ? { ...l, visible: false } : l));
    levels.push({ value: 0.65, color: "#123456", visible: true });
    const s = withOpts("fibRetracement", [at(10, 120), at(50, 170)], { levels });
    expect(labels(s).some((t) => t.startsWith("0.236"))).toBe(false);
    expect(labels(s)).toContain("0.65 (137.50)");
    expect(segs(s).some((g) => g.color === "#123456" && g.y1 === yOf(137.5))).toBe(true);
  });

  it("reverse, extend, labels and background", () => {
    const pts = [at(10, 120), at(50, 170)];
    // Reversed: 0 at the start (120), 1 at the end.
    expect(labels(withOpts("fibRetracement", pts, { reverse: true }))).toContain("1 (170.00)");
    expect(labels(withOpts("fibRetracement", pts, { reverse: true }))).toContain("0 (120.00)");
    // Extended right: the level lines run on past the pane.
    expect(segs(withOpts("fibRetracement", pts, { extendRight: true })).some((g) => g.x2 > 5000)).toBe(true);
    // Levels without prices, or no labels at all.
    expect(labels(withOpts("fibRetracement", pts, { showPrices: false }))).toContain("0.618");
    expect(labels(withOpts("fibRetracement", pts, { showPrices: false, showLevels: false }))).toEqual([]);
    // No background: no filled bands.
    expect(withOpts("fibRetracement", pts, { fill: false }).some((g) => g.t === "poly" && g.fill)).toBe(false);
  });

  it("trend line extends; a channel loses its middle line; Gann angles follow their values", () => {
    const t = segs(withOpts("trend", [at(10, 120), at(20, 130)], { extendLeft: true, extendRight: true }))[0];
    expect(t.x1).toBeLessThan(-1000);
    expect(t.x2).toBeGreaterThan(5000);
    const ch = (o: object) => segs(withOpts("channel", [at(10, 120), at(30, 140), at(20, 150)], o)).length;
    expect(ch({ middleLine: false })).toBe(ch({}) - 1);
    const fan = withOpts("gannFan", [at(10, 120), at(30, 140)], { levels: [{ value: 5, color: "#ff0000", visible: true }] });
    expect(labels(fan)).toEqual(["5/1"]);
  });

  it("text: its size and background", () => {
    const s = shapesFor("text", { ...ctx([at(10, 150)]), drawing: { color: "#fff", width: 1, text: "Hi", options: { fontSize: 24, textBackground: false } } });
    expect(s[0]).toMatchObject({ t: "text", text: "Hi", size: 24, bg: undefined });
  });
});
