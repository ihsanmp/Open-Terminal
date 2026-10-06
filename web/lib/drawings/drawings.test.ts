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
    const pts = [at(10, 120), at(30, 160), at(45, 140), at(55, 170), at(65, 130), at(75, 165), at(85, 125)];
    const bars = Array.from({ length: 100 }, (_, i) => ({ open: 140 + i * 0.2, high: 145 + i * 0.2, low: 135 + i * 0.2, close: 141 + i * 0.2, volume: 1000 + i }));
    for (const t of TOOLS) {
      const n = t.variable ? Math.max(t.points, 4) : t.points;
      const placed = pts.slice(0, n);
      const full = shapesFor(t.id as ToolId, { ...ctx(placed), bars, drawing: { color: "#2962FF", width: 1, text: "Hi" } });
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

  it("rectangle: extend, middle line, background and its text, as TradingView's", () => {
    const pts = [at(10, 120), at(30, 140)];
    const box = (o: object, text?: string) => shapesFor("rect", { ...ctx(pts), drawing: { color: "#9C27B0", width: 1, text, options: o } });
    const poly = (s: Shape[]) => s.find((g) => g.t === "poly") as Extract<Shape, { t: "poly" }>;
    // Plain: no middle line, a background in its border color.
    expect(segs(box({}))).toEqual([]);
    expect(poly(box({})).fill).toBe("rgba(156,39,176,0.15)");
    // Extended both ways, with a dashed middle line in its own color across it.
    const s = box({ extendLeft: true, extendRight: true, middleLine: true, middleColor: "#00ff00", fillColor: "rgba(1,2,3,0.5)" });
    const xs = poly(s).pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(-1000);
    expect(Math.max(...xs)).toBeGreaterThan(5000);
    expect(segs(s)[0]).toMatchObject({ y1: yOf(130), color: "#00ff00", dash: [6, 4] });
    expect(poly(s).fill).toBe("rgba(1,2,3,0.5)");
    expect(poly(box({ fill: false })).fill).toBeUndefined();
    // Its text, placed in the box as aligned.
    const t = box({ textVAlign: "bottom", textHAlign: "right", textColor: "#fff", bold: true }, "Zone").find((g) => g.t === "text");
    expect(t).toMatchObject({ text: "Zone", x: xOf(30) - 6, y: yOf(120) - 4, align: "right", base: "bottom", color: "#fff", bold: true });
  });

  it("trend line: arrows, middle point, price labels, its text along it, and stats", () => {
    const pts = [at(10, 120), at(30, 140)];
    const line = (o: object, extra: Partial<GeometryContext> = {}, text?: string) =>
      shapesFor("trend", { ...ctx(pts), ...extra, drawing: { color: "#2962FF", width: 1, text, options: o } });
    const polys = (s: Shape[]) => s.filter((g) => g.t === "poly");
    expect(polys(line({ rightEnd: "arrow" }))).toHaveLength(1);
    expect(polys(line({ rightEnd: "arrow", extendRight: true }))).toHaveLength(0); // no end to point
    expect(line({ middlePoint: true }).some((g) => g.t === "ellipse" && g.cx === xOf(20))).toBe(true);
    expect(labels(line({ priceLabels: true }))).toEqual(["120.00", "140.00"]);
    // The text turns with the line (up to the right: a negative angle on screen).
    const t = line({}, {}, "Breakout").find((g) => g.t === "text") as Extract<Shape, { t: "text" }>;
    expect(t.text).toBe("Breakout");
    expect(t.angle).toBeCloseTo(Math.atan2(yOf(140) - yOf(120), xOf(30) - xOf(10)), 6);
    // Stats: only while selected unless always shown.
    const stats = { statsPriceRange: true, statsPercent: true, statsBars: true, statsDateRange: true, statsAngle: true };
    expect(labels(line(stats))).toEqual([]);
    const timeOf = (l: number) => 1_000_000 + l * 86_400;
    const shown = labels(line(stats, { selected: true, timeOf }))[0];
    expect(shown.split("\n")).toEqual(["+20.00 (+16.67%)", "20 bars, 20d", `${(Math.atan2(120, 200) * (180 / Math.PI)).toFixed(1)}°`]);
    expect(labels(line({ ...stats, alwaysShowStats: true }))).toHaveLength(1);
  });

  it("levels: one color for all, as percents, labels on the right, and backgrounds between rays and time zones", () => {
    const pts = [at(10, 120), at(50, 170)];
    const s = withOpts("fibRetracement", pts, { useOneColor: true, oneColor: "#abcdef", levelsAs: "percents", labelHAlign: "right", showPrices: false });
    expect(segs(s).filter((g) => g.y1 === g.y2).every((g) => g.color === "#abcdef")).toBe(true);
    expect(labels(s)).toContain("61.8%");
    const l618 = s.find((g) => g.t === "text" && g.text === "61.8%") as Extract<Shape, { t: "text" }>;
    expect(l618).toMatchObject({ x: xOf(50) + 4, align: "left" });
    // Gann fan: a wedge between each pair of neighbouring angles.
    const fan = withOpts("gannFan", [at(10, 120), at(30, 140)], {});
    expect(fan.filter((g) => g.t === "poly" && g.fill)).toHaveLength(8);
    expect(withOpts("gannFan", [at(10, 120), at(30, 140)], { fill: false }).some((g) => g.t === "poly")).toBe(false);
    // Time zones: no background until it's turned on.
    expect(withOpts("fibTimeZone", [at(10, 150), at(14, 150)], {}).some((g) => g.t === "poly")).toBe(false);
    expect(withOpts("fibTimeZone", [at(10, 150), at(14, 150)], { fill: true }).filter((g) => g.t === "poly").length).toBeGreaterThan(5);
    // Gann box without its diagonals; a spiral the other way round.
    const diagonals = (o: object) => segs(withOpts("gannBox", pts, o)).filter((g) => g.x1 !== g.x2 && g.y1 !== g.y2).length;
    expect(diagonals({})).toBe(2);
    expect(diagonals({ angles: false })).toBe(0);
    const spiral = (o: object) => (withOpts("fibSpiral", pts, o).find((g) => g.t === "poly") as Extract<Shape, { t: "poly" }>).pts[40];
    expect(spiral({ counterclockwise: true })).not.toEqual(spiral({}));
  });

  it("a vertical line's time, and text that turns or runs over lines is picked where it is", async () => {
    const { distanceTo: dist, fmtDuration } = await import("./geometry");
    const v = shapesFor("vline", { ...ctx([at(20, 150)]), timeOf: () => 86_400, formatTime: (t) => `T${t}`, drawing: { color: "#fff", width: 1, options: { timeLabel: true } } });
    expect(labels(v)).toEqual(["T86400"]);
    expect([fmtDuration(90_000), fmtDuration(8_100), fmtDuration(2_400), fmtDuration(86_400)]).toEqual(["1d 1h", "2h 15m", "40m", "1d"]);
    const turned: Shape = { t: "text", x: 100, y: 100, text: "abcdefghij", color: "", align: "left", base: "middle", size: 10, angle: Math.PI / 2 };
    expect(dist(turned, 100, 140)).toBe(0); // down the turned text
    expect(dist(turned, 140, 100)).toBe(Infinity);
    const twoLines: Shape = { t: "text", x: 0, y: 0, text: "a\nb", color: "", align: "left", base: "top", size: 10 };
    expect(dist(twoLines, 2, 20)).toBe(0);
  });

  it("text: its size and background", () => {
    const s = shapesFor("text", { ...ctx([at(10, 150)]), drawing: { color: "#fff", width: 1, text: "Hi", options: { fontSize: 24, textBackground: false } } });
    expect(s[0]).toMatchObject({ t: "text", text: "Hi", size: 24, bg: undefined });
  });
});

describe("TradingView's other tools", () => {
  const draw = (tool: ToolId, anchors: Anchor[], extra: Partial<GeometryContext> = {}, options: object = {}) =>
    shapesFor(tool, { ...ctx(anchors), ...extra, drawing: { color: "#2962FF", width: 1, options } });

  it("a long position: the target's and stop's zones, and the risk/reward", () => {
    const [stop] = TOOLS.find((t) => t.id === "longPosition")!.derive!([{ time: 1, price: 100 }, { time: 2, price: 110 }]).slice(2);
    expect(stop.price).toBe(90); // 1:1 until it's moved
    const s = draw("longPosition", [at(10, 150), at(30, 170), at(10, 140)]);
    expect(labels(s)).toEqual(expect.arrayContaining(["Target: 170.00 (+13.33%)", "Stop: 140.00 (-6.67%)", "Risk/Reward Ratio: 2.00"]));
    expect(s.filter((g) => g.t === "poly" && g.fill)).toHaveLength(2);
  });

  it("XABCD: each leg's ratio and the points' names", () => {
    const s = draw("xabcd", [at(0, 100), at(10, 150), at(20, 120), at(30, 140), at(40, 110)]);
    expect(labels(s)).toEqual(expect.arrayContaining(["X", "A", "B", "C", "D", "0.600", "0.667"]));
  });

  it("Elliott waves are numbered, head and shoulders named", () => {
    expect(labels(draw("elliottImpulse", [at(0, 100), at(5, 120), at(10, 110), at(15, 140), at(20, 130), at(25, 150)]))).toEqual(["(1)", "(2)", "(3)", "(4)", "(5)"]);
    const hs = draw("headShoulders", [at(0, 100), at(5, 130), at(10, 115), at(15, 150), at(20, 115), at(25, 130), at(30, 100)]);
    expect(labels(hs)).toEqual(["Left Shoulder", "Head", "Right Shoulder"]);
  });

  it("regression, anchored VWAP and volume profile read the bars", () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({ open: 120 + i, high: 122 + i, low: 118 + i, close: 121 + i, volume: 100 }));
    // A straight rise: the regression line lies on the closes, with no spread for the bands.
    const reg = segs(draw("regression", [at(10, 0), at(40, 0)], { bars }, { fill: false }));
    expect(reg[2].y1).toBeCloseTo(yOf(131), 6);
    expect(reg[2].y2).toBeCloseTo(yOf(161), 6);
    expect(reg[0].y1).toBeCloseTo(reg[2].y1, 6);
    const vwap = draw("anchoredVwap", [at(50, 0)], { bars }, { showLabels: false })[0] as Extract<Shape, { t: "poly" }>;
    expect(vwap.pts[0][1]).toBeCloseTo(yOf((172 + 168 + 171) / 3), 6);
    const vp = draw("volumeProfile", [at(0, 0), at(59, 0)], { bars }, { rows: 10 });
    expect(vp.filter((g) => g.t === "poly" && g.fill)).toHaveLength(20); // up and down in each row
  });

  it("shapes: a circle around its center, an arc through its middle point, a closed polyline", () => {
    const c = draw("circle", [at(20, 150), at(23, 154)]).find((g) => g.t === "ellipse") as Extract<Shape, { t: "ellipse" }>;
    expect(c.rx).toBeCloseTo(Math.hypot(30, 24), 6);
    const arc = draw("arc", [at(10, 150), at(30, 150), at(20, 160)]).find((g) => g.t === "ellipse") as Extract<Shape, { t: "ellipse" }>;
    expect(distanceTo(arc, xOf(20), yOf(160))).toBeLessThan(0.5);
    const poly = draw("polyline", [at(10, 120), at(20, 150), at(30, 120)]).find((g) => g.t === "poly") as Extract<Shape, { t: "poly" }>;
    expect(poly.closed).toBe(true);
  });
});
