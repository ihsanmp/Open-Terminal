"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useTerminal, type View } from "../../store/terminal";
import { ago, Failed, Loading, Pct, ScoreBar, Section, wib } from "./ui";

// Macro Command Center's first page: the big picture before a trade idea. The macro regime and
// the risk overlay, the key markets, the regime's shortlist, the high-impact releases of the next
// days, S&P 500 breadth, what the futures curves price, the crowded trades, the loudest
// geopolitical themes and Watcher Guru's latest lines — each a door to its own tool.

type Dashboard = {
  markets: Array<{ label: string; symbol: string; digits: number; price: number | null; day: number | null; week: number | null; month: number | null }>;
  regime: {
    quadrant: string;
    label: string;
    note: string;
    growth: number;
    inflation: number;
    streak: number;
    previous: string | null;
    risk: { label: string; notes: string[] };
    long: Array<{ key: string; label: string; why: string }>;
    avoid: Array<{ key: string; label: string; why: string }>;
  } | null;
  breadth: { above50: number; above200: number; advancing: number; declining: number; nearHigh: number; nearLow: number; read: string } | null;
  events: Array<{ title: string; country: string; date: string; forecast: string | null; previous: string | null; actual: string | null }>;
  flashes: Array<{ id: number; text: string; time: number; url: string }>;
  crowded: Array<{ id: string; label: string; crowding: string; cotIndex: number; specName: string }>;
  curves: Array<{ id: string; label: string; kind: string; shape: string | null; spread: number | null; moves25: number | null; front: number | null }>;
  geo: Array<{ id: string; label: string; week: number; heat: number | null; tone: string | null; top: string | null }>;
  asOf: number;
};

const QUADRANT_COLOR: Record<string, string> = { goldilocks: "#36c26b", reflation: "#f0a030", stagflation: "#ff5d5d", deflation: "#5d9dff" };
const RISK_COLOR: Record<string, string> = { "risk-on": "up", "risk-off": "down", netral: "amber" };

function Go({ to, children }: { to: View; children: React.ReactNode }) {
  const setView = useTerminal((s) => s.setView);
  return (
    <button className="text-fs-9 dim hover:text-[var(--amber)] whitespace-nowrap" onClick={() => setView(to)}>
      {children} →
    </button>
  );
}

function curveRead(c: Dashboard["curves"][number]): string {
  if (c.kind === "rate") {
    if (c.moves25 == null) return "—";
    const n = Math.abs(c.moves25);
    return c.moves25 < -0.4 ? `memperhitungkan ±${n.toFixed(1)}× pemotongan 25 bp` : c.moves25 > 0.4 ? `memperhitungkan ±${n.toFixed(1)}× kenaikan 25 bp` : "suku bunga diperkirakan datar";
  }
  if (c.id === "vx") return c.shape === "backwardation" ? "backwardation: pasar sedang takut sekarang" : c.shape === "contango" ? "contango: kondisi tenang (normal)" : "datar";
  return c.shape === "backwardation" ? "backwardation: pasokan dekat ketat" : c.shape === "contango" ? "contango: pasokan longgar/biaya simpan" : "datar";
}

export default function DashboardPage() {
  const poll = usePoll(30_000);
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-dashboard"], queryFn: () => apiGet<Dashboard>("/api/desk/dashboard"), refetchInterval: poll });
  if (isLoading) return <Loading what="dashboard" />;
  if (error || !data) return <Failed error={error} />;
  const r = data.regime;
  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      {/* Regime and risk */}
      <Section title="Regime makro" note="arah pertumbuhan × inflasi" right={<Go to="regime">Macro Regime</Go>} className="xl:col-span-5">
        {r ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-3">
              <span className="text-fs-20 font-bold" style={{ color: QUADRANT_COLOR[r.quadrant] }}>
                {r.label}
              </span>
              <span className="dim text-fs-10">
                {r.streak} bln berturut{r.previous && r.previous !== r.quadrant ? " · baru berganti" : ""}
              </span>
              <span className={`ml-auto font-bold uppercase ${RISK_COLOR[r.risk.label] ?? ""}`}>{r.risk.label}</span>
            </div>
            <div className="dim leading-relaxed">{r.note}</div>
            <ScoreBar value={r.growth} label="Momentum pertumbuhan" />
            <ScoreBar value={r.inflation} label="Momentum inflasi" />
            <ul className="text-fs-10 dim list-disc pl-4">
              {r.risk.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="dim">Regime belum tersedia.</div>
        )}
      </Section>

      {/* Key markets */}
      <Section title="Pasar utama" note="hari / minggu / bulan" right={<Go to="market">Market</Go>} className="xl:col-span-7">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
          {data.markets.map((m) => (
            <div key={m.label} className="border-l-2 pl-2 min-w-0" style={{ borderColor: (m.day ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
              <div className="dim text-fs-9 truncate">{m.label}</div>
              <div className="font-bold tabular-nums">{m.price == null ? "—" : m.price.toLocaleString("en-US", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits })}</div>
              <div className="text-fs-9 flex gap-1.5">
                <Pct v={m.day} />
                <Pct v={m.week} digits={1} />
                <Pct v={m.month} digits={1} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Shortlist */}
      <Section title="Shortlist sesuai regime" note="bias terukur/teori + konfirmasi tren" right={<Go to="regime">rincian</Go>} className="xl:col-span-4">
        {r && (r.long.length || r.avoid.length) ? (
          <div className="grid gap-2">
            {r.long.map((x) => (
              <div key={x.key}>
                <span className="up font-bold">▲ {x.label}</span>
                <div className="dim text-fs-10">{x.why}</div>
              </div>
            ))}
            {r.avoid.map((x) => (
              <div key={x.key}>
                <span className="down font-bold">▼ {x.label}</span>
                <div className="dim text-fs-10">{x.why}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dim">Tidak ada aset yang bias regime dan trennya sejalan saat ini.</div>
        )}
      </Section>

      {/* Calendar */}
      <Section title="Kalender berdampak tinggi" note="3 hari ke depan" right={<Go to="calendar">Kalender</Go>} className="xl:col-span-4">
        {data.events.length ? (
          <table className="w-full text-fs-10">
            <tbody>
              {data.events.map((e) => (
                <tr key={e.date + e.title} className="border-b border-[#161616]">
                  <td className="py-0.5 pr-2 dim whitespace-nowrap">{wib(Date.parse(e.date))}</td>
                  <td className="py-0.5 pr-2 font-bold">{e.country}</td>
                  <td className="py-0.5">{e.title}</td>
                  <td className="py-0.5 pl-2 text-right tabular-nums dim whitespace-nowrap">{e.actual ?? (e.forecast ? `f ${e.forecast}` : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dim">Tidak ada rilis berdampak tinggi dalam 3 hari.</div>
        )}
      </Section>

      {/* Breadth */}
      <Section title="Breadth S&P 500" note="kualitas pergerakan" right={<Go to="etf">ETF & breadth</Go>} className="xl:col-span-4">
        {data.breadth ? (
          <div className="grid gap-2">
            <div className="grid grid-cols-3 gap-2">
              <Bar label="> MA 50 hari" pct={data.breadth.above50} />
              <Bar label="> MA 200 hari" pct={data.breadth.above200} />
              <Bar label="Naik hari ini" pct={(data.breadth.advancing / Math.max(1, data.breadth.advancing + data.breadth.declining)) * 100} />
            </div>
            <div className="text-fs-10 dim">
              Dekat puncak 52 minggu: <b className="up">{data.breadth.nearHigh}</b> · dekat dasar: <b className="down">{data.breadth.nearLow}</b>
            </div>
            <div className="text-fs-10 leading-relaxed">{data.breadth.read}</div>
          </div>
        ) : (
          <div className="dim">Breadth belum tersedia.</div>
        )}
      </Section>

      {/* Curves */}
      <Section title="Yang diperhitungkan futures" right={<Go to="futures">Futures</Go>} className="xl:col-span-4">
        <div className="grid gap-1.5">
          {data.curves.map((c) => (
            <div key={c.id} className="flex gap-2 items-baseline">
              <span className="w-[42%] shrink-0 truncate">{c.label}</span>
              <span className={`text-fs-10 ${c.shape === "backwardation" && c.id === "vx" ? "down" : ""}`}>{curveRead(c)}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Crowding */}
      <Section title="Posisi yang crowded" note="COT index ≥85 / ≤15" right={<Go to="cot">Positioning</Go>} className="xl:col-span-4">
        {data.crowded.length ? (
          <div className="grid gap-1">
            {data.crowded.map((c) => (
              <div key={c.id} className="flex gap-2">
                <span className="flex-1 truncate">{c.label}</span>
                <span className={c.crowding === "crowded-long" ? "up" : "down"}>{c.crowding === "crowded-long" ? "long penuh" : "short penuh"}</span>
                <span className="dim tabular-nums w-8 text-right">{c.cotIndex}</span>
              </div>
            ))}
            <div className="text-fs-9 dim mt-1">Posisi spekulan di ujung rentang 3 tahunnya: rawan berbalik bila terurai.</div>
          </div>
        ) : (
          <div className="dim">Tidak ada posisi spekulan yang ekstrem.</div>
        )}
      </Section>

      {/* Geopolitics */}
      <Section title="Geopolitik terhangat" note="7 hari" right={<Go to="geo">Geopolitics</Go>} className="xl:col-span-4">
        {data.geo.length ? (
          <div className="grid gap-1.5">
            {data.geo.map((g) => (
              <div key={g.id}>
                <div className="flex gap-2">
                  <span className="font-bold flex-1">{g.label}</span>
                  <span className="dim">{g.week} berita</span>
                  {g.heat != null && <span className={g.heat >= 1.5 ? "down" : g.heat <= 0.7 ? "up" : "dim"}>{g.heat.toFixed(1)}× biasa</span>}
                  {g.tone && <span className={g.tone === "eskalasi" ? "down" : g.tone === "meredam" ? "up" : "amber"}>{g.tone}</span>}
                </div>
                {g.top && <div className="text-fs-10 dim truncate">{g.top}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="dim">Belum ada berita geopolitik di arsip.</div>
        )}
      </Section>

      {/* Watcher Guru */}
      <Section title="Kilat Watcher Guru" right={<Go to="watcher">semua</Go>} className="xl:col-span-12">
        <div className="grid gap-1 sm:grid-cols-2">
          {data.flashes.map((f) => (
            <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="flex gap-2 hover:bg-[#121212] px-1 rounded-sm">
              <span className="dim text-fs-9 w-[64px] shrink-0 pt-0.5">{ago(f.time)}</span>
              <span className="text-fs-10 line-clamp-2">{f.text}</span>
            </a>
          ))}
        </div>
      </Section>
      <div className="xl:col-span-12 text-fs-9 dim text-right">Diperbarui {wib(data.asOf)} · bukan saran investasi.</div>
    </div>
  );
}

function Bar({ label, pct }: { label: string; pct: number }) {
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
    </div>
  );
}
