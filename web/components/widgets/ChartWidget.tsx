"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
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
import { apiGet, fmt, fmtBig, fmtPrice, type Candle } from "../../lib/api";
import {
  INDICATOR_BY_ID,
  candlesToBars,
  createInstance,
  instanceLabel,
  resolveParams,
  type BtcDaily,
  type Color,
  type ExternalData,
  type Series,
  type IndicatorDef,
  type IndicatorInstance,
  type IndicatorResult,
  type Params,
} from "../../lib/ta";
import { barSpacing } from "../../lib/ta/core";
import { BackgroundPrimitive, CountdownPrimitive, DrawingsPrimitive, FillPrimitive, type DrawingsSpec } from "../../lib/ta/chart-primitives";
import { IndicatorTableView } from "../chart/IndicatorTableView";
import { chartContext } from "../../lib/chart-context";
import { INTERVALS, INTERVAL_SECONDS, RANGES, defaultInterval, resolveChartView, type ChartInterval, type Range } from "../../lib/chart-intervals";
import { DEFAULT_CHART_INDICATORS, useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { IndicatorPicker, IndicatorSettings } from "../chart/IndicatorDialogs";
import { isCryptoSymbol, usePoll, usSessionActive } from "../../lib/refresh";
import { formatAxisCountdown, formatBarTime, formatCountdown, intervalLabel, isIntradayInterval, secondsUntilClose, type Market } from "../../lib/candle-time";


const CHART_TYPES = ["candles", "bars", "line", "area"] as const;


type ChartType = (typeof CHART_TYPES)[number];

const UP = "#00c853";
/** Axis font size; the countdown label is stacked by the height it gives the price label. */
const AXIS_FONT_SIZE = 10;
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
  // Skip weekends only for markets that don't trade them (crypto bars include Sat/Sun).
  const tradesWeekends = time.slice(-30).some((t) => [0, 6].includes(new Date(t * 1000).getUTCDay()));
  const daily = spacing >= 20 * 3600 && spacing <= 2 * 86_400 && !tradesWeekends;
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

/** Decimals needed to show a price series (sub-cent tokens need many). */
function pricePrecision(candles: Candle[]): number {
  const ref = Math.min(...candles.slice(-50).map((c) => Math.abs(c.low)).filter((x) => x > 0));
  if (!isFinite(ref) || ref >= 1) return 2;
  if (ref >= 0.01) return 4;
  return Math.min(12, Math.ceil(-Math.log10(ref)) + 3);
}

/** Ticks once a second while a candle is still open, so it only re-renders this one label. */
function BarCountdown({ barTime, intervalSeconds, market }: { barTime: number; intervalSeconds: number; market: Market }) {
  const [left, setLeft] = useState(() => secondsUntilClose(barTime, intervalSeconds, market));
  useEffect(() => {
    setLeft(secondsUntilClose(barTime, intervalSeconds, market));
    const id = setInterval(() => setLeft(secondsUntilClose(barTime, intervalSeconds, market)), 1_000);
    return () => clearInterval(id);
  }, [barTime, intervalSeconds, market]);
  // Closed (market shut) or not yet open: nothing is counting down.
  if (left === null) return null;
  return (
    <span className="dim">
      closes in <span className="amber">{formatCountdown(left)}</span>
    </span>
  );
}

function formatValue(v: number | undefined, precision: number): string {
  if (v === undefined || !Number.isFinite(v)) return "∅";
  return Math.abs(v) >= 100_000 ? fmtBig(v) : fmt(v, precision);
}

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setWidgetIndicators = useTerminal((s) => s.setWidgetIndicators);
  const setWidgetChart = useTerminal((s) => s.setWidgetChart);
  // Range and interval are saved with the widget, so they survive a restart. Picking a range
  // also picks its usual interval, which the interval menu shows and can override.
  const { range, interval } = resolveChartView(widget.chartRange, widget.chartInterval, symbol);
  const setRange = (r: Range) => setWidgetChart(widget.id, { chartRange: r, chartInterval: defaultInterval(r, symbol) });
  const setInterval_ = (i: ChartInterval) => setWidgetChart(widget.id, { chartInterval: i });
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  // Price-scale width and time-scale height, so tables sit inside the plotting area like Pine's.
  const [axes, setAxes] = useState({ right: 60, bottom: 26 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<{ key: string; range: LogicalRange } | null>(null);

  const instances = (widget.indicators ?? DEFAULT_CHART_INDICATORS).filter((i) => INDICATOR_BY_ID.has(i.id));
  const saveInstances = (next: IndicatorInstance[]) => setWidgetIndicators(widget.id, next);
  const poll = usePoll(() => {
    const live = isCryptoSymbol(symbol) || usSessionActive();
    const seconds = INTERVAL_SECONDS[interval];
    if (seconds <= 900) return live ? 10_000 : 300_000;
    if (seconds < 86_400) return live ? 30_000 : 600_000;
    return live ? 120_000 : 900_000;
  });

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range, interval],
    queryFn: () => apiGet<Candle[]>(`/api/history/${symbol}?range=${range}&interval=${interval}`),
    // Intraday bars move; daily-and-longer bars only change at the last candle.
    refetchInterval: poll,
  });

  const bars = useMemo(() => (candles && candles.length > 0 ? candlesToBars(candles) : null), [candles]);

  // On-chain series (Bitcoin Thermocap) are fetched only while an indicator that reads them is shown.
  const needsBtcDaily = instances.some((i) => !i.hidden && INDICATOR_BY_ID.get(i.id)?.needs?.includes("btcDaily"));
  const btcDailyPoll = usePoll(600_000);
  const { data: btcDaily } = useQuery({
    queryKey: ["onchain", "btc-daily"],
    queryFn: () => apiGet<BtcDaily>("/api/onchain/btc-daily"),
    enabled: needsBtcDaily,
    staleTime: 300_000,
    refetchInterval: btcDailyPoll,
  });

  // request.security() of other symbols: each indicator names the API paths it needs.
  // The chosen interval is exact; measuring the bars would read a stock's 4h candles (4h, then
  // 20h overnight) as 20h.
  const intervalSeconds = INTERVAL_SECONDS[interval];
  const ctx = useMemo(
    () => chartContext(symbol, intervalSeconds, range, interval),
    [symbol, intervalSeconds, range, interval]
  );
  const instancesJson = JSON.stringify(instances);
  const fetchPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const inst of JSON.parse(instancesJson) as IndicatorInstance[]) {
      const def = INDICATOR_BY_ID.get(inst.id);
      if (inst.hidden || !def?.fetches) continue;
      for (const p of def.fetches(resolveParams(def, inst), ctx)) paths.add(p);
    }
    return [...paths].sort();
  }, [instancesJson, ctx]);
  const fetchPoll = usePoll(() => (isCryptoSymbol(symbol) || usSessionActive() ? 30_000 : 300_000));
  const fetchResults = useQueries({
    queries: fetchPaths.map((path) => ({
      queryKey: ["indicator-fetch", path],
      queryFn: () => apiGet<unknown>(path),
      staleTime: 15_000,
      refetchInterval: fetchPoll,
    })),
  });
  const fetchedKey = fetchResults.map((r) => r.dataUpdatedAt).join(",");
  const fetched = useMemo(() => {
    const out: Record<string, unknown> = {};
    fetchPaths.forEach((path, i) => {
      if (fetchResults[i]?.data !== undefined) out[path] = fetchResults[i].data;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPaths, fetchedKey]);
  const ext = useMemo<ExternalData>(() => ({ btcDaily, chart: ctx, fetched }), [btcDaily, ctx, fetched]);

  const instancesKey = instancesJson;
  const prepared = useMemo(() => {
    if (!bars) return null;
    const list = JSON.parse(instancesKey) as IndicatorInstance[];
    // An input can read another indicator's plot ("plot:<uid>:<key>"), so indicators are
    // computed once everything they read has been; a missing or circular source is an error.
    const refsOf = (inst: IndicatorInstance) =>
      Object.values(inst.params).filter((v): v is string => typeof v === "string" && v.startsWith("plot:"));
    const plots: Record<string, Series> = {};
    const done = new Map<string, Omit<Prepared, "plots">>();
    const run = (inst: IndicatorInstance, forcedError?: string) => {
      const def = INDICATOR_BY_ID.get(inst.id)!;
      const params = resolveParams(def, inst);
      let result: IndicatorResult = { plots: {} };
      let err = forcedError;
      if (!err) {
        try {
          result = def.compute(bars, params, { ...ext, plots });
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
      }
      for (const [key, values] of Object.entries(result.plots)) plots[`plot:${inst.uid}:${key}`] = values;
      done.set(inst.uid, { inst, def, params, label: instanceLabel(def, params), result, error: err });
    };
    let pending = list;
    while (pending.length) {
      const ready = pending.filter((inst) => refsOf(inst).every((r) => r in plots));
      if (ready.length === 0) {
        pending.forEach((inst) => run(inst, "source indicator missing or circular"));
        break;
      }
      ready.forEach((inst) => run(inst));
      pending = pending.filter((inst) => !ready.includes(inst));
    }
    const computed = list.map((inst) => done.get(inst.uid)!);
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
  }, [bars, ext, instancesKey]);

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
    const viewKey = `${symbol}:${range}:${interval}`;
    const pxPrecision = pricePrecision(candles);
    const mainFormat = { type: "price" as const, precision: pxPrecision, minMove: 1 / 10 ** pxPrecision };

    const chart: IChartApi = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: AXIS_FONT_SIZE, attributionLogo: false, panes: { separatorColor: "#262626" } },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#262626", timeVisible: isIntradayInterval(intervalSeconds) },
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
          ? chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat: mainFormat })
          : chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN, priceFormat: mainFormat });
      main.setData([...data, ...future]);
    } else {
      main =
        chartType === "line"
          ? chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1, priceFormat: mainFormat })
          : chart.addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)", priceFormat: mainFormat });
      main.setData([...candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })), ...future]);
    }

    const overlayMarkers: SeriesMarker<Time>[] = [];
    const drawings: DrawingsSpec = { lines: [], labels: [], crosses: [], boxes: [] };
    const toMarkers = (it: Prepared) =>
      (it.result.markers ?? [])
        .filter((m) => m.index >= 0 && m.index < candles.length && m.shape !== "xcross")
        .map((m) => ({ time: times[m.index], position: m.position, shape: m.shape, color: m.color, text: m.text }) as SeriesMarker<Time>);

    for (const it of items) {
      if (it.inst.hidden || it.error) continue;
      const paneIndex = it.def.overlay ? 0 : paneOf.get(it.inst.uid);
      if (paneIndex === undefined) continue;
      // Price-scale overlays (MAs, bands) need the instrument's own precision.
      const precision = it.def.overlay && !it.def.volumeOverlay ? Math.max(it.def.precision ?? 2, pxPrecision) : it.def.precision ?? 2;
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
      if (it.def.overlay) {
        overlayMarkers.push(...toMarkers(it));
        drawings.lines.push(...(it.result.lines ?? []));
        drawings.labels.push(...(it.result.labels ?? []));
        drawings.boxes.push(...(it.result.boxes ?? []));
        for (const m of it.result.markers ?? []) {
          if (m.shape !== "xcross" || m.index < 0 || m.index >= candles.length) continue;
          const above = m.position === "aboveBar";
          drawings.crosses.push({ index: m.index, price: above ? candles[m.index].high : candles[m.index].low, position: above ? "above" : "below", color: m.color });
        }
      }
      else if (it.result.markers?.length) createSeriesMarkers(anchor, toMarkers(it).sort((x, y) => (x.time as number) - (y.time as number)));
    }
    if (overlayMarkers.length) createSeriesMarkers(main, overlayMarkers.sort((x, y) => (x.time as number) - (y.time as number)));
    if (drawings.lines.length || drawings.labels.length || drawings.crosses.length || drawings.boxes.length) main.attachPrimitive(new DrawingsPrimitive(drawings));

    // Time left on the open candle, under the last-price label on the price axis.
    const last = candles[candles.length - 1];
    const lastColor =
      chartType === "line" || chartType === "area" ? "#ff9900" : barColors?.[candles.length - 1] ?? (last.close >= last.open ? UP : DOWN);
    const market: Market = { type: ctx.type, timezone: ctx.timezone };
    const countdown = new CountdownPrimitive(() => {
      const left = secondsUntilClose(last.time, intervalSeconds, market);
      return left === null ? null : { price: last.close, text: formatAxisCountdown(left), color: lastColor };
    }, AXIS_FONT_SIZE * (1 + 5 / 12));
    main.attachPrimitive(countdown);
    const countdownTimer = setInterval(() => {
      if (!document.hidden) countdown.refresh();
    }, 1_000);

    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length - 1) * 1.5 : 1));

    const measurePanes = () => {
      const top = el.getBoundingClientRect().top;
      const tops = chart.panes().map((p) => Math.round((p.getHTMLElement()?.getBoundingClientRect().top ?? top) - top));
      setPaneTops((prev) => (prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops));
      const right = chart.priceScale("right").width();
      const bottom = chart.timeScale().height();
      setAxes((prev) => (prev.right === right && prev.bottom === bottom ? prev : { right, bottom }));
    };
    const raf = requestAnimationFrame(measurePanes);
    const ro = new ResizeObserver(measurePanes);
    ro.observe(el);

    let lastMeasure = 0;
    chart.subscribeCrosshairMove((param) => {
      const idx = param.logical === undefined ? null : Math.round(param.logical);
      setHoverIndex((prev) => {
        const next = idx !== null && idx >= 0 && idx < total ? idx : null;
        return prev === next ? prev : next;
      });
      // Pane separators can be dragged without a resize event; re-measure at most twice a second.
      const now = performance.now();
      if (now - lastMeasure > 500) {
        lastMeasure = now;
        measurePanes();
      }
    });

    if (savedRange.current?.key === viewKey) chart.timeScale().setVisibleLogicalRange(savedRange.current.range);
    else chart.timeScale().fitContent();

    return () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) savedRange.current = { key: viewKey, range: r };
      cancelAnimationFrame(raf);
      clearInterval(countdownTimer);
      ro.disconnect();
      chart.remove();
    };
  }, [candles, chartType, prepared, paneOf, range, interval, intervalSeconds, symbol, ctx]);

  // ---- legend ----
  const n = candles?.length ?? 0;
  const idx = hoverIndex ?? n - 1;
  const candle = candles && n > 0 ? candles[Math.min(idx, n - 1)] : null;

  const update = (uid: string, patch: Partial<IndicatorInstance>) =>
    saveInstances(latestIndicators(widget.id).map((i) => (i.uid === uid ? { ...i, ...patch } : i)));
  const remove = (uid: string) => saveInstances(latestIndicators(widget.id).filter((i) => i.uid !== uid));

  const legendPrecision = candles && n > 0 ? pricePrecision(candles) : 2;
  const legendMarket = useMemo<Market>(() => ({ type: ctx.type, timezone: ctx.timezone }), [ctx.type, ctx.timezone]);
  const hoveringLastBar = hoverIndex === null || hoverIndex >= n - 1;

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
                {formatValue(v, it.def.overlay && !it.def.volumeOverlay ? Math.max(it.def.precision ?? 2, legendPrecision) : it.def.precision ?? 2)}
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
        <select
          className="term-btn"
          value={interval}
          onChange={(e) => setInterval_(e.target.value as ChartInterval)}
          title="Candle interval — each range opens at its usual one"
        >
          {INTERVALS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
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
              <span className="dim">
                <span className="amber">{intervalLabel(intervalSeconds)}</span> {formatBarTime(candle.time, intervalSeconds)}
              </span>
              {hoveringLastBar && <BarCountdown barTime={candle.time} intervalSeconds={intervalSeconds} market={legendMarket} />}
              <span className="dim">O <span className="text-[var(--text)]">{fmtPrice(candle.open)}</span></span>
              <span className="dim">H <span className="up">{fmtPrice(candle.high)}</span></span>
              <span className="dim">L <span className="down">{fmtPrice(candle.low)}</span></span>
              <span className="dim">C <span className={candle.close >= candle.open ? "up" : "down"}>{fmtPrice(candle.close)}</span></span>
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
        {items
          .filter((it) => it.def.overlay && !it.inst.hidden && !it.error && it.result.table)
          .map((it) => (
            <IndicatorTableView key={`table-${it.inst.uid}`} table={it.result.table!} inset={axes} paneBottom={paneTops.length > 1 ? paneTops[1] : undefined} />
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
          plotSources={items
            .filter((it) => it.inst.uid !== editingItem.inst.uid)
            .flatMap((it) =>
              it.def.plots
                .filter((p) => it.result.plots[p.key])
                .map((p) => ({ value: `plot:${it.inst.uid}:${p.key}`, label: `${it.label}: ${p.title}` }))
            )}
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
