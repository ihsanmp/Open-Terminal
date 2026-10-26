"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { usePoll } from "../../lib/refresh";
import { useFollowPair, usePairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import { Failed, Loading, Pct, Section, signed, wib } from "./ui";

// Futures: forward pricing. Every market's contract months front to back (server/src/providers/
// curves.ts): the shape of the curve (contango or backwardation), the carry it implies over a year,
// and for the money markets (SOFR, Fed funds) the path of rates the market prices.

type Point = { ticker: string; month: string; label: string; price: number; value: number; changePercent: number | null; volume: number | null };
type Curve = { id: string; label: string; group: string; unit: string; kind: "price" | "rate"; points: Point[]; shape: string | null; spread: number | null; annualCarry: number | null; moves25: number | null; asOf: number };

const GROUPS: Array<[string, string]> = [
  ["rates", "Suku bunga"],
  ["volatility", "Volatilitas"],
  ["index", "Indeks saham"],
  ["energy", "Energi"],
  ["metal", "Logam"],
  ["crypto", "Kripto"],
  ["currency", "Mata uang"],
  ["agri", "Pertanian"],
];

/** A price with the digits it needs: the yen future trades at 0.006345. */
const price = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 6 : Math.abs(v) < 100 ? 4 : 2 });

function readOf(c: Curve): string {
  if (!c.points.length) return "Belum ada harga kontrak.";
  if (c.kind === "rate") {
    const m = c.moves25 ?? 0;
    const first = c.points[0];
    const last = c.points.at(-1)!;
    const dir = m < -0.4 ? `turun ±${Math.abs(m).toFixed(1)} kali 25 bp (pemotongan)` : m > 0.4 ? `naik ±${m.toFixed(1)} kali 25 bp (kenaikan)` : "relatif datar";
    return `Pasar memperhitungkan suku bunga ${first.value.toFixed(2)}% untuk ${first.label} dan ${last.value.toFixed(2)}% untuk ${last.label}: ${dir}. Ini ekspektasi pasar, bukan keputusan bank sentral.`;
  }
  const carry = c.annualCarry != null ? ` (setara ${signed(c.annualCarry, 1)} per tahun)` : "";
  if (c.id === "vx")
    return c.shape === "backwardation"
      ? "VIX backwardation: kontrak dekat lebih mahal dari yang jauh — pasar membayar mahal untuk perlindungan sekarang (stres). Biasanya terjadi saat aksi jual tajam."
      : `VIX contango${carry}: kondisi normal/tenang, volatilitas jangka dekat dianggap lebih rendah dari jangka jauh.`;
  if (c.shape === "backwardation") return `Backwardation${carry}: kontrak dekat lebih mahal — pasokan saat ini ketat atau ada permintaan mendesak. Bagi yang memegang long futures, rolling menguntungkan (positive roll yield).`;
  if (c.shape === "contango") return `Contango${carry}: kontrak jauh lebih mahal — mencerminkan biaya simpan dan bunga, pasokan cukup. Rolling long futures menggerus hasil (negative roll yield).`;
  return "Kurva datar: tidak ada tekanan pasokan atau premi yang menonjol.";
}

export default function FuturesPage() {
  const poll = usePoll(60_000);
  const { symbol, ctx } = usePairContext();
  const [selected, setSelected] = useFollowPair<string>("curve", "sr3", ctx?.curveId, ctx !== null);
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-curves"], queryFn: () => apiGet<Curve[]>("/api/desk/curves"), refetchInterval: poll });
  if (isLoading) return <Loading what="kurva forward futures" />;
  if (error || !data) return <Failed error={error} />;
  const c = data.find((x) => x.id === selected) ?? data[0];
  const chart = c.points.map((p) => ({ x: p.label, y: p.value }));
  const tick = { fill: "#808080", fontSize: fontPx(9) };

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <div className="xl:col-span-12">
        <PairBanner symbol={symbol} ctx={ctx}>
          {ctx?.curveId ? `kurva ${data.find((x) => x.id === ctx.curveId)?.label ?? ctx.curveId} dipilih otomatis (●)` : ctx ? "pair ini tidak punya kurva futures; pilih kurva lain di kiri" : null}
        </PairBanner>
      </div>
      <Section title="Semua kurva" note="klik untuk melihat" className="xl:col-span-6">
        <table className="data-table w-full text-fs-10">
          <thead>
            <tr>
              <th>Pasar</th>
              <th>Depan</th>
              <th>Bentuk</th>
              <th title="Kontrak terakhir vs depan">Spread</th>
              <th title="Price: carry per tahun · Rate: jumlah langkah 25 bp">Carry / langkah</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(([g, label]) => {
              const rows = data.filter((x) => x.group === g);
              if (!rows.length) return null;
              return [
                <tr key={g}>
                  <td colSpan={5} className="!text-[#7f93b8] font-bold uppercase text-fs-9 pt-2">
                    {label}
                  </td>
                </tr>,
                ...rows.map((x) => (
                  <tr key={x.id} onClick={() => setSelected(x.id)} className={`cursor-pointer ${x.id === c.id ? "bg-[#1a1a1a]" : "hover:bg-[#121212]"}`}>
                    <td className={x.id === c.id ? "amber" : ""}>
                      {x.id === ctx?.curveId && <span className="amber">● </span>}
                      {x.label}
                    </td>
                    <td className="tabular-nums">{x.points[0] ? (x.kind === "rate" ? `${x.points[0].value.toFixed(2)}%` : price(x.points[0].price)) : "—"}</td>
                    <td className={x.shape === "backwardation" || x.shape === "hikes" ? "down" : x.shape === "contango" || x.shape === "cuts" ? "up" : "dim"}>
                      {x.shape === "cuts" ? "pemotongan" : x.shape === "hikes" ? "kenaikan" : x.shape === "flat" ? "datar" : x.shape ?? "—"}
                    </td>
                    <td className="tabular-nums">{x.spread == null ? "—" : x.kind === "rate" ? signed(x.spread, 2, " pp") : signed(x.spread, 1)}</td>
                    <td className="tabular-nums">{x.kind === "rate" ? (x.moves25 == null ? "—" : `${x.moves25 > 0 ? "+" : ""}${x.moves25}×`) : signed(x.annualCarry, 1)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </Section>

      <div className="xl:col-span-6 grid gap-2 content-start">
        <Section title={c.label} note={`${c.kind === "rate" ? "suku bunga tersirat (100 − harga)" : c.unit} · ${c.points.length} kontrak`}>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1a1a1a" />
                <XAxis dataKey="x" tick={tick} />
                <YAxis tick={tick} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => (c.kind === "rate" ? `${v.toFixed(2)}%` : price(v))} />
                <Tooltip itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#111", border: "1px solid #333", fontSize: fontPx(10) }} formatter={(v: number) => [c.kind === "rate" ? `${v.toFixed(3)}%` : price(v), c.kind === "rate" ? "suku bunga" : "harga"]} />
                <Line type="monotone" dataKey="y" stroke="#f0a030" strokeWidth={2} dot={{ r: 3, fill: "#f0a030" }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 leading-relaxed">{readOf(c)}</div>
        </Section>
        <Section title="Kontrak" note={`diperbarui ${wib(c.asOf)}`}>
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Bulan</th>
                <th>Kontrak</th>
                <th>Harga</th>
                {c.kind === "rate" && <th>Suku bunga</th>}
                <th>Hari ini</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {c.points.map((p) => (
                <tr key={p.ticker}>
                  <td>{p.label}</td>
                  <td className="dim">{p.ticker.split(":")[1]}</td>
                  <td className="tabular-nums">{price(p.price)}</td>
                  {c.kind === "rate" && <td className="tabular-nums">{p.value.toFixed(3)}%</td>}
                  <td>
                    <Pct v={p.changePercent} />
                  </td>
                  <td className="tabular-nums dim">{p.volume == null ? "—" : p.volume.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
