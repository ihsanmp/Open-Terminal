"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { usePoll } from "../../lib/refresh";
import { useChartSymbol } from "../../lib/pair";
import { useWidgetSetting } from "../../store/terminal";
import { Section, signed, wib } from "./ui";

// Multi-factor regression of the chart's pair on the S&P 500, the dollar, the 10-year yield, the
// VIX, gold, oil and bitcoin (server/src/providers/factorreg.ts): each factor's beta with its
// Newey-West t-statistic, how stable it is, how much of the pair's move they explain together,
// the last day taken apart, and whether yesterday's factors foretell today (out of sample).

type FactorRow = { key: string; label: string; unit: "%" | "bp"; beta: number; se: number; t: number; p: number; stdBeta: number; vif: number; betaEarly: number | null; betaLate: number | null };
type ModelSize = { keys: string[]; k: number; aic: number; bic: number; adjR2: number; trainR2: number | null; testR2: number | null; cvR2: number | null };
type Overfit = {
  trainR2: number;
  testR2: number;
  gap: number;
  verdict: "ok" | "watch" | "overfit" | "shift";
  cv: { folds: Array<{ from: string; to: string; n: number; trainR2: number; testR2: number; testR2Simple: number | null }>; meanTest: number; sdTest: number; meanTestSimple: number | null };
  complexity: { full: ModelSize; simple: ModelSize | null; preferred: "full" | "simple" };
};

const VERDICT: Record<Overfit["verdict"], { label: string; cls: string; text: string }> = {
  ok: { label: "Tidak ada tanda overfitting", cls: "up", text: "R² di data uji hampir sama dengan di data latih: hubungan yang ditemukan berlaku juga pada data yang tidak dipakai untuk melatih." },
  watch: { label: "Sedikit menurun — perhatikan", cls: "amber", text: "R² di data uji turun 5–15 poin dari data latih. Masih wajar untuk data pasar, tapi beta sebaiknya dibaca dengan hati-hati." },
  overfit: { label: "Indikasi overfitting", cls: "down", text: "Model penuh turun jauh di data uji, sementara model sederhana (hanya faktor signifikan) bertahan: kelebihan variabel ikut mempelajari noise. Pakai model sederhana." },
  shift: { label: "Hubungan berubah (bukan overfitting)", cls: "amber", text: "Model penuh dan model sederhana sama-sama turun di data uji: bukan karena terlalu banyak variabel, tapi karena hubungan pair dengan pasar berubah di periode terakhir. Beta terbaru lebih relevan dari beta seluruh periode." },
};

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
  overfit?: Overfit | null;
  transforms?: Transforms | null;
  rolling?: RollingBetas | null;
  asOf: number;
};

type TransformKey = "ols" | "winsor" | "huber" | "wls";
type Transforms = {
  rows: Array<{ key: TransformKey; label: string; note: string; cvR2: number; wins: number; folds: number; betas: Record<string, number> }>;
  best: TransformKey;
  better: boolean;
};
type RollingBetas = { window: number; step: number; dates: string[]; betas: Record<string, number[]>; r2: number[] };

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

  const q = `symbol=${encodeURIComponent(symbol)}&freq=${freq}`;
  const toggle = (
    <span className="flex gap-1 items-center">
      {(["daily", "weekly"] as const).map((f) => (
        <button key={f} className={`term-btn ${freq === f ? "active" : ""}`} onClick={() => setFreq(f)}>
          {f === "daily" ? "Harian" : "Mingguan"}
        </button>
      ))}
      <span className="w-px h-4 bg-[var(--border)] mx-1" />
      {/* The data and a SAS program for it, as files (server/src/routes/desk.ts). */}
      <a className="term-btn !no-underline" href={`/api/desk/regression.csv?${q}`} download title="Data yang dipakai regresi: tanggal, OHLCV pair, return pair dan tiap faktor (CSV, dibuka di SAS/Excel/R/Python)">
        ⬇ CSV
      </a>
      <a className="term-btn !no-underline" href={`/api/desk/regression.sas?${q}`} download title="Program SAS siap jalan untuk CSV di atas: OLS + VIF, Newey-West, prediksi di luar sampel, ramalan tren">
        ⬇ Kode SAS
      </a>
    </span>
  );
  if (isLoading) return <div className="p-3 dim">Menghitung regresi {symbol} terhadap faktor-faktor pasar (±3 tahun data harian)…</div>;
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
                      {signed(f.beta, Math.abs(f.beta) < 0.01 ? 4 : f.unit === "bp" || Math.abs(f.beta) < 0.1 ? 3 : 2, "")}
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
          {data.factors.some((f) => f.key === "ratediff") &&
            " Selisih yield: yield obligasi 2 tahun negara mata uang dasar dikurangi negara mata uang lawan (perubahan, bp) — penggerak utama forex: uang mengalir ke yang bunganya naik."}
          {data.dropped.length > 0 && ` Tidak dipakai: ${data.dropped.map((d) => `${d.label} (${d.why})`).join(", ")}.`}
        </div>
      </Section>

      {data.overfit && <OverfitSection o={data.overfit} period={period} labelOf={(k) => data.factors.find((f) => f.key === k)?.label ?? k} />}

      {data.transforms && <TransformsSection t={data.transforms} factors={data.factors} />}

      {data.rolling && <RollingSection r={data.rolling} factors={data.factors} period={period} />}

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

/** The overfitting checks: training vs testing R², walk-forward cross-validation, full vs simple model. */
function OverfitSection({ o, period, labelOf }: { o: Overfit; period: string; labelOf: (key: string) => string }) {
  const v = VERDICT[o.verdict];
  const c = o.complexity;
  const rows: Array<[string, ModelSize]> = [["Penuh", c.full], ...(c.simple ? ([["Sederhana", c.simple]] as Array<[string, ModelSize]>) : [])];
  const r2 = (x: number | null | undefined) => (x == null ? "—" : pct(x));
  return (
    <Section title="Cek overfitting" note="data latih vs uji · validasi silang · kompleksitas model" className="xl:col-span-12">
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className={`font-bold ${v.cls}`}>{v.label}</div>
          <div className="text-fs-10 dim leading-relaxed mt-1">{v.text}</div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div>
              <div className="text-fs-9 dim">R² data latih (70% awal)</div>
              <div className="font-bold">{pct(o.trainR2)}</div>
            </div>
            <div>
              <div className="text-fs-9 dim">R² data uji (30% akhir)</div>
              <div className={`font-bold ${o.testR2 < 0 ? "down" : ""}`}>{pct(o.testR2)}</div>
            </div>
            <div>
              <div className="text-fs-9 dim">Selisih</div>
              <div className={`font-bold ${o.gap > 0.15 ? "down" : o.gap > 0.05 ? "amber" : "up"}`}>{signed(o.gap * 100, 1, " pp")}</div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="text-fs-10 font-bold mb-1">Validasi silang walk-forward ({o.cv.folds.length} lipatan)</div>
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Diuji pada</th>
                <th>{period}</th>
                <th>R² latih</th>
                <th>R² uji</th>
                <th title="Model hanya dengan faktor yang signifikan di data latih lipatan itu">R² uji sederhana</th>
              </tr>
            </thead>
            <tbody>
              {o.cv.folds.map((f) => (
                <tr key={f.from}>
                  <td className="whitespace-nowrap">
                    {day(f.from)} – {day(f.to)}
                  </td>
                  <td className="tabular-nums dim">{f.n}</td>
                  <td className="tabular-nums">{pct(f.trainR2)}</td>
                  <td className={`tabular-nums ${f.testR2 < 0 ? "down" : ""}`}>{pct(f.testR2)}</td>
                  <td className="tabular-nums dim">{r2(f.testR2Simple)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-fs-9 dim mt-1">
            Rata-rata R² uji {pct(o.cv.meanTest)} ± {pct(o.cv.sdTest)}
            {o.cv.meanTestSimple != null ? ` · model sederhana ${pct(o.cv.meanTestSimple)}` : ""}. Tiap lipatan dilatih hanya dengan data sebelum periodenya, jadi masa depan tidak bocor ke data latih.
          </div>
        </div>

        <div className="xl:col-span-2 overflow-x-auto">
          <div className="text-fs-10 font-bold mb-1">Kompleksitas: model penuh vs sederhana</div>
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Model</th>
                <th>Faktor</th>
                <th title="Jumlah parameter, termasuk konstanta">k</th>
                <th>R² adj</th>
                <th title="Akaike: makin kecil makin baik">AIC</th>
                <th title="Bayesian (Schwarz): menghukum variabel lebih keras; makin kecil makin baik">BIC</th>
                <th>R² uji</th>
                <th>R² CV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, m]) => {
                const chosen = (name === "Penuh" ? "full" : "simple") === c.preferred;
                return (
                  <tr key={name} className={chosen ? "bg-[#14301f]" : ""}>
                    <td className={chosen ? "up font-bold" : ""}>
                      {chosen ? "✓ " : ""}
                      {name}
                    </td>
                    <td className="!whitespace-normal !text-left min-w-[180px]">{m.keys.map(labelOf).join(", ")}</td>
                    <td className="tabular-nums">{m.k}</td>
                    <td className="tabular-nums">{pct(m.adjR2)}</td>
                    <td className="tabular-nums dim">{m.aic.toFixed(1)}</td>
                    <td className="tabular-nums">{m.bic.toFixed(1)}</td>
                    <td className="tabular-nums">{r2(m.testR2)}</td>
                    <td className="tabular-nums">{r2(m.cvR2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-fs-9 dim mt-1 leading-relaxed">
            {c.simple
              ? c.preferred === "simple"
                ? "Model sederhana dipilih: BIC lebih kecil dan R² validasi silang tidak lebih buruk — faktor tambahan tidak menambah daya jelas di luar sampel."
                : "Model penuh dipertahankan: faktor tambahan masih menambah daya jelas (BIC atau R² validasi silang lebih baik)."
              : "Semua faktor signifikan di data latih: tidak ada model yang lebih sederhana untuk dibandingkan."}{" "}
            Faktor model sederhana dipilih dari data latih saja, bukan seluruh data.
          </div>
        </div>
      </div>
    </Section>
  );
}

/** Plain OLS against the transformations, on the same walk-forward blocks, judged on the raw returns. */
function TransformsSection({ t, factors }: { t: Transforms; factors: FactorRow[] }) {
  const plain = t.rows[0];
  const best = t.rows.find((r) => r.key === t.best) ?? plain;
  const top = t.rows.filter((r) => Number.isFinite(r.cvR2)).sort((a, b) => b.cvR2 - a.cvR2)[0];
  return (
    <Section title="Transformasi data" note="OLS vs winsorize, robust, WLS · uji walk-forward yang sama" className="xl:col-span-12">
      <div className={`font-bold ${t.better ? "up" : "dim"}`}>
        {t.better
          ? `${best.label} lebih baik secara konsisten: R² luar sampel ${pct(best.cvR2)} vs ${pct(plain.cvR2)} OLS, menang di ${best.wins} dari ${best.folds} lipatan.`
          : "Tidak ada transformasi yang nyata lebih baik dari OLS biasa untuk pair ini."}
      </div>
      <div className="text-fs-10 dim leading-relaxed mt-1">
        {t.better
          ? "Hari-hari ekstrem atau masa bergejolak menarik beta OLS menjauh; beta dari metode ini lebih mewakili hari biasa. Untuk risiko di hari ekstrem, beta OLS tetap relevan."
          : top && top.key !== "ols"
            ? `${top.label} paling tinggi (${pct(top.cvR2)} vs ${pct(plain.cvR2)}), tapi selisihnya di bawah 1 poin atau tidak menang di sebagian besar lipatan: bedanya bisa kebetulan. Beta OLS di atas sudah cukup.`
            : "OLS biasa paling baik di data uji: transformasi tidak menambah apa-apa di sini. Beta di atas sudah cukup."}
      </div>
      <div className="overflow-x-auto mt-2">
        <table className="data-table w-full text-fs-10">
          <thead>
            <tr>
              <th>Metode</th>
              <th title="Rata-rata R² di blok uji walk-forward, diukur pada return asli">R² luar sampel</th>
              <th title="Berapa lipatan metode ini lebih baik dari OLS biasa">Menang vs OLS</th>
              {factors.map((f) => (
                <th key={f.key} title={`Beta ${f.label} (seluruh data)`}>
                  β {f.label.replace(/\s*\(.*\)$/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.key} className={r.key === t.best ? "bg-[#14301f]" : ""} title={r.note}>
                <td className={`whitespace-nowrap ${r.key === t.best ? "up font-bold" : ""}`}>{r.label}</td>
                <td className={`tabular-nums ${r.cvR2 < 0 ? "down" : ""}`}>{Number.isFinite(r.cvR2) ? pct(r.cvR2) : "—"}</td>
                <td className="tabular-nums dim">{r.key === "ols" ? "—" : `${r.wins}/${r.folds}`}</td>
                {factors.map((f) => (
                  <td key={f.key} className="tabular-nums">
                    {Number.isFinite(r.betas[f.key]) ? signed(r.betas[f.key], f.unit === "bp" ? 3 : 2, "") : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-fs-9 dim mt-1 leading-relaxed">
        {t.rows.slice(1).map((r) => (
          <div key={r.key}>
            <b className="text-[var(--text)]">{r.label}</b>: {r.note}
          </div>
        ))}
        <div className="mt-1">
          Semua metode dilatih di data sebelum tiap blok dan dinilai pada return asli di blok itu, jadi transformasi yang hanya mempercantik angka di data latih tidak menang. Dinyatakan lebih baik hanya bila R² luar sampelnya ≥ 1 poin di atas OLS dan menang di sebagian besar lipatan.
        </div>
      </div>
    </Section>
  );
}

const tick = { fill: "#808080", fontSize: fontPx(9) };
const tip = { background: "#111", border: "1px solid #333", fontSize: fontPx(10) };

/** Each factor's beta over a moving window, one factor at a time, with the window's R². */
function RollingSection({ r, factors, period }: { r: RollingBetas; factors: FactorRow[]; period: string }) {
  const strongest = [...factors].sort((a, b) => Math.abs(b.stdBeta) - Math.abs(a.stdBeta))[0]?.key ?? factors[0]?.key;
  const [key, setKey] = useState<string>(strongest);
  const f = factors.find((x) => x.key === key) ?? factors[0];
  if (!f) return null;
  const b = r.betas[f.key] ?? [];
  const rows = r.dates.map((d, i) => ({ date: d, beta: b[i], r2: r.r2[i] * 100 }));
  const first = b[0];
  const last = b[b.length - 1];
  const lo = Math.min(...b);
  const hi = Math.max(...b);
  const flips = b.some((v) => v > 0) && b.some((v) => v < 0);
  const dp = f.unit === "bp" ? 3 : 2;
  return (
    <Section title="Beta bergulir" note={`jendela ${r.window} ${period}${r.step > 1 ? `, tiap ${r.step} ${period}` : ""}`} className="xl:col-span-12">
      <div className="flex flex-wrap gap-1 mb-2">
        {factors.map((x) => (
          <button key={x.key} className={`term-btn ${x.key === f.key ? "active" : ""}`} onClick={() => setKey(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="text-fs-10 leading-relaxed mb-1">
        Beta {f.label}: {signed(first, dp, "")} di awal → {signed(last, dp, "")} sekarang (rentang {signed(lo, dp, "")} sampai {signed(hi, dp, "")})
        {flips ? <span className="amber">, pernah berbalik tanda: hubungannya tidak tetap</span> : null}. Garis putus-putus: R² jendela itu (seberapa besar faktor-faktor menjelaskan gerak pair saat itu).
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e1e1e" vertical={false} />
            <XAxis dataKey="date" tick={tick} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={40} />
            <YAxis yAxisId="b" tick={tick} width={48} tickFormatter={(v: number) => v.toFixed(dp)} />
            <YAxis yAxisId="r" orientation="right" tick={tick} width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine yAxisId="b" y={0} stroke="#404040" />
            <Tooltip
              itemStyle={{ color: "#fff" }}
              labelStyle={{ color: "#fff" }}
              contentStyle={tip}
              labelFormatter={(d: string) => day(d)}
              formatter={(v: number, n: string) => (n === "beta" ? [signed(v, dp, ""), `beta ${f.label}`] : [`${v.toFixed(1)}%`, "R² jendela"])}
            />
            <Line yAxisId="b" type="monotone" dataKey="beta" stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="r2" stroke="#5aa9ff" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-fs-9 dim mt-1 leading-relaxed">
        Tiap titik adalah regresi multifaktor yang sama, hanya pada {r.window} {period} terakhir sampai tanggal itu. Beta yang naik-turun jauh atau R² yang jatuh berarti beta seluruh periode di tabel atas kurang mewakili keadaan sekarang; pakai nilai terbarunya.
      </div>
    </Section>
  );
}
