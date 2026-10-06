// What each drawing tool draws, in screen pixels, from its anchors: lines, fills, ellipses and
// labels, with TradingView's levels and colors unless its Settings changed them (the levels shown,
// their values and colors, the background, extending, labels, line ends, stats, text …). Pure, so
// the shapes can be tested and hit-tested.
//
// Levels that are prices (a Fibonacci retracement) are worked out in price and then placed, so they
// stay right on a logarithmic scale; those that are times (time zones) in the chart's bar index.

import { TOOL_BY_ID, type DrawLevel, type Drawing, type DrawingOptions, type HAlign, type ToolId, type VAlign } from "./tools";

export type Anchor = { x: number; y: number; logical: number; price: number };

type TextShape = {
  t: "text";
  x: number;
  y: number;
  /** One line or several ("\n"). */
  text: string;
  color: string;
  align?: "left" | "right" | "center";
  base?: "top" | "middle" | "bottom";
  bg?: string;
  /** A frame round its background. */
  border?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Turned about (x, y), in radians: text along a sloping line. */
  angle?: number;
};

export type Shape =
  | { t: "seg"; x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dash?: number[] }
  | { t: "poly"; pts: Array<[number, number]>; fill?: string; stroke?: string; width?: number; dash?: number[]; closed?: boolean }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; start?: number; end?: number; color: string; width?: number; dash?: number[]; fill?: string }
  | TextShape;

export type GeometryContext = {
  anchors: Anchor[];
  /** The pane's size. */
  width: number;
  height: number;
  xOf: (logical: number) => number | null;
  yOf: (price: number) => number | null;
  formatPrice: (price: number) => string;
  drawing: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio" | "options">;
  /** Whether it's the selected drawing (a trend line's stats show then, unless always). */
  selected?: boolean;
  /** A bar index's time (unix seconds), and a time as the chart writes it. */
  timeOf?: (logical: number) => number;
  formatTime?: (time: number) => string;
  /** The chart's bars by index (regression trend, anchored VWAP, volume profile). */
  bars?: ReadonlyArray<Bar>;
};

export type Bar = { open: number; high: number; low: number; close: number; volume?: number };

const FAR = 20_000;
type Pt2 = { x: number; y: number };
export const DASH: Record<string, number[]> = { solid: [], dashed: [6, 4], dotted: [1, 3] };

/** TradingView's Fibonacci level colors. */
const FIB_COLOR: Record<string, string> = {
  "0": "#787B86", "0.236": "#F23645", "0.382": "#FF9800", "0.5": "#4CAF50", "0.618": "#089981", "0.786": "#00BCD4",
  "1": "#787B86", "1.272": "#2962FF", "1.414": "#2962FF", "1.618": "#2962FF", "2": "#F23645", "2.618": "#F23645",
  "3": "#9C27B0", "3.618": "#9C27B0", "4.236": "#E91E63", "0.25": "#F23645", "0.75": "#00BCD4", "0.886": "#00BCD4",
  "1.382": "#2962FF", "2.382": "#F23645",
};
export const fibColor = (l: number) => FIB_COLOR[String(l)] ?? "#787B86";

const RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
const CIRCLE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];
const ARC_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FAN_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
const TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const TREND_TIME = [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3];
const GANN_FAN: Array<[number, string]> = [
  [8, "#FF9800"], [4, "#089981"], [3, "#4CAF50"], [2, "#00BCD4"], [1, "#2962FF"], [1 / 2, "#00BCD4"], [1 / 3, "#4CAF50"], [1 / 4, "#089981"], [1 / 8, "#FF9800"],
];

const fib = (values: number[]): DrawLevel[] => values.map((value) => ({ value, color: fibColor(value), visible: true }));
const plain = (values: number[], color: string): DrawLevel[] => values.map((value) => ({ value, color, visible: true }));

/** A tool's levels as TradingView has them (null for a tool without levels). */
export function defaultLevels(tool: ToolId): DrawLevel[] | null {
  switch (tool) {
    case "fibRetracement":
    case "fibExtension":
    case "fibChannel":
      return fib(RETRACEMENT);
    case "fibTimeZone":
      return plain(TIME_ZONES, "#2962FF");
    case "fibTrendTime":
      return fib(TREND_TIME);
    case "fibSpeedFan":
      return fib(FAN_LEVELS);
    case "fibCircles":
      return fib(CIRCLE_LEVELS);
    case "fibSpeedArcs":
    case "fibWedge":
      return fib(ARC_LEVELS);
    case "pitchfan":
      return fib([0.382, 0.5, 0.618, 1]);
    case "gannBox":
      return fib([0.25, 0.382, 0.5, 0.618, 0.75]);
    case "gannSquare":
    case "gannSquareFixed":
      return plain([0.25, 0.5, 0.75], "#FF9800");
    case "gannFan":
      return GANN_FAN.map(([value, color]) => ({ value, color, visible: true }));
    case "pitchfork":
    case "schiffPitchfork":
    case "modifiedSchiff":
    case "insidePitchfork":
      // TradingView's: the handle's own lines (1) and half-way (0.5) shown, the rest to turn on.
      return [0.25, 0.382, 0.5, 0.618, 0.75, 1, 1.5, 1.75, 2].map((value) => ({ value, color: value === 1 ? "#2962FF" : fibColor(value), visible: value === 0.5 || value === 1 }));
    default:
      return null;
  }
}

/** A Gann angle as written: 2 → 2/1, 0.25 → 1/4. */
export const gannLabel = (k: number) => (k >= 1 ? `${+k.toFixed(3)}/1` : `1/${+(1 / k).toFixed(3)}`);

/** Options without a default of their own: unset means "the drawing's color" (or none). */
type Unset = "levels" | "oneColor" | "fillColor" | "trendColor" | "middleColor" | "textColor" | "textBgColor" | "textBorderColor" | "profitColor" | "stopColor" | "upColor" | "downColor";
export type ResolvedOptions = Required<Omit<DrawingOptions, Unset>> & Pick<DrawingOptions, Unset> & { levels: DrawLevel[] };

const FILL_OPACITY: Partial<Record<ToolId, number>> = {
  channel: 0.12, rect: 0.15, gannBox: 0.06, gannSquare: 0.06, gannSquareFixed: 0.06, fibChannel: 0.08,
  fibSpeedFan: 0.08, pitchfan: 0.08, gannFan: 0.08, fibTimeZone: 0.08, fibTrendTime: 0.08, measure: 0.18, priceRange: 0.18, dateRange: 0.18,
  regression: 0.08, flatTopBottom: 0.12, disjointChannel: 0.12, pitchfork: 0.08, schiffPitchfork: 0.08, modifiedSchiff: 0.08, insidePitchfork: 0.08,
  xabcd: 0.2, cypher: 0.2, headShoulders: 0.2, trianglePattern: 0.2, timeCycles: 0.1,
  rotatedRect: 0.15, circle: 0.15, ellipse: 0.15, polyline: 0.15, triangle: 0.15, arc: 0.15,
};
/** Backgrounds TradingView starts without. */
const NO_FILL: ToolId[] = ["fibTimeZone", "fibTrendTime"];

/** A drawing's options with each one's default for its tool filled in. */
export function optionsOf(tool: ToolId, o: DrawingOptions | undefined): ResolvedOptions {
  return {
    levels: o?.levels ?? defaultLevels(tool) ?? [],
    useOneColor: o?.useOneColor ?? false,
    oneColor: o?.oneColor,
    fill: o?.fill ?? !NO_FILL.includes(tool),
    fillOpacity: o?.fillOpacity ?? FILL_OPACITY[tool] ?? 0.1,
    fillColor: o?.fillColor,
    extendLeft: o?.extendLeft ?? false,
    extendRight: o?.extendRight ?? tool === "fibChannel",
    reverse: o?.reverse ?? false,
    showLevels: o?.showLevels ?? true,
    showPrices: o?.showPrices ?? true,
    levelsAs: o?.levelsAs ?? "values",
    labelHAlign: o?.labelHAlign ?? "left",
    labelVAlign: o?.labelVAlign ?? "middle",
    labelSize: o?.labelSize ?? 10,
    trendLine: o?.trendLine ?? true,
    trendColor: o?.trendColor,
    trendWidth: o?.trendWidth ?? 1,
    trendDash: o?.trendDash ?? "dashed",
    middleLine: o?.middleLine ?? tool === "channel",
    middleColor: o?.middleColor,
    middleWidth: o?.middleWidth ?? 1,
    middleDash: o?.middleDash ?? "dashed",
    priceLabel: o?.priceLabel ?? true,
    timeLabel: o?.timeLabel ?? tool === "crossLine",
    leftEnd: o?.leftEnd ?? "normal",
    rightEnd: o?.rightEnd ?? "normal",
    middlePoint: o?.middlePoint ?? false,
    priceLabels: o?.priceLabels ?? false,
    statsPriceRange: o?.statsPriceRange ?? false,
    statsPercent: o?.statsPercent ?? false,
    statsBars: o?.statsBars ?? false,
    statsDateRange: o?.statsDateRange ?? false,
    statsAngle: o?.statsAngle ?? false,
    statsPosition: o?.statsPosition ?? "right",
    alwaysShowStats: o?.alwaysShowStats ?? false,
    fontSize: o?.fontSize ?? 14,
    textColor: o?.textColor,
    bold: o?.bold ?? false,
    italic: o?.italic ?? false,
    textVAlign: o?.textVAlign ?? (tool === "rect" ? "top" : "middle"),
    textHAlign: o?.textHAlign ?? (tool === "rect" ? "left" : "center"),
    textBackground: o?.textBackground ?? true,
    textBgColor: o?.textBgColor,
    textBorder: o?.textBorder ?? false,
    textBorderColor: o?.textBorderColor,
    grid: o?.grid ?? true,
    angles: o?.angles ?? true,
    fans: o?.fans ?? true,
    arcs: o?.arcs ?? true,
    counterclockwise: o?.counterclockwise ?? false,
    labelBackground: o?.labelBackground ?? true,
    showLabels: o?.showLabels ?? true,
    profitColor: o?.profitColor,
    stopColor: o?.stopColor,
    deviation: o?.deviation ?? 2,
    rows: o?.rows ?? 24,
    upColor: o?.upColor,
    downColor: o?.downColor,
    pocLine: o?.pocLine ?? true,
  };
}

/** A color with an opacity (hex or rgb(a)). */
export function withAlpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(color);
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})` : color;
}

/** From (x1, y1) through (x2, y2) on to far beyond the pane (or both ways). */
function ray(x1: number, y1: number, x2: number, y2: number, both = false): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * FAR;
  const uy = (dy / len) * FAR;
  return both ? [x1 - ux, y1 - uy, x1 + ux, y1 + uy] : [x1, y1, x1 + ux, y1 + uy];
}

/** A segment extended on either side as its Settings say. */
function extendSeg(x1: number, y1: number, x2: number, y2: number, left: boolean, right: boolean): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * FAR;
  const uy = (dy / len) * FAR;
  return [left ? x1 - ux : x1, left ? y1 - uy : y1, right ? x2 + ux : x2, right ? y2 + uy : y2];
}

const fmtLevel = (l: number) => String(+l.toFixed(3));

/** A span of time as TradingView's stats write it: 3d 4h, 2h 15m, 40m. */
export function fmtDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Text's baseline for a place above, on or below a line. */
const BASE_OF: Record<VAlign, "bottom" | "middle" | "top"> = { top: "bottom", middle: "middle", bottom: "top" };
const STATS_BG = "rgba(19,23,34,0.85)";

/** The shapes of a drawing (or of one being placed: fewer anchors than its tool needs). */
export function shapesFor(tool: ToolId, ctx: GeometryContext): Shape[] {
  const { anchors: a, width: W, height: H, xOf, yOf, formatPrice, drawing } = ctx;
  const color = drawing.color;
  const lw = drawing.width;
  const dash = DASH[drawing.dash ?? "solid"];
  const o = optionsOf(tool, drawing.options);
  const levels = o.levels.filter((l) => l.visible).map((l) => (o.useOneColor ? { ...l, color: o.oneColor ?? color } : l));
  const fillA = (c: string) => (o.fill ? withAlpha(c, o.fillOpacity) : undefined);
  const out: Shape[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number, c = color, w: number = lw, d = dash) => out.push({ t: "seg", x1, y1, x2, y2, color: c, width: w, dash: d });
  /** While a tool is placed, the line between its points so far. */
  const guide = (p: Anchor, q: Anchor) => seg(p.x, p.y, q.x, q.y, withAlpha(color, 0.8), 1, [4, 4]);
  /** A Fibonacci tool's trend line, as its Settings have it. */
  const trend = (p: Anchor, q: Anchor) => {
    if (o.trendLine) seg(p.x, p.y, q.x, q.y, o.trendColor ?? withAlpha(color, 0.8), o.trendWidth, DASH[o.trendDash]);
  };
  const text = (x: number, y: number, s: string, c = color, align: "left" | "right" | "center" = "left", base: "top" | "middle" | "bottom" = "bottom", bg?: string, size?: number) =>
    out.push({ t: "text", x, y, text: s, color: c, align, base, bg, size });
  const lvl = (v: number) => (o.levelsAs === "percents" ? `${+(v * 100).toFixed(1)}%` : fmtLevel(v));
  const label = (l: number, price?: number) =>
    [o.showLevels ? lvl(l) : "", o.showPrices && price !== undefined ? `(${formatPrice(price)})` : ""].filter(Boolean).join(" ");
  const band = (pts: Array<[number, number]>, c: string) => {
    const f = fillA(c);
    if (f) out.push({ t: "poly", pts, fill: f, closed: true });
  };
  /** Wedges between rays from one point, in order, each in the color of its outer ray. */
  const wedges = (from: Anchor, ends: Array<{ x: number; y: number; color: string }>) => {
    for (let i = 0; i + 1 < ends.length; i++) band([[from.x, from.y], [ends[i].x, ends[i].y], [ends[i + 1].x, ends[i + 1].y]], ends[i + 1].color);
  };
  /** The drawing's own text along a line from p to q (read left to right), placed as its Settings say. */
  const lineText = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    if (!drawing.text) return;
    const [L, R] = p.x < q.x || (p.x === q.x && p.y > q.y) ? [p, q] : [q, p];
    const ang = Math.atan2(R.y - L.y, R.x - L.x);
    const t = o.textHAlign === "left" ? 0 : o.textHAlign === "right" ? 1 : 0.5;
    const along = o.textHAlign === "left" ? 4 : o.textHAlign === "right" ? -4 : 0;
    const off = o.textVAlign === "top" ? 3 : o.textVAlign === "bottom" ? -3 : 0;
    // "Up" from the line is to its left as it runs from L to R.
    const [ux, uy] = [Math.sin(ang), -Math.cos(ang)];
    out.push({
      t: "text",
      x: L.x + (R.x - L.x) * t + Math.cos(ang) * along + ux * off,
      y: L.y + (R.y - L.y) * t + Math.sin(ang) * along + uy * off,
      text: drawing.text,
      color: o.textColor ?? color,
      align: o.textHAlign,
      base: BASE_OF[o.textVAlign],
      size: o.fontSize,
      bold: o.bold,
      italic: o.italic,
      angle: ang || undefined,
    });
  };
  const arrowHead = (tip: { x: number; y: number }, from: { x: number; y: number }) => {
    const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    const s = 7 + lw * 2;
    const at = (d: number): [number, number] => [tip.x - s * Math.cos(ang + d), tip.y - s * Math.sin(ang + d)];
    out.push({ t: "poly", pts: [[tip.x, tip.y], at(0.42), at(-0.42)], fill: color, stroke: color, width: 1, closed: true });
  };
  /** A label in a box of its color (white text), as TradingView's patterns and notes have them. */
  const tag = (x: number, y: number, s: string, bg: string, align: "left" | "right" | "center" = "center", base: "top" | "middle" | "bottom" = "bottom", fg = "#ffffff", size?: number) =>
    out.push({ t: "text", x, y, text: s, color: fg, align, base, bg, size });
  /** The background inside a shape: its own color, or the line's at the shape's opacity. */
  const area = o.fill ? (o.fillColor ?? withAlpha(color, o.fillOpacity)) : undefined;
  const line = (pts: Array<{ x: number; y: number }>, closed = false, fill?: string, w: number = lw, c = color) =>
    out.push({ t: "poly", pts: pts.map((q) => [q.x, q.y] as [number, number]), stroke: c, width: w, dash, closed, fill });
  /** The drawing's own text, centered at (x, y), as its Text tab has it. */
  const centerText = (x: number, y: number) => {
    if (drawing.text) out.push({ t: "text", x, y, text: drawing.text, color: o.textColor ?? color, align: "center", base: "middle", size: o.fontSize, bold: o.bold, italic: o.italic });
  };
  /** A pattern point's name, above it at a peak and below it at a trough. */
  const pointName = (pts: Anchor[], i: number, name: string) => {
    if (!o.showLabels || !pts[i]) return;
    const near = [pts[i - 1], pts[i + 1]].filter(Boolean);
    const high = near.length === 0 || pts[i].y <= near.reduce((sum, q) => sum + q.y, 0) / near.length;
    text(pts[i].x, high ? pts[i].y - 6 : pts[i].y + 6, name, color, "center", high ? "bottom" : "top", undefined, o.labelSize + 2);
  };
  /** A pattern's ratio of two legs, on the dashed line between the points it spans. */
  const ratio = (p: Anchor | undefined, q: Anchor | undefined, value: number) => {
    if (!p || !q || !Number.isFinite(value)) return;
    seg(p.x, p.y, q.x, q.y, withAlpha(color, 0.7), 1, [4, 4]);
    if (o.showLabels) tag((p.x + q.x) / 2, (p.y + q.y) / 2, value.toFixed(3), color, "center", "middle", "#ffffff", o.labelSize);
  };
  const leg = (p: Anchor, q: Anchor) => Math.abs(q.price - p.price);
  const pct = (from: number, to: number) => (from !== 0 ? ((to - from) / from) * 100 : 0);
  const signed = (v: number, s: string) => `${v >= 0 ? "+" : ""}${s}`;
  /** A note's box: solid in its color (or its own), or none with Background off; its text white on it. */
  const noteBg = o.fill ? (o.fillColor ?? color) : undefined;
  const noteFg = o.textColor ?? (noteBg ? "#ffffff" : color);

  if (a.length === 0) return out;
  const [A, B, C] = a;

  // While placing, a tool with more points shows what it has so far.
  if (a.length < 2 && (TOOL_BY_ID.get(tool)?.points ?? 2) > 1) return out;

  switch (tool) {
    case "trend":
    case "ray":
    case "extended":
    case "infoLine":
    case "trendAngle": {
      // A ray is a trend line extended right; an extended line, both ways. An info line always
      // shows its stats; a trend angle its angle.
      const extL = tool === "extended" || o.extendLeft;
      const extR = tool === "ray" || tool === "extended" || o.extendRight;
      if (tool === "infoLine")
        Object.assign(o, { statsPriceRange: true, statsPercent: true, statsBars: true, statsDateRange: true, statsAngle: true, alwaysShowStats: true });
      if (tool === "trendAngle") {
        const deg = Math.atan2(A.y - B.y, B.x - A.x);
        const r = Math.min(40, Math.max(20, Math.hypot(B.x - A.x, B.y - A.y) * 0.4));
        seg(A.x, A.y, A.x + r * 1.4 * Math.sign(B.x - A.x || 1), A.y, withAlpha(color, 0.7), 1, [4, 4]);
        const [s0, s1] = B.x >= A.x ? (deg >= 0 ? [-deg, 0] : [0, -deg]) : deg >= 0 ? [Math.PI, 2 * Math.PI - deg] : [-deg, Math.PI];
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: r, ry: r, start: s0, end: s1, color, width: 1 });
        text(A.x + r + 4 * Math.sign(B.x - A.x || 1), A.y - 4, `${((deg * 180) / Math.PI).toFixed(2)}°`, color, B.x >= A.x ? "left" : "right", "bottom");
      }
      const [x1, y1, x2, y2] = extendSeg(A.x, A.y, B.x, B.y, extL, extR);
      seg(x1, y1, x2, y2);
      if (o.leftEnd === "arrow" && !extL) arrowHead(A, B);
      if (o.rightEnd === "arrow" && !extR) arrowHead(B, A);
      if (o.middlePoint) out.push({ t: "ellipse", cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, rx: 3.5, ry: 3.5, color, width: 1, fill: color });
      if (o.priceLabels)
        for (const p of [A, B]) {
          const above = p === (A.y <= B.y ? A : B);
          text(p.x, above ? p.y - 6 : p.y + 6, formatPrice(p.price), "#ffffff", "center", above ? "bottom" : "top", color);
        }
      lineText(A, B);
      const anyStats = o.statsPriceRange || o.statsPercent || o.statsBars || o.statsDateRange || o.statsAngle;
      if (anyStats && (o.alwaysShowStats || ctx.selected)) {
        const change = B.price - A.price;
        const sign = change >= 0 ? "+" : "";
        const pct = A.price !== 0 ? (change / A.price) * 100 : 0;
        const bars = Math.round(B.logical - A.logical);
        const time = o.statsDateRange && ctx.timeOf ? fmtDuration(ctx.timeOf(B.logical) - ctx.timeOf(A.logical)) : "";
        const lines = [
          [o.statsPriceRange ? `${sign}${formatPrice(change)}` : "", o.statsPercent ? `(${sign}${pct.toFixed(2)}%)` : ""].filter(Boolean).join(" "),
          [o.statsBars ? `${bars} bars` : "", time].filter(Boolean).join(", "),
          o.statsAngle ? `${(Math.atan2(A.y - B.y, B.x - A.x) * (180 / Math.PI)).toFixed(1)}°` : "",
        ].filter(Boolean);
        const [L, R] = A.x <= B.x ? [A, B] : [B, A];
        const p = o.statsPosition === "left" ? L : o.statsPosition === "right" ? R : { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        out.push({ t: "text", x: p.x, y: p.y + 12, text: lines.join("\n"), color: "#D1D4DC", align: "center", base: "top", bg: STATS_BG, size: 11 });
      }
      break;
    }
    case "hline":
    case "hray": {
      const x0 = tool === "hline" ? -FAR : A.x;
      seg(x0, A.y, FAR, A.y);
      if (o.priceLabel) text(W - 4, A.y - 2, formatPrice(A.price), color, "right");
      lineText({ x: tool === "hline" ? 0 : A.x, y: A.y }, { x: W, y: A.y });
      break;
    }
    case "vline":
      seg(A.x, -FAR, A.x, FAR);
      if (o.timeLabel && ctx.timeOf && ctx.formatTime) text(A.x, H - 3, ctx.formatTime(ctx.timeOf(A.logical)), "#ffffff", "center", "bottom", color);
      // Read upwards, as on TradingView: Left is the bottom of the line.
      lineText({ x: A.x, y: H }, { x: A.x, y: 0 });
      break;
    case "crossLine":
      seg(-FAR, A.y, FAR, A.y);
      seg(A.x, -FAR, A.x, FAR);
      if (o.priceLabel) text(W - 4, A.y - 2, formatPrice(A.price), color, "right");
      if (o.timeLabel && ctx.timeOf && ctx.formatTime) text(A.x, H - 3, ctx.formatTime(ctx.timeOf(A.logical)), "#ffffff", "center", "bottom", color);
      lineText({ x: 0, y: A.y }, { x: W, y: A.y });
      break;

    case "regression": {
      // The closes' least-squares line between the two times, with bands at ± deviations.
      const bars = ctx.bars ?? [];
      const i0 = Math.max(0, Math.ceil(Math.min(A.logical, B.logical)));
      const i1 = Math.min(bars.length - 1, Math.floor(Math.max(A.logical, B.logical)));
      if (i1 - i0 < 1) {
        seg(A.x, A.y, B.x, B.y);
        break;
      }
      const n = i1 - i0 + 1;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let i = i0; i <= i1; i++) {
        sx += i;
        sy += bars[i].close;
        sxy += i * bars[i].close;
        sxx += i * i;
      }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
      const icpt = (sy - slope * sx) / n;
      let ss = 0;
      for (let i = i0; i <= i1; i++) ss += (bars[i].close - (icpt + slope * i)) ** 2;
      const dev = Math.sqrt(ss / n) * o.deviation;
      const end = o.extendRight ? i1 + Math.max(n, 2000) : i1;
      const at = (i: number, off: number) => ({ x: xOf(i), y: yOf(icpt + slope * i + off) });
      const lines = [0, dev, -dev].map((off) => [at(i0, off), at(end, off)] as const);
      if (lines.some(([p, q]) => p.x === null || p.y === null || q.x === null || q.y === null)) break;
      const [[b0, b1], [u0, u1], [l0, l1]] = lines as unknown as Array<[Pt2, Pt2]>;
      if (area) out.push({ t: "poly", pts: [[u0.x, u0.y], [u1.x, u1.y], [l1.x, l1.y], [l0.x, l0.y]], fill: area, closed: true });
      seg(u0.x, u0.y, u1.x, u1.y);
      seg(l0.x, l0.y, l1.x, l1.y);
      seg(b0.x, b0.y, b1.x, b1.y, color, lw, [6, 4]);
      break;
    }

    case "flatTopBottom":
    case "disjointChannel": {
      const [x1, y1, x2, y2] = extendSeg(A.x, A.y, B.x, B.y, o.extendLeft, o.extendRight);
      seg(x1, y1, x2, y2);
      if (!C) break;
      // Flat: the third point's price all along. Disjoint: from it at the first time, with the
      // trend line's slope the other way.
      const ya = C.y;
      const yb = tool === "flatTopBottom" ? C.y : yOf(C.price - (B.price - A.price));
      if (yb === null) break;
      const [px1, py1, px2, py2] = extendSeg(A.x, ya, B.x, yb, o.extendLeft, o.extendRight);
      if (area) out.push({ t: "poly", pts: [[x1, y1], [x2, y2], [px2, py2], [px1, py1]], fill: area, closed: true });
      seg(px1, py1, px2, py2);
      break;
    }

    case "pitchfork":
    case "schiffPitchfork":
    case "modifiedSchiff":
    case "insidePitchfork": {
      if (!C) {
        guide(A, B);
        break;
      }
      // The handle starts at the pivot (moved, for Schiff's and the inside one) and runs through
      // the middle of the other two points; the tines are its parallels through them.
      const P =
        tool === "schiffPitchfork" ? { x: A.x, y: (A.y + B.y) / 2 }
        : tool === "modifiedSchiff" ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        : tool === "insidePitchfork" ? { x: (A.x + C.x) / 2, y: (A.y + C.y) / 2 }
        : { x: A.x, y: A.y };
      const M = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
      const len = Math.hypot(M.x - P.x, M.y - P.y) || 1;
      const D = { x: ((M.x - P.x) / len) * FAR, y: ((M.y - P.y) / len) * FAR };
      if (P.x !== A.x || P.y !== A.y) seg(A.x, A.y, P.x, P.y, withAlpha(color, 0.7), 1, [4, 4]);
      seg(B.x, B.y, C.x, C.y, color, lw, dash);
      seg(P.x, P.y, P.x + D.x, P.y + D.y);
      const tines = [{ v: 0, c: color, s: M }];
      for (const l of levels)
        for (const side of [B, C]) tines.push({ v: side === B ? l.value : -l.value, c: l.color, s: { x: M.x + (side.x - M.x) * l.value, y: M.y + (side.y - M.y) * l.value } });
      tines.sort((p, q) => p.v - q.v);
      for (let i = 0; i + 1 < tines.length; i++) {
        const [p, q] = [tines[i].s, tines[i + 1].s];
        band([[p.x, p.y], [p.x + D.x, p.y + D.y], [q.x + D.x, q.y + D.y], [q.x, q.y]], tines[Math.abs(tines[i].v) > Math.abs(tines[i + 1].v) ? i : i + 1].c);
      }
      for (const t of tines) if (t.v !== 0) seg(t.s.x, t.s.y, t.s.x + D.x, t.s.y + D.y, t.c, lw, dash);
      break;
    }

    case "channel": {
      const [bx1, by1, bx2, by2] = extendSeg(A.x, A.y, B.x, B.y, o.extendLeft, o.extendRight);
      seg(bx1, by1, bx2, by2);
      if (!C) break;
      // The parallel through the third point, at the same price offset all along.
      const slope = B.logical === A.logical ? 0 : (B.price - A.price) / (B.logical - A.logical);
      const offset = C.price - (A.price + slope * (C.logical - A.logical));
      const ya = yOf(A.price + offset);
      const yb = yOf(B.price + offset);
      const ma = yOf(A.price + offset / 2);
      const mb = yOf(B.price + offset / 2);
      if (ya === null || yb === null) break;
      const [px1, py1, px2, py2] = extendSeg(A.x, ya, B.x, yb, o.extendLeft, o.extendRight);
      if (o.fill) out.push({ t: "poly", pts: [[bx1, by1], [bx2, by2], [px2, py2], [px1, py1]], fill: o.fillColor ?? withAlpha(color, o.fillOpacity), closed: true });
      seg(px1, py1, px2, py2);
      if (o.middleLine && ma !== null && mb !== null) {
        const [mx1, my1, mx2, my2] = extendSeg(A.x, ma, B.x, mb, o.extendLeft, o.extendRight);
        seg(mx1, my1, mx2, my2, o.middleColor ?? withAlpha(color, 0.8), o.middleWidth, DASH[o.middleDash]);
      }
      break;
    }

    case "fibRetracement":
    case "fibExtension": {
      // Retracement: 1 at the move's start, 0 at its end. Extension: the move A→B laid off from C.
      // Reversed, the other way round.
      const ext = tool === "fibExtension";
      if (ext && !C) {
        guide(A, B);
        break;
      }
      const from = ext ? C : o.reverse ? A : B;
      const span = (ext ? B.price - A.price : A.price - B.price) * (o.reverse ? -1 : 1);
      let x1 = ext ? C.x : Math.min(A.x, B.x);
      let x2 = ext ? C.x + Math.max(60, Math.abs(B.x - A.x)) : Math.max(A.x, B.x);
      if (o.extendLeft) x1 = -FAR;
      if (o.extendRight) x2 = FAR;
      const ys = levels.map((l) => ({ l, price: from.price + span * l.value, y: yOf(from.price + span * l.value) }));
      const sorted = [...ys].sort((p, q) => p.l.value - q.l.value);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const [p, q] = [sorted[i], sorted[i + 1]];
        if (p.y === null || q.y === null) continue;
        band([[x1, p.y], [x2, p.y], [x2, q.y], [x1, q.y]], q.l.color);
      }
      // Labels: left of the levels (or at the pane's edge when they run off it), centered on
      // what's on screen, or right of them; above, on or below each line.
      const [lx, lAlign]: [number, "left" | "right" | "center"] =
        o.labelHAlign === "left" ? (o.extendLeft ? [4, "left"] : [x1 - 4, "right"])
        : o.labelHAlign === "right" ? (o.extendRight ? [W - 4, "right"] : [x2 + 4, "left"])
        : [(Math.max(x1, 0) + Math.min(x2, W)) / 2, "center"];
      const dy = o.labelVAlign === "top" ? -2 : o.labelVAlign === "bottom" ? 2 : 0;
      for (const { l, price, y } of ys) {
        if (y === null) continue;
        seg(x1, y, x2, y, l.color, lw, dash);
        const s = label(l.value, price);
        if (s) text(lx, y + dy, s, l.color, lAlign, BASE_OF[o.labelVAlign], undefined, o.labelSize);
      }
      if (ext) {
        trend(A, B);
        trend(B, C);
      } else trend(A, B);
      break;
    }

    case "fibChannel": {
      seg(A.x, A.y, B.x, B.y, color, lw, dash);
      if (!C) break;
      const slope = B.logical === A.logical ? 0 : (B.price - A.price) / (B.logical - A.logical);
      const offset = C.price - (A.price + slope * (C.logical - A.logical));
      const lines = levels.map((l) => {
        const ya = yOf(A.price + offset * l.value);
        const yb = yOf(B.price + offset * l.value);
        if (ya === null || yb === null) return null;
        const [x1, y1, x2, y2] = extendSeg(A.x, ya, B.x, yb, o.extendLeft, o.extendRight);
        return { l, x1, y1, x2, y2, ya };
      });
      const sorted = lines.filter((v): v is NonNullable<typeof v> => v !== null).sort((p, q) => p.l.value - q.l.value);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const [p, q] = [sorted[i], sorted[i + 1]];
        band([[p.x1, p.y1], [p.x2, p.y2], [q.x2, q.y2], [q.x1, q.y1]], q.l.color);
      }
      for (const ln of sorted) {
        seg(ln.x1, ln.y1, ln.x2, ln.y2, ln.l.color, lw, dash);
        if (o.showLevels) text(o.extendLeft ? 4 : A.x - 4, o.extendLeft ? ln.y1 : ln.ya, lvl(ln.l.value), ln.l.color, o.extendLeft ? "left" : "right", "middle");
      }
      break;
    }

    case "fibTimeZone":
    case "fibTrendTime": {
      const trendTime = tool === "fibTrendTime";
      if (trendTime && !C) {
        guide(A, B);
        break;
      }
      const base = trendTime ? C.logical : A.logical;
      const span = B.logical - A.logical;
      const xs = levels
        .map((l) => ({ l, x: xOf(base + span * l.value) }))
        .filter((v): v is { l: DrawLevel; x: number } => v.x !== null)
        .sort((p, q) => p.l.value - q.l.value);
      for (let i = 0; i + 1 < xs.length; i++) band([[xs[i].x, 0], [xs[i + 1].x, 0], [xs[i + 1].x, H], [xs[i].x, H]], xs[i + 1].l.color);
      for (const { l, x } of xs) {
        seg(x, -FAR, x, FAR, l.color, lw, dash);
        if (o.showLevels) text(x + 3, H - 4, lvl(l.value), l.color, "left", "bottom");
      }
      trend(A, B);
      if (trendTime) trend(B, C);
      break;
    }

    case "fibSpeedFan": {
      // Rays from A through the price divisions at B's time, and the time divisions at B's price.
      // Reversed, the fan is drawn from B back towards A.
      const [P, Q] = o.reverse ? [B, A] : [A, B];
      const priceEnds: Array<{ x: number; y: number; color: string }> = [];
      for (const l of [...levels].sort((p, q) => p.value - q.value)) {
        const y = yOf(P.price + (Q.price - P.price) * l.value);
        const x = xOf(P.logical + (Q.logical - P.logical) * l.value);
        if (o.grid) {
          if (y !== null) seg(P.x, y, Q.x, y, withAlpha(l.color, 0.5), 1, []);
          if (x !== null) seg(x, P.y, x, Q.y, withAlpha(l.color, 0.5), 1, []);
        }
        if (l.value === 0) continue;
        if (y !== null) {
          const [x1, y1, x2, y2] = ray(P.x, P.y, Q.x, y);
          seg(x1, y1, x2, y2, l.color, lw, dash);
          priceEnds.push({ x: x2, y: y2, color: l.color });
          if (o.showLevels) text(Q.x + (o.reverse ? -4 : 4), y, lvl(l.value), l.color, o.reverse ? "right" : "left", "middle");
        }
        if (x !== null && l.value !== 1) {
          const [x1, y1, x2, y2] = ray(P.x, P.y, x, Q.y);
          seg(x1, y1, x2, y2, l.color, lw, dash);
        }
      }
      wedges(P, priceEnds);
      break;
    }

    case "fibCircles":
    case "fibSpeedArcs": {
      // Ellipses in chart space (they scale with the chart): level 1 passes through B.
      const dx = Math.abs(B.x - A.x);
      const dy = Math.abs(B.y - A.y);
      const r = Math.hypot(B.x - A.x, B.y - A.y);
      const [rx, ry] = dx > 1 && dy > 1 ? [Math.SQRT2 * dx, Math.SQRT2 * dy] : [r, r];
      const arcs = tool === "fibSpeedArcs";
      // Arcs: the half of each ellipse on B's side of A.
      const [start, end] = arcs ? (B.y < A.y ? [Math.PI, 2 * Math.PI] : [0, Math.PI]) : [0, 2 * Math.PI];
      for (const l of levels) {
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: rx * l.value, ry: ry * l.value, start, end, color: l.color, width: lw, dash });
        if (o.showLevels) text(A.x + rx * l.value + 3, A.y, lvl(l.value), l.color, "left", "middle");
      }
      trend(A, B);
      break;
    }

    case "fibSpiral": {
      // A golden spiral through B: its radius grows by φ every quarter turn.
      const phi = (1 + Math.sqrt(5)) / 2;
      const r0 = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const t0 = Math.atan2(B.y - A.y, B.x - A.x);
      const turn = o.counterclockwise ? -1 : 1;
      const pts: Array<[number, number]> = [];
      for (let k = -32; k <= 40; k++) {
        const th = (k / 8) * Math.PI;
        const r = r0 * phi ** ((th * 2) / Math.PI);
        if (r > FAR) break;
        pts.push([A.x + r * Math.cos(t0 + turn * th), A.y + r * Math.sin(t0 + turn * th)]);
      }
      out.push({ t: "poly", pts, stroke: color, width: lw, dash });
      guide(A, B);
      break;
    }

    case "fibWedge": {
      if (!C) {
        guide(A, B);
        break;
      }
      const r = Math.hypot(B.x - A.x, B.y - A.y);
      const a1 = Math.atan2(B.y - A.y, B.x - A.x);
      let a2 = Math.atan2(C.y - A.y, C.x - A.x);
      // The shorter way round from one side to the other.
      while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
      while (a1 - a2 > Math.PI) a2 += 2 * Math.PI;
      const [s, e] = a1 <= a2 ? [a1, a2] : [a2, a1];
      seg(A.x, A.y, A.x + r * Math.cos(a1), A.y + r * Math.sin(a1), color, lw, dash);
      seg(A.x, A.y, A.x + r * Math.cos(a2), A.y + r * Math.sin(a2), color, lw, dash);
      for (const l of levels) {
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: r * l.value, ry: r * l.value, start: s, end: e, color: l.color, width: lw, dash });
        if (o.showLevels) text(A.x + r * l.value * Math.cos(s), A.y + r * l.value * Math.sin(s) - 2, lvl(l.value), l.color, "left", "bottom");
      }
      break;
    }

    case "pitchfan": {
      if (!C) {
        guide(A, B);
        break;
      }
      const mx = (B.x + C.x) / 2;
      const my = (B.y + C.y) / 2;
      seg(B.x, B.y, C.x, C.y, color, 1, [4, 4]);
      // Each ray by where it crosses B–C (−1 at C … 1 at B), so the wedges between them follow.
      const rays: Array<{ at: number; x: number; y: number; color: string }> = [];
      const rayTo = (at: number, x: number, y: number, c: string) => {
        const [x1, y1, x2, y2] = ray(A.x, A.y, x, y);
        seg(x1, y1, x2, y2, c, lw, dash);
        rays.push({ at, x: x2, y: y2, color: c });
      };
      rayTo(0, mx, my, color);
      for (const l of levels) {
        rayTo(l.value, mx + (B.x - mx) * l.value, my + (B.y - my) * l.value, l.color);
        rayTo(-l.value, mx + (C.x - mx) * l.value, my + (C.y - my) * l.value, l.color);
      }
      wedges(A, rays.sort((p, q) => p.at - q.at));
      break;
    }

    case "gannBox":
    case "gannSquare":
    case "gannSquareFixed": {
      const bx = B.x;
      let by = B.y;
      // Fixed: keeps the price per bar it was drawn with, so it stays a square in chart terms.
      if (tool === "gannSquareFixed" && drawing.ratio) {
        const dl = B.logical - A.logical;
        const price = A.price + Math.sign(B.price - A.price || 1) * Math.abs(dl) * drawing.ratio;
        by = yOf(price) ?? B.y;
      }
      const [x1, x2] = [Math.min(A.x, bx), Math.max(A.x, bx)];
      const [y1, y2] = [Math.min(A.y, by), Math.max(A.y, by)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: fillA(color), stroke: color, width: lw, dash, closed: true });
      const box = tool === "gannBox";
      for (const l of levels) {
        // Reversed, the levels are counted from the other corner.
        const v = box && o.reverse ? 1 - l.value : l.value;
        const y = y1 + (y2 - y1) * v;
        const x = x1 + (x2 - x1) * v;
        seg(x1, y, x2, y, withAlpha(l.color, 0.7), 1, box ? [] : [4, 4]);
        seg(x, y1, x, y2, withAlpha(l.color, 0.7), 1, box ? [] : [4, 4]);
        if (box && o.showLevels) {
          text(x1 - 3, y, lvl(l.value), l.color, "right", "middle");
          text(x, y2 + 3, lvl(l.value), l.color, "center", "top");
        }
      }
      if (o.angles) {
        seg(x1, y1, x2, y2, withAlpha(color, 0.8), 1, []);
        seg(x1, y2, x2, y1, withAlpha(color, 0.8), 1, []);
      }
      if (!box) {
        // Gann's square: arcs from the anchored corner and its fan to the far sides' divisions.
        const ox = A.x;
        const oy = A.y;
        const rx = Math.abs(bx - ox);
        const ry = Math.abs(by - oy);
        const sx = Math.sign(bx - ox) || 1;
        const sy = Math.sign(by - oy) || 1;
        const quarter = sx > 0 ? (sy > 0 ? [0, Math.PI / 2] : [-Math.PI / 2, 0]) : sy > 0 ? [Math.PI / 2, Math.PI] : [Math.PI, 1.5 * Math.PI];
        if (o.arcs) for (const l of [0.5, 1]) out.push({ t: "ellipse", cx: ox, cy: oy, rx: rx * l, ry: ry * l, start: quarter[0], end: quarter[1], color: withAlpha(color, 0.8), width: 1 });
        if (o.fans)
          for (const l of levels) {
            seg(ox, oy, bx, oy + (by - oy) * l.value, withAlpha(l.color, 0.6), 1, []);
            seg(ox, oy, ox + (bx - ox) * l.value, by, withAlpha(l.color, 0.6), 1, []);
          }
      }
      break;
    }

    case "gannFan": {
      // Gann's angles: price/time = k times that of A→B (the 1/1 line).
      const dl = B.logical - A.logical;
      const dp = B.price - A.price;
      const xb = xOf(A.logical + dl);
      const ends: Array<{ x: number; y: number; color: string }> = [];
      for (const l of [...levels].sort((p, q) => p.value - q.value)) {
        const y = yOf(A.price + dp * l.value);
        if (y === null || xb === null) continue;
        const [x1, y1, x2, y2] = ray(A.x, A.y, xb, y);
        seg(x1, y1, x2, y2, l.color, lw, dash);
        ends.push({ x: x2, y: y2, color: l.color });
        if (o.showLevels) text(xb + 4, y, gannLabel(l.value), l.color, "left", "middle");
      }
      wedges(A, ends);
      break;
    }

    // ---- patterns ----
    case "xabcd":
    case "cypher": {
      const [X, PA, PB, PC, PD] = a;
      if (area && PB) out.push({ t: "poly", pts: [[X.x, X.y], [PA.x, PA.y], [PB.x, PB.y]], fill: area, closed: true });
      if (area && PD) out.push({ t: "poly", pts: [[PB.x, PB.y], [PC.x, PC.y], [PD.x, PD.y]], fill: area, closed: true });
      line(a);
      if (PB) ratio(X, PB, leg(PA, PB) / leg(X, PA));
      if (tool === "xabcd") {
        if (PC) ratio(PA, PC, leg(PB, PC) / leg(PA, PB));
        if (PD) ratio(PB, PD, leg(PC, PD) / leg(PB, PC));
        if (PD) ratio(X, PD, leg(PA, PD) / leg(X, PA));
      } else {
        if (PC) ratio(X, PC, leg(X, PC) / leg(X, PA));
        if (PD) ratio(PB, PD, leg(PC, PD) / leg(X, PC));
      }
      ["X", "A", "B", "C", "D"].forEach((nm, i) => pointName(a, i, nm));
      break;
    }
    case "abcd": {
      const [PA, PB, PC, PD] = a;
      line(a);
      if (PC) ratio(PA, PC, leg(PB, PC) / leg(PA, PB));
      if (PD) ratio(PB, PD, leg(PC, PD) / leg(PB, PC));
      ["A", "B", "C", "D"].forEach((nm, i) => pointName(a, i, nm));
      break;
    }
    case "headShoulders": {
      // Each shoulder and the head filled down to the neckline (through the two troughs).
      if (area) for (const [i, j, k] of [[0, 1, 2], [2, 3, 4], [4, 5, 6]]) if (a[k]) out.push({ t: "poly", pts: [a[i], a[j], a[k]].map((q) => [q.x, q.y] as [number, number]), fill: area, closed: true });
      line(a);
      if (a[4]) {
        const [n1, n2] = [a[2], a[4]];
        const slope = n2.x !== n1.x ? (n2.y - n1.y) / (n2.x - n1.x) : 0;
        const x0 = a[0].x;
        const x1 = (a[6] ?? n2).x;
        seg(x0, n1.y + slope * (x0 - n1.x), x1, n1.y + slope * (x1 - n1.x), color, lw, [6, 4]);
      }
      pointName(a, 1, "Left Shoulder");
      pointName(a, 3, "Head");
      pointName(a, 5, "Right Shoulder");
      break;
    }
    case "trianglePattern": {
      const [PA, PB, PC, PD] = a;
      if (PD) {
        // Where its two sides meet: the apex the triangle narrows to.
        const den = (PC.x - PA.x) * (PD.y - PB.y) - (PC.y - PA.y) * (PD.x - PB.x);
        const t = den !== 0 ? ((PB.x - PA.x) * (PD.y - PB.y) - (PB.y - PA.y) * (PD.x - PB.x)) / den : NaN;
        const apex = Number.isFinite(t) && t > 1 && t < 50 ? { x: PA.x + (PC.x - PA.x) * t, y: PA.y + (PC.y - PA.y) * t } : null;
        if (area) out.push({ t: "poly", pts: (apex ? [PA, apex, PB] : [PA, PC, PD, PB]).map((q) => [q.x, q.y] as [number, number]), fill: area, closed: true });
        const endA = apex ?? PC;
        const endB = apex ?? PD;
        seg(PA.x, PA.y, endA.x, endA.y, withAlpha(color, 0.8), 1, [4, 4]);
        seg(PB.x, PB.y, endB.x, endB.y, withAlpha(color, 0.8), 1, [4, 4]);
      }
      line(a);
      ["A", "B", "C", "D"].forEach((nm, i) => pointName(a, i, nm));
      break;
    }
    case "threeDrives": {
      line(a);
      ratio(a[1], a[3], a[3] && a[2] ? leg(a[2], a[3]) / leg(a[1], a[2]) : NaN);
      ratio(a[3], a[5], a[5] && a[4] ? leg(a[4], a[5]) / leg(a[3], a[4]) : NaN);
      ratio(a[2], a[4], a[4] ? leg(a[3], a[4]) / leg(a[2], a[3]) : NaN);
      pointName(a, 1, "Drive 1");
      pointName(a, 3, "Drive 2");
      pointName(a, 5, "Drive 3");
      break;
    }
    case "elliottImpulse":
    case "elliottCorrection":
    case "elliottTriangle":
    case "elliottDouble":
    case "elliottTriple": {
      const names = { elliottImpulse: "12345", elliottCorrection: "ABC", elliottTriangle: "ABCDE", elliottDouble: "WXY", elliottTriple: "WXYXZ" }[tool];
      line(a);
      [...names].forEach((nm, i) => pointName(a, i + 1, `(${nm})`));
      break;
    }
    case "cyclicLines": {
      // The span between the points, again and again to the right.
      const span = B.logical - A.logical;
      if (span === 0) break;
      for (let k = 0; k < 400; k++) {
        const x = xOf(A.logical + span * k);
        if (x === null || (span > 0 ? x > W + 2 : x < -2)) break;
        seg(x, -FAR, x, FAR);
      }
      break;
    }
    case "timeCycles": {
      const span = B.logical - A.logical;
      if (span === 0) break;
      const ry = Math.abs(B.y - A.y) || Math.abs(B.x - A.x) / 2;
      for (let k = 0; k < 400; k++) {
        const x0 = xOf(A.logical + span * k);
        const x1 = xOf(A.logical + span * (k + 1));
        if (x0 === null || x1 === null || (span > 0 ? x0 > W + 2 : x0 < -2)) break;
        out.push({ t: "ellipse", cx: (x0 + x1) / 2, cy: A.y, rx: Math.abs(x1 - x0) / 2, ry, start: Math.PI, end: 2 * Math.PI, color, width: lw, dash, fill: area });
      }
      break;
    }
    case "sineLine": {
      // A peak at the first point, the trough after it at the second, on across the pane.
      const half = B.x - A.x;
      if (half === 0) break;
      const mid = (A.y + B.y) / 2;
      const amp = (B.y - A.y) / 2;
      const pts: Anchor[] = [];
      for (let x = -4; x <= W + 4; x += 3) pts.push({ x, y: mid - amp * Math.cos((Math.PI * (x - A.x)) / half), logical: 0, price: 0 });
      line(pts);
      break;
    }

    // ---- forecasting and measuring ----
    case "longPosition":
    case "shortPosition": {
      // Entry, target and stop (worked out at 1:1 until it's moved): the target's zone in green,
      // the stop's in red, and the risk/reward between them.
      const stopPrice = C ? C.price : 2 * A.price - B.price;
      const yS = C ? C.y : yOf(stopPrice);
      if (yS === null) break;
      let [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      if (x2 - x1 < 20) x2 = x1 + 20;
      const zone = (y0: number, y1: number, fill: string) => out.push({ t: "poly", pts: [[x1, y0], [x2, y0], [x2, y1], [x1, y1]], fill, closed: true });
      zone(A.y, B.y, o.profitColor ?? "rgba(8,153,129,0.25)");
      zone(A.y, yS, o.stopColor ?? "rgba(242,54,69,0.25)");
      seg(x1, A.y, x2, A.y, "#787B86", 1, []);
      if (o.showLabels) {
        const cx = (x1 + x2) / 2;
        const up = B.y < A.y;
        const rr = Math.abs(A.price - stopPrice) > 0 ? Math.abs(B.price - A.price) / Math.abs(A.price - stopPrice) : 0;
        tag(cx, up ? B.y - 3 : B.y + 3, `Target: ${formatPrice(B.price)} (${signed(pct(A.price, B.price), pct(A.price, B.price).toFixed(2))}%)`, "#089981", "center", up ? "bottom" : "top", "#ffffff", o.labelSize + 1);
        tag(cx, up ? yS + 3 : yS - 3, `Stop: ${formatPrice(stopPrice)} (${signed(pct(A.price, stopPrice), pct(A.price, stopPrice).toFixed(2))}%)`, "#F23645", "center", up ? "top" : "bottom", "#ffffff", o.labelSize + 1);
        tag(cx, A.y, `Risk/Reward Ratio: ${rr.toFixed(2)}`, "#787B86", "center", "middle", "#ffffff", o.labelSize + 1);
      }
      break;
    }
    case "forecast": {
      seg(A.x, A.y, B.x, B.y);
      arrowHead(B, A);
      out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: 3.5, ry: 3.5, color, width: 1, fill: color });
      const change = B.price - A.price;
      const bars = Math.round(B.logical - A.logical);
      const time = ctx.timeOf ? `, ${fmtDuration(ctx.timeOf(B.logical) - ctx.timeOf(A.logical))}` : "";
      const up = B.y <= A.y;
      tag(B.x, up ? B.y - 8 : B.y + 8, `${signed(change, formatPrice(change))} (${signed(change, pct(A.price, B.price).toFixed(2))}%)\nin ${bars} bars${time}`, change >= 0 ? "#089981" : "#F23645", "center", up ? "bottom" : "top", "#ffffff", o.labelSize + 1);
      break;
    }
    case "anchoredVwap": {
      // The volume-weighted average of each bar's typical price, from the anchored bar on.
      const bars = ctx.bars ?? [];
      const pts: Anchor[] = [];
      let pv = 0;
      let vol = 0;
      for (let i = Math.max(0, Math.round(A.logical)); i < bars.length; i++) {
        const b = bars[i];
        const v = b.volume && b.volume > 0 ? b.volume : 1;
        pv += ((b.high + b.low + b.close) / 3) * v;
        vol += v;
        const x = xOf(i);
        const y = yOf(pv / vol);
        if (x !== null && y !== null) pts.push({ x, y, logical: i, price: pv / vol });
      }
      if (pts.length > 1) line(pts);
      else out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: 3.5, ry: 3.5, color, width: 1, fill: color });
      if (pts.length && o.showLabels) text(pts[pts.length - 1].x + 4, pts[pts.length - 1].y, "VWAP", color, "left", "middle", undefined, o.labelSize);
      break;
    }
    case "volumeProfile": {
      // The volume traded in each row of price between the two times, each bar's spread evenly
      // over its range; up volume, then down, from the left edge; the busiest row's price.
      const bars = ctx.bars ?? [];
      const i0 = Math.max(0, Math.ceil(Math.min(A.logical, B.logical)));
      const i1 = Math.min(bars.length - 1, Math.floor(Math.max(A.logical, B.logical)));
      const xl = Math.min(A.x, B.x);
      const xr = Math.max(A.x, B.x);
      seg(xl, -FAR, xl, FAR, withAlpha(color, 0.35), 1, [4, 4]);
      seg(xr, -FAR, xr, FAR, withAlpha(color, 0.35), 1, [4, 4]);
      if (i1 < i0) break;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        lo = Math.min(lo, bars[i].low);
        hi = Math.max(hi, bars[i].high);
      }
      const rows = Math.max(1, Math.round(o.rows));
      const step = (hi - lo) / rows || 1;
      const up = new Array(rows).fill(0);
      const down = new Array(rows).fill(0);
      for (let i = i0; i <= i1; i++) {
        const b = bars[i];
        const v = b.volume ?? 0;
        const r0 = Math.min(rows - 1, Math.floor((b.low - lo) / step));
        const r1 = Math.min(rows - 1, Math.floor((b.high - lo) / step));
        const share = v / (r1 - r0 + 1);
        for (let r = r0; r <= r1; r++) (b.close >= b.open ? up : down)[r] += share;
      }
      const totals = up.map((u, r) => u + down[r]);
      const max = Math.max(...totals) || 1;
      const width = (xr - xl) * 0.3;
      for (let r = 0; r < rows; r++) {
        const yb = yOf(lo + step * r);
        const yt = yOf(lo + step * (r + 1));
        if (yb === null || yt === null) continue;
        const [t1, b1] = [Math.min(yt, yb) + 0.5, Math.max(yt, yb) - 0.5];
        const wu = (up[r] / max) * width;
        const wd = (down[r] / max) * width;
        out.push({ t: "poly", pts: [[xl, t1], [xl + wu, t1], [xl + wu, b1], [xl, b1]], fill: o.upColor ?? "rgba(41,98,255,0.45)", closed: true });
        out.push({ t: "poly", pts: [[xl + wu, t1], [xl + wu + wd, t1], [xl + wu + wd, b1], [xl + wu, b1]], fill: o.downColor ?? "rgba(251,192,45,0.45)", closed: true });
      }
      if (o.pocLine) {
        const poc = totals.indexOf(Math.max(...totals));
        const y = yOf(lo + step * (poc + 0.5));
        if (y !== null) seg(xl, y, xr, y, "#F23645", 1, []);
      }
      break;
    }
    case "priceRange":
    case "dateRange": {
      const prices = tool === "priceRange";
      const c = prices ? (B.price >= A.price ? "#2962FF" : "#F23645") : B.logical >= A.logical ? "#2962FF" : "#F23645";
      const [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: o.fill ? withAlpha(c, o.fillOpacity) : undefined, stroke: o.fill ? undefined : c, width: 1, closed: true });
      if (prices) {
        const xm = (x1 + x2) / 2;
        seg(xm, A.y, xm, B.y, c, 1, []);
        arrowHead({ x: xm, y: B.y }, { x: xm, y: A.y });
        const change = B.price - A.price;
        const up = B.y <= A.y;
        text(xm, up ? y1 - 4 : y2 + 4, `${signed(change, formatPrice(change))} (${signed(change, pct(A.price, B.price).toFixed(2))}%)`, o.labelBackground ? "#ffffff" : c, "center", up ? "bottom" : "top", o.labelBackground ? c : undefined, o.labelSize);
      } else {
        const ym = (y1 + y2) / 2;
        seg(A.x, ym, B.x, ym, c, 1, []);
        arrowHead({ x: B.x, y: ym }, { x: A.x, y: ym });
        const bars = Math.round(B.logical - A.logical);
        const time = ctx.timeOf ? `, ${fmtDuration(ctx.timeOf(B.logical) - ctx.timeOf(A.logical))}` : "";
        text((x1 + x2) / 2, y2 + 4, `${bars} bars${time}`, o.labelBackground ? "#ffffff" : c, "center", "top", o.labelBackground ? c : undefined, o.labelSize);
      }
      break;
    }

    // ---- shapes ----
    case "brush":
      line(a, false, undefined, lw);
      break;
    case "highlighter":
      line(a, false, undefined, lw * 5 + 6, withAlpha(color, 0.35));
      break;
    case "arrowMarker": {
      // A broad arrow: its shaft from the first point, its head at the second.
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const [ux, uy] = [(B.x - A.x) / L, (B.y - A.y) / L];
      const [nx, ny] = [-uy, ux];
      const w = 4 + lw * 2;
      const h = Math.min(L * 0.45, 26);
      const at = (along: number, across: number): [number, number] => [A.x + ux * along + nx * across, A.y + uy * along + ny * across];
      out.push({ t: "poly", pts: [at(0, -w / 2), at(L - h, -w / 2), at(L - h, -w * 1.6), [B.x, B.y], at(L - h, w * 1.6), at(L - h, w / 2), at(0, w / 2)], fill: color, closed: true });
      if (drawing.text) out.push({ t: "text", x: A.x - ux * 6, y: A.y - uy * 6, text: drawing.text, color: o.textColor ?? color, align: ux >= 0 ? "right" : "left", base: "middle", size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "arrow":
      seg(A.x, A.y, B.x, B.y);
      arrowHead(B, A);
      break;
    case "arrowUp":
    case "arrowDown": {
      // Below the bar pointing up at it, or above it pointing down.
      const d = tool === "arrowUp" ? 1 : -1;
      const tip = A.y + 4 * d;
      const w = 7 + lw;
      out.push({ t: "poly", pts: [[A.x, tip], [A.x + w, tip + 11 * d], [A.x + w / 2.4, tip + 11 * d], [A.x + w / 2.4, tip + 26 * d], [A.x - w / 2.4, tip + 26 * d], [A.x - w / 2.4, tip + 11 * d], [A.x - w, tip + 11 * d]], fill: color, closed: true });
      if (drawing.text) out.push({ t: "text", x: A.x, y: tip + 30 * d, text: drawing.text, color: o.textColor ?? color, align: "center", base: d > 0 ? "top" : "bottom", size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "rotatedRect": {
      if (!C) {
        seg(A.x, A.y, B.x, B.y);
        break;
      }
      // One side from A to B; the other at C's distance from it.
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const [nx, ny] = [-(B.y - A.y) / L, (B.x - A.x) / L];
      const d = (C.x - A.x) * nx + (C.y - A.y) * ny;
      line([A, B, { x: B.x + nx * d, y: B.y + ny * d }, { x: A.x + nx * d, y: A.y + ny * d }], true, area);
      centerText((A.x + B.x) / 2 + (nx * d) / 2, (A.y + B.y) / 2 + (ny * d) / 2);
      break;
    }
    case "path":
      line(a);
      if (a.length > 1) arrowHead(a[a.length - 1], a[a.length - 2]);
      break;
    case "polyline":
    case "triangle":
      line(a, a.length > 2, a.length > 2 ? area : undefined);
      if (a.length > 2) centerText(a.reduce((sx, q) => sx + q.x, 0) / a.length, a.reduce((sy, q) => sy + q.y, 0) / a.length);
      break;
    case "circle": {
      const r = Math.hypot(B.x - A.x, B.y - A.y);
      out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: r, ry: r, color, width: lw, dash, fill: area });
      centerText(A.x, A.y);
      break;
    }
    case "ellipse":
      out.push({ t: "ellipse", cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, rx: Math.abs(B.x - A.x) / 2, ry: Math.abs(B.y - A.y) / 2, color, width: lw, dash, fill: area });
      centerText((A.x + B.x) / 2, (A.y + B.y) / 2);
      break;
    case "arc": {
      if (!C) {
        guide(A, B);
        break;
      }
      // The circle through its ends and the point it passes, drawn the way round that passes it.
      const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
      if (Math.abs(d) < 1e-6) {
        seg(A.x, A.y, B.x, B.y);
        break;
      }
      const sq = (q: Anchor) => q.x * q.x + q.y * q.y;
      const cx = (sq(A) * (B.y - C.y) + sq(B) * (C.y - A.y) + sq(C) * (A.y - B.y)) / d;
      const cy = (sq(A) * (C.x - B.x) + sq(B) * (A.x - C.x) + sq(C) * (B.x - A.x)) / d;
      const r = Math.hypot(A.x - cx, A.y - cy);
      const ang = (q: Anchor) => Math.atan2(q.y - cy, q.x - cx);
      const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const [aA, aB, aC] = [ang(A), ang(B), ang(C)];
      const passes = norm(aC - aA) < norm(aB - aA);
      const [s0, sweep] = passes ? [aA, norm(aB - aA)] : [aB, norm(aA - aB)];
      out.push({ t: "ellipse", cx, cy, rx: r, ry: r, start: s0, end: s0 + sweep, color, width: lw, dash, fill: area });
      break;
    }
    case "curve":
    case "doubleCurve": {
      // A Bézier curve between the ends, bent towards the other point(s).
      const D = a[3];
      if (!C) {
        seg(A.x, A.y, B.x, B.y);
        break;
      }
      const pts: Anchor[] = [];
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        const u = 1 - t;
        const [x, y] =
          tool === "doubleCurve" && D
            ? [u * u * u * A.x + 3 * u * u * t * C.x + 3 * u * t * t * D.x + t * t * t * B.x, u * u * u * A.y + 3 * u * u * t * C.y + 3 * u * t * t * D.y + t * t * t * B.y]
            : [u * u * A.x + 2 * u * t * C.x + t * t * B.x, u * u * A.y + 2 * u * t * C.y + t * t * B.y];
        pts.push({ x, y, logical: 0, price: 0 });
      }
      line(pts);
      break;
    }

    // ---- annotations ----
    case "note": {
      const bg = noteBg ?? color;
      out.push({ t: "poly", pts: [[A.x - 7, A.y - 8], [A.x + 4, A.y - 8], [A.x + 7, A.y - 5], [A.x + 7, A.y + 8], [A.x - 7, A.y + 8]], fill: bg, closed: true });
      seg(A.x - 4, A.y - 3, A.x + 4, A.y - 3, "#ffffff", 1, []);
      seg(A.x - 4, A.y + 1, A.x + 4, A.y + 1, "#ffffff", 1, []);
      seg(A.x - 4, A.y + 5, A.x + 1, A.y + 5, "#ffffff", 1, []);
      if (drawing.text) out.push({ t: "text", x: A.x + 13, y: A.y, text: drawing.text, color: noteFg, align: "left", base: "middle", bg: noteBg, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "priceNote": {
      out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: 3, ry: 3, color, width: 1, fill: color });
      seg(A.x, A.y, B.x, B.y);
      const label = drawing.text ? `${formatPrice(A.price)}  ${drawing.text}` : formatPrice(A.price);
      out.push({ t: "text", x: B.x, y: B.y, text: label, color: o.textColor ?? "#ffffff", align: B.x >= A.x ? "left" : "right", base: "middle", bg: color, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "pin": {
      const bg = noteBg ?? color;
      seg(A.x, A.y, A.x, A.y - 12, bg, 2, []);
      out.push({ t: "ellipse", cx: A.x, cy: A.y - 18, rx: 7, ry: 7, color: bg, width: 1, fill: bg });
      out.push({ t: "ellipse", cx: A.x, cy: A.y - 18, rx: 2.5, ry: 2.5, color: "#ffffff", width: 1, fill: "#ffffff" });
      if (drawing.text) out.push({ t: "text", x: A.x, y: A.y - 29, text: drawing.text, color: noteFg, align: "center", base: "bottom", bg: noteBg, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "callout": {
      // A box of text at the second point, its pointer at the first.
      out.push({ t: "poly", pts: [[A.x, A.y], [B.x - 7, B.y], [B.x + 7, B.y]], fill: noteBg ?? color, closed: true });
      out.push({ t: "text", x: B.x, y: B.y, text: drawing.text || "Text", color: noteFg, align: "center", base: "middle", bg: noteBg, border: noteBg ? undefined : color, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "priceLabel": {
      out.push({ t: "poly", pts: [[A.x, A.y], [A.x + 5, A.y - 9], [A.x + 13, A.y - 9]], fill: noteBg ?? color, closed: true });
      const label = drawing.text ? `${formatPrice(A.price)}  ${drawing.text}` : formatPrice(A.price);
      out.push({ t: "text", x: A.x + 2, y: A.y - 8, text: label, color: noteFg, align: "left", base: "bottom", bg: noteBg, border: noteBg ? undefined : color, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "signpost": {
      const bg = noteBg ?? color;
      seg(A.x, A.y, A.x, A.y - 40, bg, 2, []);
      out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: 3, ry: 3, color: bg, width: 1, fill: bg });
      out.push({ t: "text", x: A.x, y: A.y - 40, text: drawing.text || "Text", color: noteFg, align: "center", base: "bottom", bg: noteBg, border: noteBg ? undefined : color, size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }
    case "flagMark": {
      const bg = noteBg ?? color;
      seg(A.x, A.y, A.x, A.y - 26, bg, 2, []);
      out.push({ t: "poly", pts: [[A.x, A.y - 26], [A.x + 17, A.y - 20.5], [A.x, A.y - 15]], fill: bg, closed: true });
      if (drawing.text) out.push({ t: "text", x: A.x + 20, y: A.y - 20, text: drawing.text, color: o.textColor ?? bg, align: "left", base: "middle", size: o.fontSize, bold: o.bold, italic: o.italic });
      break;
    }

    case "rect": {
      // Extended, its sides run on past the pane's edges.
      const x1 = o.extendLeft ? -FAR : Math.min(A.x, B.x);
      const x2 = o.extendRight ? W + FAR : Math.max(A.x, B.x);
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      const fill = o.fill ? (o.fillColor ?? withAlpha(color, o.fillOpacity)) : undefined;
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill, stroke: color, width: lw, dash, closed: true });
      const ym = (y1 + y2) / 2;
      if (o.middleLine) seg(x1, ym, x2, ym, o.middleColor ?? color, o.middleWidth, DASH[o.middleDash]);
      if (drawing.text) {
        // Placed in the part of the box on screen.
        const [l, r] = [Math.max(x1, 0), Math.min(x2, W)];
        const x = o.textHAlign === "left" ? l + 6 : o.textHAlign === "right" ? r - 6 : (l + r) / 2;
        const y = o.textVAlign === "top" ? y1 + 4 : o.textVAlign === "bottom" ? y2 - 4 : ym;
        const base = o.textVAlign === "top" ? "top" : o.textVAlign === "bottom" ? "bottom" : "middle";
        out.push({ t: "text", x, y, text: drawing.text, color: o.textColor ?? color, align: o.textHAlign, base, size: o.fontSize, bold: o.bold, italic: o.italic });
      }
      break;
    }

    case "text":
      out.push({
        t: "text",
        x: A.x,
        y: A.y,
        text: drawing.text || "Text",
        color,
        align: "left",
        base: "middle",
        bg: o.textBackground ? (o.textBgColor ?? "rgba(10,10,10,0.6)") : undefined,
        border: o.textBorder ? (o.textBorderColor ?? color) : undefined,
        size: o.fontSize,
        bold: o.bold,
        italic: o.italic,
      });
      break;

    case "measure": {
      const up = B.price >= A.price;
      const c = up ? "#2962FF" : "#F23645";
      const [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: o.fill ? withAlpha(c, o.fillOpacity) : undefined, stroke: o.fill ? undefined : c, width: 1, closed: true });
      seg((x1 + x2) / 2, A.y, (x1 + x2) / 2, B.y, c, 1, []);
      seg(A.x, (y1 + y2) / 2, B.x, (y1 + y2) / 2, c, 1, []);
      const change = B.price - A.price;
      const pct = A.price !== 0 ? (change / A.price) * 100 : 0;
      const bars = Math.round(B.logical - A.logical);
      const time = ctx.timeOf ? `, ${fmtDuration(ctx.timeOf(B.logical) - ctx.timeOf(A.logical))}` : "";
      text(
        (x1 + x2) / 2,
        up ? y1 - 4 : y2 + 4,
        `${change >= 0 ? "+" : ""}${formatPrice(change)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)\n${bars} bars${time}`,
        o.labelBackground ? "#ffffff" : c,
        "center",
        up ? "bottom" : "top",
        o.labelBackground ? c : undefined,
        o.labelSize
      );
      break;
    }
  }
  return out;
}

/** A text shape's box in its own (unturned) frame, about its anchor: approximate, for picking. */
export function textBox(s: TextShape): { x0: number; y0: number; w: number; h: number } {
  const size = s.size ?? 12;
  const lines = s.text.split("\n");
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.6 + 8;
  const h = lines.length * size * 1.25 + 4;
  const x0 = s.align === "right" ? -w + 4 : s.align === "center" ? -w / 2 : -4;
  const y0 = s.base === "top" ? 0 : s.base === "bottom" ? -h : -h / 2;
  return { x0, y0, w, h };
}

/** How far (px) a point is from a shape, for picking a drawing under the pointer. */
export function distanceTo(shape: Shape, px: number, py: number): number {
  const toSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
  };
  switch (shape.t) {
    case "seg":
      return toSeg(shape.x1, shape.y1, shape.x2, shape.y2);
    case "poly": {
      const p = shape.pts;
      if (shape.fill && shape.closed && inside(p, px, py)) return 0;
      let d = Infinity;
      for (let i = 0; i + 1 < p.length; i++) d = Math.min(d, toSeg(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
      if (shape.closed && p.length > 2) d = Math.min(d, toSeg(p[p.length - 1][0], p[p.length - 1][1], p[0][0], p[0][1]));
      return d;
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      if (rx <= 0 || ry <= 0) return Infinity;
      if (shape.fill && ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1) return 0;
      const ang = Math.atan2((py - cy) / ry, (px - cx) / rx);
      const norm = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const s = shape.start ?? 0;
      const e = shape.end ?? 2 * Math.PI;
      if (e - s < 2 * Math.PI - 1e-9) {
        const a = norm(ang - s);
        if (a > e - s) return Infinity;
      }
      return Math.hypot(px - (cx + rx * Math.cos(ang)), py - (cy + ry * Math.sin(ang)));
    }
    case "text": {
      // The point in the text's own frame (turned back by its angle).
      const [dx, dy] = [px - shape.x, py - shape.y];
      const an = shape.angle ?? 0;
      const [tx, ty] = [dx * Math.cos(an) + dy * Math.sin(an), -dx * Math.sin(an) + dy * Math.cos(an)];
      const b = textBox(shape);
      return tx >= b.x0 && tx <= b.x0 + b.w && ty >= b.y0 && ty <= b.y0 + b.h ? 0 : Infinity;
    }
  }
}

function inside(pts: Array<[number, number]>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export type { HAlign, VAlign };
