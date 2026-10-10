"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { KEY_TENORS, SPREADS, curveThen, moveBp, shapeOf, spread, timeLeft } from "../../lib/bonds";
import { fontPx } from "../../lib/font-scale";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";
import { DetailChart, PERIODS, Panel, Sparkline, signed, type CurvePoint, type MacroData, type Period, type Selected } from "./macro-parts";

// US Bonds: the US Treasury curve by tenor (US2Y, US10Y and US30Y first), each with its benchmark
// security's maturity — when it falls due — coupon and next auction (TreasuryDirect), its yield
// and move (live, as on the Macro page), the curve now against where it stood, and the spreads.

type Benchmark = {
  tenor: string;
  term: string;
  type: string;
  cusip: string;
  auctionDate: string;
  issueDate: string;
  maturityDate: string;
  coupon: number | null;
  auctionYield: number | null;
  bidToCover: number | null;
  reopening: boolean;
  next: { auctionDate: string; issueDate: string; maturityDate: string; reopening: boolean } | null;
};

const date = (d: string | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const NAMES: Record<string, string> = { Bill: "T-Bill", Note: "T-Note", Bond: "T-Bond" };

function KeyCard({ c, b, period, selected, onSelect }: { c: CurvePoint; b?: Benchmark; period: Period; selected: boolean; onSelect: () => void }) {
  const move = moveBp(c, period);
  return (
    <button
      onClick={onSelect}
      className={`text-left border p-2 min-w-0 flex flex-col gap-1 ${selected ? "border-[var(--amber)] bg-[#1f1a10]" : "border-[var(--border)] bg-[var(--panel)] hover:bg-[#161616]"}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="amber font-bold text-fs-13">US {c.tenor}</span>
        <span className="dim text-fs-10">{b ? `${NAMES[b.type] ?? b.type} ${c.tenor}` : c.symbol}</span>
        <span className="ml-auto">
          <Sparkline values={c.spark} />
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-fs-18 text-[var(--text)]">
          <Flash value={c.value}>{fmt(c.value, 3)}%</Flash>
        </span>
        <span className={pctClass(move)}>
          {signed(move, 1, " bp")} <span className="dim text-fs-10">{period}</span>
        </span>
      </div>
      {b ? (
        <div className="text-fs-11 leading-relaxed">
          <div>
            <span className="dim">Jatuh tempo </span>
            <span className="text-[var(--text)] font-bold">{date(b.maturityDate)}</span>
            <span className="dim"> · sisa {timeLeft(b.maturityDate)}</span>
          </div>
          <div className="dim">
            Kupon <span className="text-[var(--text)]">{b.coupon !== null ? `${fmt(b.coupon, 3)}%` : "tanpa kupon"}</span> · CUSIP {b.cusip}
          </div>
          <div className="dim">
            Lelang terakhir {date(b.auctionDate)}
            {b.auctionYield !== null && <> ({fmt(b.auctionYield, 3)}%)</>}
            {b.reopening && " · reopening"}
          </div>
          <div className="dim">Lelang berikutnya {b.next ? <span className="text-[var(--text)]">{date(b.next.auctionDate)}</span> : "belum diumumkan"}</div>
        </div>
      ) : (
        <div className="dim text-fs-10">Data jatuh tempo belum tersedia</div>
      )}
    </button>
  );
}

export default function BondsWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setView = useTerminal((s) => s.setView);
  const poll = usePoll(sessionRefreshMs(10_000, 120_000));
  // The same data (and cache) as the Macro page.
  const { data, error } = useQuery({ queryKey: ["macro"], queryFn: () => apiGet<MacroData>("/api/macro"), refetchInterval: poll });
  const bench = useQuery({ queryKey: ["bond-benchmarks"], queryFn: () => apiGet<Benchmark[]>("/api/bonds/benchmarks"), staleTime: 3_600_000, refetchInterval: 3_600_000 });
  const [period, setPeriod] = useWidgetSetting<Period>("bondsChgPeriod", "1D");
  const [sel, setSel] = useState<Selected>({ symbol: "TVC:US10Y", label: "US 10Y Yield", isYield: true });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading US Treasury yields…</div>;

  const curve = data.curve;
  const benchOf = (tenor: string) => bench.data?.find((b) => b.tenor === tenor);
  const pick = (c: CurvePoint) => setSel({ symbol: c.symbol, label: `US ${c.tenor} Yield`, isYield: true });
  const shape = shapeOf(curve);
  const chart = curveThen(curve, period).filter((p) => p.now !== null);

  return (
    <div className="p-1 flex flex-col gap-1 text-fs-11">
      <div className="flex items-center gap-1 px-1 flex-wrap" role="group" aria-label="Change over">
        <span className="dim mr-1">Perubahan</span>
        {PERIODS.map((p) => (
          <button key={p} className={`term-btn ${p === period ? "active" : ""}`} onClick={() => setPeriod(p)} aria-pressed={p === period}>
            {p}
          </button>
        ))}
        <span className="ml-auto dim text-fs-10">
          Yield {data.curveSource === "fred" ? "FRED (harian)" : "live"} · jatuh tempo & lelang: TreasuryDirect
          {bench.error ? <span className="down"> (gagal dimuat)</span> : null}
        </span>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(calc(15rem * var(--font-scale)), 1fr))" }}>
        {KEY_TENORS.map((t) => {
          const c = curve.find((x) => x.tenor === t);
          return c ? <KeyCard key={t} c={c} b={benchOf(t)} period={period} selected={sel.symbol === c.symbol} onSelect={() => pick(c)} /> : null;
        })}
      </div>

      <DetailChart
        sel={sel}
        onOpen={() => {
          setActiveSymbol(sel.symbol);
          setView("chart");
        }}
      />

      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(calc(24rem * var(--font-scale)), 1fr))" }}>
        <Panel title="Semua tenor · jatuh tempo obligasi acuan">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Yield</th>
                <th>Chg {period} (bp)</th>
                <th>Jatuh tempo</th>
                <th>Sisa</th>
                <th>Kupon</th>
                <th>Lelang berikutnya</th>
                <th>3M</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((c) => {
                const b = benchOf(c.tenor);
                const move = moveBp(c, period);
                return (
                  <tr key={c.tenor} className={`cursor-pointer ${sel.symbol === c.symbol ? "bg-[#1f1a10]" : ""}`} onClick={() => pick(c)} title={b ? `${NAMES[b.type] ?? b.type} · CUSIP ${b.cusip} · terbit ${date(b.issueDate)}` : c.symbol}>
                    <td className={KEY_TENORS.includes(c.tenor) ? "amber font-bold" : ""}>US {c.tenor}</td>
                    <td>
                      <Flash value={c.value}>{fmt(c.value, 3)}%</Flash>
                    </td>
                    <td className={pctClass(move)}>{signed(move, 1)}</td>
                    <td className="text-[var(--text)]">{b ? date(b.maturityDate) : "—"}</td>
                    <td className="dim">{b ? timeLeft(b.maturityDate) : "—"}</td>
                    <td>{b ? (b.coupon !== null ? `${fmt(b.coupon, 3)}%` : "—") : "—"}</td>
                    <td className="dim">{b?.next ? date(b.next.auctionDate) : "—"}</td>
                    <td>
                      <Sparkline values={c.spark} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-2 py-1 dim text-fs-10 border-t border-[var(--border)]">
            Jatuh tempo milik obligasi acuan (on-the-run): seri yang terakhir dilelang untuk tiap tenor, yang yield-nya ditampilkan di sini.
          </div>
        </Panel>

        <Panel title={`Kurva yield · sekarang vs awal ${period}`} right={shape ? <span className="normal-case">{shape}</span> : undefined}>
          <div className="h-44 px-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
                <XAxis dataKey="tenor" stroke="#808080" fontSize={fontPx(9)} />
                <YAxis stroke="#808080" fontSize={fontPx(9)} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: fontPx(10) }}
                  labelStyle={{ color: "#808080" }}
                  formatter={(v: number) => `${fmt(v, 3)}%`}
                />
                <Legend wrapperStyle={{ fontSize: fontPx(10) }} />
                <Line name="Sekarang" type="monotone" dataKey="now" stroke="#ff9900" strokeWidth={1.8} dot={{ r: 2 }} isAnimationActive={false} />
                <Line name={`Awal ${period}`} type="monotone" dataKey="then" stroke="#5b9cf6" strokeWidth={1.2} strokeDasharray="4 3" dot={{ r: 1.5 }} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Spread</th>
                <th>Sekarang (bp)</th>
                <th>Chg {period} (bp)</th>
                <th className="!text-left">Artinya</th>
              </tr>
            </thead>
            <tbody>
              {SPREADS.map(([label, short, long, means]) => {
                const s = spread(curve, short, long, period);
                return (
                  <tr key={label}>
                    <td className="font-bold">{label}</td>
                    <td className={s.value !== null && s.value < 0 ? "down" : "text-[var(--text)]"}>{signed(s.value, 1)}</td>
                    <td className={pctClass(s.move)}>{signed(s.move, 1)}</td>
                    <td className="!text-left dim !whitespace-normal">{means}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
