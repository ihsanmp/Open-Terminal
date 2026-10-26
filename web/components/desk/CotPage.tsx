"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { useFollowPair, usePairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import { Failed, Loading, Section } from "./ui";

// Market Participant · Positioning: the CFTC's Commitments of Traders for 25 futures markets —
// the speculators (leveraged funds / managed money), the other large holders and the hedgers, net
// long or short, the week's change, and the COT index (0 … 100 within three years) that flags a
// crowded side. Server: server/src/providers/cot.ts.

type Week = { date: string; openInterest: number; spec: number; other: number; hedgers: number };
type Series = {
  id: string;
  label: string;
  group: string;
  report: "tff" | "dis";
  names: { spec: string; other: string; hedgers: string };
  weeks: Week[];
  latest: Week | null;
  specChange: number | null;
  specPctOi: number | null;
  cotIndex: number | null;
  crowding: "crowded-long" | "crowded-short" | null;
};

const k = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}rb` : v.toFixed(0)}`);
const tick = { fill: "#808080", fontSize: fontPx(9) };

function IndexBar({ v }: { v: number | null }) {
  if (v == null) return <span className="dim">—</span>;
  const color = v >= 85 ? "var(--up)" : v <= 15 ? "var(--down)" : "#7f93b8";
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-16 h-1.5 bg-[#1a1a1a] rounded-sm">
        <div className="absolute top-[-2px] w-1 h-2.5 rounded-sm" style={{ left: `calc(${v}% - 2px)`, background: color }} />
      </div>
      <span className="tabular-nums" style={{ color }}>
        {v}
      </span>
    </div>
  );
}

export default function CotPage() {
  const { symbol, ctx } = usePairContext();
  const [selected, setSelected] = useFollowPair<string>("cotMarket", "gc", ctx?.cotId, ctx !== null);
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-cot"], queryFn: () => apiGet<Series[]>("/api/desk/cot"), refetchInterval: 3_600_000 });
  if (isLoading) return <Loading what="laporan Commitments of Traders (CFTC)" />;
  if (error || !data) return <Failed error={error} />;
  const s = data.find((x) => x.id === selected) ?? data[0];
  const groups = [...new Set(data.map((x) => x.group))];
  const chart = s.weeks.map((w) => ({ x: w.date, spec: w.spec, other: w.other, hedgers: w.hedgers }));
  const date = data.find((x) => x.latest)?.latest?.date;

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <div className="xl:col-span-12">
        <PairBanner symbol={symbol} ctx={ctx}>
          {ctx?.cotId ? `pasar ${data.find((x) => x.id === ctx.cotId)?.label ?? ctx.cotId} dipilih otomatis (●)` : ctx ? "pair ini tidak dilaporkan CFTC; pilih pasar lain" : null}
        </PairBanner>
      </div>
      <Section title="Posisi bersih per pasar" note={date ? `posisi per Selasa ${date} (terbit Jumat)` : ""} className="xl:col-span-7">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Pasar</th>
                <th title="Leveraged funds (keuangan) / managed money (komoditas)">Spekulan bersih</th>
                <th>Δ minggu</th>
                <th>% OI</th>
                <th title="Posisi spekulan dalam rentang 3 tahun: 100 = paling long, 0 = paling short">COT index</th>
                <th>Kelompok lain</th>
                <th>Hedger</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={g}>
                  <td colSpan={7} className="!text-[#7f93b8] font-bold uppercase text-fs-9 pt-2">
                    {g}
                  </td>
                </tr>,
                ...data
                  .filter((x) => x.group === g)
                  .map((x) => (
                    <tr key={x.id} onClick={() => setSelected(x.id)} className={`cursor-pointer ${x.id === s.id ? "bg-[#1a1a1a]" : "hover:bg-[#121212]"}`}>
                      <td className={x.id === s.id ? "amber" : ""}>
                        {x.id === ctx?.cotId && <span className="amber">● </span>}
                        {x.label}
                        {x.crowding && <span className={`ml-1 text-fs-9 ${x.crowding === "crowded-long" ? "up" : "down"}`}>{x.crowding === "crowded-long" ? "● long penuh" : "● short penuh"}</span>}
                      </td>
                      <td className={`tabular-nums ${(x.latest?.spec ?? 0) >= 0 ? "up" : "down"}`}>{k(x.latest?.spec)}</td>
                      <td className={`tabular-nums ${(x.specChange ?? 0) >= 0 ? "up" : "down"}`}>{k(x.specChange)}</td>
                      <td className="tabular-nums dim">{x.specPctOi == null ? "—" : `${x.specPctOi.toFixed(1)}%`}</td>
                      <td>
                        <IndexBar v={x.cotIndex} />
                      </td>
                      <td className="tabular-nums dim">{k(x.latest?.other)}</td>
                      <td className="tabular-nums dim">{k(x.latest?.hedgers)}</td>
                    </tr>
                  )),
              ])}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="xl:col-span-5 grid gap-2 content-start">
        <Section title={s.label} note="posisi bersih 3 tahun (kontrak)">
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1a1a1a" />
                <XAxis dataKey="x" tick={tick} minTickGap={40} tickFormatter={(v: string) => v.slice(0, 7)} />
                <YAxis tick={tick} width={50} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}rb` : String(v))} />
                <ReferenceLine y={0} stroke="#444" />
                <Tooltip itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} contentStyle={{ background: "#111", border: "1px solid #333", fontSize: fontPx(10) }} formatter={(v: number, n: string) => [v.toLocaleString("en-US"), n]} />
                <Legend wrapperStyle={{ fontSize: fontPx(9) }} />
                <Line dataKey="spec" name={s.names.spec} stroke="#f0a030" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="other" name={s.names.other} stroke="#5d9dff" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line dataKey="hedgers" name={s.names.hedgers} stroke="#888" strokeWidth={1} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Cara membaca">
          <ul className="list-disc pl-4 grid gap-1 text-fs-10 leading-relaxed">
            <li>
              <b>{s.names.spec}</b> adalah uang cepat yang mengikuti tren. Saat posisinya di ujung rentang 3 tahun (COT index ≥ 85 atau ≤ 15), sisi itu sudah ramai: sedikit pembeli/penjual baru tersisa, dan pembalikan bisa tajam bila mereka keluar bersamaan.
            </li>
            <li>
              <b>{s.names.hedgers}</b> berposisi untuk melindungi bisnis atau inventaris, biasanya berlawanan dengan harga. Mereka bukan sinyal arah jangka pendek.
            </li>
            <li>Crowding adalah peringatan risiko, bukan sinyal timing: posisi bisa tetap ekstrem berminggu-minggu selama tren berjalan. Pakai bersama tren harga dan katalis.</li>
            <li>Data per Selasa, terbit Jumat sore waktu AS: selalu tertinggal 3 hari.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
