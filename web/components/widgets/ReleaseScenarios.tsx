"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { Icon } from "../Icon";

// The Astro Calendar's release scenarios: the big US releases of the next week and, for each, what
// the markets did after past releases with a surprise of each size (the Live TV's news impact,
// server/src/providers/newsimpact.ts, same query and cache). Scenarios, not a forecast: the
// research the calendar follows ("Astronomi, Makro, dan Pergerakan Market") found the surprise
// moves markets on the day, and it isn't known until the print. The quant forecaster's direction
// stays Netral for want of a proven edge; this is what is known.

type Band = { p10: number; p50: number; p90: number; n: number };
type Inst = { key: string; label: string; unit: string; hawk: number; group: string };
type Scenario = { name: string; z: number; print: number; first: Record<string, Band>; day: Record<string, Band> };
type Skill = { calls: number; hits: number; ruleHits: number; coverage: number; n: number };
export type ImpactData = {
  instruments: Inst[];
  upcoming: Array<{ key: string; label: string; release: string; consensus: number; unit: string; p10: number; p90: number; scenarios: Scenario[] }>;
  skill: Array<{ key: string; first: Skill; day: Skill }>;
  events: number;
};

/** The markets the calendar reads, in its order. */
const SHOWN = ["xau", "btc", "dxy", "es", "oil", "us10y"];
/** The report's own figures, per +0.1 pp of core CPI above the consensus (2021–26) and per +76 K payrolls. */
const REPORT: Record<string, string> = {
  cpi: "Laporan: Core CPI +0,1 pp di atas konsensus → DXY +23 bp, emas −24 bp, BTC −1,2%, S&P 500 −0,3% di hari rilis (rezim 2021–2026).",
  nfp: "Laporan: NFP +76 ribu di atas konsensus → DXY +13 bp, emas −30 bp di hari rilis.",
  ism: "Laporan: ISM kuat → DXY naik, emas turun, BTC naik; minyak naik tipis (satu-satunya rilis yang menggerakkan minyak).",
};
const reportFor = (label: string) => (/cpi|inflation/i.test(label) ? REPORT.cpi : /payroll|nfp/i.test(label) ? REPORT.nfp : /ism/i.test(label) ? REPORT.ism : null);

export const useImpact = () => useQuery({ queryKey: ["macro-impact"], queryFn: () => apiGet<ImpactData>("/api/macro/impact"), staleTime: 30_000, refetchInterval: 5 * 60_000 });

const when = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB";
const fmtMove = (v: number, unit: string) => `${v > 0 ? "+" : ""}${unit === "bp" ? v.toFixed(1) : v.toFixed(2)}${unit === "bp" ? " bp" : "%"}`;
const fmtPrint = (v: number, unit: string) => (unit === "K" ? `${Math.round(v).toLocaleString("id-ID")} rb` : `${Number(v.toFixed(2))}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);

export default function ReleaseScenarios() {
  const { data, isLoading, error } = useImpact();
  if (isLoading) return <div className="p-3 dim">Mengambil rilis 7 hari ke depan dan riwayat reaksinya…</div>;
  if (error || !data) return <div className="p-3 down">Skenario rilis belum bisa dihitung: {error instanceof Error ? error.message : "data tidak tersedia"}.</div>;
  const insts = SHOWN.map((k) => data.instruments.find((i) => i.key === k)).filter((i): i is Inst => Boolean(i));
  const skill = new Map(data.skill.map((s) => [s.key, s.day]));
  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3 text-fs-11">
      <div className="text-fs-10 dim leading-relaxed">
        Prakiraan arah di kalender tetap <b className="text-[var(--text)]">Netral</b>: belum ada model yang terbukti menebak arah 5–20 hari. Yang terbukti dari laporan &quot;Astronomi, Makro, dan Pergerakan Market&quot;: kejutan data (aktual dibanding konsensus) menggerakkan pasar di hari rilis. Di bawah, untuk tiap rilis besar 7 hari ke depan, apa yang terjadi setelah rilis-rilis sebelumnya dengan kejutan seukuran itu ({data.events} rilis di riwayat aplikasi). Ini skenario, bukan ramalan: angkanya baru diketahui saat rilis.
      </div>
      {!data.upcoming.length && (
        <div className="border border-[var(--border)] p-3 dim">Tidak ada rilis besar AS (CPI, NFP, ISM, GDP, PCE, FOMC, …) dalam 7 hari ke depan.</div>
      )}
      {data.upcoming.map((u) => {
        const note = reportFor(u.label);
        return (
          <div key={`${u.key}-${u.release}`} className="border border-[var(--border)]">
            <div className="px-2 py-1.5 bg-[var(--panel-2)] flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-bold text-[var(--text)]">
                <Icon name="chart" /> {u.label}
              </span>
              <span className="amber">{when(u.release)}</span>
              <span className="dim">
                konsensus {fmtPrint(u.consensus, u.unit)} · perkiraan engine {fmtPrint(u.p10, u.unit)} – {fmtPrint(u.p90, u.unit)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table w-full text-fs-10">
                <thead>
                  <tr>
                    <th className="!text-left">Gerak hari itu</th>
                    {u.scenarios.map((s) => (
                      <th key={s.name} title={`Kejutan ${s.z > 0 ? "+" : ""}${s.z} simpangan baku (+ = lebih panas/kuat dari konsensus)`}>
                        <div className={s.z > 0 ? "down" : s.z < 0 ? "up" : ""}>
                          <Icon name={s.z > 0 ? "hot" : s.z < 0 ? "cool" : "neutral"} /> {s.name}
                        </div>
                        <div className="dim font-normal">rilis {fmtPrint(s.print, u.unit)}</div>
                      </th>
                    ))}
                    <th title="Sesudah kejutan yang jelas, seberapa sering arah median riwayat sama dengan arah gerak hari itu (uji walk-forward)">Arah benar</th>
                  </tr>
                </thead>
                <tbody>
                  {insts.map((inst) => {
                    const sk = skill.get(inst.key);
                    const hit = sk && sk.calls ? sk.hits / sk.calls : null;
                    return (
                      <tr key={inst.key}>
                        <td className="!text-left whitespace-nowrap">{inst.label}</td>
                        {u.scenarios.map((s) => {
                          const b = s.day[inst.key];
                          return (
                            <td
                              key={s.name}
                              className={`tabular-nums ${!b ? "dim" : b.p50 > 0 ? "up" : b.p50 < 0 ? "down" : ""}`}
                              title={b ? `Median ${fmtMove(b.p50, inst.unit)} · P10–P90 ${fmtMove(b.p10, inst.unit)} sampai ${fmtMove(b.p90, inst.unit)} · ${b.n} rilis` : "riwayat belum cukup"}
                            >
                              {b ? fmtMove(b.p50, inst.unit) : "—"}
                            </td>
                          );
                        })}
                        <td className={`tabular-nums ${hit === null ? "dim" : hit >= 0.6 ? "up" : hit >= 0.5 ? "" : "down"}`} title={sk ? `${sk.hits} dari ${sk.calls} kejutan jelas` : ""}>
                          {hit === null ? "—" : `${Math.round(hit * 100)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {note && <div className="px-2 py-1 text-fs-9 dim border-t border-[var(--border)]">{note}</div>}
          </div>
        );
      })}
      <div className="text-fs-9 dim leading-relaxed">
        Angka di sel = median gerak hari rilis setelah rilis-rilis sebelumnya dalam kelompok kejutan yang sama (arahkan kursor untuk rentang P10–P90). &quot;Arah benar&quot; = seberapa sering median itu searah dengan gerak sebenarnya, diuji walk-forward; laporan menemukan bahkan hubungan terkuat searah hanya sekitar 2 dari 3 kali, jadi tetap pakai manajemen risiko. Minyak sering bergerak berlawanan: data panas dibaca sebagai permintaan kuat.
      </div>
    </div>
  );
}
