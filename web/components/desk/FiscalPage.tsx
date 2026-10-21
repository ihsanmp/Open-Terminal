"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { usePairContext, type PairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import { Failed, Loading, Section, signed, Spark, Stat, usd, wib } from "./ui";

/** Why the US budget matters to the pair, in a line. */
function relevance(ctx: PairContext): string {
  if (ctx.kind === "rate") return "relevan langsung: defisit dan pasokan obligasi menentukan yield yang Anda pantau";
  if (ctx.kind === "dollar" || (ctx.kind === "fx" && ctx.currencies.includes("USD"))) return "relevan untuk sisi dolar: tekanan fiskal dan TGA memengaruhi yield dan likuiditas dolar";
  if (ctx.kind === "metal") return "relevan tidak langsung: tekanan fiskal dan yield riil sering jadi alasan permintaan emas/logam";
  if (ctx.kind === "crypto") return "relevan lewat likuiditas: TGA yang naik menyedot likuiditas yang biasanya juga menopang kripto";
  if (ctx.country === "US" && (ctx.kind === "stock" || ctx.kind === "index" || ctx.kind === "etf")) return "relevan lewat yield: pasokan obligasi yang deras menaikkan yield dan menekan valuasi saham";
  return "pengaruhnya tidak langsung, lewat dolar dan yield global";
}

// Fiscal Policy: how much the US government borrows and what it costs — the debt, each month's
// deficit, the interest bill and the average rate paid, and the Treasury's cash at the Fed (the
// TGA: when it fills it drains liquidity from the banks, when it runs down it adds it). From the
// Treasury's Fiscal Data API (server/src/providers/fiscal.ts).

type Point = { date: string; value: number };
type Fiscal = {
  debt: { latest: Point | null; heldByPublic: number | null; intragov: number | null; change30d: number | null; change1y: number | null; series: Point[] };
  budget: { months: Array<{ month: string; receipts: number; outlays: number; deficit: number }>; fytd: { fy: number; deficit: number; months: number } | null; priorSamePeriod: number | null; last12: number | null };
  interest: { months: Point[]; last12: number | null; prior12: number | null };
  avgRate: { latest: Point | null; yearAgo: number | null; series: Point[] };
  tga: { latest: Point | null; change30d: number | null; series: Point[] };
  asOf: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const mLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const tick = { fill: "#808080", fontSize: fontPx(9) };

export default function FiscalPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-fiscal"], queryFn: () => apiGet<Fiscal>("/api/desk/fiscal"), refetchInterval: 60 * 60_000 });
  const { symbol, ctx } = usePairContext();
  if (isLoading) return <Loading what="data fiskal Departemen Keuangan AS" />;
  if (error || !data) return <Failed error={error} />;
  const b = data.budget;
  const receipts12 = b.months.length >= 12 ? b.months.slice(-12).reduce((s, m) => s + m.receipts, 0) : null;
  const interestShare = data.interest.last12 != null && receipts12 ? (data.interest.last12 / receipts12) * 100 : null;
  const interestGrowth = data.interest.last12 != null && data.interest.prior12 ? (data.interest.last12 / data.interest.prior12 - 1) * 100 : null;
  const fytdChange = b.fytd && b.priorSamePeriod ? (b.fytd.deficit / b.priorSamePeriod - 1) * 100 : null;
  const deficitData = b.months.slice(-24).map((m) => ({ x: mLabel(m.month), y: m.deficit / 1e9 }));
  const interestData = data.interest.months.slice(-24).map((p) => ({ x: mLabel(p.date), y: p.value / 1e9 }));

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <div className="xl:col-span-12">
        <PairBanner symbol={symbol} ctx={ctx}>
          {ctx ? relevance(ctx) : null}
        </PairBanner>
      </div>
      <Section title="Utang pemerintah AS" note={data.debt.latest ? `per ${data.debt.latest.date}` : ""} className="xl:col-span-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
          <Stat label="Total utang" value={usd(data.debt.latest?.value ?? null)} />
          <Stat label="Dipegang publik" value={usd(data.debt.heldByPublic)} />
          <Stat label="30 hari" value={usd(data.debt.change30d)} tone="amber" sub="tambahan utang" />
          <Stat label="1 tahun" value={usd(data.debt.change1y)} tone="amber" sub={data.debt.change1y != null ? `≈ ${usd(data.debt.change1y / 365)} per hari` : undefined} />
        </div>
        <Spark data={data.debt.series.map((p) => ({ x: p.date, y: p.value / 1e12 }))} color="#f0a030" height={110} format={(v) => `$${v.toFixed(2)} T`} />
      </Section>

      <Section title="Tekanan bunga" note="bunga atas utang yang dipegang publik" className="xl:col-span-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
          <Stat label="Bunga 12 bln" value={usd(data.interest.last12)} tone="down" sub={interestGrowth != null ? `${signed(interestGrowth, 1)} vs 12 bln sebelumnya` : undefined} />
          <Stat label="Porsi dari penerimaan" value={interestShare != null ? `${interestShare.toFixed(1)}%` : "—"} tone={interestShare != null && interestShare > 15 ? "down" : undefined} sub="bunga ÷ penerimaan pajak" />
          <Stat label="Rata-rata bunga" value={data.avgRate.latest ? `${data.avgRate.latest.value.toFixed(2)}%` : "—"} sub={data.avgRate.yearAgo != null && data.avgRate.latest ? `${signed(data.avgRate.latest.value - data.avgRate.yearAgo, 2, " pp")} setahun` : undefined} />
          <Stat label="Bulan terakhir" value={usd(data.interest.months.at(-1)?.value ?? null)} sub={data.interest.months.at(-1) ? mLabel(data.interest.months.at(-1)!.date) : undefined} />
        </div>
        <div style={{ height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={interestData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1a1a1a" vertical={false} />
              <XAxis dataKey="x" tick={tick} interval={3} />
              <YAxis tick={tick} width={36} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
              <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: fontPx(10) }} formatter={(v: number) => [`$${v.toFixed(1)} miliar`, "bunga"]} />
              <Bar dataKey="y" fill="#ff7a59" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Defisit anggaran" note="Monthly Treasury Statement · miliar $ (merah = defisit, hijau = surplus)" className="xl:col-span-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
          <Stat label={b.fytd ? `Tahun fiskal ${b.fytd.fy} (${b.fytd.months} bln)` : "Tahun fiskal berjalan"} value={usd(b.fytd?.deficit ?? null)} tone="down" sub={fytdChange != null ? `${signed(fytdChange, 1)} vs periode sama tahun lalu` : undefined} />
          <Stat label="12 bulan terakhir" value={usd(b.last12)} tone="down" />
          <Stat label="Bulan terakhir" value={usd(b.months.at(-1)?.deficit ?? null)} sub={b.months.at(-1) ? `${mLabel(b.months.at(-1)!.month)} · penerimaan ${usd(b.months.at(-1)!.receipts)}, belanja ${usd(b.months.at(-1)!.outlays)}` : undefined} />
        </div>
        <div style={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={deficitData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1a1a1a" vertical={false} />
              <XAxis dataKey="x" tick={tick} interval={2} />
              <YAxis tick={tick} width={40} />
              <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: fontPx(10) }} formatter={(v: number) => [`$${v.toFixed(1)} miliar`, v >= 0 ? "defisit" : "surplus"]} />
              <Bar dataKey="y" isAnimationActive={false}>
                {deficitData.map((d) => (
                  <Cell key={d.x} fill={d.y >= 0 ? "#ff5d5d" : "#36c26b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-fs-9 dim mt-1">April dan bulan pembayaran pajak kuartalan biasanya surplus; bandingkan dengan bulan yang sama tahun lalu, bukan dengan bulan sebelumnya.</div>
      </Section>

      <Section title="Kas Treasury di The Fed (TGA)" note="likuiditas" className="xl:col-span-4">
        <div className="grid grid-cols-2 gap-3 mb-2">
          <Stat label="Saldo" value={usd(data.tga.latest?.value ?? null)} sub={data.tga.latest?.date} />
          <Stat label="30 hari" value={usd(data.tga.change30d)} tone={data.tga.change30d == null ? undefined : data.tga.change30d > 0 ? "down" : "up"} sub={data.tga.change30d == null ? undefined : data.tga.change30d > 0 ? "naik: menyedot likuiditas" : "turun: menambah likuiditas"} />
        </div>
        <Spark data={data.tga.series.map((p) => ({ x: p.date, y: p.value / 1e9 }))} color="#5d9dff" height={110} format={(v) => `$${v.toFixed(0)} miliar`} />
      </Section>

      <Section title="Cara membaca" className="xl:col-span-12">
        <ul className="list-disc pl-4 grid gap-1 text-fs-10 leading-relaxed">
          <li>Defisit besar dibiayai dengan menerbitkan obligasi: pasokan obligasi yang deras cenderung menekan harga obligasi (yield naik), terutama tenor panjang — lihat juga lelang di US Bonds.</li>
          <li>Porsi bunga terhadap penerimaan yang terus naik adalah ukuran &quot;tekanan fiskal&quot;: makin besar, makin sempit ruang anggaran dan makin sensitif pasar terhadap berita fiskal (shutdown, plafon utang).</li>
          <li>TGA yang naik tajam (mis. setelah plafon utang dinaikkan) menarik cadangan dari perbankan — likuiditas mengetat, sering berat bagi aset berisiko; TGA yang turun sebaliknya.</li>
        </ul>
        <div className="text-fs-9 dim mt-2">Sumber: api.fiscaldata.treasury.gov · diperbarui {wib(data.asOf)}</div>
      </Section>
    </div>
  );
}
