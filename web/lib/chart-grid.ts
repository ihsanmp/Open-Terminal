// The chart's vertical grid, following the interval as TradingView's does: lines where a quarter
// hour, an hour,
// day, week, month, quarter or year begins, the finest of those that is longer than a couple of
// bars and leaves the lines far enough apart at the current zoom. So an H1 chart is ruled by days
// (or 6 hours zoomed in), a D1 chart by months, a weekly one by quarters or years, and the cells
// grow and shrink with the zoom instead of keeping one fixed size.

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

/** A bar's time, in the chart's time zone. */
export type ZonedTime = { year: number; month: number; day: number; hour: number; minute: number; weekday: number; dayNumber: number };

const formats = new Map<string, Intl.DateTimeFormat>();

/** Each time's calendar parts in a time zone (worked out once per bar, not per frame). */
export function zonedTimes(times: number[], timeZone: string): ZonedTime[] {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formats.set(timeZone, f);
  }
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return times.map((t) => {
    const p: Record<string, string> = {};
    for (const x of f!.formatToParts(new Date(t * 1000))) if (x.type !== "literal") p[x.type] = x.value;
    const year = Number(p.year);
    const month = Number(p.month);
    const day = Number(p.day);
    return { year, month, day, hour: Number(p.hour), minute: Number(p.minute), weekday: WD[p.weekday] ?? 0, dayNumber: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) };
  });
}

type Unit = { name: string; seconds: number; key: (z: ZonedTime) => number };

const minutes = (n: number): Unit => ({ name: `${n}m`, seconds: 60 * n, key: (z) => z.dayNumber * 1440 + Math.floor((z.hour * 60 + z.minute) / n) });
const hours = (n: number): Unit => ({ name: `${n}h`, seconds: 3600 * n, key: (z) => z.dayNumber * 24 + Math.floor(z.hour / n) });

export const GRID_UNITS: Unit[] = [
  minutes(5),
  minutes(10),
  minutes(15),
  minutes(30),
  hours(1),
  hours(2),
  hours(3),
  hours(6),
  hours(12),
  { name: "day", seconds: 86_400, key: (z) => z.dayNumber },
  // Weeks start on Monday.
  { name: "week", seconds: 7 * 86_400, key: (z) => Math.floor((z.dayNumber - ((z.weekday + 6) % 7) + 3) / 7) },
  { name: "month", seconds: 30 * 86_400, key: (z) => z.year * 12 + z.month - 1 },
  { name: "quarter", seconds: 91 * 86_400, key: (z) => z.year * 4 + Math.floor((z.month - 1) / 3) },
  { name: "year", seconds: 365 * 86_400, key: (z) => z.year },
  { name: "5 years", seconds: 5 * 365 * 86_400, key: (z) => Math.floor(z.year / 5) },
];

/**
 * The bars (indexes) a vertical grid line falls on, between `from` and `to`, and the unit chosen:
 * the finest unit longer than two bars whose lines are at least `minGap` px apart on average.
 */
export function gridBars(z: ZonedTime[], from: number, to: number, barSeconds: number, pxPerBar: number, minGap = 60): { unit: string; bars: number[] } {
  const lo = Math.max(1, Math.floor(from));
  const hi = Math.min(z.length - 1, Math.ceil(to));
  if (hi <= lo) return { unit: "", bars: [] };
  const width = (hi - lo) * pxPerBar;
  for (const unit of GRID_UNITS) {
    if (unit.seconds < barSeconds * 2) continue;
    const bars: number[] = [];
    let prev = unit.key(z[lo - 1]);
    for (let i = lo; i <= hi; i++) {
      const k = unit.key(z[i]);
      if (k !== prev) bars.push(i);
      prev = k;
    }
    // Lines far enough apart on average (a unit with none in view is coarser than needed).
    if (bars.length === 0 || width / bars.length >= minGap) return { unit: unit.name, bars };
  }
  return { unit: "", bars: [] };
}

type Attached = { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void };

/** The vertical grid of one pane, under everything else in it. */
export class TimeGridPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: Attached | null = null;
  private view: IPrimitivePaneView;

  constructor(private zoned: ZonedTime[], private barSeconds: number, private color: string) {
    const self = this;
    this.view = {
      zOrder: () => "bottom",
      renderer: () => ({
        draw(target: CanvasRenderingTarget2D) {
          const at = self.attachedTo;
          if (!at) return;
          const ts = at.chart.timeScale();
          const r = ts.getVisibleLogicalRange();
          if (!r) return;
          const x0 = ts.logicalToCoordinate(Math.floor(r.from) as Logical);
          const x1 = ts.logicalToCoordinate((Math.floor(r.from) + 1) as Logical);
          const px = x0 !== null && x1 !== null ? x1 - x0 : 6;
          const { bars } = gridBars(self.zoned, r.from, r.to, self.barSeconds, px);
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio }) => {
            ctx.fillStyle = self.color;
            const w = Math.max(1, Math.floor(horizontalPixelRatio));
            for (const i of bars) {
              const x = ts.logicalToCoordinate(i as Logical);
              if (x === null) continue;
              ctx.fillRect(Math.round(x * horizontalPixelRatio) - Math.floor(w / 2), 0, w, bitmapSize.height);
            }
          });
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
}
