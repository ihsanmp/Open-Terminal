// A selected drawing's handles, and what dragging one does to its points. Most tools have a handle
// on each point. A rectangle, as on TradingView, has eight: its four corners (circles), each moving
// that corner, and the middle of each side (squares), each moving only that side.

import type { DrawPoint, ToolId } from "./tools";

type Pt = { x: number; y: number };
export type Handle = Pt & { square?: boolean };

/** The handles of a drawing whose points are at `anchors` (pane pixels). */
export function handlesOf(tool: ToolId, anchors: Pt[]): Handle[] {
  if (tool === "rect" && anchors.length === 2) {
    const [A, B] = anchors;
    const [mx, my] = [(A.x + B.x) / 2, (A.y + B.y) / 2];
    return [
      { x: A.x, y: A.y }, // 0, 1: its two points
      { x: B.x, y: B.y },
      { x: A.x, y: B.y }, // 2, 3: the other two corners
      { x: B.x, y: A.y },
      { x: mx, y: A.y, square: true }, // 4, 5: the sides at its two prices
      { x: mx, y: B.y, square: true },
      { x: A.x, y: my, square: true }, // 6, 7: the sides at its two times
      { x: B.x, y: my, square: true },
    ];
  }
  return anchors.map((a) => ({ x: a.x, y: a.y }));
}

/** The drawing's points with handle `h` dragged to `p`. */
export function moveHandle(tool: ToolId, h: number, points: DrawPoint[], p: DrawPoint): DrawPoint[] {
  if (tool === "rect" && points.length === 2) {
    const [A, B] = points;
    switch (h) {
      case 0:
        return [p, B];
      case 1:
        return [A, p];
      case 2:
        return [{ time: p.time, price: A.price }, { time: B.time, price: p.price }];
      case 3:
        return [{ time: A.time, price: p.price }, { time: p.time, price: B.price }];
      case 4:
        return [{ ...A, price: p.price }, B];
      case 5:
        return [A, { ...B, price: p.price }];
      case 6:
        return [{ ...A, time: p.time }, B];
      case 7:
        return [A, { ...B, time: p.time }];
    }
  }
  return points.map((q, i) => (i === h ? p : q));
}

/**
 * Where Shift holds handle `h` from (pane pixels): for a rectangle's corner the opposite one (so
 * it stays a square); a side moves alone, so nothing. Otherwise the point before it.
 */
export function handleFrom(tool: ToolId, h: number, anchors: Pt[], refIndex: (i: number) => number): Pt | null {
  if (tool === "rect" && anchors.length === 2) {
    const [A, B] = anchors;
    return [B, A, { x: B.x, y: A.y }, { x: A.x, y: B.y }][h] ?? null;
  }
  return anchors[refIndex(h)] ?? null;
}
