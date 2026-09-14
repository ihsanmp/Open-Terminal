// lightweight-charts series primitives for the two things Pine can draw that
// the built-in series types can't: fill() between two plots and bgcolor().
// Modeled on the official bands-indicator / session-highlighting plugin examples.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
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
