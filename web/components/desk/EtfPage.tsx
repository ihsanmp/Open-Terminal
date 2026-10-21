"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, LabelList } from "recharts";
import { apiGet } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { usePoll } from "../../lib/refresh";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import { Failed, Loading, Pct, Section, signed } from "./ui";

// ETF: sector rotation, ETF breadth and where the money goes. The main US ETFs by theme with their
// moves and relative volume, the rotation map of the sectors against the S&P 500, S&P 500 breadth
// sector by sector, and the spot crypto ETFs' daily flows (server/src/providers/etfboard.ts).

type Etf = { symbol: string; tv: string; label: string; group: string; price: number | null; day: number | null; week: number | null; month: number | null; month3: number | null; ytd: number | null; relVolume: number | null; rel1m: number | null; rel3m: number | null; rotation: string | null };
type Breadth = { members: number; above50: number; above200: number; advancing: number; declining: number; nearHigh: number; nearLow: number; sectors: Array<{ sector: string; members: number; above50: number; above200: number; advancing: number }>; equalVsCap1m: number | null; read: string };
type Flows = Array<{ coin: string; days: Array<{ date: string; total: number; byFund: Record<string, number> }>; week: number | null; month: number | null; streak: { direction: "in" | "out"; days: number } | null }>;

const GROUPS: Array<[string, string]> = [
  ["sectors", "Sektor"],
  ["style", "Indeks & faktor"],
  ["bonds", "Obligasi"],
  ["commodities", "Komoditas"],
  ["global", "Internasional"],
  ["crypto", "Kripto"],
];
const ROT: Record<string, { label: string; color: string }> = {
  leading: { label: "Memimpin", color: "#36c26b" },
  weakening: { label: "Melemah", color: "#f0c040" },
  lagging: { label: "Tertinggal", color: "#ff5d5d" },
  improving: { label: "Membaik", color: "#5d9dff" },
};
const tick = { fill: "#808080", fontSize: fontPx(9) };
const tip = { background: "#111", border: "1px solid #333", fontSize: fontPx(10) };

export default function EtfPage() {
  const poll = usePoll(60_000);
  const [group, setGroup] = useWidgetSetting<string>("etfGroup", "sectors");
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setView = useTerminal((s) => s.setView);
  const board = useQuery({ queryKey: ["desk-etf"], queryFn: () => apiGet<Etf[]>("/api/desk/etf"), refetchInterval: poll });
  const breadth = useQuery({ queryKey: ["desk-breadth"], queryFn: () => apiGet<Breadth>("/api/desk/breadth"), refetchInterval: poll });
  const flows = useQuery({ queryKey: ["desk-crypto-flows"], queryFn: () => apiGet<Flows>("/api/desk/crypto-etf-flows"), refetchInterval: 30 * 60_000 });

  const rows = (board.data ?? []).filter((e) => e.group === group);
  const sectors = (board.data ?? []).filter((e) => e.group === "sectors" && e.rel3m != null && e.rel1m != null);
  const map = sectors.map((e) => ({ x: e.rel3m!, y: e.rel1m! - e.rel3m! / 3, name: e.symbol, label: e.label, rot: e.rotation ?? "" }));

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <Section
        title="Papan ETF"
        note="RelVol = volume hari ini ÷ rata-rata 10 hari (>1,5: uang masuk/keluar deras)"
        className="xl:col-span-12"
        right={
          <div className="flex gap-1 flex-wrap">
            {GROUPS.map(([id, label]) => (
              <button key={id} className={`term-btn ${group === id ? "active" : ""}`} onClick={() => setGroup(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {board.isLoading ? (
          <Loading what="papan ETF" />
        ) : board.error ? (
          <Failed error={board.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-fs-10">
              <thead>
                <tr>
                  <th>ETF</th>
                  <th>Harga</th>
                  <th>Hari</th>
                  <th>Minggu</th>
                  <th>Bulan</th>
                  <th>3 bln</th>
                  <th>YTD</th>
                  <th>RelVol</th>
                  <th title="Kinerja 1 bulan dikurangi SPY">vs SPY 1b</th>
                  <th title="Kinerja 3 bulan dikurangi SPY">vs SPY 3b</th>
                  <th>Rotasi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.symbol}
                    className="cursor-pointer hover:bg-[#121212]"
                    title="Buka di chart"
                    onClick={() => {
                      setActiveSymbol(e.symbol);
                      setView("chart");
                    }}
                  >
                    <td className="whitespace-nowrap">
                      <b>{e.symbol}</b> <span className="dim">{e.label}</span>
                    </td>
                    <td className="tabular-nums">{e.price?.toFixed(2) ?? "—"}</td>
                    <td>
                      <Pct v={e.day} />
                    </td>
                    <td>
                      <Pct v={e.week} digits={1} />
                    </td>
                    <td>
                      <Pct v={e.month} digits={1} />
                    </td>
                    <td>
                      <Pct v={e.month3} digits={1} />
                    </td>
                    <td>
                      <Pct v={e.ytd} digits={1} />
                    </td>
                    <td className={`tabular-nums ${(e.relVolume ?? 0) >= 1.5 ? "amber font-bold" : "dim"}`}>{e.relVolume?.toFixed(2) ?? "—"}</td>
                    <td>
                      <Pct v={e.rel1m} digits={1} unit=" pp" />
                    </td>
                    <td>
                      <Pct v={e.rel3m} digits={1} unit=" pp" />
                    </td>
                    <td style={{ color: e.rotation ? ROT[e.rotation].color : undefined }}>{e.rotation ? ROT[e.rotation].label : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Peta rotasi sektor" note="x: unggul 3 bln vs SPY · y: percepatan bulan ini" className="xl:col-span-4">
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1a1a1a" />
              <XAxis type="number" dataKey="x" tick={tick} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
              <YAxis type="number" dataKey="y" tick={tick} width={30} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
              <ZAxis range={[60, 60]} />
              <ReferenceLine x={0} stroke="#444" />
              <ReferenceLine y={0} stroke="#444" />
              <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [`${v.toFixed(2)} pp`, n === "x" ? "vs SPY 3 bln" : "percepatan"]} labelFormatter={() => ""} />
              <Scatter data={map} isAnimationActive={false}>
                {map.map((d) => (
                  <Cell key={d.name} fill={ROT[d.rot]?.color ?? "#888"} />
                ))}
                <LabelList dataKey="name" position="top" style={{ fill: "#bbb", fontSize: fontPx(9) }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 gap-x-2 text-fs-9 mt-1">
          <span style={{ color: ROT.improving.color }}>↖ Membaik</span>
          <span className="text-right" style={{ color: ROT.leading.color }}>
            Memimpin ↗
          </span>
          <span style={{ color: ROT.lagging.color }}>↙ Tertinggal</span>
          <span className="text-right" style={{ color: ROT.weakening.color }}>
            Melemah ↘
          </span>
        </div>
      </Section>

      <Section title="Breadth S&P 500" note={breadth.data ? `${breadth.data.members} saham anggota` : ""} className="xl:col-span-8">
        {breadth.isLoading ? (
          <Loading what="breadth" />
        ) : breadth.error || !breadth.data ? (
          <Failed error={breadth.error} />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-2">
              <Gauge label="> MA 50 hari" pct={breadth.data.above50} />
              <Gauge label="> MA 200 hari" pct={breadth.data.above200} />
              <Gauge label="Naik hari ini" pct={(breadth.data.advancing / Math.max(1, breadth.data.advancing + breadth.data.declining)) * 100} sub={`${breadth.data.advancing} naik / ${breadth.data.declining} turun`} />
              <div>
                <div className="text-fs-9 dim">Dekat puncak / dasar 52 mg</div>
                <div className="font-bold">
                  <span className="up">{breadth.data.nearHigh}</span> / <span className="down">{breadth.data.nearLow}</span>
                </div>
              </div>
              <div>
                <div className="text-fs-9 dim">Bobot setara vs cap (1 bln)</div>
                <div className="font-bold">
                  <Pct v={breadth.data.equalVsCap1m} digits={1} unit=" pp" />
                </div>
              </div>
            </div>
            <div className="mb-2 leading-relaxed">{breadth.data.read}</div>
            <table className="data-table w-full text-fs-10">
              <thead>
                <tr>
                  <th>Sektor</th>
                  <th>Saham</th>
                  <th>&gt; MA 50</th>
                  <th>&gt; MA 200</th>
                  <th>Naik hari ini</th>
                </tr>
              </thead>
              <tbody>
                {breadth.data.sectors.map((s) => (
                  <tr key={s.sector}>
                    <td>{s.sector}</td>
                    <td className="dim tabular-nums">{s.members}</td>
                    <PctCell v={s.above50} />
                    <PctCell v={s.above200} />
                    <PctCell v={s.advancing} />
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title="Arus ETF kripto spot AS" note="juta US$ per hari (Farside)" className="xl:col-span-12">
        {flows.isLoading ? (
          <Loading what="arus ETF kripto" />
        ) : flows.error || !flows.data ? (
          <Failed error={flows.error} />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {flows.data.map((f) => {
              const days = f.days.slice(-20).map((d) => ({ x: d.date.slice(5), y: d.total }));
              return (
                <div key={f.coin}>
                  <div className="flex gap-3 items-baseline">
                    <b>{f.coin}</b>
                    <span className="dim text-fs-10">
                      5 hari: <Pct v={f.week} digits={0} unit=" jt" /> · 21 hari: <Pct v={f.month} digits={0} unit=" jt" />
                    </span>
                    {f.streak && (
                      <span className={`ml-auto text-fs-10 ${f.streak.direction === "in" ? "up" : "down"}`}>
                        {f.streak.days} hari {f.streak.direction === "in" ? "masuk" : "keluar"} beruntun
                      </span>
                    )}
                  </div>
                  <div style={{ height: 70 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={days} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                        <XAxis dataKey="x" hide />
                        <YAxis hide />
                        <ReferenceLine y={0} stroke="#333" />
                        <Tooltip contentStyle={tip} formatter={(v: number) => [`${signed(v, 1, "")} jt US$`, "arus bersih"]} />
                        <Bar dataKey="y" isAnimationActive={false}>
                          {days.map((d) => (
                            <Cell key={d.x} fill={d.y >= 0 ? "#36c26b" : "#ff5d5d"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function Gauge({ label, pct, sub }: { label: string; pct: number; sub?: string }) {
  const color = pct >= 60 ? "var(--up)" : pct <= 40 ? "var(--down)" : "var(--amber)";
  return (
    <div>
      <div className="text-fs-9 dim">{label}</div>
      <div className="font-bold tabular-nums" style={{ color }}>
        {pct.toFixed(0)}%
      </div>
      <div className="h-1.5 bg-[#1a1a1a] rounded-sm">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      {sub && <div className="text-fs-9 dim">{sub}</div>}
    </div>
  );
}

function PctCell({ v }: { v: number }) {
  return (
    <td className="tabular-nums" style={{ color: v >= 60 ? "var(--up)" : v <= 40 ? "var(--down)" : "var(--amber)" }}>
      {v.toFixed(0)}%
    </td>
  );
}
