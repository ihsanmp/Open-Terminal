"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";

// The macro engine (server: providers/macroengine.ts): our own P10/P50/P90 for the next CPI, core
// CPI, PPI and payrolls, by quantile gradient boosting on point-in-time data, with the latest Fed
// Sentiment Index, the band kept 30 minutes before each release, and each model's out-of-sample
// track record beside it.

type Unit = "%" | "K";
type Backtest = { months: number; from: string | null; maeEngine: number; maeConsensus: number; coverage: number; calls: number; hits: number; medianSpread: number };
type Snapshot = { at: string; p10: number; p50: number; p90: number; adjusted: number; consensus: number; sentiment: number | null };
type Row = {
  key: string;
  label: string;
  unit: Unit;
  period: string;
  release: string;
  consensus: number;
  previous: number | null;
  actual: number | null;
  p10: number;
  p50: number;
  p90: number;
  spread: number;
  confidence: number;
  sentiment: { index: number; at: string; title: string } | null;
  adjustment: number;
  adjusted: number;
  bias: "hawkish" | "dovish" | "neutral";
  inputs: Array<{ name: string; value: number | null }>;
  backtest: Backtest;
  h30: Snapshot | null;
};
type Engine = {
  asOf: string;
  rows: Row[];
  waiting: Array<{ key: string; label: string; period: string; release: string; backtest: Backtest }>;
  recent: Array<{ key: string; label: string; unit: Unit; period: string; release: string; consensus: number; actual: number; h30: Snapshot }>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const val = (v: number, unit: Unit) => (unit === "K" ? `${Math.round(v)}K` : `${fmt(v, 2)}%`);
const signed = (v: number, unit: Unit) => `${v > 0 ? "+" : ""}${unit === "K" ? Math.round(v) : fmt(v, 3)}`;

const BIAS = {
  hawkish: { label: "🦅 HAWKISH", cls: "bg-[#ef5350] text-black", reading: "lebih panas dari konsensus → USD & yield ↑, emas · saham · crypto ↓" },
  dovish: { label: "🕊 DOVISH", cls: "bg-[#26a69a] text-black", reading: "lebih dingin dari konsensus → USD & yield ↓, emas · saham · crypto ↑" },
  neutral: { label: "⚖ NETRAL", cls: "border border-[#555] dim", reading: "tidak jelas berbeda dari konsensus" },
};

function useNow(step = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(id);
  }, [step]);
  return now;
}

function countdown(ms: number): string {
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${String(m).padStart(2, "0")} mnt`;
  return `${m} mnt ${String(s % 60).padStart(2, "0")} dtk`;
}

/** The band on a line: P10–P90 shaded, P50 and the consensus (and the print, once out) marked. */
function Fan({ r }: { r: Row }) {
  const points = [r.p10, r.p90, r.consensus, r.adjusted, ...(r.actual !== null ? [r.actual] : [])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
  const x = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;
  return (
    <div className="relative h-7 mx-1">
      <div className="absolute top-3 left-0 right-0 h-px bg-[#333]" />
      <div className="absolute top-1.5 h-3 bg-[#ef5350]/25 border border-[#ef5350]/60 rounded-sm" style={{ left: x(r.p10), width: `calc(${x(r.p90)} - ${x(r.p10)})` }} title={`P10–P90: ${val(r.p10, r.unit)} – ${val(r.p90, r.unit)}`} />
      <div className="absolute top-0.5 h-5 w-[2px] bg-white" style={{ left: x(r.adjusted) }} title={`P50 (dengan sentimen Fed): ${val(r.adjusted, r.unit)}`} />
      <div className="absolute top-0 h-6 w-[2px] bg-[#f5a623]" style={{ left: x(r.consensus) }} title={`Konsensus: ${val(r.consensus, r.unit)}`} />
      {r.actual !== null && <div className="absolute top-0 h-6 w-[3px] bg-[#26a69a]" style={{ left: x(r.actual) }} title={`Aktual: ${val(r.actual, r.unit)}`} />}
      <div className="absolute top-[22px] text-fs-9 dim tabular-nums" style={{ left: x(r.p10), transform: "translateX(-50%)" }}>
        {val(r.p10, r.unit)}
      </div>
      <div className="absolute top-[22px] text-fs-9 dim tabular-nums" style={{ left: x(r.p90), transform: "translateX(-50%)" }}>
        {val(r.p90, r.unit)}
      </div>
    </div>
  );
}

function Track({ b, unit }: { b: Backtest; unit: Unit }) {
  const better = b.maeEngine < b.maeConsensus;
  return (
    <div className="dim text-fs-10 leading-relaxed">
      Uji walk-forward {b.months} rilis sejak {b.from ? periodLabel(b.from) : "-"}: meleset rata-rata{" "}
      <b className={better ? "up" : "text-[var(--text)]"}>{unit === "K" ? `${Math.round(b.maeEngine)}K` : fmt(b.maeEngine, 3)}</b> vs konsensus {unit === "K" ? `${Math.round(b.maeConsensus)}K` : fmt(b.maeConsensus, 3)}
      {better ? " (sedikit lebih baik)" : b.maeEngine === b.maeConsensus ? " (setara)" : " (belum lebih baik)"}; pita P10–P90 memuat {Math.round(b.coverage * 100)}% rilis (ideal 80%); saat berani beda dari konsensus: {b.hits}/{b.calls} benar arah.
    </div>
  );
}

export default function EnginePanel() {
  const now = useNow();
  const { data, isLoading, error } = useQuery({
    queryKey: ["macro-engine"],
    queryFn: () => apiGet<Engine>("/api/macro/engine"),
    staleTime: 60_000,
    // Every two minutes: the band is kept at H-30, and the inputs move as data comes in.
    refetchInterval: 120_000,
  });
  if (isLoading) return <div className="dim p-2">Melatih model kuantil dari data point-in-time…</div>;
  if (error || !data) return <div className="down p-2">Engine gagal dimuat: {(error as Error)?.message}</div>;

  return (
    <div className="flex flex-col gap-2 p-2 text-fs-11">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-[var(--text)]">⚙ ENGINE KUANTIL (P10 / P50 / P90)</span>
        <span className="dim text-fs-10">model sendiri · data point-in-time · diperbarui {new Date(data.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {data.rows.map((r) => {
        const t = Date.parse(r.release);
        const left = t - now;
        const h30 = left > 0 && left <= 30 * 60_000;
        return (
          <div key={r.key} className={`border rounded-sm ${h30 ? "border-[#f5a623]" : "border-[var(--border)]"}`}>
            <div className="px-2 py-1 bg-[#141414] flex items-center gap-2">
              <span className="text-[var(--text)] font-bold">
                {r.label} · {periodLabel(r.period)}
              </span>
              {h30 && <span className="text-fs-9 px-1 rounded-sm bg-[#f5a623] text-black font-bold">H-30</span>}
              <span className="ml-auto dim tabular-nums">
                {r.actual !== null ? `rilis ${when(r.release)}` : left > 0 ? `${countdown(left)} · ${when(r.release)}` : "menunggu angka…"}
              </span>
            </div>
            <div className="px-2 pt-1 flex items-center gap-3 flex-wrap">
              <div>
                <div className="dim text-fs-9">P50 ENGINE</div>
                <div className="text-fs-15 font-bold text-[var(--text)] tabular-nums">{val(r.adjusted, r.unit)}</div>
              </div>
              <div>
                <div className="dim text-fs-9">KONSENSUS</div>
                <div className="text-fs-15 amber tabular-nums">{val(r.consensus, r.unit)}</div>
              </div>
              {r.actual !== null && (
                <div>
                  <div className="dim text-fs-9">AKTUAL</div>
                  <div className="text-fs-15 up tabular-nums">{val(r.actual, r.unit)}</div>
                </div>
              )}
              <div>
                <div className="dim text-fs-9">KEYAKINAN</div>
                <div className="text-fs-15 tabular-nums">{r.confidence}%</div>
              </div>
              <span className={`text-fs-9 px-1 rounded-sm font-bold ${BIAS[r.bias].cls}`}>{BIAS[r.bias].label}</span>
            </div>
            <Fan r={r} />
            <div className="px-2 pb-1.5 pt-2 flex flex-col gap-0.5">
              <div className="text-fs-10">{BIAS[r.bias].reading}</div>
              <div className="dim text-fs-10">
                P10 {val(r.p10, r.unit)} · P50 model {val(r.p50, r.unit)} · P90 {val(r.p90, r.unit)} · rentang {r.unit === "K" ? `${Math.round(r.spread)}K` : fmt(r.spread, 2)}
                {r.sentiment
                  ? ` · sentimen Fed ${r.sentiment.index > 0 ? "+" : ""}${fmt(r.sentiment.index, 2)} (${new Date(r.sentiment.at).toLocaleDateString([], { day: "numeric", month: "short" })}) menggeser ${signed(r.adjustment, r.unit)}`
                  : " · belum ada sentimen Fed dari siaran 14 hari terakhir"}
              </div>
              <div className="dim text-fs-10">
                Input: {r.inputs.map((i) => `${i.name} ${i.value === null ? "belum ada" : fmt(i.value, 2)}`).join(" · ")}
              </div>
              {r.h30 && (
                <div className="text-fs-10">
                  H-30 ({new Date(r.h30.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}): P50 {val(r.h30.adjusted, r.unit)}, pita {val(r.h30.p10, r.unit)}–{val(r.h30.p90, r.unit)}
                </div>
              )}
              <Track b={r.backtest} unit={r.unit} />
            </div>
          </div>
        );
      })}
      {data.waiting.map((w) => (
        <div key={w.key} className="border border-[var(--border)] rounded-sm px-2 py-1">
          <div className="flex gap-2">
            <span className="text-[var(--text)] font-bold">
              {w.label} · {periodLabel(w.period)}
            </span>
            <span className="ml-auto dim">{when(w.release)}</span>
          </div>
          <div className="dim text-fs-10">Menunggu konsensus pasar; engine memprediksi selisih terhadap konsensus, jadi pitanya muncul setelah konsensus terbit.</div>
          <Track b={w.backtest} unit={w.key === "nfp" ? "K" : "%"} />
        </div>
      ))}
      {data.recent.length > 0 && (
        <div className="border border-[var(--border)] rounded-sm">
          <div className="px-2 py-1 bg-[#141414] text-[var(--text)] font-bold">Prediksi H-30 vs rilis</div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="!text-left">Rilis</th>
                <th>P50 H-30</th>
                <th>Pita</th>
                <th>Konsensus</th>
                <th>Aktual</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((x) => {
                const inside = x.actual >= x.h30.p10 && x.actual <= x.h30.p90;
                const closer = Math.abs(x.actual - x.h30.adjusted) < Math.abs(x.actual - x.consensus);
                return (
                  <tr key={`${x.key}${x.release}`}>
                    <td className="!text-left">
                      {x.label} {periodLabel(x.period)}
                    </td>
                    <td className={`tabular-nums ${closer ? "up" : ""}`}>{val(x.h30.adjusted, x.unit)}</td>
                    <td className={`tabular-nums ${inside ? "" : "down"}`}>
                      {val(x.h30.p10, x.unit)}–{val(x.h30.p90, x.unit)}
                    </td>
                    <td className="tabular-nums">{val(x.consensus, x.unit)}</td>
                    <td className="tabular-nums text-[var(--text)]">{val(x.actual, x.unit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="dim text-fs-10 leading-relaxed">
        Gradient boosting kuantil (pohon 1 level, 100 pohon) memprediksi kejutan (aktual − konsensus) dari data yang sudah ada sebelum rilis: rilis pertama dan konsensus di kalender sejak 2013, nowcast Cleveland Fed, kejutan ADP/PPI/CPI yang keluar lebih dulu, harga bensin. Model yang lebih besar (150 pohon × 3 level seperti di blueprint) terbukti overfit pada ±160 rilis, jadi dipakai yang sederhana. Konsensus pasar sulit dikalahkan: engine ini kebanyakan setara konsensus, dan baru berani berbeda saat inputnya jelas. Sentimen Fed menggeser P50 maksimal ¼ simpangan kejutan biasa. Bacaan arah, bukan sinyal trading.
      </div>
    </div>
  );
}
