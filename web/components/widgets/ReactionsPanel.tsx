"use client";

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { useWidgetSetting } from "../../store/terminal";

// How markets actually moved on each release and Fed broadcast (server: providers/reactions.ts):
// gold, bitcoin, S&P futures, the dollar and the 2-year yield, ~30 minutes after the release and
// over the day, against the surprise's side, the engine's call before it, and the Fed Sentiment Index.

type Bias = "hawkish" | "dovish" | "neutral";
type Key = string;
type Moves = Partial<Record<Key, number | null>>;
type Tally = Record<Key, { n: number; agree: number }>;
type Reactions = {
  asOf: string;
  releases: Array<{ key: string; label: string; date: string; surprise: number; side: Bias; call: Bias | null; m30: Moves; day: Moves }>;
  summary: Array<{ key: string; label: string; surprise30: Tally; surpriseDay: Tally; call30: Tally; callDay: Tally; releases: number }>;
  broadcasts: Array<{ videoId: string; title: string; start: number; end: number; index: number; side: Bias; moves: Moves }>;
  instruments: Array<{ key: Key; label: string; unit: string; hawk: number }>;
  delivery?: Delivery;
};
/** Layers 2 and 3 (voice and face) against the markets (server: providers/deliverytest.ts). */
type Delivery = {
  n: number;
  needed: number;
  rows: Array<{
    videoId: string;
    title: string;
    start: number;
    words: number;
    delivery: { minutes: number; faceMinutes: number; confidence: number; stress: number; hesitation: number; tension: number | null };
    reaction: number | null;
  }>;
  hypotheses: Array<{ id: string; label: string; stat: number | null; statLabel: string; p: number | null; shown: boolean }>;
};

/** The test of the voice and the face: its hypotheses, how far the data has come, and each broadcast. */
function DeliveryTest({ d }: { d: Delivery }) {
  const enough = d.n >= d.needed;
  return (
    <div className="border border-[var(--border)] rounded-sm">
      <div className="px-2 py-1 bg-[#141414] text-[var(--text)] font-bold flex items-center gap-2">
        🎙🙂 Uji suara &amp; wajah vs pasar
        <span className={`ml-auto text-fs-10 font-normal ${enough ? "up" : "amber"}`}>
          {enough ? `${d.n} siaran` : `mengumpulkan data: ${d.n}/${d.needed} siaran`}
        </span>
      </div>
      <div className="px-2 py-1 text-fs-10 leading-relaxed dim">
        Hipotesis ditetapkan 20 Okt 2026, sebelum datanya ada. Reaksi = gerak yield 2Y, DXY, emas, dan S&amp;P futures selama siaran, ditandai searah bacaan hawkish dan
        diskalakan ke gerak tipikal masing-masing. p = seberapa sering acak (cara bicara diacak antar-siaran, 2.000 kali) menghasilkan angka setinggi itu. Dianggap
        terbukti hanya bila ≥{d.needed} siaran dan p &lt; 0,05.
      </div>
      <div className="px-2 pb-1 text-fs-10 leading-relaxed">
        <span className="text-[var(--text)]">Pembanding, kata-kata saja</span>
        <span className="dim">
          {" "}
          (caption 57 konferensi pers FOMC 2019–2026, harga 1 menit histdata.com, uji 20 Okt 2026): indeks kata vs reaksi pasar selama konferensi pers r 0,23 (p 0,04),
          tetapi dengan uji peringkat hanya ρ 0,14 (p 0,17), karena didorong beberapa reaksi besar 2022; 2023–2026 ρ 0,02. Jadi kata-kata Fed menunjukkan sikapnya,
          bukan kejutannya bagi pasar. Lapisan suara dan wajah harus mengalahkan angka ini untuk berarti.
        </span>
      </div>
      <div className="px-2 pb-1 flex flex-col gap-1">
        {d.hypotheses.map((h) => (
          <div key={h.id} className="leading-snug">
            <b>{h.id}</b> {h.label}
            <div className="text-fs-10 tabular-nums">
              {h.stat === null ? <span className="dim">belum ada angka</span> : `${h.statLabel} ${h.stat > 0 ? "+" : ""}${fmt(h.stat, 3)} · p ${fmt(h.p ?? NaN, 3)}`} ·{" "}
              {h.shown ? <span className="up font-bold">terbukti</span> : !enough ? <span className="amber">data belum cukup</span> : <span className="dim">tidak terbukti</span>}
            </div>
          </div>
        ))}
      </div>
      {d.rows.length === 0 ? (
        <div className="px-2 py-1 dim text-fs-10">
          Belum ada siaran dengan rekaman suara/wajah ≥10 menit (rekaman konferensi pers lama tidak bisa diunduh: YouTube kini menolaknya tanpa token anti-bot). Perekaman berjalan otomatis saat siaran The Fed ditonton live di Live TV dengan mode Watcher (suara &amp;
          wajah) aktif, satu sampel per menit dari pembicara utama.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Siaran</th>
              <th title="Indeks kata-kata (lapisan 1)">Kata</th>
              <th title="Keyakinan cara bicara rata-rata, 0–1">Yakin</th>
              <th title="Stres suara (nada, variasi nada, volume vs baseline)">Stres</th>
              <th title="Jeda dan 'uh/um'">Ragu</th>
              <th title="Ketegangan wajah (menit dengan wajah terkunci)">Wajah</th>
              <th title="Reaksi pasar searah hawkish, dalam satuan gerak tipikal">Reaksi</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.slice(0, 20).map((r) => (
              <tr key={r.videoId}>
                <td className="!text-left max-w-[180px] truncate" title={r.title}>
                  {new Date(r.start).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" })} {r.title}
                  <span className="dim text-fs-9"> · {r.delivery.minutes} mnt</span>
                </td>
                <td className={r.words >= 0.2 ? "down" : r.words <= -0.2 ? "up" : "dim"}>{fmt(r.words, 2)}</td>
                <td className="tabular-nums">{fmt(r.delivery.confidence, 2)}</td>
                <td className="tabular-nums">{fmt(r.delivery.stress, 2)}</td>
                <td className="tabular-nums">{fmt(r.delivery.hesitation, 2)}</td>
                <td className="tabular-nums">{r.delivery.tension === null ? <span className="dim">—</span> : `${fmt(r.delivery.tension, 2)} (${r.delivery.faceMinutes}m)`}</td>
                <td className="tabular-nums">{r.reaction === null ? <span className="dim">—</span> : `${r.reaction > 0 ? "+" : ""}${fmt(r.reaction, 2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A hawkish side sends gold, bitcoin and stocks down, the dollar and the 2-year yield up. */
const agrees = (side: Bias | null, hawk: number, v: number | null | undefined) =>
  !side || side === "neutral" || v === null || v === undefined || v === 0 ? null : Math.sign(v) === (side === "hawkish" ? hawk : -hawk);

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
                      <Move v={b.moves[i.key]} unit={i.unit} ok={agrees(b.side, i.hawk, b.moves[i.key])} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.delivery && <DeliveryTest d={data.delivery} />}

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
                      <Move v={moves[i.key]} unit={i.unit} ok={agrees(r.side, i.hawk, moves[i.key])} />
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
