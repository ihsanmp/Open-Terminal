"use client";

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { useWidgetSetting } from "../../store/terminal";

// How markets actually moved on each release and Fed broadcast (server: providers/reactions.ts):
// gold, bitcoin, S&P futures, the dollar and the 2-year yield, ~30 minutes after the release and
// over the day, against the surprise's side, the engine's call before it, and the Fed Sentiment Index.

type Bias = "hawkish" | "dovish" | "neutral";
type Key = "xau" | "btc" | "es" | "dxy" | "us2y";
type Moves = Partial<Record<Key, number | null>>;
type Tally = Record<Key, { n: number; agree: number }>;
type Reactions = {
  asOf: string;
  releases: Array<{ key: string; label: string; date: string; surprise: number; side: Bias; call: Bias | null; m30: Moves; day: Moves }>;
  summary: Array<{ key: string; label: string; surprise30: Tally; surpriseDay: Tally; call30: Tally; callDay: Tally; releases: number }>;
  broadcasts: Array<{ videoId: string; title: string; start: number; end: number; index: number; side: Bias; moves: Moves }>;
  instruments: Array<{ key: Key; label: string; unit: string }>;
};

/** A hawkish side sends gold, bitcoin and stocks down, the dollar and the 2-year yield up. */
const HAWK: Record<Key, 1 | -1> = { xau: -1, btc: -1, es: -1, dxy: 1, us2y: 1 };
const agrees = (side: Bias | null, key: Key, v: number | null | undefined) =>
  !side || side === "neutral" || v === null || v === undefined || v === 0 ? null : Math.sign(v) === (side === "hawkish" ? HAWK[key] : -HAWK[key]);

const SIDE: Record<Bias, { label: string; cls: string }> = {
  hawkish: { label: "🦅", cls: "down" },
  dovish: { label: "🕊", cls: "up" },
  neutral: { label: "⚖", cls: "dim" },
};

function Rate({ t }: { t: { n: number; agree: number } }) {
  if (!t.n) return <span className="dim">-</span>;
  const p = t.agree / t.n;
  return (
    <span title={`${t.agree} dari ${t.n}`} className={p >= 0.65 ? "up font-bold" : p <= 0.45 ? "down" : ""}>
      {Math.round(p * 100)}%<span className="dim text-fs-9">/{t.n}</span>
    </span>
  );
}

function Move({ v, unit, ok }: { v: number | null | undefined; unit: string; ok: boolean | null }) {
  if (v === null || v === undefined) return <span className="dim">-</span>;
  return (
    <span className={ok === null ? "" : ok ? "up" : "down"}>
      {v > 0 ? "+" : ""}
      {fmt(v, unit === "bp" ? 1 : 2)}
      {unit === "bp" ? "bp" : "%"}
    </span>
  );
}

export default function ReactionsPanel() {
  const [span, setSpan] = useWidgetSetting<"m30" | "day">("reactSpan", "m30");
  const { data, isLoading, error } = useQuery({ queryKey: ["macro-reactions"], queryFn: () => apiGet<Reactions>("/api/macro/reactions"), staleTime: 300_000, refetchInterval: 900_000 });
  if (isLoading) return <div className="dim p-2">Mengambil harga intraday di sekitar tiap rilis…</div>;
  if (error || !data) return <div className="down p-2">Reaksi pasar gagal dimuat: {(error as Error)?.message}</div>;
  const inst = data.instruments;

  return (
    <div className="flex flex-col gap-2 p-2 text-fs-11">
      <div className="flex items-center gap-2">
        <span className="font-bold text-[var(--text)]">📈 UJI REAKSI PASAR</span>
        <span className="ml-auto flex gap-1">
          <button className={`term-btn ${span === "m30" ? "active" : ""}`} onClick={() => setSpan("m30")} title="Dari saat rilis sampai ±30 menit sesudahnya">
            30 menit
          </button>
          <button className={`term-btn ${span === "day" ? "active" : ""}`} onClick={() => setSpan("day")} title="Penutupan hari rilis vs hari sebelumnya">
            harian
          </button>
        </span>
      </div>
      <div className="dim text-fs-10 leading-relaxed">
        Seberapa sering pasar bergerak searah bacaan: hawkish → emas, BTC, S&P turun; DXY dan yield 2Y naik (dovish sebaliknya). 50% = tidak lebih baik dari lempar koin.
      </div>

      <div className="border border-[var(--border)] rounded-sm overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Rilis · bacaan</th>
              {inst.map((i) => (
                <th key={i.key}>{i.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.summary.map((s) => (
              <Fragment key={s.key}>
                <tr>
                  <td className="!text-left">
                    <span className="text-[var(--text)]">{s.label}</span> <span className="dim text-fs-9">kejutan</span>
                  </td>
                  {inst.map((i) => (
                    <td key={i.key} className="tabular-nums">
                      <Rate t={(span === "m30" ? s.surprise30 : s.surpriseDay)[i.key]} />
                    </td>
                  ))}
                </tr>
                {inst.some((i) => (span === "m30" ? s.call30 : s.callDay)[i.key].n > 0) && (
                  <tr>
                    <td className="!text-left dim text-fs-10">↳ tebakan engine (sebelum rilis)</td>
                    {inst.map((i) => (
                      <td key={i.key} className="tabular-nums">
                        <Rate t={(span === "m30" ? s.call30 : s.callDay)[i.key]} />
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-[var(--border)] rounded-sm">
        <div className="px-2 py-1 bg-[#141414] text-[var(--text)] font-bold">🏛 Siaran The Fed vs pasar</div>
        {data.broadcasts.length === 0 ? (
          <div className="px-2 py-1 dim text-fs-10">Belum ada. Tiap siaran The Fed yang diikuti (dengan ≥3 frasa kebijakan) dicatat di sini: indeks sentimennya vs gerak pasar selama siaran.</div>
        ) : (
          <table className="data-table">
            <tbody>
              {data.broadcasts.slice(0, 15).map((b) => (
                <tr key={b.videoId}>
                  <td className="!text-left max-w-[150px] truncate" title={b.title}>
                    {new Date(b.start).toLocaleDateString([], { day: "numeric", month: "short" })} {b.title}
                  </td>
                  <td className={SIDE[b.side].cls}>
                    {SIDE[b.side].label} {b.index > 0 ? "+" : ""}
                    {fmt(b.index, 2)}
                  </td>
                  {inst.map((i) => (
                    <td key={i.key} className="tabular-nums">
                      <Move v={b.moves[i.key]} unit={i.unit} ok={agrees(b.side, i.key, b.moves[i.key])} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-[var(--border)] rounded-sm overflow-auto">
        <div className="px-2 py-1 bg-[#141414] text-[var(--text)] font-bold">Rilis terakhir</div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Rilis</th>
              <th>Kejutan</th>
              <th>Engine</th>
              {inst.map((i) => (
                <th key={i.key}>{i.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.releases.slice(0, 40).map((r) => {
              const moves = span === "m30" ? r.m30 : r.day;
              return (
                <tr key={`${r.key}${r.date}`}>
                  <td className="!text-left whitespace-nowrap">
                    <span className="dim">{new Date(r.date).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" })}</span> {r.label}
                  </td>
                  <td className={`tabular-nums ${SIDE[r.side].cls}`}>
                    {SIDE[r.side].label} {r.surprise > 0 ? "+" : ""}
                    {r.surprise}
                  </td>
                  <td className={r.call ? SIDE[r.call].cls : "dim"}>{r.call ? SIDE[r.call].label : "-"}</td>
                  {inst.map((i) => (
                    <td key={i.key} className="tabular-nums">
                      <Move v={moves[i.key]} unit={i.unit} ok={agrees(r.side, i.key, moves[i.key])} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dim text-fs-10 leading-relaxed">
        Harga dari TradingView: bar 30 menit (tahun ini) atau 1 jam (sebelumnya; jendela ±30 menit di sekitar rilis) dan bar harian sejak 2016. Rilis yang keluar bersamaan (CPI dan Core CPI) berbagi gerak pasar yang sama. Hijau = searah bacaan, merah = berlawanan. Riwayat bar disimpan dan bertambah setiap hari.
      </div>
    </div>
  );
}
