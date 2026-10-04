// The chart's cursors, as TradingView's: Cross (the crosshair), Dot, Arrow, Demonstration (a
// highlight that ripples on click, for showing a chart to others), Magic (a fading trail drawn by
// dragging) and Eraser (a click removes a drawing). Each sets the pointer over the chart and
// whether the crosshair's lines show; the axis labels stay, so the legend still follows.

export type CursorMode = "cross" | "dot" | "arrow" | "demo" | "magic" | "eraser";

export const CURSORS: Array<{ id: CursorMode; label: string }> = [
  { id: "cross", label: "Cross" },
  { id: "dot", label: "Dot" },
  { id: "arrow", label: "Arrow" },
  { id: "demo", label: "Demonstration" },
  { id: "magic", label: "Magic" },
];
export const ERASER = { id: "eraser" as const, label: "Eraser" };

const svgCursor = (svg: string, x: number, y: number, fallback: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

const DOT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="2.6" fill="#ffffff" stroke="#000000" stroke-width="1"/></svg>`;
const DEMO = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="rgba(255,82,82,0.3)" stroke="rgba(255,82,82,0.9)" stroke-width="1.5"/><circle cx="14" cy="14" r="1.5" fill="#ff5252"/></svg>`;
const MAGIC = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M3 21L15 9" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/><path d="M3 21L15 9" stroke="#000000" stroke-width="0.8" stroke-linecap="round"/><path d="M18 2v5M15.5 4.5h5M21 9v3M19.5 10.5h3M13 1v2M12 2h2" stroke="#ffd54f" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ERASE = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M3 15l9-9a1.5 1.5 0 0 1 2 0l4 4a1.5 1.5 0 0 1 0 2l-7 7H6z" fill="#ffffff" stroke="#000000" stroke-width="1"/><path d="M8 10l6 6" stroke="#000000" stroke-width="1"/><path d="M3 20h16" stroke="#ffffff" stroke-width="1.2"/></svg>`;

/** The CSS cursor over the chart's panes. */
export function cssCursor(mode: CursorMode): string {
  switch (mode) {
    case "cross":
      return "crosshair";
    case "dot":
      return svgCursor(DOT, 6, 6, "crosshair");
    case "arrow":
      return "default";
    case "demo":
      return svgCursor(DEMO, 14, 14, "default");
    case "magic":
      return svgCursor(MAGIC, 3, 21, "default");
    case "eraser":
      return svgCursor(ERASE, 4, 18, "default");
  }
}

/** The crosshair for a cursor: its lines only with the Cross; its axis labels always. */
export function crosshairFor(mode: CursorMode) {
  const lines = mode === "cross";
  return { mode: 0, vertLine: { visible: lines, labelVisible: true }, horzLine: { visible: lines, labelVisible: true } };
}

/** A point of the Magic cursor's trail, and how long the trail takes to fade. */
export type TrailPoint = { x: number; y: number; t: number };
export const TRAIL_MS = 900;
export const RIPPLE_MS = 600;

/** The trail still showing at a moment, oldest first. */
export const liveTrail = (points: TrailPoint[], now: number) => points.filter((p) => now - p.t < TRAIL_MS);
