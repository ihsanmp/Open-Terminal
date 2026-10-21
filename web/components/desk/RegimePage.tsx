"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { usePairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import { Failed, Loading, Pct, ScoreBar, Section, signed } from "./ui";

// Macro Regime: the quadrant growth and inflation make now, how it was read, the last three
// years of it, and what every asset has actually done in each quadrant since 2002 (next-month
// returns), beside the textbook bias; the shortlist where the regime and the trend agree; the
// risk overlay. Server: server/src/providers/regime.ts.

type Quadrant = "goldilocks" | "reflation" | "stagflation" | "deflation";
type Stat = { n: number; mean: number; hit: number; t: number } | null;
type Reading = { month: string; growth: number; inflation: number; quadrant: Quadrant; parts: { indproMomentum: number; copperGold3m: number; cpiMomentum: number; oil3m: number } };
type Regime = {
  current: Reading;
  previous: Reading | null;
  streak: number;
  history: Reading[];
  frequency: Record<Quadrant, { months: number; share: number; avgRun: number }>;
  assets: Array<{ key: string; label: string; price: number | null; aboveSma10: boolean | null; change1m: number | null; change3m: number | null; byRegime: Record<Quadrant, Stat>; all: Stat; textbook: -1 | 0 | 1; measured: "positive" | "negative" | "none" }>;
  shortlist: { long: Array<{ key: string; label: string; why: string }>; avoid: Array<{ key: string; label: string; why: string }> };
  risk: { label: string; notes: string[]; vix: number | null; hySpread: number | null; curve2s10s: number | null };
  sinceMonth: string;
  caveat: string;
};

const Q: Record<Quadrant, { label: string; color: string; sub: string; note: string }> = {
  goldilocks: { label: "Goldilocks", color: "#36c26b", sub: "pertumbuhan ↑ · inflasi ↓", note: "Ramah bagi saham (teknologi, siklikal) dan aset berisiko." },
  reflation: { label: "Reflasi", color: "#f0a030", sub: "pertumbuhan ↑ · inflasi ↑", note: "Komoditas, energi, keuangan, small cap lazim unggul; obligasi tertekan." },
  stagflation: { label: "Stagflasi", color: "#ff5d5d", sub: "pertumbuhan ↓ · inflasi ↑", note: "Emas, komoditas, defensif bertahan; saham dan obligasi tertekan." },
  deflation: { label: "Deflasi / perlambatan", color: "#5d9dff", sub: "pertumbuhan ↓ · inflasi ↓", note: "Obligasi pemerintah, dolar, defensif lazim unggul." },
};
const ORDER: Quadrant[] = ["reflation", "goldilocks", "stagflation", "deflation"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function cellColor(s: Stat): string {
  if (!s) return "transparent";
  const a = Math.min(1, Math.abs(s.mean) / 2.5) * 0.55;
  return s.mean >= 0 ? `rgba(0,200,83,${a})` : `rgba(255,61,61,${a})`;
}

export default function RegimePage() {
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-regime"], queryFn: () => apiGet<Regime>("/api/desk/regime"), refetchInterval: 15 * 60_000 });
  const { symbol, ctx } = usePairContext();
  if (isLoading) return <Loading what="regime makro (±25 tahun data bulanan)" />;
  if (error || !data) return <Failed error={error} />;
  const cur = data.current;
  const q = Q[cur.quadrant];
  const mine = ctx?.regimeKey ? data.assets.find((a) => a.key === ctx.regimeKey) ?? null : null;
  const mineStat = mine?.byRegime[cur.quadrant] ?? null;
  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <div className="xl:col-span-12">
        <PairBanner symbol={symbol} ctx={ctx}>
          {mine ? (
            <>
              dibaca lewat baris <b className="text-[var(--text)]">{mine.label}</b>
              {ctx?.regimeProxy ? " (padanan terdekat)" : ""}: di {q.label} rata-rata{" "}
              <b className={(mineStat?.mean ?? 0) >= 0 ? "up" : "down"}>{mineStat ? signed(mineStat.mean, 2) : "—"}</b>/bln
              {mineStat ? `, naik ${mineStat.hit.toFixed(0)}% dari ${mineStat.n} bln` : ""} (biasanya {mine.all ? signed(mine.all.mean, 2) : "—"}) · teori {mine.textbook > 0 ? "mendukung" : mine.textbook < 0 ? "menekan" : "netral"} ·{" "}
              {mine.measured === "positive" ? "terukur unggul" : mine.measured === "negative" ? "terukur tertinggal" : "perbedaannya tidak nyata"} · tren 10 bln {mine.aboveSma10 == null ? "—" : mine.aboveSma10 ? "naik" : "turun"}
            </>
          ) : ctx ? (
            "pair ini tidak punya padanan di tabel regime"
          ) : null}
        </PairBanner>
      </div>
      <Section title="Regime sekarang" note={`bulan ${monthLabel(cur.month)} (bulan berjalan: bisa berubah sampai akhir bulan)`} className="xl:col-span-5">
        <div className="text-fs-20 font-bold" style={{ color: q.color }}>
          {q.label}
        </div>
        <div className="dim mb-2">
          {q.sub} · {data.streak} bulan berturut{data.previous && data.previous.quadrant !== cur.quadrant ? `, sebelumnya ${Q[data.previous.quadrant].label}` : ""}
        </div>
        <div className="mb-3 leading-relaxed">{q.note}</div>
        <div className="grid gap-2">
          <ScoreBar value={cur.growth} label="Momentum pertumbuhan" />
          <div className="text-fs-10 dim pl-1">
            Produksi industri AS (YoY) {signed(cur.parts.indproMomentum, 2, " pp")} vs 3 bln sebelumnya · rasio tembaga/emas {signed(cur.parts.copperGold3m * 100, 1)} dalam 3 bln
          </div>
          <ScoreBar value={cur.inflation} label="Momentum inflasi" />
          <div className="text-fs-10 dim pl-1">
            CPI AS (YoY) {signed(cur.parts.cpiMomentum, 2, " pp")} vs 3 bln sebelumnya · minyak {signed(cur.parts.oil3m * 100, 1)} dalam 3 bln
          </div>
        </div>
      </Section>

      <Section title="Peta kuadran" note={`sejak ${monthLabel(data.sinceMonth)}: seberapa sering & berapa lama`} className="xl:col-span-4">
        <div className="grid grid-cols-2 gap-1.5">
          {ORDER.map((k) => {
            const f = data.frequency[k];
            const on = k === cur.quadrant;
            return (
              <div key={k} className="rounded-sm p-2 border" style={{ borderColor: on ? Q[k].color : "#262626", background: on ? `${Q[k].color}1f` : "transparent" }}>
                <div className="font-bold" style={{ color: Q[k].color }}>
                  {Q[k].label}
                </div>
                <div className="text-fs-9 dim">{Q[k].sub}</div>
                <div className="text-fs-10 mt-1">
                  {f.share.toFixed(0)}% bulan · rata-rata {f.avgRun.toFixed(1)} bln/periode
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-fs-9 dim mt-2">Atas: pertumbuhan naik · bawah: turun · kiri: inflasi naik · kanan: turun.</div>
      </Section>

      <Section title="Overlay risiko" note="stres pasar sekarang" className="xl:col-span-3">
        <div className={`text-fs-15 font-bold uppercase ${data.risk.label === "risk-on" ? "up" : data.risk.label === "risk-off" ? "down" : "amber"}`}>{data.risk.label}</div>
        <ul className="list-disc pl-4 mt-1 text-fs-10 grid gap-1">
          {data.risk.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Section title="Riwayat 36 bulan" className="xl:col-span-12">
        <div className="flex gap-px">
          {data.history.map((h) => (
            <div key={h.month} className="flex-1 min-w-0 group relative" title={`${monthLabel(h.month)}: ${Q[h.quadrant].label} (pertumbuhan ${h.growth.toFixed(2)}, inflasi ${h.inflation.toFixed(2)})`}>
              <div className="h-6 rounded-[1px]" style={{ background: Q[h.quadrant].color, opacity: h.month === cur.month ? 1 : 0.65 }} />
              <div className="text-[9px] dim text-center truncate">{h.month.endsWith("-01") || h.month === cur.month ? monthLabel(h.month) : ""}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-1 text-fs-9">
          {ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-[1px]" style={{ background: Q[k].color }} /> {Q[k].label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Shortlist" note="bias regime + tren sejalan" className="xl:col-span-12">
        {data.shortlist.long.length + data.shortlist.avoid.length === 0 && <div className="dim">Belum ada aset yang bias dan trennya sejalan.</div>}
        <div className="grid gap-x-4 gap-y-2 md:grid-cols-2 2xl:grid-cols-3">
          {data.shortlist.long.map((x) => (
            <div key={x.key}>
              <div className="up font-bold">▲ {x.label}</div>
              <div className="text-fs-10 dim">{x.why}</div>
            </div>
          ))}
          {data.shortlist.avoid.map((x) => (
            <div key={x.key}>
              <div className="down font-bold">▼ {x.label}</div>
              <div className="text-fs-10 dim">{x.why}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Bias aset per regime" note="rata-rata return bulan berikutnya, terukur sejak 2002" className="xl:col-span-12">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Aset</th>
                <th>Tren</th>
                <th title="Sejak penutupan akhir bulan lalu">Bln ini</th>
                <th title="Sejak penutupan akhir bulan, tiga bulan lalu">3 bln</th>
                {ORDER.map((k) => (
                  <th key={k} style={{ color: Q[k].color }}>
                    {Q[k].label.split(" ")[0]}
                  </th>
                ))}
                <th>Semua bln</th>
                <th title="Arah yang lazim menurut teori regime">Teori</th>
                <th title="Rata-rata di regime sekarang beda nyata (t ≥ 2) dari bulan biasa aset itu">Terukur</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <tr key={a.key} className={a.key === mine?.key ? "bg-[#2a2210]" : ""} title={a.key === mine?.key ? `Baris untuk ${symbol}` : undefined}>
                  <td className="whitespace-nowrap">
                    {a.key === mine?.key && <span className="amber">● </span>}
                    {a.label}
                  </td>
                  <td className={a.aboveSma10 == null ? "dim" : a.aboveSma10 ? "up" : "down"}>{a.aboveSma10 == null ? "—" : a.aboveSma10 ? "naik" : "turun"}</td>
                  <td>
                    <Pct v={a.change1m} digits={1} />
                  </td>
                  <td>
                    <Pct v={a.change3m} digits={1} />
                  </td>
                  {ORDER.map((k) => {
                    const s = a.byRegime[k];
                    return (
                      <td
                        key={k}
                        className={`tabular-nums ${k === cur.quadrant ? "outline outline-1 outline-[#555]" : ""}`}
                        style={{ background: cellColor(s) }}
                        title={s ? `${s.n} bulan · naik ${s.hit.toFixed(0)}% · t ${s.t.toFixed(2)}` : "data kurang"}
                      >
                        {s ? signed(s.mean, 2) : "—"}
                      </td>
                    );
                  })}
                  <td className="tabular-nums dim">{a.all ? signed(a.all.mean, 2) : "—"}</td>
                  <td className={a.textbook > 0 ? "up" : a.textbook < 0 ? "down" : "dim"}>{a.textbook > 0 ? "▲" : a.textbook < 0 ? "▼" : "·"}</td>
                  <td className={a.measured === "positive" ? "up" : a.measured === "negative" ? "down" : "dim"}>{a.measured === "positive" ? "unggul" : a.measured === "negative" ? "tertinggal" : "tidak nyata"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-fs-9 dim mt-2 leading-relaxed">
          Kolom regime: rata-rata return bulan setelah sebuah bulan diklasifikasikan ke regime itu (arahkan kursor untuk jumlah bulan, % naik, statistik t). &quot;Terukur&quot; hanya bila rata-ratanya berbeda nyata dari bulan biasa aset itu.
          {" "}
          {data.caveat}
        </div>
      </Section>
    </div>
  );
}
