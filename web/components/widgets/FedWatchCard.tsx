"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";

// CME FedWatch beside the Fed on air: what the market prices for the next FOMC meetings (server:
// providers/fedwatch.ts, CME's method on fed funds futures), next to what the Fed is saying.

type Probs = Record<string, number>;
type FedWatchData = {
  asOf: number;
  target: { lower: number; upper: number };
  effr: number;
  buckets: string[];
  meetings: Array<{ date: string; probs: Probs }>;
  next: { date: string; at: Array<{ label: string; date: string; probs: Probs }> } | null;
  source: string;
};

const CME_URL = "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html";

export function useFedWatch() {
  return useQuery({ queryKey: ["macro-fedwatch"], queryFn: () => apiGet<FedWatchData>("/api/macro/fedwatch"), staleTime: 300_000, refetchInterval: 600_000 });
}

const lowOf = (bucket: string) => Number(bucket.split("-")[0]);
const meetingDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

/** A target range against today's: hold, or cut / hike by so many basis points. */
function moveOf(bucket: string, current: number): { label: string; cls: string } {
  const bps = lowOf(bucket) - current;
  if (bps === 0) return { label: "TAHAN", cls: "dim" };
  return bps > 0 ? { label: `NAIK ${bps}`, cls: "down" } : { label: `TURUN ${-bps}`, cls: "up" };
}

/** Odds of a hike, a hold and a cut at a meeting. */
export function sides(probs: Probs, current: number) {
  let hike = 0;
  let hold = 0;
  let cut = 0;
  for (const [b, p] of Object.entries(probs)) {
    const d = lowOf(b) - current;
    if (d > 0) hike += p;
    else if (d < 0) cut += p;
    else hold += p;
  }
  return { hike, hold, cut };
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const pp = (p: number) => `${p > 0 ? "+" : ""}${(p * 100).toFixed(1)}`;

/** One line for the next meeting: hold, hike or cut odds. */
export function FedWatchStrip() {
  const { data } = useFedWatch();
  if (!data?.next) return null;
  const current = Math.round(data.target.lower * 100);
  const s = sides(data.next.at[0].probs, current);
  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[#0b0b0b] px-2 py-1 flex items-center gap-3 text-fs-10 flex-wrap">
      <span className="dim">CME FEDWATCH · FOMC {meetingDay(data.next.date)}</span>
      <span>
        tahan <b className="text-[var(--text)]">{pct(s.hold)}</b>
      </span>
      <span className="down">naik {pct(s.hike)}</span>
      <span className="up">turun {pct(s.cut)}</span>
      <a className="ml-auto amber hover:underline" href={CME_URL} target="_blank" rel="noreferrer">
        ↗ CME FedWatch
      </a>
    </div>
  );
}

/** The next meeting's odds by target range, how they've moved, and the path over the meetings after. */
export function FedWatchCard() {
  const { data, error, isLoading } = useFedWatch();
  if (isLoading) return <div className="dim p-2">Menghitung probabilitas dari futures fed funds…</div>;
  if (error || !data) return <div className="down p-2">FedWatch gagal dimuat: {(error as Error)?.message}</div>;
  const current = Math.round(data.target.lower * 100);
  const now = data.next?.at[0];
  const dayAgo = data.next?.at.find((a) => a.label === "1 DAY");
  const weekAgo = data.next?.at.find((a) => a.label === "1 WEEK");
  const rows = now ? Object.entries(now.probs).filter(([, p]) => p >= 0.001).sort((a, b) => lowOf(a[0]) - lowOf(b[0])) : [];
  return (
    <div className="flex flex-col gap-2 p-2 text-fs-11">
      {data.next && now && (
        <div className="border border-[var(--border)] rounded-sm">
          <div className="px-2 py-1 bg-[#141414] flex justify-between">
            <span className="text-[var(--text)] font-bold">Rapat FOMC {meetingDay(data.next.date)}</span>
            <span className="dim">target kini {current}-{Math.round(data.target.upper * 100)} bps</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="!text-left">Target (bps)</th>
                <th className="!text-left">Peluang</th>
                <th>Δ 1 hari</th>
                <th>Δ 1 minggu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([b, p]) => {
                const m = moveOf(b, current);
                const d1 = dayAgo ? p - (dayAgo.probs[b] ?? 0) : null;
                const d7 = weekAgo ? p - (weekAgo.probs[b] ?? 0) : null;
                return (
                  <tr key={b}>
                    <td className="!text-left tabular-nums">
                      {b} <span className={`text-fs-9 ${m.cls}`}>{m.label}</span>
                    </td>
                    <td className="!text-left">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 bg-[#ef5350] rounded-sm" style={{ width: `${Math.max(2, p * 90)}px` }} />
                        <span className="tabular-nums text-[var(--text)]">{pct(p)}</span>
                      </div>
                    </td>
                    <td className={`tabular-nums ${d1 === null || Math.abs(d1) < 0.001 ? "dim" : d1 > 0 ? "up" : "down"}`}>{d1 === null ? "-" : pp(d1)}</td>
                    <td className={`tabular-nums ${d7 === null || Math.abs(d7) < 0.001 ? "dim" : d7 > 0 ? "up" : "down"}`}>{d7 === null ? "-" : pp(d7)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border border-[var(--border)] rounded-sm">
        <div className="px-2 py-1 bg-[#141414] text-[var(--text)] font-bold">Jalur suku bunga yang dihargai pasar</div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Rapat</th>
              <th>Paling mungkin</th>
              <th>Rata-rata</th>
              <th>Naik / Tahan / Turun</th>
            </tr>
          </thead>
          <tbody>
            {data.meetings.map((m) => {
              const [top, p] = Object.entries(m.probs).sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
              const mean = Object.entries(m.probs).reduce((n, [b, q]) => n + (lowOf(b) + 12.5) * q, 0);
              const s = sides(m.probs, current);
              return (
                <tr key={m.date}>
                  <td className="!text-left tabular-nums">{meetingDay(m.date)}</td>
                  <td className="tabular-nums">
                    {top} <span className="dim">({pct(p)})</span>
                  </td>
                  <td className="tabular-nums">{fmt(mean / 100, 2)}%</td>
                  <td className="tabular-nums">
                    <span className="down">{(s.hike * 100).toFixed(0)}</span> / <span>{(s.hold * 100).toFixed(0)}</span> / <span className="up">{(s.cut * 100).toFixed(0)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <a className="term-btn self-start" href={CME_URL} target="_blank" rel="noreferrer">
        ↗ Buka CME FedWatch Tool (resmi)
      </a>
      <div className="dim text-fs-10 leading-relaxed">
        Dihitung dengan metode CME FedWatch dari futures 30-Day Fed Funds (ZQ), tertunda ±10 menit; EFFR {fmt(data.effr, 2)}%. Naik/tahan/turun dibandingkan target saat ini, kumulatif sampai rapat itu. Tabel lengkap ada di tab MACRO → FedWatch tool.
      </div>
    </div>
  );
}
