"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { Icon } from "../Icon";

// The next inflation and GDP prints, nowcast against the consensus (server: providers/nowcast.ts):
// the Cleveland Fed's inflation nowcast and the Atlanta Fed's GDPNow, each beside TradingView's
// consensus, with the side the print looks like landing on and how often the nowcast has called
// that side right. A bias to read, not a trade.

type Bias = "hawkish" | "dovish" | "neutral";
type Row = {
  key: string;
  label: string;
  period: string;
  release: string | null;
  nowcast: number;
  consensus: number | null;
  previous: number | null;
  actual: number | null;
  diff: number | null;
  bias: Bias | null;
  track: { months: number; nowcastMiss: number; consensusMiss: number; sideRight: number; sideCalls: number } | null;
};
type Gdp = { quarter: string; gdpNow: number; consensus: number | null; release: string | null; actual: number | null; diff: number | null };
type Nowcast = { asOf: string | null; inflation: Row[]; gdp: Gdp | null; source: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

const BIAS: Record<Bias, { label: ReactNode; cls: string; markets: string }> = {
  hawkish: { label: <><Icon name="hot" /> HAWKISH</>, cls: "bg-[#ef5350] text-black", markets: "lebih panas dari perkiraan → USD & yield ↑, emas · saham · crypto ↓" },
  dovish: { label: <><Icon name="cool" /> DOVISH</>, cls: "bg-[#26a69a] text-black", markets: "lebih dingin dari perkiraan → USD & yield ↓, emas · saham · crypto ↑" },
  neutral: { label: <><Icon name="neutral" /> NETRAL</>, cls: "border border-[#555] dim", markets: "sesuai perkiraan" },
};

function when(iso: string | null): string {
  if (!iso) return "jadwal belum ada";
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function NowcastPanel() {
  const { data, isLoading, error } = useQuery({ queryKey: ["macro-nowcast"], queryFn: () => apiGet<Nowcast>("/api/macro/nowcast"), staleTime: 600_000, refetchInterval: 1_800_000 });
  if (isLoading) return <div className="dim p-2">Memuat nowcast Cleveland Fed dan GDPNow…</div>;
  if (error || !data) return <div className="down p-2">Nowcast gagal dimuat: {(error as Error)?.message}</div>;

  // By release (CPI's four together, PCE's four together), the next first.
  const groups = new Map<string, Row[]>();
  for (const r of data.inflation) groups.set(`${r.release ?? "z"}|${r.period}`, [...(groups.get(`${r.release ?? "z"}|${r.period}`) ?? []), r]);
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="flex flex-col gap-2 p-2 text-fs-11">
      <div className="dim text-fs-10">Nowcast Cleveland Fed per {data.asOf ?? "-"} · dibandingkan konsensus pasar</div>
      {ordered.map(([key, rows]) => (
        <div key={key} className="border border-[var(--border)] rounded-sm">
          <div className="px-2 py-1 bg-[#141414] flex justify-between">
            <span className="text-[var(--text)] font-bold">
              {rows[0].label.startsWith("PCE") || rows[0].label.startsWith("Core PCE") ? "PCE" : "CPI"} · {periodLabel(rows[0].period)}
            </span>
            <span className="dim">rilis {when(rows[0].release)}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="!text-left">Indikator</th>
                <th>Nowcast</th>
                <th>Konsensus</th>
                <th>Δ</th>
                <th>Bias</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} title={r.track ? `${r.track.months} bulan terakhir: nowcast meleset rata-rata ${fmt(r.track.nowcastMiss, 3)} pp, konsensus ${fmt(r.track.consensusMiss, 3)} pp. Saat nowcast jelas berbeda dari konsensus, ${r.track.sideRight} dari ${r.track.sideCalls} kali rilisnya jatuh di sisi yang sama dengan nowcast.` : undefined}>
                  <td className="!text-left">
                    {r.label}
                    {r.actual !== null && <span className="dim"> · aktual {fmt(r.actual, 1)}%</span>}
                  </td>
                  <td className="text-[var(--text)] tabular-nums">{fmt(r.nowcast, 2)}%</td>
                  <td className="tabular-nums">{r.consensus === null ? "-" : `${fmt(r.consensus, 1)}%`}</td>
                  <td className={`tabular-nums ${r.diff === null ? "dim" : r.diff > 0 ? "down" : r.diff < 0 ? "up" : ""}`}>{r.diff === null ? "-" : `${r.diff > 0 ? "+" : ""}${fmt(r.diff, 2)}`}</td>
                  <td>{r.bias ? <span className={`text-fs-9 px-1 rounded-sm font-bold ${BIAS[r.bias].cls}`}>{BIAS[r.bias].label}</span> : <span className="dim text-fs-9">konsensus belum ada</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            // The release's call: the side most of its readings lean to (hotter or cooler), else as expected.
            const hot = rows.filter((r) => r.bias === "hawkish").length;
            const cool = rows.filter((r) => r.bias === "dovish").length;
            const lead: { bias: Bias | null } = { bias: rows.some((r) => r.bias) ? (hot > cool ? "hawkish" : cool > hot ? "dovish" : "neutral") : null };
            const t = rows.find((r) => r.track && r.track.sideCalls > 0)?.track;
            return (
              <div className="px-2 py-1 text-fs-10 leading-relaxed">
                {lead?.bias ? <span>{BIAS[lead.bias].markets}</span> : <span className="dim">Konsensus belum dirilis; bias muncul setelah ada perkiraan pasar.</span>}
                {t && (
                  <div className="dim">
                    Rekam jejak {t.months} bln: nowcast meleset ±{fmt(t.nowcastMiss, 2)} vs konsensus ±{fmt(t.consensusMiss, 2)}; tebakan sisi benar {t.sideRight}/{t.sideCalls}. Arahkan kursor ke baris untuk tiap indikator.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ))}
      {data.gdp && (
        <div className="border border-[var(--border)] rounded-sm">
          <div className="px-2 py-1 bg-[#141414] flex justify-between">
            <span className="text-[var(--text)] font-bold">GDP · {data.gdp.quarter} (QoQ annualized)</span>
            <span className="dim">rilis {when(data.gdp.release)}</span>
          </div>
          <div className="px-2 py-1.5 flex gap-4">
            <div>
              <div className="dim text-fs-10">GDPNow (Atlanta Fed)</div>
              <div className="text-fs-15 font-bold text-[var(--text)]">{fmt(data.gdp.gdpNow, 2)}%</div>
            </div>
            <div>
              <div className="dim text-fs-10">Konsensus</div>
              <div className="text-fs-15 text-[var(--text)]">{data.gdp.consensus === null ? "-" : `${fmt(data.gdp.consensus, 1)}%`}</div>
            </div>
            {data.gdp.diff !== null && (
              <div>
                <div className="dim text-fs-10">Δ</div>
                <div className={`text-fs-15 ${data.gdp.diff > 0 ? "up" : "down"}`}>{`${data.gdp.diff > 0 ? "+" : ""}${fmt(data.gdp.diff, 2)}`}</div>
              </div>
            )}
          </div>
          {data.gdp.diff !== null && (
            <div className="px-2 pb-1 text-fs-10">{data.gdp.diff > 0 ? "Pertumbuhan lebih kuat dari perkiraan: cenderung hawkish (yield ↑)." : "Pertumbuhan lebih lemah dari perkiraan: cenderung dovish (yield ↓)."}</div>
          )}
        </div>
      )}
      <div className="dim text-fs-10 leading-relaxed">
        Sumber: Cleveland Fed Inflation Nowcasting (diperbarui tiap hari kerja dari harga minyak & bensin serta rilis terakhir), Atlanta Fed GDPNow (FRED), konsensus dari kalender ekonomi TradingView. Bias adalah bacaan arah, bukan sinyal trading; konsensus sering sudah memperhitungkan nowcast.
      </div>
    </div>
  );
}
