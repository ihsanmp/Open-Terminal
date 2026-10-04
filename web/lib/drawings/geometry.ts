// What each drawing tool draws, in screen pixels, from its anchors: lines, fills, ellipses and
// labels, with TradingView's levels and colors unless its Settings changed them (the levels shown,
// their values and colors, the background, extending, labels, line ends, stats, text …). Pure, so
// the shapes can be tested and hit-tested.
//
// Levels that are prices (a Fibonacci retracement) are worked out in price and then placed, so they
// stay right on a logarithmic scale; those that are times (time zones) in the chart's bar index.

import type { DrawLevel, Drawing, DrawingOptions, HAlign, ToolId, VAlign } from "./tools";

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
};

const FAR = 20_000;
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
    default:
      return null;
  }
}

/** A Gann angle as written: 2 → 2/1, 0.25 → 1/4. */
export const gannLabel = (k: number) => (k >= 1 ? `${+k.toFixed(3)}/1` : `1/${+(1 / k).toFixed(3)}`);

/** Options without a default of their own: unset means "the drawing's color" (or none). */
type Unset = "levels" | "oneColor" | "fillColor" | "trendColor" | "middleColor" | "textColor" | "textBgColor" | "textBorderColor";
export type ResolvedOptions = Required<Omit<DrawingOptions, Unset>> & Pick<DrawingOptions, Unset> & { levels: DrawLevel[] };

const FILL_OPACITY: Partial<Record<ToolId, number>> = {
  channel: 0.12, rect: 0.15, gannBox: 0.06, gannSquare: 0.06, gannSquareFixed: 0.06, fibChannel: 0.08,
  fibSpeedFan: 0.08, pitchfan: 0.08, gannFan: 0.08, fibTimeZone: 0.08, fibTrendTime: 0.08, measure: 0.18,
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
    timeLabel: o?.timeLabel ?? false,
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
  if (a.length === 0) return out;
  const [A, B, C] = a;

  // While placing, a tool with more points shows what it has so far.
  if (a.length < 2 && !["hline", "hray", "vline", "text"].includes(tool)) return out;

  switch (tool) {
    case "trend":
    case "ray":
    case "extended": {
      // A ray is a trend line extended right; an extended line, both ways.
      const extL = tool === "extended" || o.extendLeft;
      const extR = tool !== "trend" || o.extendRight;
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
