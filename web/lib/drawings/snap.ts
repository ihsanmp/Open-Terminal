// Shift while drawing, as on TradingView: a line from the point before snaps straight —
// horizontal, vertical or at 45° on screen — and a box becomes a square; a drawing dragged whole
// keeps to one axis. In pane pixels, so "straight" is what's seen whatever the scales.

import { TOOL_BY_ID, type ToolId } from "./tools";

type Pt = { x: number; y: number };

/** How Shift holds a tool's point: by its angle from the point before, or as a square's corner. */
export type ShiftKind = "angle" | "square" | "none";

const SQUARES: ToolId[] = ["rect", "gannBox", "gannSquare", "gannSquareFixed"];

export function shiftKindOf(tool: ToolId): ShiftKind {
  if (SQUARES.includes(tool)) return "square";
  return (TOOL_BY_ID.get(tool)?.points ?? 1) > 1 ? "angle" : "none";
}

/** The point a tool's point i is held from: the one before it (the second, for the first). */
export const refIndex = (i: number) => (i > 0 ? i - 1 : 1);

/** `to` held from `from` as Shift does for a tool of this kind. */
export function constrainPoint(kind: ShiftKind, from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (kind === "none" || (dx === 0 && dy === 0)) return to;
  if (kind === "square") {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: from.x + (Math.sign(dx) || 1) * s, y: from.y + (Math.sign(dy) || 1) * s };
  }
  // The nearest of 0°, 45° and 90° (either way), keeping the pointer's reach along it.
  const a = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  const off = Math.min(a, 180 - a); // 0 … 90 from horizontal
  if (off < 22.5) return { x: to.x, y: from.y };
  if (off > 67.5) return { x: from.x, y: to.y };
  const d = (Math.abs(dx) + Math.abs(dy)) / 2;
  return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
}

/** A whole drawing dragged with Shift: along the axis it's mostly moving on. */
export const constrainMove = (dx: number, dy: number): [number, number] => (Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy]);
