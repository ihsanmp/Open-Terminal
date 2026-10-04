// What each drawing tool draws, in screen pixels, from its anchors: lines, fills, ellipses and
// labels, with TradingView's levels and colors. Pure, so the shapes can be tested and hit-tested.
//
// Levels that are prices (a Fibonacci retracement) are worked out in price and then placed, so they
// stay right on a logarithmic scale; those that are times (time zones) in the chart's bar index.

import type { Drawing, ToolId } from "./tools";

export type Anchor = { x: number; y: number; logical: number; price: number };

export type Shape =
  | { t: "seg"; x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dash?: number[] }
  | { t: "poly"; pts: Array<[number, number]>; fill?: string; stroke?: string; width?: number; dash?: number[]; closed?: boolean }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; start?: number; end?: number; color: string; width?: number; dash?: number[] }
  | { t: "text"; x: number; y: number; text: string; color: string; align?: "left" | "right" | "center"; base?: "top" | "middle" | "bottom"; bg?: string };

export type GeometryContext = {
  anchors: Anchor[];
  /** The pane's size. */
  width: number;
  height: number;
  xOf: (logical: number) => number | null;
  yOf: (price: number) => number | null;
  formatPrice: (price: number) => string;
  drawing: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio">;
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
const fibColor = (l: number) => FIB_COLOR[String(l)] ?? "#787B86";

const RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
const CIRCLE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];
const ARC_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FAN_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
const TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const TREND_TIME = [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3];
const GANN_LEVELS = [0.25, 0.382, 0.5, 0.618, 0.75];
const GANN_FAN: Array<[number, string, string]> = [
  [8, "8/1", "#FF9800"], [4, "4/1", "#089981"], [3, "3/1", "#4CAF50"], [2, "2/1", "#00BCD4"], [1, "1/1", "#2962FF"],
  [1 / 2, "1/2", "#00BCD4"], [1 / 3, "1/3", "#4CAF50"], [1 / 4, "1/4", "#089981"], [1 / 8, "1/8", "#FF9800"],
];

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

const fmtLevel = (l: number) => String(+l.toFixed(3));

/** The shapes of a drawing (or of one being placed: fewer anchors than its tool needs). */
export function shapesFor(tool: ToolId, ctx: GeometryContext): Shape[] {
  const { anchors: a, width: W, height: H, xOf, yOf, formatPrice, drawing } = ctx;
  const color = drawing.color;
  const lw = drawing.width;
  const dash = DASH[drawing.dash ?? "solid"];
  const out: Shape[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number, c = color, w = lw, d = dash) => out.push({ t: "seg", x1, y1, x2, y2, color: c, width: w, dash: d });
  const guide = (p: Anchor, q: Anchor) => seg(p.x, p.y, q.x, q.y, withAlpha(color, 0.8), 1, [4, 4]);
  const text = (x: number, y: number, s: string, c = color, align: "left" | "right" | "center" = "left", base: "top" | "middle" | "bottom" = "bottom", bg?: string) =>
    out.push({ t: "text", x, y, text: s, color: c, align, base, bg });
  if (a.length === 0) return out;
  const [A, B, C] = a;

  // While placing, a tool with more points shows what it has so far.
  if (a.length < 2 && !["hline", "hray", "vline", "text"].includes(tool)) return out;

  switch (tool) {
    case "trend":
      seg(A.x, A.y, B.x, B.y);
      break;
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
      seg(-FAR, A.y, FAR, A.y);
      text(W - 4, A.y - 2, formatPrice(A.price), color, "right");
      break;
    case "hray":
      seg(A.x, A.y, FAR, A.y);
      text(W - 4, A.y - 2, formatPrice(A.price), color, "right");
      break;
    case "vline":
      seg(A.x, -FAR, A.x, FAR);
      break;
    case "channel": {
      seg(A.x, A.y, B.x, B.y);
      if (!C) break;
      // The parallel through the third point, at the same price offset all along.
      const slope = B.logical === A.logical ? 0 : (B.price - A.price) / (B.logical - A.logical);
      const offset = C.price - (A.price + slope * (C.logical - A.logical));
      const ya = yOf(A.price + offset);
      const yb = yOf(B.price + offset);
      const ma = yOf(A.price + offset / 2);
      const mb = yOf(B.price + offset / 2);
      if (ya === null || yb === null) break;
      out.push({ t: "poly", pts: [[A.x, A.y], [B.x, B.y], [B.x, yb], [A.x, ya]], fill: withAlpha(color, 0.12), closed: true });
      seg(A.x, ya, B.x, yb);
      if (ma !== null && mb !== null) seg(A.x, ma, B.x, mb, withAlpha(color, 0.8), 1, [6, 4]);
      break;
    }

    case "fibRetracement":
    case "fibExtension": {
      // Retracement: 1 at the move's start, 0 at its end. Extension: the move A→B laid off from C.
      const ext = tool === "fibExtension";
      if (ext && !C) {
        guide(A, B);
        break;
      }
      const from = ext ? C : B;
      const span = ext ? B.price - A.price : A.price - B.price;
      const x1 = ext ? C.x : Math.min(A.x, B.x);
      const x2 = ext ? C.x + Math.max(60, Math.abs(B.x - A.x)) : Math.max(A.x, B.x);
      const ys = RETRACEMENT.map((l) => ({ l, price: from.price + span * l, y: yOf(from.price + span * l) }));
      for (let i = 0; i + 1 < ys.length; i++) {
        const [p, q] = [ys[i], ys[i + 1]];
        if (p.y === null || q.y === null) continue;
        out.push({ t: "poly", pts: [[x1, p.y], [x2, p.y], [x2, q.y], [x1, q.y]], fill: withAlpha(fibColor(q.l), 0.1), closed: true });
      }
      for (const { l, price, y } of ys) {
        if (y === null) continue;
        seg(x1, y, x2, y, fibColor(l), lw, []);
        text(x1 - 4, y, `${fmtLevel(l)} (${formatPrice(price)})`, fibColor(l), "right", "middle");
      }
      if (ext) {
        guide(A, B);
        guide(B, C);
      } else guide(A, B);
      break;
    }

    case "fibChannel": {
      seg(A.x, A.y, B.x, B.y, fibColor(0), lw, []);
      if (!C) break;
      const slope = B.logical === A.logical ? 0 : (B.price - A.price) / (B.logical - A.logical);
      const offset = C.price - (A.price + slope * (C.logical - A.logical));
      const lines = RETRACEMENT.map((l) => {
        const ya = yOf(A.price + offset * l);
        const yb = yOf(B.price + offset * l);
        if (ya === null || yb === null) return null;
        const [x1, y1, x2, y2] = ray(A.x, ya, B.x, yb);
        return { l, x1, y1, x2, y2 };
      });
      for (let i = 0; i + 1 < lines.length; i++) {
        const [p, q] = [lines[i], lines[i + 1]];
        if (!p || !q) continue;
        out.push({ t: "poly", pts: [[p.x1, p.y1], [p.x2, p.y2], [q.x2, q.y2], [q.x1, q.y1]], fill: withAlpha(fibColor(q.l), 0.08), closed: true });
      }
      for (const ln of lines) {
        if (!ln) continue;
        seg(ln.x1, ln.y1, ln.x2, ln.y2, fibColor(ln.l), lw, []);
        text(ln.x1 - 4, ln.y1, fmtLevel(ln.l), fibColor(ln.l), "right", "middle");
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
      for (const l of trend ? TREND_TIME : TIME_ZONES) {
        const x = xOf(base + span * l);
        if (x === null) continue;
        const c = trend ? fibColor(l) : color;
        seg(x, -FAR, x, FAR, c, lw, []);
        text(x + 3, H - 4, trend ? fmtLevel(l) : String(l), c, "left", "bottom");
      }
      if (trend) {
        guide(A, B);
        guide(B, C);
      }
      break;
    }

    case "fibSpeedFan": {
      // Rays from A through the price divisions at B's time, and the time divisions at B's price.
      const xs = FAN_LEVELS.map((l) => xOf(A.logical + (B.logical - A.logical) * l));
      const ys = FAN_LEVELS.map((l) => yOf(A.price + (B.price - A.price) * l));
      FAN_LEVELS.forEach((l, i) => {
        const y = ys[i];
        const x = xs[i];
        if (y !== null) seg(A.x, y, B.x, y, withAlpha(fibColor(l), 0.5), 1, []);
        if (x !== null) seg(x, A.y, x, B.y, withAlpha(fibColor(l), 0.5), 1, []);
        if (l === 0) return;
        if (y !== null) {
          const [x1, y1, x2, y2] = ray(A.x, A.y, B.x, y);
          seg(x1, y1, x2, y2, fibColor(l), lw, []);
          text(B.x + 4, y, fmtLevel(l), fibColor(l), "left", "middle");
        }
        if (x !== null && l !== 1) {
          const [x1, y1, x2, y2] = ray(A.x, A.y, x, B.y);
          seg(x1, y1, x2, y2, fibColor(l), lw, []);
        }
      });
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
      // Arcs open away from B: the half of each ellipse on B's side of A.
      const [start, end] = arcs ? (B.y < A.y ? [Math.PI, 2 * Math.PI] : [0, Math.PI]) : [0, 2 * Math.PI];
      for (const l of arcs ? ARC_LEVELS : CIRCLE_LEVELS) {
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: rx * l, ry: ry * l, start, end, color: fibColor(l), width: lw });
        text(A.x + rx * l + 3, A.y, fmtLevel(l), fibColor(l), "left", "middle");
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
        const th = (k / 8) * Math.PI; // eight steps a half turn
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
      for (const l of ARC_LEVELS) {
        out.push({ t: "ellipse", cx: A.x, cy: A.y, rx: r * l, ry: r * l, start: s, end: e, color: fibColor(l), width: lw });
        text(A.x + r * l * Math.cos(s), A.y + r * l * Math.sin(s) - 2, fmtLevel(l), fibColor(l), "left", "bottom");
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
      for (const l of [0.382, 0.5, 0.618, 1]) {
        rayTo(mx + (B.x - mx) * l, my + (B.y - my) * l, fibColor(l));
        rayTo(mx + (C.x - mx) * l, my + (C.y - my) * l, fibColor(l));
      }
      break;
    }

    case "gannBox":
    case "gannSquare":
    case "gannSquareFixed": {
      let bx = B.x;
      let by = B.y;
      // Fixed: keeps the price per bar it was drawn with, so it stays a square in chart terms.
      if (tool === "gannSquareFixed" && drawing.ratio) {
        const dl = B.logical - A.logical;
        const price = A.price + Math.sign(B.price - A.price || 1) * Math.abs(dl) * drawing.ratio;
        by = yOf(price) ?? B.y;
      }
      const [x1, x2] = [Math.min(A.x, bx), Math.max(A.x, bx)];
      const [y1, y2] = [Math.min(A.y, by), Math.max(A.y, by)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: withAlpha(color, 0.06), stroke: color, width: lw, closed: true });
      const levels = tool === "gannBox" ? GANN_LEVELS : [0.25, 0.5, 0.75];
      for (const l of levels) {
        const y = y1 + (y2 - y1) * l;
        const x = x1 + (x2 - x1) * l;
        seg(x1, y, x2, y, withAlpha(tool === "gannBox" ? fibColor(l) : color, 0.7), 1, tool === "gannBox" ? [] : [4, 4]);
        seg(x, y1, x, y2, withAlpha(tool === "gannBox" ? fibColor(l) : color, 0.7), 1, tool === "gannBox" ? [] : [4, 4]);
        if (tool === "gannBox") {
          text(x1 - 3, y, fmtLevel(l), fibColor(l), "right", "middle");
          text(x, y2 + 3, fmtLevel(l), fibColor(l), "center", "top");
        }
      }
      seg(x1, y1, x2, y2, withAlpha(color, 0.8), 1, []);
      seg(x1, y2, x2, y1, withAlpha(color, 0.8), 1, []);
      if (tool !== "gannBox") {
        // Gann's square: arcs from the anchored corner and its fan to the far sides' quarters.
        const ox = A.x;
        const oy = A.y;
        const fx = bx;
        const fy = by;
        const rx = Math.abs(fx - ox);
        const ry = Math.abs(fy - oy);
        const sx = Math.sign(fx - ox) || 1;
        const sy = Math.sign(fy - oy) || 1;
        const quarter = sx > 0 ? (sy > 0 ? [0, Math.PI / 2] : [-Math.PI / 2, 0]) : sy > 0 ? [Math.PI / 2, Math.PI] : [Math.PI, 1.5 * Math.PI];
        for (const l of [0.5, 1]) out.push({ t: "ellipse", cx: ox, cy: oy, rx: rx * l, ry: ry * l, start: quarter[0], end: quarter[1], color: withAlpha(color, 0.8), width: 1 });
        for (const l of [0.25, 0.5, 0.75]) {
          seg(ox, oy, fx, oy + (fy - oy) * l, withAlpha(color, 0.6), 1, []);
          seg(ox, oy, ox + (fx - ox) * l, fy, withAlpha(color, 0.6), 1, []);
        }
      }
      break;
    }

    case "gannFan": {
      // Gann's angles: price/time = k times that of A→B (the 1/1 line).
      const dl = B.logical - A.logical;
      const dp = B.price - A.price;
      const xb = xOf(A.logical + dl);
      for (const [k, label, c] of GANN_FAN) {
        const y = yOf(A.price + dp * k);
        if (y === null || xb === null) continue;
        const [x1, y1, x2, y2] = ray(A.x, A.y, xb, y);
        seg(x1, y1, x2, y2, c, lw, []);
        text(xb + 4, y, label, c, "left", "middle");
      }
      break;
    }

    case "rect": {
      const [x1, x2] = [Math.min(A.x, B.x), Math.max(A.x, B.x)];
      const [y1, y2] = [Math.min(A.y, B.y), Math.max(A.y, B.y)];
      out.push({ t: "poly", pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], fill: withAlpha(color, 0.15), stroke: color, width: lw, dash, closed: true });
      break;
    }

    case "text":
      text(A.x, A.y, drawing.text || "Text", color, "left", "middle", "rgba(10,10,10,0.6)");
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
      const w = shape.text.length * 7;
      const x0 = shape.align === "right" ? shape.x - w : shape.align === "center" ? shape.x - w / 2 : shape.x;
      const y0 = shape.base === "bottom" ? shape.y - 14 : shape.base === "top" ? shape.y : shape.y - 7;
      return px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + 14 ? 0 : Infinity;
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
