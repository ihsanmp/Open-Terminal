// The drawings on a chart: a series primitive on the main price series that draws every drawing
// (and the one being placed) above the candles, the selected one with its handles, and keeps what
// it drew for picking a drawing or a handle under the pointer.

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { fontPx } from "../font-scale";
import { distanceTo, shapesFor, type Anchor, type Shape } from "./geometry";
import { logicalOfTime, type Drawing, type DrawPoint, type ToolId } from "./tools";

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const HANDLE = 5;

export type LayerData = {
  drawings: Drawing[];
  /** The drawing being placed: its tool, the points so far and the pointer's. */
  preview: { tool: ToolId; points: DrawPoint[]; style: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio"> } | null;
  selected: string | null;
  hidden: boolean;
  times: number[];
  interval: number;
  formatPrice: (p: number) => string;
};

type Attached = { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void };

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

  /** Pane pixels → the chart's bar index and price. */
  toChart(x: number, y: number): { logical: number; price: number } | null {
    const at = this.attachedTo;
    if (!at) return null;
    const logical = at.chart.timeScale().coordinateToLogical(x);
    const price = at.series.coordinateToPrice(y);
    return logical === null || price === null ? null : { logical, price };
  }

  private anchorsOf(points: DrawPoint[]): Anchor[] | null {
    const at = this.attachedTo;
    if (!at) return null;
    const ts = at.chart.timeScale();
    const out: Anchor[] = [];
    for (const p of points) {
      const logical = logicalOfTime(this.data.times, this.data.interval, p.time);
      const x = ts.logicalToCoordinate(logical as Logical);
      const y = at.series.priceToCoordinate(p.price);
      if (x === null || y === null) return null;
      out.push({ x, y, logical, price: p.price });
    }
    return out;
  }

  private shapes(tool: ToolId, anchors: Anchor[], style: Pick<Drawing, "color" | "width" | "dash" | "text" | "ratio">, width: number, height: number): Shape[] {
    const at = this.attachedTo!;
    return shapesFor(tool, {
      anchors,
      width,
      height,
      xOf: (l) => at.chart.timeScale().logicalToCoordinate(l as Logical),
      yOf: (p) => at.series.priceToCoordinate(p),
      formatPrice: this.data.formatPrice,
      drawing: style,
    });
  }

  private paint(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.drawn.clear();
    if (!this.attachedTo || this.data.hidden) return;
    for (const d of this.data.drawings) {
      const anchors = this.anchorsOf(d.points);
      if (!anchors) continue;
      const shapes = this.shapes(d.tool, anchors, d, width, height);
      this.drawn.set(d.id, { anchors, shapes });
      render(ctx, shapes);
      if (d.id === this.data.selected) handles(ctx, anchors);
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
    if (sel) {
      const h = sel.anchors.findIndex((a) => Math.hypot(a.x - x, a.y - y) <= HANDLE + 3);
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
        ctx.stroke();
        break;
      case "text": {
        ctx.font = `${fontPx(10)}px ${FONT}`;
        ctx.textAlign = s.align ?? "left";
        ctx.textBaseline = s.base ?? "bottom";
        if (s.bg) {
          const w = ctx.measureText(s.text).width + 8;
          const h = fontPx(10) + 6;
          const x0 = s.align === "right" ? s.x - w + 4 : s.align === "center" ? s.x - w / 2 : s.x - 4;
          const y0 = s.base === "top" ? s.y - 3 : s.base === "middle" ? s.y - h / 2 : s.y - h + 3;
          ctx.fillStyle = s.bg;
          ctx.fillRect(x0, y0, w, h);
        }
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, s.x, s.y);
        break;
      }
    }
  }
  ctx.restore();
}

function handles(ctx: CanvasRenderingContext2D, anchors: Anchor[]) {
  ctx.save();
  for (const a of anchors) {
    ctx.beginPath();
    ctx.arc(a.x, a.y, HANDLE, 0, 2 * Math.PI);
    ctx.fillStyle = "#131313";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2962FF";
    ctx.stroke();
  }
  ctx.restore();
}
