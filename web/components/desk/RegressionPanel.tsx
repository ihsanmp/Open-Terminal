"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useChartSymbol } from "../../lib/pair";
import { useWidgetSetting } from "../../store/terminal";
import { Section, signed, wib } from "./ui";

// Multi-factor regression of the chart's pair on the S&P 500, the dollar, the 10-year yield, the
// VIX, gold, oil and bitcoin (server/src/providers/factorreg.ts): each factor's beta with its
// Newey-West t-statistic, how stable it is, how much of the pair's move they explain together,
// the last day taken apart, and whether yesterday's factors foretell today (out of sample).

type FactorRow = { key: string; label: string; unit: "%" | "bp"; beta: number; se: number; t: number; p: number; stdBeta: number; vif: number; betaEarly: number | null; betaLate: number | null };
type Regression = {
  symbol: string;
  label: string;
  freq: "daily" | "weekly";
  n: number;
  from: string;
  to: string;
  factors: FactorRow[];
  dropped: Array<{ key: string; label: string; why: string }>;
  intercept: { value: number; t: number; p: number };
  r2: number;
  adjR2: number;
  residSd: number;
  oosR2: number | null;
  predictive: { oosR2: number; hit: number; baseHit: number; n: number } | null;
  latest: { date: string; actual: number; fitted: number; parts: Array<{ key: string; label: string; move: number; contribution: number }> } | null;
  asOf: number;
};

const stars = (p: number) => (p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const per = (f: FactorRow) => (f.unit === "bp" ? "naik 1 bp" : "naik 1%");

/** A factor's effect in a sentence. */
function sentence(f: FactorRow, label: string, period: string): string {
  const strength = f.p < 0.001 ? "sangat signifikan" : f.p < 0.01 ? "signifikan" : "signifikan lemah";
  return `Saat ${f.label} ${per(f)}, ${label} rata-rata bergerak ${signed(f.beta, f.unit === "bp" ? 3 : 2)} di ${period} yang sama (t ${f.t.toFixed(1)}, ${strength}).`;
}

export default function RegressionPanel() {
  const symbol = useChartSymbol();
  const [freq, setFreq] = useWidgetSetting<"daily" | "weekly">("regFreq", "daily");
  const poll = usePoll(5 * 60_000);
  const { data, error, isLoading } = useQuery({
    queryKey: ["desk-regression", symbol, freq],
    queryFn: () => apiGet<Regression>(`/api/desk/regression?symbol=${encodeURIComponent(symbol)}&freq=${freq}`),
    refetchInterval: poll,
  });
  const period = freq === "daily" ? "hari" : "minggu";

  const toggle = (
    <span className="flex gap-1">
      {(["daily", "weekly"] as const).map((f) => (
        <button key={f} className={`term-btn ${freq === f ? "active" : ""}`} onClick={() => setFreq(f)}>
          {f === "daily" ? "Harian" : "Mingguan"}
        </button>
      ))}
    </span>
  );
  if (isLoading) return <div className="p-3 dim">Menghitung regresi {symbol} terhadap 7 faktor (±3 tahun data harian)…</div>;
  if (error || !data)
    return (
      <div className="p-3">
        <div className="down">Regresi untuk {symbol} gagal: {error instanceof Error ? error.message : "data tidak tersedia"}</div>
        <div className="mt-2">{toggle}</div>
      </div>
    );

  // A company's name without its closing full stop, for use mid-sentence ("Apple Inc." → "Apple Inc").
  const name = data.label.replace(/\.$/, "");
  const sig = data.factors.filter((f) => f.p < 0.05).sort((a, b) => Math.abs(b.stdBeta) - Math.abs(a.stdBeta));
  const maxStd = Math.max(0.01, ...data.factors.map((f) => Math.abs(f.stdBeta)));
  const l = data.latest;
  const explained = l && l.actual !== 0 ? Math.max(-9.99, Math.min(9.99, l.fitted / l.actual)) : null;

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <Section
        title={`Regresi multifaktor · ${data.symbol}`}
        note={`${data.label} · ${data.n} ${period} · ${day(data.from)} – ${day(data.to)} (data terakhir) · dihitung ${wib(data.asOf)}`}
        right={toggle}
        className="xl:col-span-12"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div>
            <div className="text-fs-9 dim">R² (seluruh periode)</div>
            <div className="text-fs-15 font-bold">{pct(data.r2)}</div>
            <div className="text-fs-9 dim">gerak {data.label} yang ikut faktor-faktor ini</div>
          </div>
          <div>
            <div className="text-fs-9 dim">R² disesuaikan</div>
            <div className="text-fs-15 font-bold">{pct(data.adjR2)}</div>
          </div>
          <div>
            <div className="text-fs-9 dim">R² di luar sampel (30% terakhir)</div>
            <div className={`text-fs-15 font-bold ${data.oosR2 == null ? "" : data.oosR2 > 0.05 ? "up" : data.oosR2 < 0 ? "down" : "amber"}`}>{data.oosR2 == null ? "—" : pct(data.oosR2)}</div>
            <div className="text-fs-9 dim">beta dari 70% awal, diuji pada data sesudahnya</div>
          </div>
          <div>
            <div className="text-fs-9 dim">Sisa gerak sendiri (σ residu)</div>
            <div className="text-fs-15 font-bold">{data.residSd.toFixed(2)}%</div>
            <div className="text-fs-9 dim">per {period}, di luar faktor</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Faktor</th>
                <th title="Perubahan pair (%) untuk setiap faktor naik 1% (yield: 1 bp), faktor lain tetap">Beta</th>
                <th title="Standar error Newey-West (tahan heteroskedastisitas & autokorelasi)">SE</th>
                <th>t</th>
                <th>p</th>
                <th title="Beta dalam satuan simpangan baku: perbandingan kekuatan antar faktor">Kekuatan (beta standar)</th>
                <th title="Variance inflation factor: di atas 5, faktor terlalu mirip faktor lain">VIF</th>
                <th title="Beta di paruh awal → paruh akhir periode">Stabil? (awal → akhir)</th>
              </tr>
            </thead>
            <tbody>
              {data.factors.map((f) => {
                const flips = f.betaEarly != null && f.betaLate != null && Math.sign(f.betaEarly) !== Math.sign(f.betaLate) && f.p < 0.05;
                return (
                  <tr key={f.key} className={f.p < 0.05 ? "" : "opacity-60"}>
                    <td className="whitespace-nowrap">{f.label}</td>
                    <td className={`tabular-nums font-bold ${f.beta >= 0 ? "up" : "down"}`}>
                      {signed(f.beta, f.unit === "bp" || Math.abs(f.beta) < 0.1 ? 3 : 2, "")}
                      <span className="dim font-normal"> /{f.unit === "bp" ? "bp" : "%"}</span>
                    </td>
                    <td className="tabular-nums dim">{f.se.toFixed(3)}</td>
                    <td className="tabular-nums">{f.t.toFixed(2)}</td>
                    <td className="tabular-nums">
                      {f.p < 0.001 ? "<0,001" : f.p.toFixed(3)} <span className="amber">{stars(f.p)}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <div className="relative w-24 h-1.5 bg-[#1a1a1a] rounded-sm">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[#444]" />
                          <div
                            className={`absolute top-0 bottom-0 ${f.stdBeta >= 0 ? "bg-[var(--up)]" : "bg-[var(--down)]"}`}
                            style={f.stdBeta >= 0 ? { left: "50%", width: `${(f.stdBeta / maxStd) * 50}%` } : { right: "50%", width: `${(-f.stdBeta / maxStd) * 50}%` }}
                          />
                        </div>
                        <span className="tabular-nums dim">{f.stdBeta.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className={`tabular-nums ${f.vif > 5 ? "amber" : "dim"}`}>{f.vif.toFixed(1)}</td>
                    <td className={`tabular-nums ${flips ? "amber" : "dim"}`}>
                      {f.betaEarly == null || f.betaLate == null ? "—" : `${f.betaEarly.toFixed(2)} → ${f.betaLate.toFixed(2)}`}
                      {flips ? " (berbalik)" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-fs-9 dim mt-1">
          * p &lt; 0,05 · ** p &lt; 0,01 · *** p &lt; 0,001. Baris pudar: tidak signifikan (bisa saja kebetulan).
          {data.dropped.length > 0 && ` Tidak dipakai: ${data.dropped.map((d) => `${d.label} (${d.why})`).join(", ")}.`}
        </div>
      </Section>

      <Section title="Artinya" className="xl:col-span-6">
        {sig.length ? (
          <ul className="list-disc pl-4 grid gap-1 leading-relaxed">
            {sig.map((f) => (
              <li key={f.key}>{sentence(f, name, period)}</li>
            ))}
          </ul>
        ) : (
          <div className="dim">Tidak ada faktor yang signifikan: gerak {data.label} hampir seluruhnya miliknya sendiri, bukan ikut pasar besar.</div>
        )}
        <div className="text-fs-10 dim mt-2 leading-relaxed">
          Ini <b>sensitivitas</b> (apa yang bergerak bersama di {period} yang sama), bukan ramalan. Gunakan untuk lindung nilai, ukuran posisi, dan memahami berita mana yang akan menggerakkan {name}. R² {pct(data.r2)} berarti{" "}
          {pct(1 - data.r2)} geraknya tetap tidak dijelaskan faktor-faktor ini.
        </div>
      </Section>

      <Section title={`${period === "hari" ? "Hari" : "Minggu"} terakhir dibedah`} note={l ? day(l.date) : ""} className="xl:col-span-6">
        {l ? (
          <>
            <div className="mb-2">
              {data.label} bergerak <b className={l.actual >= 0 ? "up" : "down"}>{signed(l.actual, 2)}</b>; faktor-faktor memperkirakan <b>{signed(l.fitted, 2)}</b>
              {explained != null && Math.abs(l.actual) > 0.05 ? <span className="dim"> ({explained > 0 ? `±${Math.round(Math.min(1, explained) * 100)}% searah` : "berlawanan arah"} dengan model)</span> : null}. Sisanya{" "}
              <b className={l.actual - l.fitted >= 0 ? "up" : "down"}>{signed(l.actual - l.fitted, 2)}</b> adalah gerak khas {data.label} sendiri.
            </div>
            <table className="data-table w-full text-fs-10">
              <thead>
                <tr>
                  <th>Faktor</th>
                  <th>Geraknya</th>
                  <th>Sumbangan ke pair</th>
                </tr>
              </thead>
              <tbody>
                {[...l.parts]
                  .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
                  .map((p) => (
                    <tr key={p.key}>
                      <td>{p.label}</td>
                      <td className="tabular-nums">{signed(p.move, 2, data.factors.find((f) => f.key === p.key)?.unit === "bp" ? " bp" : "%")}</td>
                      <td className={`tabular-nums ${p.contribution >= 0 ? "up" : "down"}`}>{signed(p.contribution, 3)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="dim">—</div>
        )}
      </Section>

      <Section title="Bisakah faktor kemarin meramal hari ini?" note="uji di luar sampel, 30% data terakhir" className="xl:col-span-12">
        {data.predictive ? (
          <div className="leading-relaxed">
            Faktor-faktor {period} sebelumnya (dan gerak {data.label} sendiri) dipakai untuk menebak {period} berikutnya: R² di luar sampel{" "}
            <b className={data.predictive.oosR2 > 0.01 ? "up" : "down"}>{pct(data.predictive.oosR2)}</b>, arah tepat <b>{data.predictive.hit.toFixed(1)}%</b> dari {data.predictive.n} {period} vs{" "}
            {data.predictive.baseHit.toFixed(1)}% bila selalu menebak arah yang paling sering.{" "}
            {data.predictive.oosR2 > 0.01 && data.predictive.hit > data.predictive.baseHit + 3 ? (
              <span className="up">Ada sedikit daya ramal — tetap uji lagi sebelum dipakai.</span>
            ) : (
              <span className="amber">Tidak ada daya ramal: hubungan ini hanya berlaku di {period} yang sama, jadi beta di atas tidak bisa dipakai sebagai sinyal masuk.</span>
            )}
          </div>
        ) : (
          <div className="dim">Data terlalu sedikit untuk uji ramalan.</div>
        )}
        <div className="text-fs-9 dim mt-2">
          Metode: OLS dengan konstanta; return log harian/mingguan dalam %, yield sebagai perubahan bp; hanya hari ketika semua pasar buka; hari dengan lonjakan &gt;8 deviasi (roll kontrak, data rusak) dibuang; standar error Newey-West. Data ±3 tahun terakhir sampai
          bar terbaru yang sudah ditutup semua pasar.
        </div>
      </Section>
    </div>
  );
}
