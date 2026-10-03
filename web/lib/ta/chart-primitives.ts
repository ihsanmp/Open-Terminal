// lightweight-charts series primitives for what Pine can draw that the built-in
// series types can't: fill() between two plots, bgcolor(), and line.new() /
// label.new() / plotshape(shape.xcross) drawings.
// Modeled on the official bands-indicator / session-highlighting plugin examples.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { Box, Label, Line, LineDash } from "./types";
import type {
  IChartApi,
  ISeriesPrimitiveAxisView,
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
import { fontPx } from "../font-scale";

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
  lines: Line[];
  labels: Label[];
  /** plotshape(shape.xcross) above the bar's high or below its low. */
  crosses: Array<{ index: number; price: number; position: "above" | "below"; color: string }>;
  boxes: Box[];
};

// Pine's size.* for label text and for a text-less style_circle dot, in CSS pixels.
const FONT_PX = { tiny: fontPx(9), small: fontPx(11), normal: fontPx(13), large: fontPx(16), huge: fontPx(22) } as const;
const DOT_PX = { tiny: 8, small: 12, normal: 16, large: 22, huge: 30 } as const;
const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const DASH: Record<LineDash, number[]> = { solid: [], dashed: [4, 3], dotted: [1, 3] };

const lineDash = (l: { style?: LineDash; dashed?: boolean }) => DASH[l.style ?? (l.dashed ? "dashed" : "solid")];

type PlacedLine = Line & { ax: number; ay: number; bx: number; by: number };
type PlacedLabel = Label & { x: number; y: number };
type PlacedCross = { x: number; y: number; color: string };

/** Endpoints of a line extended to the pane's edges (Pine's extend.right / left / both). */
function extendLine(l: PlacedLine, width: number, height: number): [number, number, number, number] {
  let { ax, ay, bx, by } = l;
  if (!l.extend) return [ax, ay, bx, by];
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-9) {
    // Vertical: extend to the top and bottom.
    const up = Math.min(ay, by);
    const down = Math.max(ay, by);
    return [ax, l.extend === "left" || l.extend === "both" ? -height : up, bx, l.extend === "right" || l.extend === "both" ? 2 * height : down];
  }
  const slope = dy / dx;
  const left = Math.min(ax, bx) === ax ? { x: ax, y: ay } : { x: bx, y: by };
  const right = left.x === ax ? { x: bx, y: by } : { x: ax, y: ay };
  if (l.extend === "right" || l.extend === "both") {
    right.y += slope * (width + 50 - right.x);
    right.x = width + 50;
  }
  if (l.extend === "left" || l.extend === "both") {
    left.y += slope * (-50 - left.x);
    left.x = -50;
  }
  return [left.x, left.y, right.x, right.y];
}

class DrawingsRenderer implements IPrimitivePaneRenderer {
  constructor(private lines: PlacedLine[], private labels: PlacedLabel[], private crosses: PlacedCross[]) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      const height = scope.mediaSize.height;
      ctx.save();
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);

      for (const l of this.lines) {
        const [x1, y1, x2, y2] = extendLine(l, width, height);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width ?? 1;
        ctx.setLineDash(lineDash(l));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
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

      for (const lb of this.labels) drawLabel(ctx, lb);
      ctx.restore();
    });
  }
}

/** One label, in any of Pine's styles; text may span several lines. */
function drawLabel(ctx: CanvasRenderingContext2D, lb: PlacedLabel) {
  if (lb.style === "circle") {
    ctx.fillStyle = lb.bg ?? "#2962FF";
    ctx.beginPath();
    ctx.arc(lb.x, lb.y, DOT_PX[lb.size] / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (lb.style === "cross") {
    const r = DOT_PX[lb.size] / 2;
    ctx.strokeStyle = lb.bg ?? lb.textColor ?? "#2962FF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lb.x - r, lb.y);
    ctx.lineTo(lb.x + r, lb.y);
    ctx.moveTo(lb.x, lb.y - r);
    ctx.lineTo(lb.x, lb.y + r);
    ctx.stroke();
    return;
  }
  const px = FONT_PX[lb.size];
  const lineH = px * 1.2;
  ctx.font = `${px}px ${FONT}`;
  const rows = lb.text.split("\n");
  const w = Math.max(0, ...rows.map((r) => ctx.measureText(r).width));
  const h = rows.length * lineH;
  const padX = lb.text ? px * 0.5 : 0;
  const padY = lb.text ? px * 0.3 : 0;
  const boxW = w + padX * 2;
  const boxH = h + padY * 2;
  const pointer = 5;
  // Top-left corner of the text box for each style.
  let bx: number;
  let by: number;
  switch (lb.style) {
    case "up": // box below the point, pointing up at it
      bx = lb.x - boxW / 2;
      by = lb.y + pointer;
      break;
    case "down": // box above the point, pointing down at it
      bx = lb.x - boxW / 2;
      by = lb.y - pointer - boxH;
      break;
    case "right":
      bx = lb.x - 4 - boxW;
      by = lb.y - boxH / 2;
      break;
    case "left":
      bx = lb.x + 4;
      by = lb.valign === "above" ? lb.y - boxH : lb.valign === "below" ? lb.y : lb.y - boxH / 2;
      break;
    default: // center, none
      bx = lb.x - boxW / 2;
      by = lb.y - boxH / 2;
  }
  const filled = lb.bg && lb.style !== "none";
  if (filled) {
    ctx.fillStyle = lb.bg!;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 3);
    if (lb.style === "up") {
      ctx.moveTo(lb.x - pointer, by);
      ctx.lineTo(lb.x, lb.y);
      ctx.lineTo(lb.x + pointer, by);
    } else if (lb.style === "down") {
      ctx.moveTo(lb.x - pointer, by + boxH);
      ctx.lineTo(lb.x, lb.y);
      ctx.lineTo(lb.x + pointer, by + boxH);
    }
    ctx.fill();
  }
  ctx.fillStyle = lb.textColor ?? "#ffffff";
  ctx.textBaseline = "middle";
  const align = lb.style === "left" ? "left" : lb.style === "right" ? "right" : "center";
  ctx.textAlign = align;
  const tx = align === "left" ? bx + padX : align === "right" ? bx + boxW - padX : bx + boxW / 2;
  rows.forEach((row, k) => ctx.fillText(row, tx, by + padY + lineH * (k + 0.5)));
}

type PlacedBox = Box & { ax: number; bx: number; ay: number; by: number };

/** box.new(): drawn behind the series like TradingView's boxes. */
class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(private boxes: PlacedBox[]) {}

  draw() {}

  drawBackground(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      ctx.save();
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
      for (const b of this.boxes) {
        const x = Math.min(b.ax, b.bx);
        const right = b.extendRight ? width + 10 : Math.max(b.ax, b.bx);
        const y = Math.min(b.ay, b.by);
        const w = right - x;
        const h = Math.max(1, Math.abs(b.by - b.ay));
        if (b.bg) {
          ctx.fillStyle = b.bg;
          ctx.fillRect(x, y, w, h);
        }
        if (b.border) {
          ctx.strokeStyle = b.border;
          ctx.lineWidth = b.borderWidth ?? 1;
          ctx.setLineDash(DASH[b.borderStyle ?? (b.dashed ? "dashed" : "solid")]);
          ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        }
        if (b.text) {
          ctx.setLineDash([]);
          const px = FONT_PX[b.textSize ?? "tiny"];
          ctx.font = `${px}px ${FONT}`;
          const halign = b.textHAlign ?? "left";
          const valign = b.textVAlign ?? "top";
          ctx.textAlign = halign;
          ctx.textBaseline = valign === "top" ? "top" : valign === "bottom" ? "bottom" : "middle";
          ctx.fillStyle = b.textColor ?? "#ffffff";
          const tx = halign === "left" ? x + 3 : halign === "right" ? x + w - 3 : x + w / 2;
          const ty = valign === "top" ? y + 2 : valign === "bottom" ? y + h - 2 : y + h / 2;
          ctx.fillText(b.text, tx, ty);
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
      if ((!b.extendRight && Math.max(b.x1, b.x2) < from) || Math.min(b.x1, b.x2) > to) continue;
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
      const lo = Math.min(l.x1, l.x2);
      const hi = Math.max(l.x1, l.x2);
      const reachesRight = l.extend === "right" || l.extend === "both";
      const reachesLeft = l.extend === "left" || l.extend === "both";
      if ((!reachesRight && hi < from) || (!reachesLeft && lo > to)) continue;
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

export type CountdownState = { price: number; text: string; color: string } | null;

/** The open candle's time to close, on the price axis right under the last-price label, as
 *  TradingView shows it. Refresh it once a second; it hides itself once the candle has closed.
 *
 *  Drawn by itself on top of the axis rather than as one more axis label: as a label it sank
 *  behind an indicator's value whenever that was close to the price (a moving average), and
 *  the countdown went missing. The label is still registered, see-through, so the axis keeps
 *  room for its width. */
export class CountdownPrimitive extends PrimitiveBase {
  private axisView: ISeriesPrimitiveAxisView;
  private axisPaneView: IPrimitivePaneView;

  /** `labelHeight`: height of the series' own last-price label, so the two stack flush. */
  constructor(private state: () => CountdownState, private labelHeight: number) {
    super();
    const self = this;
    const y = () => {
      const s = self.state();
      const at = self.attachedTo;
      if (!s || !at) return null;
      const c = at.series.priceToCoordinate(s.price);
      return c === null ? null : c + self.labelHeight;
    };
    this.axisView = {
      coordinate: () => y() ?? -1e6,
      text: () => self.state()?.text ?? "",
      textColor: () => "transparent",
      backColor: () => "transparent",
      visible: () => y() !== null,
      tickVisible: () => false,
    };
    const fontSize = labelHeight * (12 / 17); // the axis label's height is its font size × 17/12
    this.axisPaneView = {
      zOrder: () => "top",
      renderer: () => ({
        draw(target: CanvasRenderingTarget2D) {
          const s = self.state();
          const mid = y();
          if (!s || mid === null) return;
          target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const top = Math.round(mid - self.labelHeight / 2);
            ctx.fillStyle = s.color;
            ctx.fillRect(0, top, mediaSize.width, Math.ceil(self.labelHeight));
            ctx.font = `${fontSize}px ${FONT}`;
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.fillText(s.text, Math.round(fontSize * 0.75), top + self.labelHeight / 2 + 0.5);
          });
        },
      }),
    };
  }

  paneViews() {
    return [];
  }

  priceAxisViews() {
    return [this.axisView];
  }

  priceAxisPaneViews() {
    return [this.axisPaneView];
  }

  refresh() {
    this.attachedTo?.requestUpdate();
  }
}
