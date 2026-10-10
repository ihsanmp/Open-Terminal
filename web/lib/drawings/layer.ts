// The drawings on a chart pane: a series primitive on the pane's series (the price series, or an
// indicator's in its own pane) that draws the pane's drawings (and the one being placed) above it,
// the selected one with its handles, and keeps what it drew for picking a drawing or a handle
// under the pointer.

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { fontPx } from "../font-scale";
import { distanceTo, shapesFor, textBox, type Anchor, type Bar, type Shape } from "./geometry";
import { handlesOf, type Handle } from "./handles";
import { TOOL_BY_ID, logicalOfTime, timeOfLogical, type Drawing, type DrawPoint, type TimeframeKind, type ToolId } from "./tools";

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const HANDLE = 5;

export type LayerData = {
  drawings: Drawing[];
  /** The drawing being placed: its tool, the points so far and the pointer's. */
  preview: { tool: ToolId; points: DrawPoint[]; style: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio" | "options"> } | null;
  selected: string | null;
  hidden: boolean;
  times: number[];
  interval: number;
  formatPrice: (p: number) => string;
  /** A time as the chart writes it (a vertical line's time label). */
  formatTime?: (t: number) => string;
  /** The chart's bars, by index (for the tools that read them: regression, VWAP, volume profile). */
  bars?: ReadonlyArray<Bar>;
  /** The chart's kind of interval, for each drawing's Visibility. */
  intervalKind: TimeframeKind;
  /** The indicator whose pane this is (its uid); the price pane when unset. */
  pane?: string;
};

type Attached = { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void };

/**
 * The drawing under the pointer right now: one being dragged (shown with its handles) or being
 * placed. It's drawn on a canvas of its own above the chart at every move; repainting the whole
 * chart (candles, indicators, every drawing) for each move fell visibly behind the pointer.
 */
export type Live = { drawing: Drawing } | { preview: NonNullable<LayerData["preview"]> };

export class DrawingLayer implements ISeriesPrimitive<Time> {
  private attachedTo: Attached | null = null;
  private data: LayerData;
  private drawn = new Map<string, { anchors: Anchor[]; shapes: Shape[] }>();
  private view: IPrimitivePaneView;

  constructor(data: LayerData) {
    this.data = data;
    const self = this;
    this.view = {
      zOrder: () => "top",
      renderer: () => ({
        draw(target: CanvasRenderingTarget2D) {
          target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => self.paint(ctx, mediaSize.width, mediaSize.height));
        },
      }),
    };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.attachedTo = param as unknown as Attached;
  }

  detached() {
    this.attachedTo = null;
  }

  paneViews() {
    return [this.view];
  }

  set(next: Partial<LayerData>) {
    this.data = { ...this.data, ...next };
    this.attachedTo?.requestUpdate();
  }

  private live: Live | null = null;
  /** Whether a drawing is being placed or moved (attachDrawing's): the chart isn't rebuilt meanwhile. */
  isBusy: () => boolean = () => false;
  /** Repaints the live canvas (attachDrawing's), at once rather than with the chart. */
  liveSink: (() => void) | null = null;

  /** What the live canvas shows; the chart leaves a dragged drawing to it meanwhile. */
  setLive(live: Live | null) {
    const was = this.live && "drawing" in this.live ? this.live.drawing.id : null;
    this.live = live;
    const now = live && "drawing" in live ? live.drawing.id : null;
    if (now !== was) this.attachedTo?.requestUpdate();
    this.liveSink?.();
  }

  /** A drawing added by hand before its owner passes the list back (no blank frame meanwhile). */
  add(d: Drawing) {
    this.set({ drawings: [...this.data.drawings.filter((x) => x.id !== d.id), d] });
  }

  /** The live drawing, on the live canvas (pane coordinates, like the chart's). */
  paintLive(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const live = this.live;
    if (!live || !this.attachedTo || this.data.hidden) return;
    if ("drawing" in live) {
      const d = live.drawing;
      const anchors = this.anchorsOf(d.points);
      if (!anchors) return;
      render(ctx, this.shapes(d.tool, anchors, d, width, height, true));
      handles(ctx, freehand(d.tool) ? [] : handlesOf(d.tool, anchors));
    } else {
      const p = live.preview;
      const anchors = this.anchorsOf(p.points);
      if (!anchors) return;
      render(ctx, this.shapes(p.tool, anchors, p.style, width, height));
      handles(ctx, anchors);
    }
  }

  /**
   * The crosshair put at pane pixels: a drag keeps the pointer's moves from the chart (so it
   * doesn't pan), which would leave the crosshair where the drag began.
   */
  crosshairAt(x: number, y: number) {
    const at = this.attachedTo;
    if (!at) return;
    const time = at.chart.timeScale().coordinateToTime(x);
    const price = at.series.coordinateToPrice(y);
    if (time !== null && price !== null) at.chart.setCrosshairPosition(price, time, at.series);
  }

  /** Pane pixels → the chart's bar index and price. */
  toChart(x: number, y: number): { logical: number; price: number } | null {
    const at = this.attachedTo;
    if (!at) return null;
    // The library gives whole bars only (rounded up), so a point dragged along jumped bar to bar
    // ahead of the pointer: the fraction is put back from the pixels past that bar.
    const ts = at.chart.timeScale();
    const bar = ts.coordinateToLogical(x);
    const price = at.series.coordinateToPrice(y);
    if (bar === null || price === null) return null;
    const a = ts.logicalToCoordinate(bar);
    const b = ts.logicalToCoordinate((bar + 1) as Logical);
    const logical = a !== null && b !== null && b !== a ? bar + (x - a) / (b - a) : bar;
    return { logical, price };
  }

  /**
   * A bar index → pane x, between bars too. The library places whole bar indexes only (a
   * fraction comes back at 0), and a point drawn on another interval falls between this one's
   * bars: an H1 point on a D1 chart, say. So it's placed in proportion between its two bars.
   */
  private xOf(logical: number): number | null {
    const ts = this.attachedTo!.chart.timeScale();
    const i = Math.floor(logical);
    const f = logical - i;
    const a = ts.logicalToCoordinate(i as Logical);
    if (f < 1e-9 || a === null) return a;
    const b = ts.logicalToCoordinate((i + 1) as Logical);
    return b === null ? null : a + (b - a) * f;
  }

  /** A drawing point → pane pixels. */
  toPixel(p: DrawPoint): { x: number; y: number } | null {
    return this.anchorsOf([p])?.[0] ?? null;
  }

  private anchorsOf(points: DrawPoint[]): Anchor[] | null {
    const at = this.attachedTo;
    if (!at) return null;
    const out: Anchor[] = [];
    for (const p of points) {
      const logical = logicalOfTime(this.data.times, this.data.interval, p.time);
      const x = this.xOf(logical);
      const y = at.series.priceToCoordinate(p.price);
      if (x === null || y === null) return null;
      out.push({ x, y, logical, price: p.price });
    }
    return out;
  }

  private shapes(tool: ToolId, anchors: Anchor[], style: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio" | "options">, width: number, height: number, selected = false): Shape[] {
    const at = this.attachedTo!;
    const { times, interval } = this.data;
    return shapesFor(tool, {
      selected,
      timeOf: (l) => timeOfLogical(times, interval, l),
      formatTime: this.data.formatTime,
      bars: this.data.bars,
      anchors,
      width,
      height,
      xOf: (l) => this.xOf(l),
      yOf: (p) => at.series.priceToCoordinate(p),
      formatPrice: this.data.formatPrice,
      drawing: style,
    });
  }

  private paint(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.drawn.clear();
    if (!this.attachedTo || this.data.hidden) return;
    const liveId = this.live && "drawing" in this.live ? this.live.drawing.id : null;
    for (const d of this.data.drawings) {
      if (d.visibility?.[this.data.intervalKind] === false || d.id === liveId || d.pane !== this.data.pane) continue;
      const anchors = this.anchorsOf(d.points);
      if (!anchors) continue;
      const shapes = this.shapes(d.tool, anchors, d, width, height, d.id === this.data.selected);
      this.drawn.set(d.id, { anchors, shapes });
      render(ctx, shapes);
      if (d.id === this.data.selected) handles(ctx, freehand(d.tool) ? [] : handlesOf(d.tool, anchors));
    }
    const p = this.data.preview;
    if (p) {
      const anchors = this.anchorsOf(p.points);
      if (anchors) {
        render(ctx, this.shapes(p.tool, anchors, p.style, width, height));
        handles(ctx, anchors);
      }
    }
  }

  /** The drawing (and handle) under a pane point: the selected one's handles first, then the topmost drawing. */
  pick(x: number, y: number): { id: string; handle: number | null } | null {
    const sel = this.data.selected ? this.drawn.get(this.data.selected) : undefined;
    const selTool = this.data.drawings.find((d) => d.id === this.data.selected)?.tool;
    if (sel && selTool && !freehand(selTool)) {
      const h = handlesOf(selTool, sel.anchors).findIndex((a) => Math.hypot(a.x - x, a.y - y) <= HANDLE + 3);
      if (h >= 0) return { id: this.data.selected!, handle: h };
    }
    const ids = [...this.drawn.keys()].reverse();
    for (const id of ids) {
      const { shapes, anchors } = this.drawn.get(id)!;
      if (anchors.some((a) => Math.hypot(a.x - x, a.y - y) <= HANDLE + 3) || shapes.some((s) => distanceTo(s, x, y) <= 5)) return { id, handle: null };
    }
    return null;
  }

  anchorsOfDrawing(id: string): Anchor[] | null {
    return this.drawn.get(id)?.anchors ?? null;
  }
}

function render(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  ctx.save();
  ctx.lineCap = "round";
  for (const s of shapes) {
    switch (s.t) {
      case "seg":
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width ?? 1;
        ctx.setLineDash(s.dash ?? []);
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        break;
      case "poly":
        if (s.pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(s.pts[0][0], s.pts[0][1]);
        for (const [x, y] of s.pts.slice(1)) ctx.lineTo(x, y);
        if (s.closed) ctx.closePath();
        if (s.fill) {
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
        if (s.stroke) {
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = s.width ?? 1;
          ctx.setLineDash(s.dash ?? []);
          ctx.stroke();
        }
        break;
      case "ellipse":
        if (s.rx <= 0 || s.ry <= 0) break;
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width ?? 1;
        ctx.setLineDash(s.dash ?? []);
        ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, s.start ?? 0, s.end ?? 2 * Math.PI);
        if (s.fill) {
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
        ctx.stroke();
        break;
      case "text": {
        // Its box in its own frame (turned about its anchor for text along a sloping line),
        // a line of text at a time.
        const size = fontPx(s.size ?? 10);
        const lines = s.text.split("\n");
        const lh = size * 1.25;
        ctx.save();
        ctx.translate(s.x, s.y);
        if (s.angle) ctx.rotate(s.angle);
        ctx.font = `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${size}px ${FONT}`;
        ctx.textAlign = s.align ?? "left";
        ctx.textBaseline = "middle";
        const box = textBox({ ...s, size });
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8;
        const x0 = s.align === "right" ? -w + 4 : s.align === "center" ? -w / 2 : -4;
        if (s.bg) {
          ctx.fillStyle = s.bg;
          ctx.fillRect(x0, box.y0, w, box.h);
        }
        if (s.border) {
          ctx.strokeStyle = s.border;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.strokeRect(x0 + 0.5, box.y0 + 0.5, w - 1, box.h - 1);
        }
        ctx.fillStyle = s.color;
        lines.forEach((l, i) => ctx.fillText(l, 0, box.y0 + 2 + lh * (i + 0.5)));
        ctx.restore();
        break;
      }
    }
  }
  ctx.restore();
}

/** A brush stroke: picked and moved whole, without a handle on each of its many points. */
const freehand = (tool: ToolId | undefined) => tool !== undefined && TOOL_BY_ID.get(tool)?.variable === "freehand";

/** Handles: a circle on a point or corner, a rounded square on a side (TradingView's). */
function handles(ctx: CanvasRenderingContext2D, list: Handle[]) {
  ctx.save();
  for (const a of list) {
    ctx.beginPath();
    if (a.square) ctx.roundRect(a.x - HANDLE + 0.5, a.y - HANDLE + 0.5, 2 * HANDLE - 1, 2 * HANDLE - 1, 2);
    else ctx.arc(a.x, a.y, HANDLE, 0, 2 * Math.PI);
    ctx.fillStyle = "#131313";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2962FF";
    ctx.stroke();
  }
  ctx.restore();
}
