// The Astro chat panel's size (components/AstroChatBubble.tsx): what's kept, what fits, and how an
// edge or a corner dragged changes it.

export type Pos = { x: number; y: number };
export type Size = { w: number; h: number };

/** Kept from the window's edges. */
export const MARGIN = 8;
/** The panel's size until one is chosen: portrait. */
export const DEFAULT_PANEL: Size = { w: 360, h: 560 };
/** Smaller than this the chat, its menu and the message box don't fit. */
export const MIN_PANEL: Size = { w: 300, h: 380 };

/** The size wanted, within the least the chat needs and what the window leaves room for. */
export const fitSize = (s: Size, view: Size): Size => ({
  w: Math.round(Math.min(Math.max(MIN_PANEL.w, s.w), view.w - 2 * MARGIN)),
  h: Math.round(Math.min(Math.max(MIN_PANEL.h, s.h), view.h - 2 * MARGIN)),
});

/** Which edges a resize handle moves: left, right, top, bottom. */
export type Edges = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };

/**
 * The panel dragged by an edge or a corner: the opposite edges stay put, the size stays within
 * fitSize, and the panel within the window.
 */
export function resized(start: Pos & Size, edges: Edges, dx: number, dy: number, view: Size): Pos & Size {
  let w = start.w + (edges.r ? dx : edges.l ? -dx : 0);
  let h = start.h + (edges.b ? dy : edges.t ? -dy : 0);
  // Not past the window's edge on the side being dragged.
  if (edges.r) w = Math.min(w, view.w - MARGIN - start.x);
  if (edges.l) w = Math.min(w, start.x + start.w - MARGIN);
  if (edges.b) h = Math.min(h, view.h - MARGIN - start.y);
  if (edges.t) h = Math.min(h, start.y + start.h - MARGIN);
  ({ w, h } = fitSize({ w, h }, view));
  return { x: edges.l ? start.x + start.w - w : start.x, y: edges.t ? start.y + start.h - h : start.y, w, h };
}
