"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, fmt, fmtBig, fmtPrice, pctClass, type Quote } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { quoteRefreshMs, usePoll } from "../../lib/refresh";
import { useWidgetSetting, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";

// Money Flow: what went into the asset being viewed and what came out, over a day, a week, a
// month, three months and a year (server: providers/moneyflow.ts). A coin on Binance shows its
// trades as made, buyers' against sellers'; anything else an estimate from its bars.

type FlowBar = { time: number; inflow: number; outflow: number };
type Period = { period: string; interval: string; bars: FlowBar[]; inflow: number; outflow: number; net: number; buyShare: number | null; error: string | null };
type MoneyFlow = { symbol: string; method: "taker" | "clv"; unit: string | null; periods: Period[] };

const IN = "#26a69a";
const OUT = "#ef5350";
const NAMES: Record<string, string> = { "1D": "Hari ini", "1W": "1 minggu", "1M": "1 bulan", "3M": "3 bulan", "1Y": "1 tahun" };

const money = (v: number | null | undefined, unit: string) => (v === null || v === undefined || !isFinite(v) ? "—" : `${v < 0 ? "-" : ""}${unit}${fmtBig(Math.abs(v))}`);
const signedMoney = (v: number, unit: string) => `${v > 0 ? "+" : ""}${money(v, unit)}`;

function timeLabel(t: number, period: string): string {
  const d = new Date(t * 1000);
  if (period === "1D") return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (period === "1W") return d.toLocaleString("id-ID", { weekday: "short", hour: "2-digit" });
  if (period === "1Y") return d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function Card({ label, value, cls, sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 min-w-0">
      <div className="dim text-fs-10 uppercase tracking-wider">{label}</div>
      <div className={`text-fs-15 font-bold ${cls ?? "text-[var(--text)]"}`}>{value}</div>
      {sub && <div className="dim text-fs-10">{sub}</div>}
    </div>
  );
}

export default function MoneyFlowWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [periodKey, setPeriodKey] = useWidgetSetting<string>("flowPeriod", "1D");
  const quotePoll = usePoll(() => quoteRefreshMs(symbol));
  const flowPoll = usePoll(60_000);
  const quote = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${symbol}`))[0],
    refetchInterval: quotePoll,
  });
  const { data, error, isLoading } = useQuery({
    queryKey: ["moneyflow", symbol],
    queryFn: () => apiGet<MoneyFlow>(`/api/moneyflow/${encodeURIComponent(symbol)}`),
    refetchInterval: flowPoll,
  });
  const q = quote.data;
  const unit = data?.unit === "USDT" ? "$" : q?.currency === "USD" ? "$" : q?.currency ? `${q.currency} ` : "";
  const period = data?.periods.find((p) => p.period === periodKey) ?? data?.periods[0];

  // Inflow up, outflow down, and the running net across the period.
  let running = 0;
  const chart = (period?.bars ?? []).map((b) => {
    running += b.inflow - b.outflow;
    return { t: timeLabel(b.time, period!.period), inflow: b.inflow, outflow: -b.outflow, net: running };
  });

  return (
    <div className="p-2 flex flex-col gap-2 text-fs-11">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="amber font-bold text-fs-13">{symbol}</span>
        {q && (
          <>
            <Flash value={q.price} className="text-fs-15 font-bold">
              {fmtPrice(q.price)}
            </Flash>
            <Flash value={q.changePercent} className={pctClass(q.changePercent)}>
              {q.change !== null && q.change >= 0 ? "+" : ""}
              {fmt(q.change)} ({fmt(q.changePercent)}%)
            </Flash>
            <span className="dim truncate">{q.name}</span>
          </>
        )}
        {data && (
          <span className="ml-auto dim text-fs-10" title={data.method === "taker" ? "Binance: beli yang mengambil order jual (taker buy) dihitung masuk, jual yang mengambil order beli dihitung keluar." : "Perkiraan dari candle: nilai transaksi tiap bar (harga tipikal × volume) dibagi menurut posisi close di rentang high–low."}>
            {data.method === "taker" ? "● Taker buy / sell · Binance (USDT)" : "● Estimasi dari candle (Chaikin money flow)"}
          </span>
        )}
      </div>

      <div className="flex gap-1 items-center flex-wrap">
        {(data?.periods ?? []).map((p) => (
          <button key={p.period} className={`term-btn ${p.period === period?.period ? "active" : ""}`} onClick={() => setPeriodKey(p.period)}>
            {p.period}
          </button>
        ))}
        {period && <span className="dim text-fs-10 ml-1">{NAMES[period.period]} · bar {period.interval}</span>}
      </div>

      {error && <div className="down">Error: {(error as Error).message}</div>}
      {isLoading && <div className="dim">Menghitung money flow {symbol}…</div>}

      {period && (
        <>
          {period.error ? (
            <div className="down">Data periode ini gagal dimuat: {period.error}</div>
          ) : period.inflow + period.outflow === 0 ? (
            <div className="dim">Tidak ada volume untuk {symbol} pada periode ini (misalnya kurs atau indeks tanpa volume).</div>
          ) : (
            <>
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(calc(9rem * var(--font-scale)), 1fr))" }}>
                <Card label="Inflow (masuk)" value={money(period.inflow, unit)} cls="up" />
                <Card label="Outflow (keluar)" value={money(period.outflow, unit)} cls="down" />
                <Card label="Net flow" value={signedMoney(period.net, unit)} cls={pctClass(period.net)} sub={period.net >= 0 ? "lebih banyak uang masuk" : "lebih banyak uang keluar"} />
                <Card label="Porsi beli" value={period.buyShare === null ? "—" : `${fmt(period.buyShare * 100, 1)}%`} sub={period.buyShare === null ? undefined : `jual ${fmt((1 - period.buyShare) * 100, 1)}%`} />
              </div>
              {period.buyShare !== null && (
                <div className="h-2 flex" title={`Masuk ${fmt(period.buyShare * 100, 1)}% · keluar ${fmt((1 - period.buyShare) * 100, 1)}%`}>
                  <span style={{ width: `${period.buyShare * 100}%`, background: IN }} />
                  <span className="flex-1" style={{ background: OUT }} />
                </div>
              )}
              <div className="h-[max(calc(14rem*var(--font-scale)),32vh)] border border-[var(--border)] bg-[var(--panel)] p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} stackOffset="sign">
                    <CartesianGrid stroke="#1c1c1c" vertical={false} />
                    <XAxis dataKey="t" stroke="#808080" fontSize={fontPx(9)} minTickGap={24} />
                    <YAxis yAxisId="flow" stroke="#808080" fontSize={fontPx(9)} tickFormatter={(v: number) => fmtBig(v)} width={52} />
                    <YAxis yAxisId="net" orientation="right" stroke="#ff9900" fontSize={fontPx(9)} tickFormatter={(v: number) => fmtBig(v)} width={52} />
                    <Tooltip
                      contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: fontPx(10) }}
                      labelStyle={{ color: "#808080" }}
                      formatter={(v: number, name: string) => [money(name === "Outflow" ? -v : v, unit), name]}
                    />
                    <ReferenceLine yAxisId="flow" y={0} stroke="#404040" />
                    <Bar yAxisId="flow" dataKey="inflow" name="Inflow" fill={IN} stackId="f" isAnimationActive={false} />
                    <Bar yAxisId="flow" dataKey="outflow" name="Outflow" fill={OUT} stackId="f" isAnimationActive={false} />
                    <Line yAxisId="net" dataKey="net" name="Net kumulatif" stroke="#ff9900" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Inflow</th>
                <th>Outflow</th>
                <th>Net</th>
                <th>Porsi beli</th>
              </tr>
            </thead>
            <tbody>
              {data!.periods.map((p) => (
                <tr key={p.period} className={`cursor-pointer ${p.period === period.period ? "bg-[#1f1a10]" : ""}`} onClick={() => setPeriodKey(p.period)}>
                  <td className="!text-left">{NAMES[p.period] ?? p.period}</td>
                  <td className="up">{p.error ? "—" : money(p.inflow, unit)}</td>
                  <td className="down">{p.error ? "—" : money(p.outflow, unit)}</td>
                  <td className={pctClass(p.net)}>{p.error ? "—" : signedMoney(p.net, unit)}</td>
                  <td>{p.buyShare === null ? "—" : `${fmt(p.buyShare * 100, 1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dim text-fs-10 leading-relaxed">
            {data!.method === "taker"
              ? "Inflow = nilai beli agresif (taker buy) di Binance, outflow = nilai jual agresif. Ini transaksi yang benar-benar terjadi, bukan perkiraan."
              : "Inflow dan outflow diperkirakan dari candle (metode Chaikin): nilai transaksi tiap bar dihitung masuk bila close dekat high dan keluar bila dekat low. Data arus dana institusi per saham tidak tersedia gratis."}
          </div>
        </>
      )}
    </div>
  );
}
