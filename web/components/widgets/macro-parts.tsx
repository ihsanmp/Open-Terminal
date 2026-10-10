"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AreaSeries, BarSeries, CandlestickSeries, LineSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { apiGet, fmt, pctClass, type Candle } from "../../lib/api";
import { useWidgetSetting } from "../../store/terminal";
import { fontPx } from "../../lib/font-scale";

// Pieces of the former Macro page that the US Bonds page builds on: the /api/macro data's types,
// the change periods, a three-month sparkline, a titled panel, and the chart of a chosen yield or
// price (dragged and zoomed like the Chart page's, at a chosen timeframe and span).

/** The periods a change can be shown over (the server sends the close each starts from). */
export const PERIODS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
export type Period = (typeof PERIODS)[number];
export type Spark = { spark?: number[]; refs?: Partial<Record<Period, number>> };
export type CurvePoint = { tenor: string; symbol: string; value: number | null; changeBp: number | null } & Spark;
export type Spread = { label: string; value: number | null; changeBp: number | null };
type MarketItem = { symbol: string; label: string; value: number | null; change: number | null; changePct: number | null } & Spark;
type Yield10 = { symbol: string; label: string; value: number | null; changeBp: number | null } & Spark;
type EconItem = { label: string; value: string | null; date: string | null };
export type MacroData = {
  curve: CurvePoint[];
  spreads: Spread[];
  global10y: Yield10[];
  markets: Array<{ group: string; items: MarketItem[] }>;
  economy: EconItem[];
  curveSource: "tradingview" | "fred";
};

/** What the chart at the top shows. */
export type Selected = { symbol: string; label: string; isYield: boolean };

/** The chart's timeframes: [interval, label, intraday]. */
const TIMEFRAMES: Array<[string, string, boolean]> = [
  ["5m", "5m", true],
  ["15m", "15m", true],
  ["1h", "1H", true],
  ["4h", "4H", true],
  ["1D", "D", false],
  ["1W", "W", false],
  ["1M", "M", false],
];
/** How the chart draws the prices, as on the Chart page. */
const CHART_TYPES: Array<[string, string]> = [
  ["area", "Area"],
  ["line", "Line"],
  ["candles", "Candles"],
  ["bars", "Bars"],
];
const UP = "#26a69a";
const DOWN = "#ef5350";

/** The spans the range buttons bring into view (days). */
const RANGES: Array<[string, number]> = [
  ["1D", 1],
  ["1W", 7],
  ["1M", 31],
  ["3M", 92],
  ["6M", 183],
  ["1Y", 366],
  ["5Y", 1827],
  ["All", Infinity],
];

/** Decimals for a level: yields to 3, FX pairs to 4, the rest to 2. */
const digitsFor = (v: number | null, isYield: boolean) => (isYield ? 3 : v !== null && Math.abs(v) < 10 ? 4 : 2);
export const signed = (v: number | null, digits: number, unit = "") => (v === null ? "—" : `${v >= 0 ? "+" : ""}${fmt(v, digits)}${unit}`);

/** A three-month line: green when it ended higher than it started, red when lower. */
export function Sparkline({ values }: { values?: number[] }) {
  const w = 72;
  const h = 20;
  if (!values || values.length < 2) return <span className="inline-block" style={{ width: w }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - lo) / span) * (h - 2)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "#26a69a" : "#ef5350"} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

export function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--border)] bg-[var(--panel)] min-w-0">
      <div className="px-2 py-1 dim text-fs-10 uppercase tracking-wider flex justify-between border-b border-[var(--border)]">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The selected symbol's chart: dragged and zoomed like the Chart page's, at the chosen timeframe,
 *  the range buttons bringing a span into view. */
export function DetailChart({ sel, onOpen }: { sel: Selected; onOpen: () => void }) {
  const [interval, setInterval_] = useWidgetSetting("macroInterval", "1D");
  const [range, setRange] = useWidgetSetting("macroRange", "1Y");
  const [chartType, setChartType] = useWidgetSetting("macroChartType", "area");
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const intraday = TIMEFRAMES.find(([v]) => v === interval)?.[2] ?? false;
  const { data, error, isLoading } = useQuery({
    queryKey: ["history", sel.symbol, "5Y", interval],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(sel.symbol)}?range=5Y&interval=${interval}`),
    staleTime: intraday ? 30_000 : 300_000,
  });
  // The first close in view, for the move shown in the header.
  const [firstShown, setFirstShown] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data?.length) return;
    const local = (t: number) => new Date(t * 1000);
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#808080", fontSize: fontPx(10), attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1c1c1c" } },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626", timeVisible: intraday, rightOffset: 3 },
      localization: {
        timeFormatter: (t: number) =>
          intraday
            ? local(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
            : local(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
      // Drag to move, the wheel to zoom, the axes to stretch: as on the Chart page.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
    });
    const digits = digitsFor(data[data.length - 1].close, sel.isYield);
    const priceFormat = { type: "price" as const, precision: digits, minMove: 1 / 10 ** digits };
    const time = (c: Candle) => c.time as UTCTimestamp;
    // Candles and bars in their own colors; a line or area takes the move in view's color.
    let recolor: ((up: boolean) => void) | null = null;
    if (chartType === "candles") {
      const series = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat });
      series.setData(data.map((c) => ({ time: time(c), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "bars") {
      const series = chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN, priceFormat });
      series.setData(data.map((c) => ({ time: time(c), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      const series = chart.addSeries(LineSeries, { lineWidth: 2, crosshairMarkerVisible: false, priceFormat });
      series.setData(data.map((c) => ({ time: time(c), value: c.close })));
      recolor = (up) => series.applyOptions({ color: up ? UP : DOWN });
    } else {
      const series = chart.addSeries(AreaSeries, { lineWidth: 2, crosshairMarkerVisible: false, priceFormat });
      series.setData(data.map((c) => ({ time: time(c), value: c.close })));
      recolor = (up) =>
        series.applyOptions({ lineColor: up ? UP : DOWN, topColor: up ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.25)", bottomColor: "rgba(0,0,0,0)" });
    }
    // The header's move (and a line's color) follow what's in view.
    const onRange = (r: { from: number; to: number } | null) => {
      if (!r) return;
      const i = Math.min(data.length - 1, Math.max(0, Math.ceil(r.from)));
      const first = data[i].close;
      setFirstShown(first);
      recolor?.(data[data.length - 1].close >= first);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chartRef.current = chart;
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, sel.isYield, intraday, chartType]);

  // A range button brings that span (up to the latest bar) into view; a new chart opens on it once
  // it has its width (before that the library has nothing to fit the span in).
  const rangeRef = useRef(range);
  rangeRef.current = range;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data?.length) return;
    const show = () => {
      if (chartRef.current !== chart) return;
      const days = RANGES.find(([r]) => r === rangeRef.current)?.[1] ?? Infinity;
      const last = data[data.length - 1].time;
      const from = last - days * 86_400;
      if (!Number.isFinite(days) || from <= data[0].time) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: last as UTCTimestamp });
    };
    // Now, and again when it next gets its size: a chart just made lays itself out then.
    const ts = chart.timeScale();
    show();
    const onSize = (width: number) => {
      if (width <= 0) return;
      ts.unsubscribeSizeChange(onSize);
      show();
    };
    ts.subscribeSizeChange(onSize);
    return () => {
      if (chartRef.current === chart) ts.unsubscribeSizeChange(onSize);
    };
  }, [range, data, chartType]);

  const last = data?.length ? data[data.length - 1].close : null;
  const change = firstShown !== null && last !== null ? last - firstShown : null;
  return (
    <Panel
      title={`${sel.label} · ${sel.symbol}`}
      right={
        <span className="flex items-center gap-1 normal-case tracking-normal">
          {TIMEFRAMES.map(([v, label]) => (
            <button key={v} className={`px-1.5 ${v === interval ? "text-[var(--amber)]" : "hover:text-[var(--text)]"}`} onClick={() => setInterval_(v)} title={`Timeframe ${label}`}>
              {label}
            </button>
          ))}
          <span className="w-px h-3 bg-[var(--border)] mx-1" />
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="bg-[var(--panel)] border border-[var(--border)] px-1 cursor-pointer"
            aria-label="Chart type"
            title="Chart type"
          >
            {CHART_TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <span className="w-px h-3 bg-[var(--border)] mx-1" />
          {RANGES.map(([r]) => (
            <button key={r} className={`px-1.5 ${r === range ? "text-[var(--amber)]" : "hover:text-[var(--text)]"}`} onClick={() => setRange(r)} title={`Show ${r}`}>
              {r}
            </button>
          ))}
          <button className="ml-2 px-1.5 border border-[var(--border)] hover:text-[var(--amber)]" onClick={onOpen} title="Open on the Chart page">
            Open chart →
          </button>
        </span>
      }
    >
      <div className="px-2 pt-1 flex items-baseline gap-3">
        <span className="text-fs-18 text-[var(--text)]">
          {fmt(last, digitsFor(last, sel.isYield))}
          {sel.isYield ? "%" : ""}
        </span>
        <span className={pctClass(change)}>
          {sel.isYield ? signed(change === null ? null : change * 100, 1, " bp") : signed(change, digitsFor(last, false))}
          {!sel.isYield && firstShown ? ` (${signed(((last! - firstShown) / firstShown) * 100, 2, "%")})` : ""}
          <span className="dim"> · in view</span>
        </span>
        <span className="dim text-fs-10 ml-auto">drag to move · wheel to zoom · double-click an axis to reset</span>
      </div>
      {/* About half the screen: room to read the move. */}
      <div className="h-[max(calc(20rem*var(--font-scale)),50vh)] relative">
        {error ? (
          <div className="p-2 down">Error: {(error as Error).message}</div>
        ) : isLoading ? (
          <div className="p-2 dim">Loading chart…</div>
        ) : (
          <div ref={ref} className="absolute inset-0" />
        )}
      </div>
    </Panel>
  );
}
