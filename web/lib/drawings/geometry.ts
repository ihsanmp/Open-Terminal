// What each drawing tool draws, in screen pixels, from its anchors: lines, fills, ellipses and
// labels, with TradingView's levels and colors unless its Settings changed them (the levels shown,
// their values and colors, the background, extending, labels …). Pure, so the shapes can be tested
// and hit-tested.
//
// Levels that are prices (a Fibonacci retracement) are worked out in price and then placed, so they
// stay right on a logarithmic scale; those that are times (time zones) in the chart's bar index.

import type { DrawLevel, Drawing, DrawingOptions, ToolId } from "./tools";

export type Anchor = { x: number; y: number; logical: number; price: number };

export type Shape =
  | { t: "seg"; x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dash?: number[] }
  | { t: "poly"; pts: Array<[number, number]>; fill?: string; stroke?: string; width?: number; dash?: number[]; closed?: boolean }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; start?: number; end?: number; color: string; width?: number; dash?: number[] }
  | { t: "text"; x: number; y: number; text: string; color: string; align?: "left" | "right" | "center"; base?: "top" | "middle" | "bottom"; bg?: string; size?: number };

export type GeometryContext = {
  anchors: Anchor[];
  /** The pane's size. */
  width: number;
  height: number;
  xOf: (logical: number) => number | null;
  yOf: (price: number) => number | null;
  formatPrice: (price: number) => string;
  drawing: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio" | "options">;
};

const FAR = 20_000;
const DASH: Record<string, number[]> = { solid: [], dashed: [6, 4], dotted: [1, 3] };

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

/** A drawing's options with each one's default for its tool filled in. */
export function optionsOf(tool: ToolId, o: DrawingOptions | undefined): Required<Omit<DrawingOptions, "levels">> & { levels: DrawLevel[] } {
  const opacity: Partial<Record<ToolId, number>> = { channel: 0.12, rect: 0.15, gannBox: 0.06, gannSquare: 0.06, gannSquareFixed: 0.06 };
  return {
    levels: o?.levels ?? defaultLevels(tool) ?? [],
    fill: o?.fill ?? true,
    fillOpacity: o?.fillOpacity ?? opacity[tool] ?? (tool === "fibChannel" ? 0.08 : 0.1),
    extendLeft: o?.extendLeft ?? false,
    extendRight: o?.extendRight ?? false,
    reverse: o?.reverse ?? false,
    showLevels: o?.showLevels ?? true,
    showPrices: o?.showPrices ?? true,
    middleLine: o?.middleLine ?? true,
    priceLabel: o?.priceLabel ?? true,
    fontSize: o?.fontSize ?? 14,
    textBackground: o?.textBackground ?? true,
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

/** The shapes of a drawing (or of one being placed: fewer anchors than its tool needs). */
export function shapesFor(tool: ToolId, ctx: GeometryContext): Shape[] {
  const { anchors: a, width: W, height: H, xOf, yOf, formatPrice, drawing } = ctx;
  const color = drawing.color;
  const lw = drawing.width;
  const dash = DASH[drawing.dash ?? "solid"];
  const o = optionsOf(tool, drawing.options);
  const levels = o.levels.filter((l) => l.visible);
  const fillA = (c: string) => (o.fill ? withAlpha(c, o.fillOpacity) : undefined);
  const out: Shape[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number, c = color, w = lw, d = dash) => out.push({ t: "seg", x1, y1, x2, y2, color: c, width: w, dash: d });
  const guide = (p: Anchor, q: Anchor) => seg(p.x, p.y, q.x, q.y, withAlpha(color, 0.8), 1, [4, 4]);
  const text = (x: number, y: number, s: string, c = color, align: "left" | "right" | "center" = "left", base: "top" | "middle" | "bottom" = "bottom", bg?: string, size?: number) =>
    out.push({ t: "text", x, y, text: s, color: c, align, base, bg, size });
  const label = (l: number, price?: number) =>
    [o.showLevels ? fmtLevel(l) : "", o.showPrices && price !== undefined ? `(${formatPrice(price)})` : ""].filter(Boolean).join(" ");
  const band = (pts: Array<[number, number]>, c: string) => {
    const f = fillA(c);
    if (f) out.push({ t: "poly", pts, fill: f, closed: true });
  };
  if (a.length === 0) return out;
  const [A, B, C] = a;

  // While placing, a tool with more points shows what it has so far.
  if (a.length < 2 && !["hline", "hray", "vline", "text"].includes(tool)) return out;

  switch (tool) {
    case "trend": {
      const [x1, y1, x2, y2] = extendSeg(A.x, A.y, B.x, B.y, o.extendLeft, o.extendRight);
      seg(x1, y1, x2, y2);
      break;
    }
    case "ray": {
      const [x1, y1, x2, y2] = ray(A.x, A.y, B.x, B.y);
      seg(x1, y1, x2, y2);
      break;
    }
    case "extended": {
      const [x1, y1, x2, y2] = ray(A.x, A.y, B.x, B.y, true);
      seg(x1, y1, x2, y2);
      break;
    }
    case "hline":
    case "hray":
      seg(tool === "hline" ? -FAR : A.x, A.y, FAR, A.y);
      if (o.priceLabel) text(W - 4, A.y - 2, formatPrice(A.price), color, "right");
      break;
    case "vline":
      seg(A.x, -FAR, A.x, FAR);
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
      band([[bx1, by1], [bx2, by2], [px2, py2], [px1, py1]], color);
      seg(px1, py1, px2, py2);
      if (o.middleLine && ma !== null && mb !== null) {
        const [mx1, my1, mx2, my2] = extendSeg(A.x, ma, B.x, mb, o.extendLeft, o.extendRight);
        seg(mx1, my1, mx2, my2, withAlpha(color, 0.8), 1, [6, 4]);
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
      const labelX = o.extendLeft ? 4 : x1 - 4;
      for (const { l, price, y } of ys) {
        if (y === null) continue;
        seg(x1, y, x2, y, l.color, lw, []);
        const s = label(l.value, price);
        if (s) text(labelX, y, s, l.color, o.extendLeft ? "left" : "right", o.extendLeft ? "bottom" : "middle");
      }
      if (ext) {
        guide(A, B);
        guide(B, C);
      } else guide(A, B);
      break;
    }

    case "fibChannel": {
      seg(A.x, A.y, B.x, B.y, color, lw, []);
      if (!C) break;
      const slope = B.logical === A.logical ? 0 : (B.price - A.price) / (B.logical - A.logical);
      const offset = C.price - (A.price + slope * (C.logical - A.logical));
      const lines = levels.map((l) => {
        const ya = yOf(A.price + offset * l.value);
        const yb = yOf(B.price + offset * l.value);
        if (ya === null || yb === null) return null;
        const [x1, y1, x2, y2] = ray(A.x, ya, B.x, yb);
        return { l, x1, y1, x2, y2 };
      });
      const sorted = lines.filter((v): v is NonNullable<typeof v> => v !== null).sort((p, q) => p.l.value - q.l.value);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const [p, q] = [sorted[i], sorted[i + 1]];
        band([[p.x1, p.y1], [p.x2, p.y2], [q.x2, q.y2], [q.x1, q.y1]], q.l.color);
      }
      for (const ln of sorted) {
        seg(ln.x1, ln.y1, ln.x2, ln.y2, ln.l.color, lw, []);
        if (o.showLevels) text(ln.x1 - 4, ln.y1, fmtLevel(ln.l.value), ln.l.color, "right", "middle");
      }
      break;
    }

    case "fibTimeZone":
    case "fibTrendTime": {
      const trend = tool === "fibTrendTime";
      if (trend && !C) {
        guide(A, B);
        break;
      }
      const base = trend ? C.logical : A.logical;
      const span = B.logical - A.logical;
      for (const l of levels) {
        const x = xOf(base + span * l.value);
        if (x === null) continue;
        seg(x, -FAR, x, FAR, l.color, lw, []);
        if (o.showLevels) text(x + 3, H - 4, fmtLevel(l.value), l.color, "left", "bottom");
      }
      if (trend) {
        guide(A, B);
        guide(B, C);
      }
      break;
    }

    case "fibSpeedFan": {
      // Rays from A through the price divisions at B's time, and the time divisions at B's price.
      for (const l of levels) {
        const y = yOf(A.price + (B.price - A.price) * l.value);
        const x = xOf(A.logical + (B.logical - A.logical) * l.value);
        if (y !== null) seg(A.x, y, B.x, y, withAlpha(l.color, 0.5), 1, []);
        if (x !== null) seg(x, A.y, x, B.y, withAlpha(l.color, 0.5), 1, []);
        if (l.value === 0) continue;
        if (y !== null) {
          const [x1, y1, x2, y2] = ray(A.x, A.y, B.x, y);
          seg(x1, y1, x2, y2, l.color, lw, []);
          if (o.showLevels) text(B.x + 4, y, fmtLevel(l.value), l.color, "left", "middle");
        }
        if (x !== null && l.value !== 1) {
          const [x1, y1, x2, y2] = ray(A.x, A.y, x, B.y);
          seg(x1, y1, x2, y2, l.color, lw, []);
        }
      }
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
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: rx * l.value, ry: ry * l.value, start, end, color: l.color, width: lw });
        if (o.showLevels) text(A.x + rx * l.value + 3, A.y, fmtLevel(l.value), l.color, "left", "middle");
      }
      guide(A, B);
      break;
    }

    case "fibSpiral": {
      // A golden spiral through B: its radius grows by φ every quarter turn.
      const phi = (1 + Math.sqrt(5)) / 2;
      const r0 = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const t0 = Math.atan2(B.y - A.y, B.x - A.x);
      const pts: Array<[number, number]> = [];
      for (let k = -32; k <= 40; k++) {
        const th = (k / 8) * Math.PI;
        const r = r0 * phi ** ((th * 2) / Math.PI);
        if (r > FAR) break;
        pts.push([A.x + r * Math.cos(t0 + th), A.y + r * Math.sin(t0 + th)]);
      }
      out.push({ t: "poly", pts, stroke: color, width: lw });
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
      seg(A.x, A.y, A.x + r * Math.cos(a1), A.y + r * Math.sin(a1), color, lw, []);
      seg(A.x, A.y, A.x + r * Math.cos(a2), A.y + r * Math.sin(a2), color, lw, []);
      for (const l of levels) {
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: r * l.value, ry: r * l.value, start: s, end: e, color: l.color, width: lw });
        if (o.showLevels) text(A.x + r * l.value * Math.cos(s), A.y + r * l.value * Math.sin(s) - 2, fmtLevel(l.value), l.color, "left", "bottom");
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
      const rayTo = (x: number, y: number, c: string) => {
        const [x1, y1, x2, y2] = ray(A.x, A.y, x, y);
        seg(x1, y1, x2, y2, c, lw, []);
      };
      rayTo(mx, my, color);
      for (const l of levels) {
        rayTo(mx + (B.x - mx) * l.value, my + (B.y - my) * l.value, l.color);
        rayTo(mx + (C.x - mx) * l.value, my + (C.y - my) * l.value, l.color);
      }
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
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: fillA(color), stroke: color, width: lw, closed: true });
      const box = tool === "gannBox";
      for (const l of levels) {
        const y = y1 + (y2 - y1) * l.value;
        const x = x1 + (x2 - x1) * l.value;
        seg(x1, y, x2, y, withAlpha(l.color, 0.7), 1, box ? [] : [4, 4]);
        seg(x, y1, x, y2, withAlpha(l.color, 0.7), 1, box ? [] : [4, 4]);
        if (box && o.showLevels) {
          text(x1 - 3, y, fmtLevel(l.value), l.color, "right", "middle");
          text(x, y2 + 3, fmtLevel(l.value), l.color, "center", "top");
        }
      }
      seg(x1, y1, x2, y2, withAlpha(color, 0.8), 1, []);
      seg(x1, y2, x2, y1, withAlpha(color, 0.8), 1, []);
      if (!box) {
        // Gann's square: arcs from the anchored corner and its fan to the far sides' divisions.
        const ox = A.x;
        const oy = A.y;
        const rx = Math.abs(bx - ox);
        const ry = Math.abs(by - oy);
        const sx = Math.sign(bx - ox) || 1;
        const sy = Math.sign(by - oy) || 1;
        const quarter = sx > 0 ? (sy > 0 ? [0, Math.PI / 2] : [-Math.PI / 2, 0]) : sy > 0 ? [Math.PI / 2, Math.PI] : [Math.PI, 1.5 * Math.PI];
        for (const l of [0.5, 1]) out.push({ t: "ellipse", cx: ox, cy: oy, rx: rx * l, ry: ry * l, start: quarter[0], end: quarter[1], color: withAlpha(color, 0.8), width: 1 });
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
      for (const l of levels) {
        const y = yOf(A.price + dp * l.value);
        if (y === null || xb === null) continue;
        const [x1, y1, x2, y2] = ray(A.x, A.y, xb, y);
        seg(x1, y1, x2, y2, l.color, lw, []);
        if (o.showLevels) text(xb + 4, y, gannLabel(l.value), l.color, "left", "middle");
      }
      break;
    }

    case "rect": {
      const [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: fillA(color), stroke: color, width: lw, dash, closed: true });
      break;
    }

    case "text":
      text(A.x, A.y, drawing.text || "Text", color, "left", "middle", o.textBackground ? "rgba(10,10,10,0.6)" : undefined, o.fontSize);
      break;

    case "measure": {
      const up = B.price >= A.price;
      const c = up ? "#2962FF" : "#F23645";
      const [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: withAlpha(c, 0.18), closed: true });
      seg((x1 + x2) / 2, A.y, (x1 + x2) / 2, B.y, c, 1, []);
      seg(A.x, (y1 + y2) / 2, B.x, (y1 + y2) / 2, c, 1, []);
      const change = B.price - A.price;
      const pct = A.price !== 0 ? (change / A.price) * 100 : 0;
      const bars = Math.round(B.logical - A.logical);
      text((x1 + x2) / 2, up ? y1 - 4 : y2 + 4, `${change >= 0 ? "+" : ""}${formatPrice(change)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · ${bars} bars`, "#ffffff", "center", up ? "bottom" : "top", c);
      break;
    }
  }
  return out;
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
      const size = shape.size ?? 12;
      const w = shape.text.length * size * 0.6;
      const x0 = shape.align === "right" ? shape.x - w : shape.align === "center" ? shape.x - w / 2 : shape.x;
      const y0 = shape.base === "bottom" ? shape.y - size - 2 : shape.base === "top" ? shape.y : shape.y - size / 2 - 1;
      return px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + size + 2 ? 0 : Infinity;
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
