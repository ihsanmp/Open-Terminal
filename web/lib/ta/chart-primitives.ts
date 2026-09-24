// lightweight-charts series primitives for what Pine can draw that the built-in
// series types can't: fill() between two plots, bgcolor(), and line.new() /
// label.new() / plotshape(shape.xcross) drawings.
// Modeled on the official bands-indicator / session-highlighting plugin examples.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  Logical,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

type Attached = { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void };

abstract class PrimitiveBase implements ISeriesPrimitive<Time> {
  protected attachedTo: Attached | null = null;

  attached(param: SeriesAttachedParameter<Time>) {
    this.attachedTo = param as unknown as Attached;
  }

  detached() {
    this.attachedTo = null;
  }

  abstract paneViews(): readonly IPrimitivePaneView[];
}

/** Visible logical index range, padded by one bar so edges don't pop in. */
function visibleRange(chart: IChartApi, count: number): [number, number] {
  const r = chart.timeScale().getVisibleLogicalRange();
  if (!r) return [0, count - 1];
  return [Math.max(0, Math.floor(r.from) - 1), Math.min(count - 1, Math.ceil(r.to) + 1)];
}

export type FillSpec = {
  times: Time[];
  a: number[];
  b: number[];
  /** One color for the whole band, or a per-bar color (undefined = no fill). */
  color: string | Array<string | undefined>;
};

type Pt = { x: number; ya: number; yb: number };

class FillRenderer implements IPrimitivePaneRenderer {
  constructor(private runs: Array<{ color: string; points: Pt[] }>) {}

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
      for (const run of this.runs) {
        if (run.points.length < 2) continue;
        const region = new Path2D();
        region.moveTo(run.points[0].x, run.points[0].ya);
        for (const p of run.points) region.lineTo(p.x, p.ya);
        for (let i = run.points.length - 1; i >= 0; i--) region.lineTo(run.points[i].x, run.points[i].yb);
        region.closePath();
        ctx.fillStyle = run.color;
        ctx.fill(region);
      }
      ctx.restore();
    });
  }
}

export class FillPrimitive extends PrimitiveBase {
  private view: IPrimitivePaneView;

  constructor(private spec: FillSpec) {
    super();
    const self = this;
    this.view = {
      zOrder: (): PrimitivePaneViewZOrder => "bottom",
      renderer: () => new FillRenderer(self.buildRuns()),
    };
  }

  paneViews() {
    return [this.view];
  }

  /** Contiguous same-color stretches become one polygon each (no seams between bars). */
  private buildRuns() {
    const at = this.attachedTo;
    if (!at) return [];
    const { times, a, b, color } = this.spec;
    const ts = at.chart.timeScale();
    const [from, to] = visibleRange(at.chart, times.length);
    type Run = { color: string; points: Pt[] };
    const runs: Run[] = [];
    let current = null as Run | null;
    for (let i = from; i <= to; i++) {
      const c = typeof color === "string" ? color : color[i];
      const va = a[i];
      const vb = b[i];
      const x = ts.timeToCoordinate(times[i]);
      const ya = Number.isFinite(va) ? at.series.priceToCoordinate(va) : null;
      const yb = Number.isFinite(vb) ? at.series.priceToCoordinate(vb) : null;
      if (!c || x === null || ya === null || yb === null) {
        current = null;
        continue;
      }
      const point = { x, ya, yb };
      if (!current || current.color !== c) {
        // Start the new run at the previous point so adjacent colors meet exactly.
        const prev: Pt | undefined = current?.points[current.points.length - 1];
        current = { color: c, points: prev ? [prev] : [] };
        runs.push(current);
      }
      current.points.push(point);
    }
    return runs;
  }
}

class BackgroundRenderer implements IPrimitivePaneRenderer {
  constructor(private bars: Array<{ x: number; color: string }>, private barWidth: number) {}

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const half = (scope.horizontalPixelRatio * this.barWidth) / 2;
      for (const bar of this.bars) {
        const x = bar.x * scope.horizontalPixelRatio;
        ctx.fillStyle = bar.color;
        const x1 = Math.max(0, Math.round(x - half));
        const x2 = Math.min(scope.bitmapSize.width, Math.round(x + half));
        ctx.fillRect(x1, 0, x2 - x1, scope.bitmapSize.height);
      }
    });
  }
}

export class BackgroundPrimitive extends PrimitiveBase {
  private view: IPrimitivePaneView;

  constructor(private times: Time[], private colors: Array<string | undefined>) {
    super();
    const self = this;
    this.view = {
      zOrder: (): PrimitivePaneViewZOrder => "bottom",
      renderer: () => {
        const at = self.attachedTo;
        if (!at) return null;
        const ts = at.chart.timeScale();
        const [from, to] = visibleRange(at.chart, self.times.length);
        const bars: Array<{ x: number; color: string }> = [];
        for (let i = from; i <= to; i++) {
          const color = self.colors[i];
          const x = ts.timeToCoordinate(self.times[i]);
          if (color && x !== null) bars.push({ x, color });
        }
        const spacing = ts.options().barSpacing;
        return new BackgroundRenderer(bars, spacing);
      },
    };
  }

  paneViews() {
    return [this.view];
  }
}

export type DrawingsSpec = {
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean; width?: number }>;
  labels: Array<{
    index: number;
    price: number;
    text: string;
    style: "left" | "right" | "center" | "circle";
    textColor?: string;
    bg?: string;
    size: "tiny" | "small" | "normal" | "large" | "huge";
  }>;
  /** plotshape(shape.xcross) above the bar's high or below its low. */
  crosses: Array<{ index: number; price: number; position: "above" | "below"; color: string }>;
  boxes: Array<{ x1: number; x2: number; top: number; bottom: number; bg: string; border?: string; dashed?: boolean; text?: string; textColor?: string }>;
};

// Pine's size.* for label text and for a text-less style_circle dot, in CSS pixels.
const FONT_PX = { tiny: 9, small: 11, normal: 13, large: 16, huge: 22 } as const;
const DOT_PX = { tiny: 8, small: 12, normal: 16, large: 22, huge: 30 } as const;
const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

type PlacedLine = DrawingsSpec["lines"][number] & { ax: number; ay: number; bx: number; by: number };
type PlacedLabel = DrawingsSpec["labels"][number] & { x: number; y: number };
type PlacedCross = { x: number; y: number; color: string };

class DrawingsRenderer implements IPrimitivePaneRenderer {
  constructor(private lines: PlacedLine[], private labels: PlacedLabel[], private crosses: PlacedCross[]) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);

      for (const l of this.lines) {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width ?? 1;
        ctx.setLineDash(l.dashed ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(l.ax, l.ay);
        ctx.lineTo(l.bx, l.by);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const c of this.crosses) {
        const r = 3.5;
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.x - r, c.y - r);
        ctx.lineTo(c.x + r, c.y + r);
        ctx.moveTo(c.x + r, c.y - r);
        ctx.lineTo(c.x - r, c.y + r);
        ctx.stroke();
      }

      ctx.textBaseline = "middle";
      for (const lb of this.labels) {
        if (lb.style === "circle") {
          ctx.fillStyle = lb.bg ?? "#2962FF";
          ctx.beginPath();
          ctx.arc(lb.x, lb.y, DOT_PX[lb.size] / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const px = FONT_PX[lb.size];
        ctx.font = `${px}px ${FONT}`;
        const w = ctx.measureText(lb.text).width;
        if (lb.style === "center") {
          const padX = px * 0.5;
          const padY = px * 0.35;
          ctx.fillStyle = lb.bg ?? "#363a45";
          ctx.beginPath();
          ctx.roundRect(lb.x - w / 2 - padX, lb.y - px / 2 - padY, w + padX * 2, px + padY * 2, 3);
          ctx.fill();
          ctx.fillStyle = lb.textColor ?? "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(lb.text, lb.x, lb.y);
        } else if (lb.style === "right") {
          // style_label_right: the point sits at the label's right edge.
          ctx.fillStyle = lb.textColor ?? "#ffffff";
          ctx.textAlign = "right";
          ctx.fillText(lb.text, lb.x - 4, lb.y);
        } else {
          // style_label_left: the point sits at the label's left edge.
          const x = lb.x + 4;
          if (lb.bg) {
            ctx.fillStyle = lb.bg;
            ctx.fillRect(x - 2, lb.y - px / 2 - 2, w + 4, px + 4);
          }
          ctx.fillStyle = lb.textColor ?? "#ffffff";
          ctx.textAlign = "left";
          ctx.fillText(lb.text, x, lb.y);
        }
      }
      ctx.restore();
    });
  }
}

type PlacedBox = DrawingsSpec["boxes"][number] & { ax: number; bx: number; ay: number; by: number };

/** box.new(): drawn behind the series like TradingView's boxes. */
class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(private boxes: PlacedBox[]) {}

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
      for (const b of this.boxes) {
        const x = Math.min(b.ax, b.bx);
        const y = Math.min(b.ay, b.by);
        const w = Math.abs(b.bx - b.ax);
        const h = Math.max(1, Math.abs(b.by - b.ay));
        ctx.fillStyle = b.bg;
        ctx.fillRect(x, y, w, h);
        if (b.border) {
          ctx.strokeStyle = b.border;
          ctx.lineWidth = 1;
          ctx.setLineDash(b.dashed ? [4, 3] : []);
          ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        }
        if (b.text) {
          ctx.setLineDash([]);
          ctx.font = `10px ${FONT}`;
          ctx.textBaseline = "top";
          ctx.textAlign = "left";
          ctx.fillStyle = b.textColor ?? "#ffffff";
          ctx.fillText(b.text, x + 3, y + 3);
        }
      }
      ctx.restore();
    });
  }
}

export class DrawingsPrimitive extends PrimitiveBase {
  private view: IPrimitivePaneView;
  private boxView: IPrimitivePaneView;

  constructor(private spec: DrawingsSpec) {
    super();
    const self = this;
    this.view = { renderer: () => self.build() };
    this.boxView = { zOrder: (): PrimitivePaneViewZOrder => "bottom", renderer: () => self.buildBoxes() };
  }

  paneViews() {
    return [this.boxView, this.view];
  }

  private buildBoxes() {
    const at = this.attachedTo;
    if (!at || this.spec.boxes.length === 0) return null;
    const ts = at.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const from = r ? r.from - 2 : -Infinity;
    const to = r ? r.to + 2 : Infinity;
    const placed: PlacedBox[] = [];
    for (const b of this.spec.boxes) {
      if (Math.max(b.x1, b.x2) < from || Math.min(b.x1, b.x2) > to) continue;
      const ax = ts.logicalToCoordinate(b.x1 as Logical);
      const bx = ts.logicalToCoordinate(b.x2 as Logical);
      const ay = at.series.priceToCoordinate(b.top);
      const by = at.series.priceToCoordinate(b.bottom);
      if (ax === null || bx === null || ay === null || by === null) continue;
      placed.push({ ...b, ax, bx, ay, by });
    }
    return new BoxRenderer(placed);
  }

  private build() {
    const at = this.attachedTo;
    if (!at) return null;
    const ts = at.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const from = r ? r.from - 2 : -Infinity;
    const to = r ? r.to + 2 : Infinity;
    const x = (i: number) => ts.logicalToCoordinate(i as Logical);
    const y = (p: number) => (Number.isFinite(p) ? at.series.priceToCoordinate(p) : null);

    const lines: PlacedLine[] = [];
    for (const l of this.spec.lines) {
      if (Math.max(l.x1, l.x2) < from || Math.min(l.x1, l.x2) > to) continue;
      const ax = x(l.x1);
      const bx = x(l.x2);
      const ay = y(l.y1);
      const by = y(l.y2);
      if (ax === null || bx === null || ay === null || by === null) continue;
      lines.push({ ...l, ax, bx, ay, by });
    }
    const labels: PlacedLabel[] = [];
    for (const lb of this.spec.labels) {
      if (lb.index < from || lb.index > to) continue;
      const lx = x(lb.index);
      const ly = y(lb.price);
      if (lx !== null && ly !== null) labels.push({ ...lb, x: lx, y: ly });
    }
    const crosses: PlacedCross[] = [];
    for (const c of this.spec.crosses) {
      if (c.index < from || c.index > to) continue;
      const cx = x(c.index);
      const cy = y(c.price);
      if (cx !== null && cy !== null) crosses.push({ x: cx, y: cy + (c.position === "above" ? -9 : 9), color: c.color });
    }
    return new DrawingsRenderer(lines, labels, crosses);
  }
}
