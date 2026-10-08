"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { apiGet, fmt, pctClass, type Candle } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";
import { fontPx } from "../../lib/font-scale";

// The Macro page: the US Treasury curve from 1 month to 30 years with its spreads, 10-year yields
// abroad, the indices, the dollar and FX, commodities and crypto — live, with the move since the
// previous close and a three-month line — and the US economy. A row opens its chart at the top;
// from there it can go to the Chart page.

type Spark = { spark?: number[] };
type CurvePoint = { tenor: string; symbol: string; value: number | null; changeBp: number | null } & Spark;
type Spread = { label: string; value: number | null; changeBp: number | null };
type MarketItem = { symbol: string; label: string; value: number | null; change: number | null; changePct: number | null } & Spark;
type Yield10 = { symbol: string; label: string; value: number | null; changeBp: number | null } & Spark;
type EconItem = { label: string; value: string | null; date: string | null };
type MacroData = {
  curve: CurvePoint[];
  spreads: Spread[];
  global10y: Yield10[];
  markets: Array<{ group: string; items: MarketItem[] }>;
  economy: EconItem[];
  curveSource: "tradingview" | "fred";
};

/** What the chart at the top shows. */
type Selected = { symbol: string; label: string; isYield: boolean };

const KEY_TENORS = new Set(["2Y", "10Y", "30Y"]);
const RANGES: Array<[string, number]> = [
  ["1M", 31],
  ["3M", 92],
  ["6M", 183],
  ["1Y", 366],
  ["5Y", 1827],
];

/** Decimals for a level: yields to 3, FX pairs to 4, the rest to 2. */
const digitsFor = (v: number | null, isYield: boolean) => (isYield ? 3 : v !== null && Math.abs(v) < 10 ? 4 : 2);
const signed = (v: number | null, digits: number, unit = "") => (v === null ? "—" : `${v >= 0 ? "+" : ""}${fmt(v, digits)}${unit}`);

/** A three-month line: green when it ended higher than it started, red when lower. */
function Sparkline({ values }: { values?: number[] }) {
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

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
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

/** The selected symbol's daily chart, over the chosen range. */
function DetailChart({ sel, onOpen }: { sel: Selected; onOpen: () => void }) {
  const [range, setRange] = useState("1Y");
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ["history", sel.symbol, "5Y", "1D"],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(sel.symbol)}?range=5Y&interval=1D`),
    staleTime: 300_000,
  });
  const days = RANGES.find(([r]) => r === range)?.[1] ?? 366;
  const shown = useMemo(() => {
    if (!data?.length) return [];
    const from = data[data.length - 1].time - days * 86_400;
    return data.filter((c) => c.time >= from);
  }, [data, days]);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown.length === 0) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#808080", fontSize: fontPx(10), attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1c1c1c" } },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626" },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
      handleScroll: false,
      handleScale: false,
    });
    const up = shown[shown.length - 1].close >= shown[0].close;
    const color = up ? "#26a69a" : "#ef5350";
    const digits = digitsFor(shown[shown.length - 1].close, sel.isYield);
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: up ? "rgba(38,166,154,0.25)" : "rgba(239,83,80,0.25)",
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
    });
    series.setData(shown.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [shown, sel.isYield]);

  const first = shown[0]?.close ?? null;
  const last = shown[shown.length - 1]?.close ?? null;
  const change = first !== null && last !== null ? last - first : null;
  return (
    <Panel
      title={`${sel.label} · ${sel.symbol}`}
      right={
        <span className="flex gap-1 normal-case tracking-normal">
          {RANGES.map(([r]) => (
            <button key={r} className={`px-1.5 ${r === range ? "text-[var(--amber)]" : "hover:text-[var(--text)]"}`} onClick={() => setRange(r)}>
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
        <span className="text-fs-18 text-[var(--text)]">{fmt(last, digitsFor(last, sel.isYield))}{sel.isYield ? "%" : ""}</span>
        <span className={pctClass(change)}>
          {sel.isYield ? signed(change === null ? null : change * 100, 1, " bp") : signed(change, digitsFor(last, false))}
          {!sel.isYield && first ? ` (${signed(((last! - first) / first) * 100, 2, "%")})` : ""}
          <span className="dim"> · {range}</span>
        </span>
      </div>
      <div className="h-[calc(13rem*var(--font-scale))] relative">
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

export default function MacroWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setView = useTerminal((s) => s.setView);
  const poll = usePoll(sessionRefreshMs(10_000, 120_000));
  const { data, error } = useQuery({
    queryKey: ["macro"],
    queryFn: () => apiGet<MacroData>("/api/macro"),
    refetchInterval: poll,
  });
  const [sel, setSel] = useState<Selected>({ symbol: "TVC:US10Y", label: "US 10Y Yield", isYield: true });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading macro data…</div>;

  const rowClass = (symbol: string) => `cursor-pointer ${sel.symbol === symbol ? "bg-[#1f1a10]" : ""}`;
  const curve = data.curve.filter((c) => c.value !== null);

  return (
    <div className="p-1 flex flex-col gap-1">
      <DetailChart
        sel={sel}
        onOpen={() => {
          setActiveSymbol(sel.symbol);
          setView("chart");
        }}
      />
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(calc(19rem * var(--font-scale)), 1fr))" }}>
        <Panel title="US Treasury Yields" right={<span className="normal-case">{data.curveSource === "fred" ? "FRED (daily)" : "live"}</span>}>
          <div className="h-24 px-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 6, right: 12, bottom: 0, left: -22 }}>
                <XAxis dataKey="tenor" stroke="#808080" fontSize={fontPx(9)} />
                <YAxis stroke="#808080" fontSize={fontPx(9)} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: fontPx(10) }} labelStyle={{ color: "#808080" }} />
                <Line type="monotone" dataKey="value" stroke="#ff9900" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Yield</th>
                <th>Chg (bp)</th>
                <th>3M</th>
              </tr>
            </thead>
            <tbody>
              {data.curve.map((c) => (
                <tr key={c.tenor} className={rowClass(c.symbol)} onClick={() => setSel({ symbol: c.symbol, label: `US ${c.tenor} Yield`, isYield: true })}>
                  <td className={KEY_TENORS.has(c.tenor) ? "amber font-bold" : ""}>US {c.tenor}</td>
                  <td>
                    <Flash value={c.value}>{fmt(c.value, 3)}%</Flash>
                  </td>
                  <td className={pctClass(c.changeBp)}>{signed(c.changeBp, 1)}</td>
                  <td>
                    <Sparkline values={c.spark} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1.5 border-t border-[var(--border)]">
            {data.spreads.map((s) => (
              <span key={s.label} title={s.label === "3M10Y" ? "Below zero: the curve is inverted" : undefined}>
                <span className="dim">{s.label}</span> <span className={s.value !== null && s.value < 0 ? "down" : "text-[var(--text)]"}>{signed(s.value, 1, " bp")}</span>{" "}
                <span className={`text-fs-10 ${pctClass(s.changeBp)}`}>({signed(s.changeBp, 1)})</span>
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="10Y Government Bonds">
          <table className="data-table">
            <thead>
              <tr>
                <th>Country</th>
                <th>Yield</th>
                <th>Chg (bp)</th>
                <th>3M</th>
              </tr>
            </thead>
            <tbody>
              {data.global10y.map((y) => (
                <tr key={y.symbol} className={rowClass(y.symbol)} onClick={() => setSel({ symbol: y.symbol, label: `${y.label} 10Y Yield`, isYield: true })}>
                  <td>{y.label}</td>
                  <td>
                    <Flash value={y.value}>{fmt(y.value, 3)}%</Flash>
                  </td>
                  <td className={pctClass(y.changeBp)}>{signed(y.changeBp, 1)}</td>
                  <td>
                    <Sparkline values={y.spark} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {data.markets.map((g) => (
          <Panel key={g.group} title={g.group}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Last</th>
                  <th>Chg%</th>
                  <th>3M</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((q) => (
                  <tr key={q.symbol} className={rowClass(q.symbol)} onClick={() => setSel({ symbol: q.symbol, label: q.label, isYield: false })}>
                    <td>{q.label}</td>
                    <td>
                      <Flash value={q.value}>{fmt(q.value, digitsFor(q.value, false))}</Flash>
                    </td>
                    <td className={pctClass(q.changePct)}>
                      <Flash value={q.changePct}>{signed(q.changePct, 2, "%")}</Flash>
                    </td>
                    <td>
                      <Sparkline values={q.spark} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}

        <Panel title="US Economy" right={<span className="normal-case">FRED</span>}>
          <table className="data-table">
            <tbody>
              {data.economy.map((e) => (
                <tr key={e.label}>
                  <td>{e.label}</td>
                  <td className="text-[var(--text)]">{e.value ?? "—"}</td>
                  <td className="dim">{e.date ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
