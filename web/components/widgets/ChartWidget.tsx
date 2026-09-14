"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import {
  INDICATOR_BY_ID,
  candlesToBars,
  createInstance,
  instanceLabel,
  resolveParams,
  type Color,
  type IndicatorDef,
  type IndicatorInstance,
  type IndicatorResult,
  type Params,
} from "../../lib/ta";
import { barSpacing } from "../../lib/ta/core";
import { BackgroundPrimitive, FillPrimitive } from "../../lib/ta/chart-primitives";
import { DEFAULT_CHART_INDICATORS, useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { IndicatorPicker, IndicatorSettings } from "../chart/IndicatorDialogs";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;

type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];

const UP = "#00c853";
const DOWN = "#ff3d3d";

type PreparedPlot = { values: number[]; colors?: Color[] };

type Prepared = {
  inst: IndicatorInstance;
  def: IndicatorDef;
  params: Params;
  label: string;
  result: IndicatorResult;
  /** Plot values re-indexed onto the chart timeline (offsets applied). */
  plots: Record<string, PreparedPlot>;
  error?: string;
};

/** Future bar times so positive offsets (Ichimoku cloud, Alligator) can be drawn. */
function futureTimes(time: number[], count: number): number[] {
  if (count <= 0 || time.length === 0) return [];
  const spacing = barSpacing(time);
  const daily = spacing >= 20 * 3600 && spacing <= 2 * 86_400;
  const out: number[] = [];
  let t = time[time.length - 1];
  while (out.length < count) {
    t += spacing;
    if (daily) {
      const day = new Date(t * 1000).getUTCDay();
      if (day === 6) t += 2 * 86_400;
      else if (day === 0) t += 86_400;
    }
    out.push(t);
  }
  return out;
}

function shifted<T>(values: T[], offset: number, total: number, empty: T): T[] {
  const out = new Array<T>(total).fill(empty);
  for (let i = 0; i < values.length; i++) {
    const j = i + offset;
    if (j >= 0 && j < total) out[j] = values[i];
  }
  return out;
}

function formatValue(v: number | undefined, precision: number): string {
  if (v === undefined || !Number.isFinite(v)) return "∅";
  return Math.abs(v) >= 100_000 ? fmtBig(v) : fmt(v, precision);
}

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setWidgetIndicators = useTerminal((s) => s.setWidgetIndicators);
  const [range, setRange] = useState<Range>("6M");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<{ key: string; range: LogicalRange } | null>(null);

  const instances = (widget.indicators ?? DEFAULT_CHART_INDICATORS).filter((i) => INDICATOR_BY_ID.has(i.id));
  const saveInstances = (next: IndicatorInstance[]) => setWidgetIndicators(widget.id, next);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range],
    queryFn: () => apiGet<Candle[]>(`/api/history/${symbol}?range=${range}`),
    refetchInterval: range === "1D" ? 8_000 : 60_000,
  });

  const bars = useMemo(() => (candles && candles.length > 0 ? candlesToBars(candles) : null), [candles]);

  const instancesKey = JSON.stringify(instances);
  const prepared = useMemo(() => {
    if (!bars) return null;
    const list = JSON.parse(instancesKey) as IndicatorInstance[];
    const computed = list.map((inst) => {
      const def = INDICATOR_BY_ID.get(inst.id)!;
      const params = resolveParams(def, inst);
      let result: IndicatorResult = { plots: {} };
      let err: string | undefined;
      try {
        result = def.compute(bars, params);
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      return { inst, def, params, label: instanceLabel(def, params), result, error: err };
    });
    const maxFuture = Math.max(
      0,
      ...computed.filter((c) => !c.inst.hidden).flatMap((c) => Object.values(c.result.offsets ?? {}))
    );
    const times = [...bars.time, ...futureTimes(bars.time, maxFuture)];
    const total = times.length;
    const items: Prepared[] = computed.map((c) => {
      const plots: Record<string, PreparedPlot> = {};
      for (const [key, values] of Object.entries(c.result.plots)) {
        const offset = c.result.offsets?.[key] ?? 0;
        const colors = c.result.colors?.[key];
        plots[key] = {
          values: shifted(values, offset, total, NaN),
          colors: colors ? shifted<Color>(colors, offset, total, undefined) : undefined,
        };
      }
      return { ...c, plots };
    });
    return { times: times as UTCTimestamp[], total, items };
  }, [bars, instancesKey]);

  // Pane index per visible separate-pane indicator, in list order.
  const paneOf = useMemo(() => {
    const m = new Map<string, number>();
    let next = 1;
    for (const it of prepared?.items ?? []) {
      if (it.def.overlay || it.inst.hidden || it.error) continue;
      if (it.def.plots.some((p) => !p.display && it.plots[p.key])) m.set(it.inst.uid, next++);
    }
    return m;
  }, [prepared]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0 || !prepared) return;
    const { times, total, items } = prepared;
    const viewKey = `${symbol}:${range}`;

    const chart: IChartApi = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false, panes: { separatorColor: "#262626" } },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#262626", timeVisible: range === "1D" || range === "5D" },
      rightPriceScale: { borderColor: "#262626" },
      autoSize: true,
      // Mouse-wheel is left free for page scrolling — zoom via drag, pinch, or the range buttons instead.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });

    // ---- main price series (with optional barcolor from an indicator) ----
    const barColors = [...items].reverse().find((it) => !it.inst.hidden && it.result.barColors)?.result.barColors;
    const future = times.slice(candles.length).map((time) => ({ time }));
    let main: ISeriesApi<SeriesType>;
    if (chartType === "candles" || chartType === "bars") {
      const data = candles.map((c, i) => {
        const color = barColors?.[i];
        const base = { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
        return color ? { ...base, color, borderColor: color, wickColor: color } : base;
      });
      main =
        chartType === "candles"
          ? chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN })
          : chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN });
      main.setData([...data, ...future]);
    } else {
      main =
        chartType === "line"
          ? chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 })
          : chart.addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)" });
      main.setData([...candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })), ...future]);
    }

    const overlayMarkers: SeriesMarker<Time>[] = [];
    const toMarkers = (it: Prepared) =>
      (it.result.markers ?? [])
        .filter((m) => m.index >= 0 && m.index < candles.length)
        .map((m) => ({ time: times[m.index], position: m.position, shape: m.shape, color: m.color, text: m.text }) as SeriesMarker<Time>);

    for (const it of items) {
      if (it.inst.hidden || it.error) continue;
      const paneIndex = it.def.overlay ? 0 : paneOf.get(it.inst.uid);
      if (paneIndex === undefined) continue;
      const precision = it.def.precision ?? 2;
      const priceFormat =
        it.def.volumeOverlay || precision === 0
          ? ({ type: "volume" } as const)
          : ({ type: "price", precision, minMove: 1 / 10 ** precision } as const);
      const scaleId = it.def.volumeOverlay ? `vol-${it.inst.uid}` : undefined;
      let anchor: ISeriesApi<SeriesType> | null = it.def.overlay && !scaleId ? main : null;

      for (const plot of it.def.plots) {
        const prep = it.plots[plot.key];
        if (!prep || plot.display) continue;
        const common = {
          priceLineVisible: false,
          lastValueVisible: !it.def.volumeOverlay,
          priceFormat,
          ...(scaleId ? { priceScaleId: scaleId } : {}),
          ...(it.def.autoscale === false ? { autoscaleInfoProvider: () => null } : {}),
        };
        const data: Array<{ time: UTCTimestamp; value?: number; color?: string }> = [];
        for (let i = 0; i < total; i++) {
          const v = prep.values[i];
          if (!Number.isFinite(v)) {
            if (!plot.connectGaps) data.push({ time: times[i] });
            continue;
          }
          const color = prep.colors?.[i];
          data.push(color ? { time: times[i], value: v, color } : { time: times[i], value: v });
        }
        let series: ISeriesApi<SeriesType>;
        if (plot.style === "histogram") {
          series = chart.addSeries(HistogramSeries, { ...common, color: plot.color }, paneIndex);
        } else if (plot.style === "area") {
          series = chart.addSeries(AreaSeries, { ...common, lineColor: plot.color, topColor: plot.color, bottomColor: "rgba(0,0,0,0)", lineWidth: plot.width ?? 1 }, paneIndex);
        } else {
          series = chart.addSeries(
            LineSeries,
            {
              ...common,
              color: plot.color,
              lineWidth: plot.width ?? 1,
              lineStyle: plot.dashed ? LineStyle.Dashed : LineStyle.Solid,
              lineType: plot.style === "step" ? LineType.WithSteps : LineType.Simple,
              lineVisible: plot.style !== "circles",
              pointMarkersVisible: plot.style === "circles",
              pointMarkersRadius: 1.5,
              crosshairMarkerVisible: plot.style !== "circles",
            },
            paneIndex
          );
        }
        series.setData(data);
        if (scaleId) series.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        anchor ??= series;
      }
      if (!anchor) continue;

      for (const h of it.result.hlines ?? []) {
        anchor.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: h.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: false, title: "" });
      }
      for (const f of it.result.fills ?? []) {
        const side = (ref: string | number) => (typeof ref === "number" ? new Array<number>(total).fill(ref) : it.plots[ref]?.values);
        const a = side(f.a);
        const b = side(f.b);
        if (!a || !b) continue;
        const offset = typeof f.a === "string" ? it.result.offsets?.[f.a] ?? 0 : 0;
        const color = typeof f.color === "string" ? f.color : shifted<Color>(f.color, offset, total, undefined);
        anchor.attachPrimitive(new FillPrimitive({ times, a, b, color }));
      }
      if (it.result.bgColors) {
        anchor.attachPrimitive(new BackgroundPrimitive(times, shifted<Color>(it.result.bgColors, 0, total, undefined)));
      }
      if (it.def.overlay) overlayMarkers.push(...toMarkers(it));
      else if (it.result.markers?.length) createSeriesMarkers(anchor, toMarkers(it).sort((x, y) => (x.time as number) - (y.time as number)));
    }
    if (overlayMarkers.length) createSeriesMarkers(main, overlayMarkers.sort((x, y) => (x.time as number) - (y.time as number)));

    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length - 1) * 1.5 : 1));

    const measurePanes = () => {
      const top = el.getBoundingClientRect().top;
      const tops = chart.panes().map((p) => Math.round((p.getHTMLElement()?.getBoundingClientRect().top ?? top) - top));
      setPaneTops((prev) => (prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops));
    };
    const raf = requestAnimationFrame(measurePanes);
    const ro = new ResizeObserver(measurePanes);
    ro.observe(el);

    chart.subscribeCrosshairMove((param) => {
      const idx = param.logical === undefined ? null : Math.round(param.logical);
      setHoverIndex(idx !== null && idx >= 0 && idx < total ? idx : null);
      measurePanes(); // pane separators can be dragged without a resize event
    });

    if (savedRange.current?.key === viewKey) chart.timeScale().setVisibleLogicalRange(savedRange.current.range);
    else chart.timeScale().fitContent();

    return () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) savedRange.current = { key: viewKey, range: r };
      cancelAnimationFrame(raf);
      ro.disconnect();
      chart.remove();
    };
  }, [candles, chartType, prepared, paneOf, range, symbol]);

  // ---- legend ----
  const n = candles?.length ?? 0;
  const idx = hoverIndex ?? n - 1;
  const candle = candles && n > 0 ? candles[Math.min(idx, n - 1)] : null;

  const update = (uid: string, patch: Partial<IndicatorInstance>) =>
    saveInstances(latestIndicators(widget.id).map((i) => (i.uid === uid ? { ...i, ...patch } : i)));
  const remove = (uid: string) => saveInstances(latestIndicators(widget.id).filter((i) => i.uid !== uid));

  const legendRow = (it: Prepared) => (
    <div key={it.inst.uid} className="group flex gap-2 items-center pointer-events-auto w-fit max-w-full">
      <span className={`whitespace-nowrap ${it.inst.hidden ? "text-[#4d4d4d]" : "text-[var(--text)]"}`}>{it.label}</span>
      {it.error ? (
        <span className="down truncate">error: {it.error}</span>
      ) : (
        !it.inst.hidden &&
        it.def.plots
          .filter((p) => p.display !== "none" && it.plots[p.key])
          .map((p) => {
            const prep = it.plots[p.key];
            const v = prep.values[idx];
            return (
              <span key={p.key} style={{ color: prep.colors?.[idx] ?? p.color }} className="whitespace-nowrap">
                {formatValue(v, it.def.precision ?? 2)}
              </span>
            );
          })
      )}
      <span className="hidden group-hover:flex gap-1.5 ml-1 bg-[#0a0a0a] px-1">
        <button title={it.inst.hidden ? "Show" : "Hide"} className="dim hover:text-[var(--text)]" onClick={() => update(it.inst.uid, { hidden: !it.inst.hidden })}>
          {it.inst.hidden ? "◌" : "◉"}
        </button>
        {it.def.inputs.length > 0 && (
          <button title="Settings" className="dim hover:text-[var(--amber)]" onClick={() => setEditing(it.inst.uid)}>
            ⚙
          </button>
        )}
        <button title="Remove" className="dim hover:text-[var(--down)]" onClick={() => remove(it.inst.uid)}>
          ✕
        </button>
      </span>
    </div>
  );

  const items = prepared?.items ?? [];
  const mainLegend = items.filter((it) => it.def.overlay || !paneOf.has(it.inst.uid));
  const editingItem = items.find((it) => it.inst.uid === editing);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {RANGES.map((r) => (
          <button key={r} className={`term-btn ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
        <span className="w-2" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <span className="w-2" />
        <button className="term-btn" onClick={() => setPickerOpen(true)} title="Add indicators">
          ƒx INDICATORS
        </button>
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
        {candle && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none max-w-[85%]">
            <div className="flex gap-3 bg-[rgba(10,10,10,0.7)] w-fit px-1">
              <span className="dim">O <span className="text-[var(--text)]">{fmt(candle.open)}</span></span>
              <span className="dim">H <span className="up">{fmt(candle.high)}</span></span>
              <span className="dim">L <span className="down">{fmt(candle.low)}</span></span>
              <span className="dim">C <span className={candle.close >= candle.open ? "up" : "down"}>{fmt(candle.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(candle.volume)}</span></span>
            </div>
            {mainLegend.map(legendRow)}
          </div>
        )}
        {items
          .filter((it) => paneOf.has(it.inst.uid))
          .map((it) => (
            <div
              key={it.inst.uid}
              className="absolute left-2 z-10 text-[11px] pointer-events-none max-w-[85%]"
              style={{ top: (paneTops[paneOf.get(it.inst.uid)!] ?? -9999) + 2 }}
            >
              {legendRow(it)}
            </div>
          ))}
        <div ref={containerRef} className="w-full h-full" />
      </div>
      {pickerOpen && (
        <IndicatorPicker
          onClose={() => setPickerOpen(false)}
          onAdd={(def) => saveInstances([...latestIndicators(widget.id), createInstance(def.id)])}
        />
      )}
      {editingItem && (
        <IndicatorSettings
          def={editingItem.def}
          instance={editingItem.inst}
          onClose={() => setEditing(null)}
          onApply={(params) => update(editingItem.inst.uid, { params })}
        />
      )}
    </div>
  );
}

/** Latest indicator list straight from the store, so rapid adds in the picker don't drop each other. */
function latestIndicators(widgetId: string): IndicatorInstance[] {
  const w = useTerminal.getState().widgets.find((x) => x.id === widgetId);
  return w?.indicators ?? DEFAULT_CHART_INDICATORS;
}
