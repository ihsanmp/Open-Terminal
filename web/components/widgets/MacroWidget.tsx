"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { fontPx } from "../../lib/font-scale";
import { newsImpact } from "../../lib/news-impact";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";
import CalendarWidget from "./CalendarWidget";

// The Macro page, after SoSoValue's: the economic calendar by day with each release's history
// (its actual, forecast and previous, a line through two years of them and the table), the
// macro flash headlines, and FedWatch — the FOMC's target-rate odds from fed funds futures — with
// the overnight funding rates (SOFR, TGCR, BGCR, ON RRP) beside it. The full calendar table
// (every country, day and week filters) is a tab of its own.

type EconEvent = {
  title: string;
  country: string;
  region?: string;
  category?: string;
  date: string;
  impact: "Low" | "Medium" | "High" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

type Tab = "calendar" | "pmi" | "inflation" | "employment" | "activity" | "table";
const TABS: Array<[Tab, string]> = [
  ["calendar", "Calendar"],
  ["pmi", "PMI"],
  ["inflation", "Inflation"],
  ["employment", "Employment"],
  ["activity", "Economic Activity"],
  ["table", "Tabel lengkap"],
];
const COUNTRIES: Array<[string, string]> = [
  ["US", "Amerika Serikat"],
  ["EU", "Zona Euro"],
  ["GB", "Inggris"],
  ["JP", "Jepang"],
  ["CN", "Tiongkok"],
  ["ID", "Indonesia"],
  ["DE", "Jerman"],
  ["CA", "Kanada"],
  ["AU", "Australia"],
];

/** Which tab an event belongs on: its TradingView category, PMIs by name. */
function inTab(e: EconEvent, tab: Tab): boolean {
  const pmi = /\bPMI\b/.test(e.title);
  switch (tab) {
    case "calendar":
      return e.impact === "High" || e.impact === "Medium";
    case "pmi":
      return pmi;
    case "inflation":
      return e.category === "prce";
    case "employment":
      return e.category === "lbr";
    case "activity":
      return !pmi && ["bsnss", "cnsm", "hse", "gdp", "trd", "gov"].includes(e.category ?? "");
    default:
      return true;
  }
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "long" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

/** "0.3%", "-$102B", "54.92K" → 0.3, -102, 54.92. */
const numberOf = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : null;
};

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-[var(--border)] bg-[var(--panel)] rounded-sm min-h-0 ${className}`}>{children}</div>;
}

// ---------------------------------------------------------------- calendar and an indicator's history

function EventDetail({ event }: { event: EconEvent }) {
  const country = event.region ?? "US";
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["macro-history", country, event.title],
    queryFn: () => apiGet<EconEvent[]>(`/api/macro/history?country=${country}&title=${encodeURIComponent(event.title)}`),
    staleTime: 3_600_000,
  });
  // Releases with figures (a speech has none).
  const rows = [...data].reverse().filter((r) => r.actual || r.forecast || r.previous);
  const chart = data.filter((e) => numberOf(e.actual) !== null).map((e) => ({ date: e.date.slice(0, 10), actual: numberOf(e.actual), forecast: numberOf(e.forecast) }));
  const latest = rows[0] ?? event;
  const cell = (label: string, value: string | null, color: string) => (
    <div className="flex-1 px-3 border-l border-[var(--border)] first:border-l-0 first:pl-0">
      <div className="text-fs-10 dim flex items-center gap-1">
        <span className="w-2 h-2 inline-block" style={{ background: color }} />
        {label}
      </div>
      <div className="text-fs-15 font-bold text-[var(--text)]">{value ?? "-"}</div>
    </div>
  );
  return (
    <div className="p-3 flex flex-col gap-2 min-h-0">
      <div className="text-fs-15 text-[var(--text)]">{event.title}</div>
      <div className="dim text-fs-11">⟲ Update time: {event.date.slice(0, 10)} · {event.country}</div>
      <div className="flex">
        {cell("Actual", latest.date.slice(0, 10) === event.date.slice(0, 10) ? event.actual : latest.actual, "#2962ff")}
        {cell("Forecast", event.forecast, "#5b9cf6")}
        {cell("Previous", event.previous, "#26a69a")}
      </div>
      {isLoading && <div className="dim">Memuat riwayat…</div>}
      {error && <div className="down">Riwayat gagal dimuat: {(error as Error).message}</div>}
      {chart.length > 1 && (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1c1c1c" vertical={false} />
              <XAxis dataKey="date" stroke="#808080" fontSize={fontPx(9)} minTickGap={40} />
              <YAxis stroke="#808080" fontSize={fontPx(9)} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: fontPx(10) }} />
              <Line dataKey="actual" name="Actual" stroke="#2962ff" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="forecast" name="Forecast" stroke="#5b9cf6" dot={false} strokeDasharray="4 3" strokeWidth={1} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {rows.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Actual</th>
              <th>Forecast</th>
              <th>Previous</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 24).map((r) => (
              <tr key={r.date}>
                <td className="!text-center">{r.date.slice(0, 10)}</td>
                <td className="!text-center text-[var(--text)]">{r.actual ?? "-"}</td>
                <td className="!text-center">{r.forecast ?? "-"}</td>
                <td className="!text-center">{r.previous ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!isLoading && rows.length === 0 && <div className="dim">Event ini tidak punya angka (pidato, rapat, lelang tanpa hasil): tidak ada riwayat untuk digambar.</div>}
    </div>
  );
}

function MacroCalendar() {
  const [tab, setTab] = useWidgetSetting<Tab>("macroTab", "calendar");
  const [country, setCountry] = useWidgetSetting("macroCountry", "US");
  const [picked, setPicked] = useState<string | null>(null);
  const poll = usePoll(300_000);
  // From yesterday, two weeks on.
  const { from, to } = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 15);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["macro-calendar", from, to],
    queryFn: () => apiGet<EconEvent[]>(`/api/econ-calendar?from=${from}&to=${to}`),
    refetchInterval: poll,
    enabled: tab !== "table",
  });

  if (tab === "table")
    return (
      <Section className="flex flex-col flex-1 min-w-0">
        <Tabs tab={tab} setTab={setTab} country={country} setCountry={setCountry} />
        <div className="flex-1 min-h-0 overflow-auto">
          <CalendarWidget />
        </div>
      </Section>
    );

  const events = data.filter((e) => (e.region ?? "US") === country && e.impact !== "Holiday" && inTab(e, tab));
  // Every day in the range, with or without events, as SoSoValue lists them.
  const days: string[] = [];
  for (let d = new Date(from); d < new Date(to); d.setDate(d.getDate() + 1)) days.push(dayKey(d.toISOString()));
  const byDay = new Map<string, EconEvent[]>();
  for (const e of events) byDay.set(dayKey(e.date), [...(byDay.get(dayKey(e.date)) ?? []), e]);
  const today = dayKey(new Date().toISOString());
  const keyOf = (e: EconEvent) => `${e.date}|${e.title}`;
  // Picked, else the next release with figures (a CPI, not a speech), else the next event.
  const hasFigures = (e: EconEvent) => Boolean(e.forecast || e.previous || e.actual);
  const selected =
    events.find((e) => keyOf(e) === picked) ??
    events.find((e) => dayKey(e.date) >= today && hasFigures(e)) ??
    events.find((e) => dayKey(e.date) >= today) ??
    events[0] ??
    null;

  return (
    <Section className="flex flex-col flex-1 min-w-0">
      <Tabs tab={tab} setTab={setTab} country={country} setCountry={setCountry} />
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
        <div className="overflow-auto min-h-0 max-h-[60vh] md:max-h-none border-r border-[var(--border)] px-2 py-1">
          {isLoading && <div className="dim p-2">Memuat kalender…</div>}
          {error && <div className="down p-2">Kalender gagal dimuat: {(error as Error).message}</div>}
          {days.map((d) => {
            const list = (byDay.get(d) ?? []).sort((a, b) => a.date.localeCompare(b.date));
            return (
              <div key={d} className="mb-1">
                <div className={`text-fs-13 py-1 ${d === today ? "text-[#ef5350] font-bold" : "text-[var(--text)]"}`}>{DAY_FMT.format(new Date(`${d}T12:00:00`))}</div>
                {list.map((e) => (
                  <button
                    key={keyOf(e)}
                    onClick={() => setPicked(keyOf(e))}
                    className={`w-full text-left flex items-center gap-2 pl-2 pr-1 py-1 text-fs-12 rounded-sm ${selected && keyOf(selected) === keyOf(e) ? "bg-[#262626] text-[var(--text)]" : "hover:bg-[#161616]"}`}
                  >
                    <span className="dim tabular-nums w-[4.5rem] shrink-0 text-fs-10 whitespace-nowrap">{new Date(e.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.impact === "High" ? "bg-[#ef5350]" : e.impact === "Medium" ? "bg-[var(--amber)]" : "bg-[#555]"}`} />
                    <span className="flex-1 truncate">{e.title}</span>
                    {e.actual && <span className="tabular-nums text-fs-10 text-[var(--text)]">{e.actual}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="overflow-auto min-h-0">{selected ? <EventDetail key={keyOf(selected)} event={selected} /> : <div className="dim p-3">Tidak ada event di kategori ini.</div>}</div>
      </div>
    </Section>
  );
}

function Tabs({ tab, setTab, country, setCountry }: { tab: Tab; setTab: (t: Tab) => void; country: string; setCountry: (c: string) => void }) {
  return (
    <div className="flex items-center gap-4 px-3 py-1.5 border-b border-[var(--border)] text-fs-12 flex-wrap">
      {TABS.map(([t, label], i) => (
        <button key={t} onClick={() => setTab(t)} className={`${tab === t ? "text-[#ef5350] font-bold" : "dim hover:text-[var(--text)]"} ${i === 1 ? "border-l border-[var(--border)] pl-4" : ""}`}>
          {i === 0 ? "▦ " : ""}
          {label}
        </button>
      ))}
      {tab !== "table" && (
        <select className="ml-auto" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Negara">
          {COUNTRIES.map(([c, name]) => (
            <option key={c} value={c}>
              {c} · {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- flash headlines

type WireItem = { id: string; title: string; link: string; publisher: string; category: string; publishedAt: string };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} minutes ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

function Flash() {
  const poll = usePoll(30_000);
  const { data } = useQuery({
    queryKey: ["macro-flash"],
    queryFn: async () => {
      const [eco, mkt] = await Promise.all([
        apiGet<{ items: WireItem[] }>("/api/news/wire?category=ECONOMIC&limit=60"),
        apiGet<{ items: WireItem[] }>("/api/news/wire?category=MARKETS&limit=60"),
      ]);
      return [...eco.items, ...mkt.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 60);
    },
    refetchInterval: poll,
  });
  return (
    <Section className="flex flex-col">
      <div className="px-3 py-2 text-[#ef5350] font-bold text-fs-12 border-b border-[var(--border)]">Flash</div>
      <div className="overflow-auto flex-1 min-h-0 max-h-[60vh]">
        {(data ?? []).map((n) => {
          const impact = newsImpact(n.title);
          return (
            <a key={n.id} href={n.link} target="_blank" rel="noreferrer" className="block px-3 py-2 border-b border-[#1c1c1c] hover:bg-[#161616]">
              <div className={`text-fs-12 leading-snug ${impact?.level === "high" ? "font-bold text-[var(--text)]" : "text-[var(--text)]"}`}>
                {impact?.level === "high" && <span className="text-fs-9 font-bold px-1 rounded-sm bg-[#ef5350] text-black mr-1.5 align-middle">⚡</span>}
                {n.title}
              </div>
              <div className="flex justify-between dim text-fs-10 mt-1">
                <span>{ago(n.publishedAt)}</span>
                <span className="underline">@{n.publisher} ↗</span>
              </div>
            </a>
          );
        })}
        {!data && <div className="dim p-3">Memuat…</div>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- FedWatch and the funding rates

type FedWatchData = {
  asOf: number;
  target: { lower: number; upper: number };
  effr: number;
  buckets: string[];
  meetings: Array<{ date: string; probs: Record<string, number> }>;
  next: { date: string; at: Array<{ label: string; date: string; probs: Record<string, number> }> } | null;
  source: string;
};
type FundingSeries = { kind: string; name: string; points: Array<{ date: string; rate: number | null; volume: number | null }>; source: string };

const pct = (p: number | undefined) => (p === undefined ? "" : `${(p * 100).toFixed(1)}%`);
const FUNDING: Array<[string, string]> = [
  ["fedwatch", "FedWatch tool"],
  ["sofr", "SOFR"],
  ["tgcr", "TGCR"],
  ["bgcr", "BGCR"],
  ["rrp", "ON RRP"],
];

function FedWatchTable() {
  const { data, error, isLoading } = useQuery({ queryKey: ["macro-fedwatch"], queryFn: () => apiGet<FedWatchData>("/api/macro/fedwatch"), staleTime: 300_000, refetchInterval: 600_000 });
  if (isLoading) return <div className="dim p-3">Menghitung probabilitas dari futures fed funds…</div>;
  if (error || !data) return <div className="down p-3">FedWatch gagal dimuat: {(error as Error)?.message}</div>;
  const current = `${Math.round(data.target.lower * 100)}-${Math.round(data.target.upper * 100)}`;
  return (
    <div className="p-3 flex flex-col gap-3 text-fs-11">
      <div className="font-bold text-[var(--text)] text-fs-13">FOMC Target Rate Probabilities</div>
      <div className="overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-center">MEETING DATE</th>
              {data.buckets.map((b) => (
                <th key={b} className={`!text-center ${b === current ? "amber" : ""}`}>
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.meetings.map((m) => {
              const top = Math.max(...Object.values(m.probs));
              return (
                <tr key={m.date}>
                  <td className="!text-center">{m.date.replaceAll("-", "/")}</td>
                  {data.buckets.map((b) => (
                    <td key={b} className={`!text-center tabular-nums ${m.probs[b] === top ? "text-[#ef5350] font-bold" : ""}`}>
                      {m.probs[b] !== undefined ? pct(m.probs[b]) : "0.0%"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.next && (
        <>
          <div className="font-bold text-[var(--text)] text-fs-13">
            Target Rate Probabilities for {new Date(`${data.next.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} Fed Meeting
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="!text-center">TARGET RATE (BPS)</th>
                {data.next.at.map((a) => (
                  <th key={a.label} className="!text-center">
                    {a.label === "NOW" ? "NOW *" : `${a.label} ${new Date(`${a.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set(data.next.at.flatMap((a) => Object.keys(a.probs)).concat(current))]
                .sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
                .map((b) => (
                  <tr key={b}>
                    <td className="!text-center">
                      {b}
                      {b === current ? " (Current)" : ""}
                    </td>
                    {data.next!.at.map((a) => (
                      <td key={a.label} className="!text-center tabular-nums">
                        {pct(a.probs[b] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      <div className="dim text-fs-10 leading-relaxed">
        Dihitung dengan metode CME FedWatch dari harga futures 30-Day Fed Funds (ZQ) per bulan, tertunda 10 menit; target saat ini {current} bps, EFFR {fmt(data.effr, 2)}% (FRED). * NOW = harga terakhir.
      </div>
    </div>
  );
}

function FundingChart({ kind }: { kind: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["macro-funding", kind], queryFn: () => apiGet<FundingSeries>(`/api/macro/funding/${kind}`), staleTime: 1_800_000 });
  if (isLoading) return <div className="dim p-3">Memuat…</div>;
  if (error || !data) return <div className="down p-3">Gagal dimuat: {(error as Error)?.message}</div>;
  const last = data.points.at(-1);
  const isRrp = kind === "rrp";
  return (
    <div className="p-3 flex flex-col gap-2 text-fs-11">
      <div className="font-bold text-[var(--text)] text-fs-13">{data.name}</div>
      {last && (
        <div className="flex gap-6">
          <div>
            <div className="dim text-fs-10">{isRrp ? "Award rate" : "Rate"}</div>
            <div className="text-fs-15 font-bold text-[var(--text)]">{last.rate !== null ? `${fmt(last.rate, 2)}%` : "-"}</div>
          </div>
          <div>
            <div className="dim text-fs-10">Volume</div>
            <div className="text-fs-15 font-bold text-[var(--text)]">{last.volume !== null ? `$${fmtBig(last.volume * 1e9)}` : "-"}</div>
          </div>
          <div>
            <div className="dim text-fs-10">Tanggal</div>
            <div className="text-fs-15 text-[var(--text)]">{last.date}</div>
          </div>
        </div>
      )}
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1c1c1c" vertical={false} />
            <XAxis dataKey="date" stroke="#808080" fontSize={fontPx(9)} minTickGap={40} />
            <YAxis yAxisId="rate" stroke="#808080" fontSize={fontPx(9)} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
            <YAxis yAxisId="vol" orientation="right" stroke="#555" fontSize={fontPx(9)} width={52} tickFormatter={(v: number) => `$${fmtBig(v * 1e9)}`} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: fontPx(10) }} formatter={(v: number, name: string) => [name === "Volume" ? `$${fmtBig(v * 1e9)}` : `${v}%`, name]} />
            <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="#26a69a" opacity={0.35} isAnimationActive={false} />
            <Line yAxisId="rate" dataKey="rate" name="Rate" stroke="#ef5350" dot={false} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="dim text-fs-10">Sumber: {data.source}</div>
    </div>
  );
}

function FedWatchPanel() {
  const [tab, setTab] = useWidgetSetting("macroRates", "fedwatch");
  return (
    <Section className="flex flex-col">
      <div className="flex gap-5 px-3 py-2 border-b border-[var(--border)] text-fs-12">
        {FUNDING.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={tab === k ? "text-[#ef5350] font-bold" : "dim hover:text-[var(--text)]"}>
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-auto flex-1 min-h-0">{tab === "fedwatch" ? <FedWatchTable /> : <FundingChart kind={tab} />}</div>
    </Section>
  );
}

export default function MacroWidget() {
  return (
    <div className="p-1 flex flex-col gap-1 min-h-full">
      <div className="h-[clamp(420px,58vh,760px)] flex">
        <MacroCalendar />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1">
        <Flash />
        <FedWatchPanel />
      </div>
    </div>
  );
}
