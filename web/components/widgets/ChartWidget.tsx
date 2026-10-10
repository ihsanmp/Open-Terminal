"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, apiGetWithStale, fmt, fmtBig, fmtPrice, type Candle } from "../../lib/api";
import {
  INDICATOR_BY_ID,
  candlesToBars,
  createInstance,
  instanceLabel,
  resolveParams,
  type BtcDaily,
  type Color,
  type ExternalData,
  type IndicatorStyle,
  type LineDash,
  type Series,
  timeframeKind,
  type IndicatorDef,
  type IndicatorInstance,
  type IndicatorResult,
  type Params,
} from "../../lib/ta";
import { barSpacing } from "../../lib/ta/core";
import { movedBound, styledLevels, styleResult } from "../../lib/ta/style";
import { BackgroundPrimitive, CountdownPrimitive, DrawingsPrimitive, FillPrimitive, type DrawingsSpec } from "../../lib/ta/chart-primitives";
import { IndicatorTableView } from "../chart/IndicatorTableView";
import { chartContext } from "../../lib/chart-context";
import { INTERVAL_LABEL, INTERVAL_SECONDS, INTERVAL_SOURCE, isRangeInterval, latestBarsView, loadRange, orderedFavorites, resolveInterval, type ChartInterval } from "../../lib/chart-intervals";
import { groupDays, groupHours, rangeBars } from "../../lib/chart-aggregate";
import { TimeGridPrimitive, zonedTimes } from "../../lib/chart-grid";
import { priceDigits } from "../../lib/watchlist";
import { IntervalMenu } from "../chart/IntervalMenu";
import { ChartSettings } from "../chart/ChartSettings";
import { candleOptions, formatChartTime, formatTick, prevCloseColors, resolveChartStyle, resolveTimezone, risingBars } from "../../lib/chart-style";
import { DEFAULT_CHART_INDICATORS, useTerminal, useWidgetSetting, useWidgetSymbol, type ChartScaleMode, type WidgetInstance } from "../../store/terminal";
import { isPinch, keyAction, panPrice, scalePrice, shiftSpan, wheelPixels, zoomFactor, zoomSpan, type Span } from "../../lib/chart-nav";
import { IndicatorPicker, IndicatorSettings } from "../chart/IndicatorDialogs";
import { PriceScaleMenu } from "../chart/PriceScaleMenu";
import { isCryptoSymbol, usePoll, usSessionActive } from "../../lib/refresh";
import { formatAxisCountdown, formatCountdown, isIntradayInterval, secondsUntilClose, type Market } from "../../lib/candle-time";
import { fontPx } from "../../lib/font-scale";
import { DrawingLayer } from "../../lib/drawings/layer";
import { attachDrawing, type PaneLayer } from "../../lib/drawings/controller";
import { TOOL_BY_ID, TOOL_FEATURES, timeframeKindOf, type Drawing, type DrawingTemplate, type DrawPoint, type ToolGroup, type ToolId } from "../../lib/drawings/tools";
import { DrawingSettings } from "../chart/DrawingSettings";
import { DrawingToolbar, FavoritesBar } from "../chart/DrawingToolbar";
import { CursorEffects } from "../chart/CursorEffects";
import { crosshairFor, cssCursor, type CursorMode } from "../../lib/chart-cursor";
import { ColorPicker } from "../chart/ColorPicker";


const CHART_TYPES = ["candles", "bars", "line", "area"] as const;


type ChartType = (typeof CHART_TYPES)[number];

/** Axis font size; the countdown label is stacked by the height it gives the price label. */
const AXIS_FONT_SIZE = fontPx(10);

type PreparedPlot = { values: number[]; colors?: Color[] };

type Prepared = {
  inst: IndicatorInstance;
  def: IndicatorDef;
  params: Params;
  label: string;
  result: IndicatorResult;
  /** The output before the Style tab's drawing and color edits (the colors it lists are these). */
  raw: IndicatorResult;
  /** Plot values re-indexed onto the chart timeline (offsets applied). */
  plots: Record<string, PreparedPlot>;
  error?: string;
};

const PRICE_SCALE_MODE = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
  indexed: PriceScaleMode.IndexedTo100,
} as const;

/** Chart actions for the navigation buttons, hotkeys and the price scale menu. */
type ChartNav = {
  zoomBy: (factor: number) => void;
  scrollBy: (bars: number) => void;
  first: () => void;
  last: () => void;
  reset: () => void;
  auto: () => void;
  overPriceAxis: (clientX: number, clientY: number) => boolean;
};

const LINE_STYLE: Record<LineDash, LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };

/** Shown on the chart right now: not hidden, not failing, and on for this kind of interval
 *  (the Visibility tab). */
const shownOn = (it: { inst: IndicatorInstance; error?: string }, intervalSeconds: number) =>
  !it.inst.hidden && !it.error && it.inst.style?.visibility?.[timeframeKind(intervalSeconds)] !== false;

/** Decimals for an indicator's values: the Style tab's precision, else its own (overlays on the
 *  price scale need at least the instrument's). */
function valuePrecision(def: IndicatorDef, style: IndicatorStyle | undefined, pricePrecision: number): number {
  if (style?.precision !== undefined) return style.precision;
  return def.overlay && !def.volumeOverlay ? Math.max(def.precision ?? 2, pricePrecision) : def.precision ?? 2;
}

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

/**
 * The bar under the pointer, kept out of the chart's state: as the pointer crosses bars only the
 * legends that show its values re-render (Hovered), not the whole chart with its toolbars and menus.
 */
type HoverStore = { get: () => number | null; set: (i: number | null) => void; subscribe: (f: () => void) => () => void };
function createHoverStore(): HoverStore {
  let value: number | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (i) => {
      if (i === value) return;
      value = i;
      subs.forEach((f) => f());
    },
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
function Hovered({ store, children }: { store: HoverStore; children: (i: number | null) => React.ReactNode }) {
  const i = useSyncExternalStore(store.subscribe, store.get, store.get);
  return <>{children(i)}</>;
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
  // The interval is saved with the widget; starred intervals sit on every chart's toolbar, as on
  // TradingView. The chart loads history for the interval and opens on the latest bars.
  const interval = resolveInterval(widget.chartInterval);
  const range = loadRange(interval);
  const favoriteIntervals = useTerminal((s) => s.favoriteIntervals);
  const toggleFavoriteInterval = useTerminal((s) => s.toggleFavoriteInterval);
  const setInterval_ = (i: ChartInterval) => setWidgetChart(widget.id, { chartInterval: i });
  // Price scale like TradingView's corner buttons: auto-fit (A), logarithmic (L), percentage (%).
  const scaleMode = widget.chartScale ?? "normal";
  const setScaleMode = (m: ChartScaleMode) => setWidgetChart(widget.id, { chartScale: m });
  const invert = Boolean(widget.chartInvert);
  const setInvert = (on: boolean) => setWidgetChart(widget.id, { chartInvert: on });
  const navRef = useRef<ChartNav | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [scaleMenu, setScaleMenu] = useState<{ x: number; y: number } | null>(null);
  /** TradingView shows its navigation buttons while the pointer is near the bottom of the chart. */
  const [navVisible, setNavVisible] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const chartRef = useRef<IChartApi | null>(null);
  /** A price range the user set by hand (dragging or wheeling the price axis), kept across data refreshes. */
  const savedPrice = useRef<{ key: string; range: { from: number; to: number } } | null>(null);
  const [chartType, setChartType] = useWidgetSetting<ChartType>("chartType", "candles");
  const hover = useMemo(createHoverStore, []);
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  // Price-scale width and time-scale height, so tables sit inside the plotting area like Pine's.
  const [axes, setAxes] = useState({ right: 60, bottom: 26 });
  const [pickerOpen, setPickerOpen] = useState(false);
  // TradingView's chart Settings: candle colors, precision, timezone, canvas.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const styleKey = JSON.stringify(widget.chartStyle ?? {});
  const chartStyle = useMemo(() => resolveChartStyle(JSON.parse(styleKey)), [styleKey]);
  const [editing, setEditing] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<{ key: string; range: LogicalRange } | null>(null);

  // ---- drawings (lib/drawings): saved with the chart, per symbol, as on TradingView ----
  const [allDrawings, setAllDrawings] = useWidgetSetting<Record<string, Drawing[]>>("drawings", {});
  const drawings = useMemo(() => allDrawings[symbol] ?? [], [allDrawings, symbol]);
  const setDrawings = (f: (list: Drawing[]) => Drawing[]) => setAllDrawings((all) => ({ ...all, [symbol]: f(all[symbol] ?? []) }));
  const [tool, setTool] = useState<ToolId | null>(null);
  const [lastTool, setLastTool] = useWidgetSetting<Partial<Record<ToolGroup, ToolId>>>("drawLastTool", {});
  const [magnet, setMagnet] = useWidgetSetting("drawMagnet", false);
  const [drawingsLocked, setDrawingsLocked] = useWidgetSetting("drawLocked", false);
  const [drawingsHidden, setDrawingsHidden] = useWidgetSetting("drawHidden", false);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  // The cursor (TradingView's Cross, Dot, Arrow, Demonstration, Magic, Eraser), the long-press
  // values tooltip, and the starred cursors and tools on the favorites bar.
  const [cursorMode, setCursorMode] = useWidgetSetting<CursorMode>("cursorMode", "cross");
  const [valuesTooltip, setValuesTooltip] = useWidgetSetting("valuesTooltip", true);
  const [favorites, setFavorites] = useWidgetSetting<string[]>("drawFavorites", []);
  const [longPressAt, setLongPressAt] = useState<{ x: number; y: number } | null>(null);
  const crosshairRef = useRef<CursorMode>("cross");
  crosshairRef.current = tool ? "cross" : cursorMode;
  // Each tool's look saved with "Save as default", for its new drawings; the open Settings.
  const [drawTemplates, setDrawTemplates] = useWidgetSetting<Partial<Record<ToolId, DrawingTemplate>>>("drawTemplates", {});
  const drawTemplatesRef = useRef(drawTemplates);
  drawTemplatesRef.current = drawTemplates;
  const [drawingSettings, setDrawingSettings] = useState<string | null>(null);
  /** The price pane's drawing layer, and every pane's (the indicators' below it too). */
  const layerRef = useRef<DrawingLayer | null>(null);
  const layersRef = useRef<DrawingLayer[]>([]);
  const placingRef = useRef<DrawPoint[] | null>(null) as React.MutableRefObject<DrawPoint[] | null> & { pane?: string | null };
  const drawStateRef = useRef({ tool, magnet, locked: drawingsLocked, drawings, selected: selectedDrawing, cursor: cursorMode });
  const drawHiddenRef = useRef(drawingsHidden);
  drawHiddenRef.current = drawingsHidden;
  const setDrawingsRef = useRef(setDrawings);
  drawStateRef.current = { tool, magnet, locked: drawingsLocked, drawings, selected: selectedDrawing, cursor: cursorMode };
  const pickTool = (t: ToolId | null) => {
    placingRef.current = null;
    placingRef.pane = null;
    for (const l of layersRef.current) l.setLive(null);
    setTool(t);
    if (t) {
      setSelectedDrawing(null);
      setLastTool((m) => ({ ...m, [TOOL_BY_ID.get(t)!.group]: t }));
    }
  };
  setDrawingsRef.current = setDrawings;
  // The layer follows the saved drawings, the selection and hiding without rebuilding the chart.
  useEffect(() => {
    for (const l of layersRef.current) l.set({ drawings, selected: selectedDrawing, hidden: drawingsHidden });
  }, [drawings, selectedDrawing, drawingsHidden]);
  // Another symbol: nothing half-placed or selected carries over.
  useEffect(() => {
    placingRef.current = null;
    placingRef.pane = null;
    setSelectedDrawing(null);
  }, [symbol]);
  // The crosshair's lines show with the Cross only (and while drawing).
  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: crosshairFor(tool ? "cross" : cursorMode) });
  }, [tool, cursorMode]);
  const selected = drawings.find((d) => d.id === selectedDrawing) ?? null;
  const patchDrawing = (id: string, patch: Partial<Drawing>) => setDrawings((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  /** A drawing's look changed: kept as its tool's for the next one drawn, as TradingView does. */
  const restyle = (d: Drawing, patch: Partial<Drawing>) => {
    patchDrawing(d.id, patch);
    const next = { ...d, ...patch };
    setDrawTemplates((m) => ({ ...m, [d.tool]: { color: next.color, width: next.width, dash: next.dash, options: next.options } }));
  };
  const removeDrawing = (id: string) => {
    setDrawings((list) => list.filter((d) => d.id !== id));
    setSelectedDrawing(null);
  };

  const instances = (widget.indicators ?? DEFAULT_CHART_INDICATORS).filter((i) => INDICATOR_BY_ID.has(i.id));
  const saveInstances = (next: IndicatorInstance[]) => setWidgetIndicators(widget.id, next);
  const poll = usePoll(() => {
    const live = isCryptoSymbol(symbol) || usSessionActive();
    const seconds = INTERVAL_SECONDS[interval];
    if (seconds <= 900) return live ? 10_000 : 300_000;
    if (seconds < 86_400) return live ? 30_000 : 600_000;
    return live ? 120_000 : 900_000;
  });

  // The API's bars for the interval, or those it is built from (H2 from H1, D3 from D1, range
  // bars from 1-minute ones; lib/chart-aggregate).
  const source = INTERVAL_SOURCE[interval];
  const rangeChart = isRangeInterval(interval);
  const { data: history, error } = useQuery({
    queryKey: ["history", symbol, range, source.base],
    queryFn: () => apiGetWithStale<Candle[]>(`/api/history/${symbol}?range=${range}&interval=${source.base}`),
    // Intraday bars move; daily-and-longer bars only change at the last candle. Right after a
    // launch the API answers from its disk cache and marks it stale: ask again shortly.
    refetchInterval: (q) => (q.state.data?.stale ? 2_500 : poll()),
  });
  const liveCandles = useMemo(() => {
    const raw = history?.data;
    if (!raw || raw.length === 0) return raw;
    if (source.ticks) return rangeBars(raw, source.ticks * 10 ** -priceDigits(symbol, raw[raw.length - 1].close));
    if (!source.group) return raw;
    const market = chartContext(symbol, 0);
    return source.base === "1h" ? groupHours(raw, source.group, market.type, market.timezone) : groupDays(raw, source.group, market.type);
  }, [history?.data, source.ticks, source.group, source.base, symbol]);

  const bars = useMemo(() => (liveCandles && liveCandles.length > 0 ? candlesToBars(liveCandles) : null), [liveCandles]);

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
    // request.security() fetches what the API serves, so the interval's source.
    () => chartContext(symbol, intervalSeconds, range, source.base),
    [symbol, intervalSeconds, range, source.base]
  );
  const timezone = resolveTimezone(chartStyle, ctx.timezone);
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
  const livePrepared = useMemo(() => {
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
      done.set(inst.uid, { inst, def, params, label: instanceLabel(def, params), result: styleResult(result, inst.style), raw: result, error: err });
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
          // ±Infinity (an overflow at extreme settings) would break the chart's series; draw a gap.
          values: shifted(values.map((v) => (v === Infinity || v === -Infinity ? NaN : v)), offset, total, NaN),
          colors: colors ? shifted<Color>(colors, offset, total, undefined) : undefined,
        };
      }
      return { ...c, plots };
    });
    return { times: times as UTCTimestamp[], total, items };
  }, [bars, ext, instancesKey]);

  // New bars wait while a drawing is being placed or moved: putting them on the chart rebuilds
  // it (a tenth of a second), which dropped the drawing under the pointer mid-move. They go on as
  // soon as it's let go. Another symbol, interval, range or indicator list shows at once.
  const dataKey = `${symbol}|${interval}|${range}|${instancesKey}`;
  const [shown, setShown] = useState({ key: dataKey, candles: liveCandles, prepared: livePrepared });
  useEffect(() => {
    if (shown.key === dataKey && shown.candles === liveCandles && shown.prepared === livePrepared) return;
    const apply = () => setShown({ key: dataKey, candles: liveCandles, prepared: livePrepared });
    const busy = () => shown.key === dataKey && (layerRef.current?.isBusy() ?? false);
    if (!busy()) return apply();
    const id = setInterval(() => {
      if (busy()) return;
      clearInterval(id);
      apply();
    }, 250);
    return () => clearInterval(id);
  }, [dataKey, liveCandles, livePrepared, shown]);
  const candles = shown.key === dataKey ? shown.candles : liveCandles;
  const prepared = shown.key === dataKey ? shown.prepared : livePrepared;

  // Pane index per visible separate-pane indicator, in list order.
  const paneOf = useMemo(() => {
    const m = new Map<string, number>();
    let next = 1;
    for (const it of prepared?.items ?? []) {
      if (it.def.overlay || !shownOn(it, intervalSeconds)) continue;
      const drawn = it.def.plots.some((p) => !p.display && it.plots[p.key] && it.inst.style?.plots?.[p.key]?.visible !== false);
      if (drawn) m.set(it.inst.uid, next++);
    }
    return m;
  }, [prepared, intervalSeconds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0 || !prepared) return;
    const { times, total, items } = prepared;
    const viewKey = `${symbol}:${range}:${interval}`;
    const priceKey = `${viewKey}:${scaleMode}:${invert}`;
    const pxPrecision = chartStyle.precision === "default" ? pricePrecision(candles) : chartStyle.precision;
    const mainFormat = { type: "price" as const, precision: pxPrecision, minMove: 1 / 10 ** pxPrecision };
    const intraday = isIntradayInterval(intervalSeconds);

    const chart: IChartApi = createChart(el, {
      layout: { background: { color: chartStyle.background }, textColor: "#808080", fontSize: AXIS_FONT_SIZE, attributionLogo: false, panes: { separatorColor: "#262626" } },
      grid: {
        // Vertical lines come from TimeGridPrimitive (lib/chart-grid), which follows the interval.
        vertLines: { visible: false },
        horzLines: { color: chartStyle.horzGrid.color, visible: chartStyle.horzGrid.visible },
      },
      // Times in the chosen timezone (the settings' Timezone); daily and longer bars are dates.
      localization: { timeFormatter: (t: Time) => formatChartTime(t as number, intraday, timezone) },
      crosshair: crosshairFor(crosshairRef.current),
      // A low minimum bar spacing lets decades of daily bars fit on screen when zoomed out, as on TradingView.
      timeScale: {
        borderColor: "#262626",
        timeVisible: intraday,
        minBarSpacing: 0.01,
        // The vertical grid is drawn apart from the axis marks (lib/chart-grid), so the axis is free
        // to label as densely as it fits, as TradingView's does.
        uniformDistribution: false,
        tickMarkFormatter: (t: Time, kind: number) => formatTick(t as number, kind, intraday, timezone),
      },
      rightPriceScale: { borderColor: "#262626", mode: PRICE_SCALE_MODE[scaleMode], invertScale: invert },
      autoSize: true,
      // Dragging pans, dragging an axis stretches it and double-clicking it resets it; the wheel is
      // handled below, the way TradingView does it.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
    });

    // ---- main price series (with optional barcolor from an indicator) ----
    const barColors = [...items].reverse().find((it) => shownOn(it, intervalSeconds) && it.result.barColors)?.result.barColors;
    const future = times.slice(candles.length).map((time) => ({ time }));
    let main: ISeriesApi<SeriesType>;
    if (chartType === "candles" || chartType === "bars") {
      // An indicator's barcolor wins; otherwise "Color bars based on previous close" when it's on.
      const byPrevClose = prevCloseColors(candles, chartStyle);
      const data = candles.map((c, i) => {
        const color = barColors?.[i];
        const base = { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
        if (color) return { ...base, color, borderColor: color, wickColor: color };
        if (!byPrevClose) return base;
        return chartType === "candles" ? { ...base, ...byPrevClose[i] } : { ...base, color: byPrevClose[i].borderColor };
      });
      main =
        chartType === "candles"
          ? chart.addSeries(CandlestickSeries, { ...candleOptions(chartStyle), priceFormat: mainFormat })
          : chart.addSeries(BarSeries, { upColor: chartStyle.borders.up, downColor: chartStyle.borders.down, priceFormat: mainFormat });
      main.setData([...data, ...future]);
    } else {
      main =
        chartType === "line"
          ? chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1, priceFormat: mainFormat, crosshairMarkerVisible: false })
          : chart.addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)", priceFormat: mainFormat, crosshairMarkerVisible: false });
      main.setData([...candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })), ...future]);
    }

    // The vertical grid, after the interval (lib/chart-grid): on the price pane, and on each
    // indicator pane as it is made below.
    const zoned = zonedTimes(times as number[], timezone);
    const gridPanes = new Set<number>([0]);
    if (chartStyle.vertGrid.visible) main.attachPrimitive(new TimeGridPrimitive(zoned, intervalSeconds, chartStyle.vertGrid.color));

    const overlayMarkers: SeriesMarker<Time>[] = [];
    const drawings: DrawingsSpec = { lines: [], labels: [], crosses: [], boxes: [] };
    const toMarkers = (it: Prepared) =>
      (it.result.markers ?? [])
        .filter((m) => m.index >= 0 && m.index < candles.length && m.shape !== "xcross")
        .map((m) => ({ time: times[m.index], position: m.position, shape: m.shape, color: m.color, text: m.text }) as SeriesMarker<Time>);

    /** Each indicator pane's first series, for its drawings to go on. */
    const paneAnchors: Array<{ uid: string; index: number; anchor: ISeriesApi<SeriesType>; precision: number }> = [];
    for (const it of items) {
      if (!shownOn(it, intervalSeconds)) continue;
      const paneIndex = it.def.overlay ? 0 : paneOf.get(it.inst.uid);
      if (paneIndex === undefined) continue;
      const style = it.inst.style ?? {};
      const precision = valuePrecision(it.def, style, pxPrecision);
      const priceFormat =
        it.def.volumeOverlay || precision === 0
          ? ({ type: "volume" } as const)
          : ({ type: "price", precision, minMove: 1 / 10 ** precision } as const);
      const scaleId = it.def.volumeOverlay ? `vol-${it.inst.uid}` : undefined;
      let anchor: ISeriesApi<SeriesType> | null = it.def.overlay && !scaleId ? main : null;

      for (const plot of it.def.plots) {
        const prep = it.plots[plot.key];
        const o = style.plots?.[plot.key] ?? {};
        if (!prep || plot.display || o.visible === false) continue;
        // A color chosen on the Style tab replaces per-bar colors too, as on TradingView.
        const baseColor = o.color ?? plot.color;
        const barColors = o.color ? undefined : prep.colors;
        const lineWidth = (o.width ?? plot.width ?? 1) as 1 | 2 | 3 | 4;
        const lineStyle = LINE_STYLE[o.dash ?? (plot.dotted ? "dotted" : plot.dashed ? "dashed" : "solid")];
        const common = {
          priceLineVisible: false,
          // No dot where the crosshair crosses each line, as on TradingView.
          crosshairMarkerVisible: false,
          lastValueVisible: !it.def.volumeOverlay && style.labelsOnPriceScale !== false,
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
          const color = barColors?.[i];
          data.push(color ? { time: times[i], value: v, color } : { time: times[i], value: v });
        }
        const kind = o.style ?? plot.style;
        let series: ISeriesApi<SeriesType>;
        if (kind === "histogram") {
          series = chart.addSeries(HistogramSeries, { ...common, color: baseColor }, paneIndex);
        } else if (kind === "area") {
          series = chart.addSeries(AreaSeries, { ...common, lineColor: baseColor, topColor: baseColor, bottomColor: "rgba(0,0,0,0)", lineWidth, lineStyle }, paneIndex);
        } else {
          series = chart.addSeries(
            LineSeries,
            {
              ...common,
              color: baseColor,
              lineWidth,
              lineStyle,
              lineType: kind === "step" ? LineType.WithSteps : LineType.Simple,
              lineVisible: kind !== "circles",
              pointMarkersVisible: kind === "circles",
              pointMarkersRadius: 1.5,
            },
            paneIndex
          );
        }
        series.setData(data);
        if (scaleId) series.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        anchor ??= series;
      }
      if (!anchor) continue;
      if (!it.def.overlay) paneAnchors.push({ uid: it.inst.uid, index: paneIndex, anchor, precision });
      if (!it.def.overlay && !gridPanes.has(paneIndex)) {
        gridPanes.add(paneIndex);
        if (chartStyle.vertGrid.visible) anchor.attachPrimitive(new TimeGridPrimitive(zoned, intervalSeconds, chartStyle.vertGrid.color));
      }

      for (const h of styledLevels(it.result, style)) {
        if (!h.visible) continue;
        anchor.createPriceLine({ price: h.price, color: h.color, lineWidth: h.width, lineStyle: LINE_STYLE[h.dash], axisLabelVisible: false, title: "" });
      }
      for (const [fi, f0] of (it.result.fills ?? []).entries()) {
        const fs = style.fills?.[fi];
        if (fs?.visible === false) continue;
        const f = fs?.color ? { ...f0, color: fs.color } : f0;
        const side = (ref: string | number) => {
          const at = movedBound(ref, it.result, style);
          return typeof at === "number" ? new Array<number>(total).fill(at) : it.plots[at]?.values;
        };
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
      else {
        if (it.result.markers?.length) createSeriesMarkers(anchor, toMarkers(it).sort((x, y) => (x.time as number) - (y.time as number)));
        // Lines, labels and boxes of an indicator in its own pane (divergence lines on an RSI).
        const { lines = [], labels = [], boxes = [] } = it.result;
        if (lines.length || labels.length || boxes.length) anchor.attachPrimitive(new DrawingsPrimitive({ lines, labels, boxes, crosses: [] }));
      }
    }
    if (overlayMarkers.length) createSeriesMarkers(main, overlayMarkers.sort((x, y) => (x.time as number) - (y.time as number)));
    if (drawings.lines.length || drawings.labels.length || drawings.crosses.length || drawings.boxes.length) main.attachPrimitive(new DrawingsPrimitive(drawings));

    // Time left on the open candle, under the last-price label on the price axis.
    const last = candles[candles.length - 1];
    const lastColor =
      chartType === "line" || chartType === "area"
        ? "#ff9900"
        : barColors?.[candles.length - 1] ?? (risingBars(candles.slice(-2), chartStyle.colorByPrevClose).at(-1) ? chartStyle.body.up : chartStyle.body.down);
    const market: Market = { type: ctx.type, timezone: ctx.timezone };
    const countdown = new CountdownPrimitive(() => {
      // Range bars close on price, not on the clock.
      const left = rangeChart ? null : secondsUntilClose(last.time, intervalSeconds, market);
      return left === null ? null : { price: last.close, text: formatAxisCountdown(left), color: lastColor };
    }, AXIS_FONT_SIZE * (1 + 5 / 12));
    main.attachPrimitive(countdown);
    const countdownTimer = setInterval(() => {
      if (!document.hidden) countdown.refresh();
    }, 1_000);

    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length - 1) * 1.5 : 1));
    // The panes (not the axes) take the cursor's pointer (globals.css: .chart-cursor); marked
    // now and again when they're measured, as a pane can be added later.
    const markPanes = () => {
      for (const p of chart.panes()) p.getHTMLElement()?.setAttribute("data-chart-pane", "");
    };
    markPanes();

    const measurePanes = () => {
      const top = el.getBoundingClientRect().top;
      markPanes();
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
      hover.set(idx !== null && idx >= 0 && idx < total ? idx : null);
      // Pane separators can be dragged without a resize event; re-measure at most twice a second.
      const now = performance.now();
      if (now - lastMeasure > 500) {
        lastMeasure = now;
        measurePanes();
      }
    });

    if (savedRange.current?.key === viewKey) chart.timeScale().setVisibleLogicalRange(savedRange.current.range);
    // The latest bars in view; the rest of the loaded history sits to the left.
    else chart.timeScale().setVisibleLogicalRange(latestBarsView(candles.length, el.clientWidth * 0.94));

    // ---- navigation and price scale, as on TradingView (lib/chart-nav.ts) ----
    const priceScale = chart.priceScale("right");
    const ts = chart.timeScale();
    if (savedPrice.current?.key === priceKey) {
      priceScale.setAutoScale(false);
      priceScale.setVisibleRange(savedPrice.current.range);
    } else savedPrice.current = null;
    chartRef.current = chart;
    // Deferred syncs can land after the chart is gone (a click that switches page).
    let disposed = false;
    const syncAuto = () => {
      if (!disposed) setAutoScale(priceScale.options().autoScale);
    };
    syncAuto();
    const isLog = scaleMode === "log";
    const maxBars = Math.max(200, total * 1.2 + 50);
    const visible = () => ts.getVisibleLogicalRange();
    const zoomBy = (factor: number, anchor?: number) => {
      const r = visible();
      if (r) ts.setVisibleLogicalRange(zoomSpan(r, factor, anchor ?? r.to, 10, maxBars));
    };
    const scrollBy = (bars: number) => {
      const r = visible();
      if (r) ts.setVisibleLogicalRange(shiftSpan(r, bars));
    };
    const autoOn = () => {
      savedPrice.current = null;
      priceScale.setAutoScale(true);
      setAutoScale(true);
    };
    const geometry = () => {
      const rect = el.getBoundingClientRect();
      const pane = chart.panes()[0]?.getHTMLElement()?.getBoundingClientRect();
      return { rect, axisWidth: priceScale.width(), paneTop: pane?.top ?? rect.top, paneBottom: pane?.bottom ?? rect.bottom };
    };
    const overPriceAxis = (x: number, y: number) => {
      const g = geometry();
      return x >= g.rect.right - g.axisWidth && x <= g.rect.right && y >= g.paneTop && y <= g.paneBottom;
    };
    navRef.current = {
      zoomBy,
      scrollBy,
      first: () => {
        const r = visible();
        if (r) ts.setVisibleLogicalRange({ from: -0.5, to: -0.5 + (r.to - r.from) });
      },
      last: () => {
        // The newest bar at the right edge with the margin the chart opens with.
        const r = visible();
        const to = candles.length + 1;
        if (r) ts.setVisibleLogicalRange({ from: to - (r.to - r.from), to });
      },
      reset: () => {
        autoOn();
        ts.setVisibleLogicalRange(latestBarsView(candles.length, el.clientWidth * 0.94));
      },
      auto: autoOn,
      overPriceAxis,
    };
    const onRange = (r: LogicalRange | null) => setAwayFromLatest(Boolean(r && r.to < candles.length - 2));
    ts.subscribeVisibleLogicalRangeChange(onRange);
    onRange(visible());

    // The wheel: over the price axis it stretches the price range around the cursor; elsewhere
    // it zooms time with the newest bar held in place, Ctrl + wheel (or a trackpad pinch) zooms at
    // the cursor, and Shift + wheel or a sideways two-finger swipe scrolls.
    const onWheel = (e: WheelEvent) => {
      const g = geometry();
      const dxPx = wheelPixels(e.deltaX, e.deltaMode, g.rect.height);
      const dyPx = wheelPixels(e.deltaY, e.deltaMode, g.rect.height);
      e.preventDefault();
      e.stopPropagation();
      if (overPriceAxis(e.clientX, e.clientY)) {
        const vr = priceScale.getVisibleRange();
        const at = main.coordinateToPrice(e.clientY - g.paneTop);
        if (!vr || at === null || dyPx === 0) return;
        priceScale.setAutoScale(false);
        priceScale.setVisibleRange(scalePrice(vr, zoomFactor(dyPx), at, isLog));
        setAutoScale(false);
        return;
      }
      let dx = dxPx;
      let dy = dyPx;
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      const r = visible();
      if (!r) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        scrollBy((dx * (r.to - r.from)) / Math.max(1, g.rect.width - g.axisWidth));
      } else if (dy !== 0) {
        const anchor = e.ctrlKey ? ts.coordinateToLogical(e.clientX - g.rect.left) ?? r.to : r.to;
        zoomBy(zoomFactor(dy, isPinch(e.ctrlKey, dy)), anchor);
      }
    };

    // Dragging the chart up or down moves the price range and turns auto-scale off, as on
    // TradingView. With auto-scale already off the library pans the price itself.
    let drag: { y: number; range: Span; height: number; taken: boolean } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      el.focus({ preventScroll: true });
      setScaleMenu(null);
      if (e.button !== 0 || !priceScale.options().autoScale) return;
      const g = geometry();
      if (e.clientX >= g.rect.right - g.axisWidth || e.clientY < g.paneTop || e.clientY > g.paneBottom) return;
      const vr = priceScale.getVisibleRange();
      drag = vr ? { y: e.clientY, range: vr, height: g.paneBottom - g.paneTop, taken: false } : null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || !(e.buttons & 1)) return;
      const dy = e.clientY - drag.y;
      if (!drag.taken) {
        if (Math.abs(dy) < 6) return;
        drag.taken = true;
        priceScale.setAutoScale(false);
        setAutoScale(false);
      }
      priceScale.setVisibleRange(panPrice(drag.range, dy, drag.height, { log: isLog, inverted: invert }));
    };
    // The library switches auto-scale off when the price axis is dragged and back on when it's
    // double-clicked; the A button follows.
    const onPointerUp = () => {
      drag = null;
      setTimeout(syncAuto, 0);
    };
    // Drawings, above the candles and on each indicator's pane (on its scale); their pointer
    // handling comes first, so a click that places or moves a drawing neither pans the chart nor
    // drags the price.
    const layerFor = (pane: string | undefined, precision: number) =>
      new DrawingLayer({
        drawings: drawStateRef.current.drawings,
        preview: null,
        selected: drawStateRef.current.selected,
        hidden: drawHiddenRef.current,
        times: times as number[],
        interval: intervalSeconds,
        formatPrice: (v) => fmt(v, precision),
        formatTime: (t) => formatChartTime(t, intraday, timezone),
        // The tools that read the bars (regression, VWAP, volume profile) read the candles.
        bars: pane === undefined ? candles : undefined,
        intervalKind: timeframeKindOf(intervalSeconds),
        pane,
      });
    const layer = layerFor(undefined, pxPrecision);
    main.attachPrimitive(layer);
    const paneLayers: PaneLayer[] = [{ pane: undefined, index: 0, layer }];
    for (const a of paneAnchors) {
      const l = layerFor(a.uid, a.precision);
      a.anchor.attachPrimitive(l);
      paneLayers.push({ pane: a.uid, index: a.index, layer: l });
    }
    layerRef.current = layer;
    layersRef.current = paneLayers.map((p) => p.layer);
    const detachDrawing = attachDrawing(el, chart, paneLayers, times as number[], intervalSeconds, candles, {
      state: () => drawStateRef.current,
      placing: placingRef,
      onAdd: (d) => setDrawingsRef.current((list) => [...list, d]),
      styleOf: (tool) => drawTemplatesRef.current[tool],
      onUpdate: (id, patch) => setDrawingsRef.current((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d))),
      onSelect: setSelectedDrawing,
      onToolDone: () => setTool(null),
      onOpenSettings: setDrawingSettings,
      onErase: (id) => {
        setDrawingsRef.current((list) => list.filter((d) => d.id !== id));
        setSelectedDrawing((s) => (s === id ? null : s));
      },
    });

    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    el.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("dblclick", onPointerUp);
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });

    return () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) savedRange.current = { key: viewKey, range: r };
      const pr = priceScale.options().autoScale ? null : priceScale.getVisibleRange();
      savedPrice.current = pr ? { key: priceKey, range: pr } : null;
      chartRef.current = null;
      layerRef.current = null;
      layersRef.current = [];
      detachDrawing();
      disposed = true;
      navRef.current = null;
      ts.unsubscribeVisibleLogicalRangeChange(onRange);
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("dblclick", onPointerUp);
      el.removeEventListener("wheel", onWheel, { capture: true });
      cancelAnimationFrame(raf);
      clearInterval(countdownTimer);
      ro.disconnect();
      chart.remove();
    };
  }, [candles, chartType, prepared, paneOf, range, interval, intervalSeconds, symbol, ctx, scaleMode, invert, chartStyle, timezone]);

  // ---- legend ----
  const n = candles?.length ?? 0;
  /** The bar a legend shows: the hovered one, else the latest. */
  const barAt = (hovered: number | null) => {
    const idx = hovered ?? n - 1;
    return { idx, candle: candles && n > 0 ? candles[Math.min(idx, n - 1)] : null, onLast: hovered === null || hovered >= n - 1 };
  };
  const candle = candles && n > 0 ? candles[n - 1] : null;

  const update = (uid: string, patch: Partial<IndicatorInstance>) =>
    saveInstances(latestIndicators(widget.id).map((i) => (i.uid === uid ? { ...i, ...patch } : i)));
  const remove = (uid: string) => saveInstances(latestIndicators(widget.id).filter((i) => i.uid !== uid));

  const legendPrecision = chartStyle.precision !== "default" ? chartStyle.precision : candles && n > 0 ? pricePrecision(candles) : 2;
  const px = (v: number) => (chartStyle.precision === "default" ? fmtPrice(v) : fmt(v, chartStyle.precision));
  const legendMarket = useMemo<Market>(() => ({ type: ctx.type, timezone: ctx.timezone }), [ctx.type, ctx.timezone]);

  const legendRow = (it: Prepared, idx: number) => (
    <div key={it.inst.uid} className="group flex gap-2 items-center pointer-events-auto w-fit max-w-full">
      <span className={`whitespace-nowrap ${shownOn(it, intervalSeconds) || it.error ? "text-[var(--text)]" : "text-[#4d4d4d]"}`}>
        {it.inst.style?.inputsInStatusLine === false ? it.def.short : it.label}
      </span>
      {it.error ? (
        <span className="down truncate">error: {it.error}</span>
      ) : (
        shownOn(it, intervalSeconds) &&
        it.inst.style?.valuesInStatusLine !== false &&
        it.def.plots
          .filter((p) => p.display !== "none" && it.plots[p.key] && it.inst.style?.plots?.[p.key]?.visible !== false)
          .map((p) => {
            const prep = it.plots[p.key];
            const v = prep.values[idx];
            const color = it.inst.style?.plots?.[p.key]?.color ?? prep.colors?.[idx] ?? p.color;
            return (
              <span key={p.key} style={{ color }} className="whitespace-nowrap">
                {formatValue(v, valuePrecision(it.def, it.inst.style, legendPrecision))}
              </span>
            );
          })
      )}
      <span className="hidden group-hover:flex gap-1.5 ml-1 bg-[#0a0a0a] px-1">
        <button title={it.inst.hidden ? "Show" : "Hide"} className="dim hover:text-[var(--text)]" onClick={() => update(it.inst.uid, { hidden: !it.inst.hidden })}>
          {it.inst.hidden ? "◌" : "◉"}
        </button>
        <button title="Settings" className="dim hover:text-[var(--amber)]" onClick={() => setEditing(it.inst.uid)}>
          ⚙
        </button>
        <button title="Remove" className="dim hover:text-[var(--down)]" onClick={() => remove(it.inst.uid)}>
          ✕
        </button>
      </span>
    </div>
  );

  // The chart's own buttons don't take focus, so its hotkeys keep working after a click.
  const keepChartFocus = (e: React.MouseEvent) => e.preventDefault();

  // TradingView's chart hotkeys while the chart has focus (it takes focus when clicked).
  const onChartKey = (e: React.KeyboardEvent) => {
    // Drawings: Esc leaves the tool (or the selection), Delete removes the selected one.
    if (e.key === "Escape" && (tool || selectedDrawing)) {
      e.preventDefault();
      pickTool(null);
      setSelectedDrawing(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected && !selected.locked && !drawingsLocked) {
      e.preventDefault();
      removeDrawing(selected.id);
      return;
    }
    const r = chartRef.current?.timeScale().getVisibleLogicalRange();
    const action = keyAction(e, r ? r.to - r.from : 100);
    const nav = navRef.current;
    if (!action || !nav) return;
    e.preventDefault();
    if (action.kind === "scroll") nav.scrollBy(action.bars);
    else if (action.kind === "zoom") nav.zoomBy(action.factor);
    else if (action.kind === "first") nav.first();
    else if (action.kind === "last") nav.last();
    else if (action.kind === "reset") nav.reset();
    else if (action.what === "invert") setInvert(!invert);
    else setScaleMode(scaleMode === action.what ? "normal" : action.what);
  };

  const items = prepared?.items ?? [];
  const mainLegend = items.filter((it) => it.def.overlay || !paneOf.has(it.inst.uid));
  const editingItem = items.find((it) => it.inst.uid === editing);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {/* Starred intervals, plus the current one when it isn't starred, then the interval menu. */}
        {(orderedFavorites(favoriteIntervals).includes(interval) ? orderedFavorites(favoriteIntervals) : [...orderedFavorites(favoriteIntervals), interval]).map((i) => (
          <button key={i} className={`term-btn ${interval === i ? "active" : ""}`} onClick={() => setInterval_(i)}>
            {INTERVAL_LABEL[i]}
          </button>
        ))}
        <IntervalMenu interval={interval} favorites={favoriteIntervals} onSelect={setInterval_} onToggleFavorite={toggleFavoriteInterval} />
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
        <button className="term-btn" onClick={() => setSettingsOpen(true)} title="Chart settings">
          ⚙
        </button>
      </div>
      {/* A failed refresh keeps the chart that's on screen; the error shows only when there is none. */}
      {error && !candles && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="flex flex-1 min-h-0">
      <DrawingToolbar
        tool={tool}
        onTool={pickTool}
        magnet={magnet}
        onMagnet={setMagnet}
        locked={drawingsLocked}
        onLock={setDrawingsLocked}
        hidden={drawingsHidden}
        onHide={setDrawingsHidden}
        count={drawings.length}
        onRemoveAll={() => {
          setDrawings(() => []);
          setSelectedDrawing(null);
        }}
        last={lastTool}
        cursor={cursorMode}
        onCursor={setCursorMode}
        valuesTooltip={valuesTooltip}
        onValuesTooltip={setValuesTooltip}
        favorites={favorites}
        onFavorite={(id) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))}
      />
      <div
        className="relative flex-1 min-h-0 min-w-0 chart-cursor"
        style={{ "--chart-cursor": cssCursor(tool ? "cross" : cursorMode) } as React.CSSProperties}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const fromBottom = rect.bottom - axes.bottom - e.clientY;
          setNavVisible(fromBottom >= -4 && fromBottom < 90 && e.clientX < rect.right - axes.right);
        }}
        onPointerLeave={() => setNavVisible(false)}
        onKeyDown={onChartKey}
      >
        {candle && (
          <Hovered store={hover}>
            {(hovered) => {
              const { idx, candle, onLast } = barAt(hovered);
              return (
                candle && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-fs-11 pointer-events-none max-w-[85%]">
            <div className="flex gap-3 bg-[rgba(10,10,10,0.7)] w-fit px-1">
              <span className="dim">
                <span className="amber">{INTERVAL_LABEL[interval]}</span> {formatChartTime(candle.time, isIntradayInterval(intervalSeconds), timezone)}
              </span>
              {onLast && !rangeChart && <BarCountdown barTime={candle.time} intervalSeconds={intervalSeconds} market={legendMarket} />}
              <span className="dim">O <span className="text-[var(--text)]">{px(candle.open)}</span></span>
              <span className="dim">H <span className="up">{px(candle.high)}</span></span>
              <span className="dim">L <span className="down">{px(candle.low)}</span></span>
              <span className="dim">C <span className={candle.close >= candle.open ? "up" : "down"}>{px(candle.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(candle.volume)}</span></span>
            </div>
            {mainLegend.map((it) => legendRow(it, idx))}
          </div>
                )
              );
            }}
          </Hovered>
        )}
        <Hovered store={hover}>
          {(hovered) =>
            items
              .filter((it) => paneOf.has(it.inst.uid))
              .map((it) => (
                <div
                  key={it.inst.uid}
                  className="absolute left-2 z-10 text-fs-11 pointer-events-none max-w-[85%]"
                  style={{ top: (paneTops[paneOf.get(it.inst.uid)!] ?? -9999) + 2 }}
                >
                  {legendRow(it, barAt(hovered).idx)}
                </div>
              ))
          }
        </Hovered>
        {items
          .filter((it) => it.def.overlay && shownOn(it, intervalSeconds) && it.result.table)
          .map((it) => (
            <IndicatorTableView key={`table-${it.inst.uid}`} table={it.result.table!} inset={axes} paneBottom={paneTops.length > 1 ? paneTops[1] : undefined} />
          ))}
        {items
          .filter((it) => paneOf.has(it.inst.uid) && it.result.table && paneTops[paneOf.get(it.inst.uid)!] !== undefined)
          .map((it) => {
            const pane = paneOf.get(it.inst.uid)!;
            return <IndicatorTableView key={`table-${it.inst.uid}`} table={it.result.table!} inset={axes} paneTop={paneTops[pane]} paneBottom={paneTops[pane + 1]} />;
          })}
        <div
          ref={containerRef}
          tabIndex={0}
          className="w-full h-full outline-none"
          onContextMenu={(e) => {
            if (!navRef.current?.overPriceAxis(e.clientX, e.clientY)) return;
            e.preventDefault();
            setScaleMenu({ x: e.clientX, y: e.clientY });
          }}
        />
        <CursorEffects hostRef={containerRef} mode={cursorMode} active={!tool} longPress={valuesTooltip} axes={axes} onLongPress={setLongPressAt} />
        <FavoritesBar
          favorites={favorites}
          tool={tool}
          cursor={cursorMode}
          onTool={pickTool}
          onCursor={setCursorMode}
        />
        {longPressAt && candle && (
          <Hovered store={hover}>
            {(hovered) => {
              const { candle } = barAt(hovered);
              return (
                candle && (
          // TradingView's values tooltip: the bar under a long press.
          <div
            role="tooltip"
            className="absolute z-30 pointer-events-none bg-[rgba(19,23,34,0.95)] border border-[var(--border)] px-2 py-1.5 text-fs-11 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 shadow-lg"
            style={{ left: Math.min(longPressAt.x + 16, (containerRef.current?.clientWidth ?? 9999) - 190), top: Math.max(4, longPressAt.y - 120) }}
          >
            <span className="col-span-2 dim">{formatChartTime(candle.time, isIntradayInterval(intervalSeconds), timezone)}</span>
            <span className="dim">Open</span>
            <span className="text-right">{px(candle.open)}</span>
            <span className="dim">High</span>
            <span className="text-right up">{px(candle.high)}</span>
            <span className="dim">Low</span>
            <span className="text-right down">{px(candle.low)}</span>
            <span className="dim">Close</span>
            <span className={`text-right ${candle.close >= candle.open ? "up" : "down"}`}>{px(candle.close)}</span>
            {(() => {
              const i = candles!.indexOf(candle);
              const prev = i > 0 ? candles![i - 1].close : candle.open;
              const ch = candle.close - prev;
              return (
                <>
                  <span className="dim">Change</span>
                  <span className={`text-right ${ch >= 0 ? "up" : "down"}`}>
                    {ch >= 0 ? "+" : ""}
                    {px(ch)} ({ch >= 0 ? "+" : ""}
                    {prev ? ((ch / prev) * 100).toFixed(2) : "0.00"}%)
                  </span>
                </>
              );
            })()}
            <span className="dim">Vol</span>
            <span className="text-right">{fmtBig(candle.volume)}</span>
          </div>
                )
              );
            }}
          </Hovered>
        )}
        {scaleMenu && (
          <PriceScaleMenu
            at={scaleMenu}
            autoScale={autoScale}
            mode={scaleMode}
            invert={invert}
            onAuto={() => navRef.current?.auto()}
            onInvert={() => setInvert(!invert)}
            onMode={setScaleMode}
            onClose={() => setScaleMenu(null)}
          />
        )}
        {candle && (
          // TradingView's navigation buttons, shown while the pointer is near the bottom of the chart.
          <div
            className={`absolute left-1/2 -translate-x-1/2 z-10 flex gap-1 transition-opacity ${navVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            style={{ bottom: axes.bottom + 10 }}
          >
            {(
              [
                ["−", "Zoom out", () => navRef.current?.zoomBy(1.25)],
                ["+", "Zoom in", () => navRef.current?.zoomBy(0.8)],
                ["‹", "Scroll left", () => navRef.current?.scrollBy(-10)],
                ["›", "Scroll right", () => navRef.current?.scrollBy(10)],
                ["⟲", "Reset chart view (Alt+R)", () => navRef.current?.reset()],
              ] as const
            ).map(([label, title, act]) => (
              <button key={title} title={title} onClick={act} onMouseDown={keepChartFocus} className="w-7 h-7 rounded bg-[#1a1a1a] border border-[var(--border)] text-[var(--text)] hover:border-[var(--amber-dim)]">
                {label}
              </button>
            ))}
          </div>
        )}
        {candle && awayFromLatest && (
          <button
            title="Scroll to the most recent bar"
            onMouseDown={keepChartFocus}
            onClick={() => navRef.current?.last()}
            className="absolute z-10 w-7 h-7 rounded bg-[#1a1a1a] border border-[var(--border)] text-[var(--text)] hover:border-[var(--amber-dim)]"
            style={{ right: axes.right + 8, bottom: axes.bottom + 10 }}
          >
            »
          </button>
        )}
        {candle && (
          // TradingView's price scale buttons, in the corner under the price axis.
          <div className="absolute right-0 bottom-0 z-10 flex items-center justify-center gap-0.5 text-fs-10" style={{ width: axes.right, height: axes.bottom }}>
            <button
              title="Auto (fits data to screen)"
              onMouseDown={keepChartFocus}
              className={`px-1 leading-4 ${autoScale ? "amber" : "dim hover:text-[var(--text)]"}`}
              onClick={() => navRef.current?.auto()}
            >
              A
            </button>
            <button
              title="Logarithmic scale"
              onMouseDown={keepChartFocus}
              className={`px-1 leading-4 ${scaleMode === "log" ? "amber" : "dim hover:text-[var(--text)]"}`}
              onClick={() => setScaleMode(scaleMode === "log" ? "normal" : "log")}
            >
              L
            </button>
            <button
              title="Percentage scale"
              onMouseDown={keepChartFocus}
              className={`px-1 leading-4 ${scaleMode === "percent" ? "amber" : "dim hover:text-[var(--text)]"}`}
              onClick={() => setScaleMode(scaleMode === "percent" ? "normal" : "percent")}
            >
              %
            </button>
          </div>
        )}
        {selected && !drawingsHidden && (
          // The selected drawing's toolbar, as TradingView's floating one: color and line, lock, remove.
          <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-1.5 py-1 rounded bg-[#1a1a1a] border border-[var(--border)] shadow-lg text-fs-11">
            <span className="dim px-1">{TOOL_BY_ID.get(selected.tool)?.label}</span>
            <ColorPicker
              color={selected.color}
              onColor={(color) => restyle(selected, { color })}
              width={selected.tool === "text" ? undefined : selected.width}
              onWidth={selected.tool === "text" ? undefined : (width) => restyle(selected, { width })}
              dash={TOOL_FEATURES[selected.tool].dash ? selected.dash ?? "solid" : undefined}
              onDash={(dash) => restyle(selected, { dash })}
            />
            <button className="px-1.5 h-6 border border-[var(--border)] dim hover:text-[var(--text)]" title="Settings (double-click the drawing)" onClick={() => setDrawingSettings(selected.id)}>
              ⚙ Settings
            </button>
            <button
              className={`px-1.5 h-6 border border-[var(--border)] ${selected.locked ? "amber" : "dim hover:text-[var(--text)]"}`}
              title={selected.locked ? "Unlock" : "Lock"}
              onClick={() => patchDrawing(selected.id, { locked: !selected.locked })}
            >
              {selected.locked ? "Locked" : "Lock"}
            </button>
            <button className="px-1.5 h-6 border border-[var(--border)] dim hover:text-[var(--down)]" title="Remove (Delete)" onClick={() => removeDrawing(selected.id)}>
              Remove
            </button>
          </div>
        )}
      </div>
      </div>
      {drawingSettings && drawings.some((d) => d.id === drawingSettings) && (
        <DrawingSettings
          drawing={drawings.find((d) => d.id === drawingSettings)!}
          template={drawTemplates[drawings.find((d) => d.id === drawingSettings)!.tool]}
          onApply={(next) => restyle(next, next)}
          onSaveTemplate={(t) => setDrawTemplates((m) => ({ ...m, [drawings.find((d) => d.id === drawingSettings)!.tool]: t }))}
          onClose={() => setDrawingSettings(null)}
        />
      )}
      {settingsOpen && (
        <ChartSettings
          style={chartStyle}
          exchangeZone={ctx.timezone}
          onApply={(s) => setWidgetChart(widget.id, { chartStyle: s })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
          result={editingItem.raw}
          onApply={(params, style) => update(editingItem.inst.uid, { params, style })}
        />
      )}
    </div>
  );
}

/** Latest indicator list straight from the store, so rapid adds in the picker don't drop each other. */
function latestIndicators(widgetId: string): IndicatorInstance[] {
  const st = useTerminal.getState();
  const w = st.widgets.find((x) => x.id === widgetId) ?? st.pages.find((x) => x.id === widgetId);
  return w?.indicators ?? DEFAULT_CHART_INDICATORS;
}
