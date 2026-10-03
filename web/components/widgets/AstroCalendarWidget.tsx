"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet, type Candle } from "../../lib/api";
import { buildEvents, type AstroEvent, type EventKind } from "../../lib/astro-calendar/events";
import { ASSETS, describeKey, describeState, extendSeries, impactOf, indexByKey, MIN_SAMPLES, pricesVersion, trackRecord, verdictTrail, type Asset, type Impact, type Verdict } from "../../lib/astro-calendar/impact";
import { useWidgetSetting } from "../../store/terminal";

// The astrology calendar: the month's sky events, each with its offline verdict on GOLD and BTC
// (lib/astro-calendar). Clicking an event opens its details: what happens, and the impact with
// the statistics behind it. The verdict follows the latest close until the day before the event,
// so it is recomputed whenever the prices change.

const DAY = 86_400;
const FIRST_DAY = Math.floor(Date.UTC(1990, 0, 1) / 1000 / DAY);
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const KINDS: Array<{ kind: EventKind; label: string }> = [
  { kind: "station", label: "Retrograde" },
  { kind: "eclipse", label: "Gerhana" },
  { kind: "lunation", label: "Bulan" },
  { kind: "ingress", label: "Ingress" },
  { kind: "aspect", label: "Aspek" },
];
const VERDICT_STYLE: Record<Verdict, string> = {
  Bullish: "bg-[#0f5f45] text-[#7ff0c2]",
  Bearish: "bg-[#6b1d1d] text-[#ffb3b3]",
  Netral: "bg-[#2a2a2a] text-[#a8a8a8]",
};
const ASSET_LABEL: Record<Asset, string> = { GOLD: "GOLD", BTC: "BTC" };

// The whole catalogue is computed once (about half a second) and shared by every calendar.
let catalogue: { events: AstroEvent[]; byKey: Map<string, number[]> } | null = null;
function getCatalogue() {
  if (!catalogue) {
    const today = Math.floor(Date.now() / 1000 / DAY);
    const events = buildEvents(FIRST_DAY, today + 500);
    catalogue = { events, byKey: indexByKey(events) };
  }
  return catalogue;
}

const localDay = (time: number) => {
  const d = new Date(time * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDate = (time: number) => localDay(time).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
const fmtUtcDay = (day: number, month: "long" | "short" = "long") =>
  new Date(day * DAY * 1000).toLocaleDateString("id-ID", { day: "2-digit", month, year: month === "long" ? "numeric" : undefined, timeZone: "UTC" });
const fmtTime = (time: number) => new Date(time * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

function AssetIcon({ asset }: { asset: Asset }) {
  return asset === "GOLD" ? (
    <span className="w-8 h-8 rounded-full bg-[#f3efe4] flex items-center justify-center shrink-0" aria-hidden>
      <svg width="20" height="14" viewBox="0 0 20 14">
        <path d="M3 13 L6 4 H14 L17 13 Z" fill="#d4a017" stroke="#9a7410" strokeWidth="0.8" />
        <path d="M7 4 L9 1 H13 L14 4 Z" fill="#f2c94c" stroke="#9a7410" strokeWidth="0.8" />
      </svg>
    </span>
  ) : (
    <span className="w-8 h-8 rounded-full bg-[#f7931a] flex items-center justify-center shrink-0 text-white font-bold text-fs-15" aria-hidden>
      ₿
    </span>
  );
}

function Badge({ verdict }: { verdict: Verdict }) {
  return <span className={`px-2 py-0.5 rounded-md text-fs-11 font-bold ${VERDICT_STYLE[verdict]}`}>{verdict}</span>;
}

/** The returns after each past event, as small bars (newest on the right). */
function Bars({ impact }: { impact: Impact }) {
  const recent = impact.samples.slice(-40);
  const max = Math.max(0.01, ...recent.map((s) => Math.abs(s.ret)));
  const maxW = Math.max(1e-9, ...recent.map((s) => s.w));
  return (
    <div className="flex items-center gap-[2px] h-10" title="Return setelah tiap kejadian sebelumnya (terbaru di kanan; makin terang, makin diperhitungkan)">
      {recent.map((s) => {
        const h = Math.max(1, (Math.abs(s.ret) / max) * 18);
        return (
          <div key={s.time} className="flex flex-col justify-center h-full w-[5px]" style={{ opacity: 0.25 + 0.75 * Math.min(1, s.w / maxW) }}>
            <div style={{ height: 18 }} className="flex items-end">
              {s.ret > 0 && <div style={{ height: h }} className="w-full bg-[#2ecc8f]" />}
            </div>
            <div style={{ height: 18 }} className="flex items-start">
              {s.ret <= 0 && <div style={{ height: h }} className="w-full bg-[#e05555]" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const VERDICT_COLOR: Record<Verdict, string> = { Bullish: "#2ecc8f", Bearish: "#e05555", Netral: "#555" };
type TrailPoint = { day: number; verdict: Verdict; t: number };

/** The verdict as of each recent trading day up to H-1, oldest on the left. */
function Trail({ trail }: { trail: TrailPoint[] }) {
  if (!trail.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="dim">Perubahan kesimpulan</span>
      <span className="flex gap-[2px]">
        {trail.map((x) => (
          <span key={x.day} className="w-[9px] h-[9px] rounded-[2px]" style={{ background: VERDICT_COLOR[x.verdict] }} title={`${fmtUtcDay(x.day)}: ${x.verdict} (t ${x.t.toFixed(2)})`} />
        ))}
      </span>
      <span className="dim">
        {fmtUtcDay(trail[0].day, "short")} → {fmtUtcDay(trail[trail.length - 1].day, "short")}
      </span>
    </div>
  );
}

function ImpactRow({ impact, trail, record }: { impact: Impact; trail: TrailPoint[]; record: { calls: number; right: number } }) {
  const [open, setOpen] = useState(false);
  const enough = impact.n >= MIN_SAMPLES;
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#151515]">
      <div className="flex items-center gap-3 px-4 py-3">
        <AssetIcon asset={impact.asset} />
        <span className="text-fs-14 text-[var(--text)]">{ASSET_LABEL[impact.asset]}</span>
        <Badge verdict={impact.verdict} />
        {impact.confidence && <span className="dim text-fs-10">keyakinan {impact.confidence}</span>}
        <button className="ml-auto text-fs-12 text-[#ff6a3d] hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Tutup" : "Lihat Detail"} {open ? "↑" : "→"}
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 text-fs-11 space-y-2">
          {enough ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="dim">Dalam {impact.horizon} hari bursa setelahnya</span>
                <span>
                  rata-rata <b className={impact.meanPct >= 0 ? "up" : "down"}>{signed(impact.meanPct)}</b>
                </span>
                <span className="dim">Biasanya (semua periode {impact.horizon} hari)</span>
                <span>{signed(impact.baselinePct)}</span>
                <span className="dim">Selisih dari biasanya</span>
                <span className={impact.excessPct >= 0 ? "up" : "down"}>{signed(impact.excessPct)}</span>
                <span className="dim pl-2">· dari kondisi pasar</span>
                <span className={impact.marketPct >= 0 ? "up" : "down"}>{signed(impact.marketPct)}</span>
                <span className="dim pl-2">· dari kejadian astro</span>
                <span className={impact.astroPct >= 0 ? "up" : "down"}>{signed(impact.astroPct)}</span>
                <span className="dim">Naik setelah kejadian</span>
                <span>
                  {(impact.upRate * 100).toFixed(0)}% <span className="dim">(biasanya {(impact.baselineUpRate * 100).toFixed(0)}%)</span>
                </span>
                <span className="dim">Jumlah kejadian sebelumnya</span>
                <span>
                  {impact.n} <span className="dim">(bobot efektif {impact.neff.toFixed(1)})</span>
                </span>
                <span className="dim">Kekuatan statistik (t)</span>
                <span>{impact.t.toFixed(2)}</span>
                <span className="dim">Kondisi pasar per {fmtUtcDay(impact.asOfDay, "short")}</span>
                <span>{describeState(impact.state)}</span>
                <span className="dim">Rekam jejak jenis ini</span>
                <span>
                  {record.calls ? `${record.right} dari ${record.calls} kesimpulan benar (${Math.round((record.right / record.calls) * 100)}%)` : "belum ada kesimpulan sebelumnya"}
                </span>
              </div>
              <Trail trail={trail} />
              <Bars impact={impact} />
              <div className="dim">
                Dasar: {describeKey(impact.basis)}
                {impact.basisLevel > 0 && " (kejadian persis seperti ini terlalu jarang, jadi dipakai kelompok yang lebih luas)"}.
              </div>
            </>
          ) : (
            <>
              <div className="dim">
                Belum cukup kejadian serupa di data ({impact.n} dari minimal {MIN_SAMPLES}) untuk menarik kesimpulan.
              </div>
              <Trail trail={trail} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EventDialog({ event, events, byKey, version, onClose }: { event: AstroEvent; events: AstroEvent[]; byKey: Map<string, number[]>; version: number; onClose: () => void }) {
  const rows = useMemo(
    () => ASSETS.map((a) => ({ impact: impactOf(event, byKey, a), trail: verdictTrail(event, byKey, a), record: trackRecord(event, byKey, events, a) })),
    [event, events, byKey, version] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const final = rows.every((r) => r.impact.final);
  const asOf = Math.max(...rows.map((r) => r.impact.asOfDay));
  const [info, setInfo] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const day = localDay(event.time);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={event.title}
        className="w-[440px] max-w-[94vw] max-h-[90vh] overflow-auto rounded-2xl border border-[#2a2a2a] bg-[#0d0d0d] p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center mb-4">
          <h2 className="text-fs-20 font-bold text-white">Astrology Calendar Details</h2>
          <button className="ml-auto dim hover:text-white text-fs-18" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] border-l-[3px] border-l-[#7c6cf0] bg-[#141414] px-4 py-3 mb-3">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-[#3b2a7a] border-2 border-white/70 flex items-center justify-center text-white text-fs-15 shrink-0">{event.glyph}</span>
            <div>
              <div className="text-fs-17 font-bold text-white">{event.title}</div>
              <div className="dim text-fs-11">
                {fmtDate(event.time)}, {fmtTime(event.time)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-fs-12 text-[var(--text)]">{event.detail}</p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-3 space-y-3">
          <div className="flex items-center px-1">
            <span className="text-fs-15 text-white">Dampak</span>
            <span className="ml-auto text-fs-13 text-white">{day.toLocaleDateString("id-ID", { day: "2-digit", month: "long" })}</span>
            <button className="ml-2 w-5 h-5 rounded-full border border-[#4a7dff] text-[#4a7dff] text-fs-11 leading-none" onClick={() => setInfo(!info)} aria-label="Cara menghitung">
              i
            </button>
          </div>
          <div className="text-fs-10 dim px-1">
            Kesimpulan per data {fmtUtcDay(asOf)}
            {final ? " · final (H-1)" : ` · sementara, ikut berubah dengan harga terbaru sampai H-1 (${fmtUtcDay(Math.floor(event.time / DAY) - 1)})`}
          </div>
          {info && (
            <div className="text-fs-11 dim px-1 space-y-1">
              <p>
                Dihitung offline dari riwayat harga (gold sejak 1990, BTC sejak 2011): untuk setiap kejadian yang sama di masa lalu, diukur pergerakan harga
                beberapa hari bursa sesudahnya (dari penutupan H-1), lalu dibandingkan dengan pergerakan biasa pada periode yang sama panjang.
                Bullish/Bearish bila selisihnya cukup konsisten (t ≥ 1), selain itu Netral.
              </p>
              <p>
                Adaptif sampai H-1: hanya harga sampai hari itu yang dipakai. Kejadian lampau yang terjadi saat kondisi pasar mirip dengan sekarang
                (momentum 20 hari dan posisi terhadap rata-rata 50 hari) serta yang lebih baru diberi bobot lebih besar, jadi kesimpulan bisa berubah
                setiap ada harga penutupan baru. Mulai H-1 kesimpulannya tetap.
              </p>
              <p>Ini pola masa lalu, bukan ramalan: astrologi belum terbukti bisa memprediksi pasar, dan sebagian pola bisa muncul karena kebetulan.</p>
            </div>
          )}
          {rows.map((r) => (
            <ImpactRow key={r.impact.asset} {...r} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A dot per asset on a calendar chip: green bullish, red bearish, grey neutral. */
function Dots({ event, byKey, version }: { event: AstroEvent; byKey: Map<string, number[]>; version: number }) {
  const v = useMemo(() => ASSETS.map((a) => impactOf(event, byKey, a).verdict), [event, byKey, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = (x: Verdict) => VERDICT_COLOR[x];
  return (
    <span className="flex gap-[2px] shrink-0" title={ASSETS.map((a, i) => `${a}: ${v[i]}`).join(", ")}>
      {v.map((x, i) => (
        <span key={ASSETS[i]} className="w-[6px] h-[6px] rounded-full" style={{ background: color(x) }} />
      ))}
    </span>
  );
}

export default function AstroCalendarWidget() {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [shown, setShown] = useWidgetSetting<EventKind[]>("kinds", ["station", "eclipse", "lunation", "ingress"]);
  const [selected, setSelected] = useState<AstroEvent | null>(null);
  const [data, setData] = useState<ReturnType<typeof getCatalogue> | null>(catalogue);

  // Computed after the first paint, so the page shows at once.
  useEffect(() => {
    if (data) return;
    const id = setTimeout(() => setData(getCatalogue()), 30);
    return () => clearTimeout(id);
  }, [data]);

  // Newer closes than the bundled ones, when the app's API is reachable (optional: it works offline).
  // Refreshed every quarter of an hour: the verdicts follow the latest close until H-1.
  const [version, setVersion] = useState(pricesVersion);
  const live = { staleTime: 10 * 60_000, refetchInterval: 15 * 60_000, retry: 0 } as const;
  const gold = useQuery({ queryKey: ["astro-prices", "GOLD"], queryFn: () => apiGet<Candle[]>("/api/history/XAUUSD=X?range=1Y&interval=1D"), ...live });
  const btc = useQuery({ queryKey: ["astro-prices", "BTC"], queryFn: () => apiGet<Candle[]>("/api/history/BTC-USD?range=1Y&interval=1D"), ...live });
  useEffect(() => {
    if (gold.data) extendSeries("GOLD", gold.data);
    if (btc.data) extendSeries("BTC", btc.data);
    setVersion(pricesVersion());
  }, [gold.data, btc.data]);

  const first = new Date(month.y, month.m, 1);
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => i - lead + 1);

  const monthEvents = useMemo(() => {
    if (!data) return [];
    const from = first.getTime() / 1000;
    const to = new Date(month.y, month.m + 1, 1).getTime() / 1000;
    return data.events.filter((e) => e.time >= from && e.time < to && shown.includes(e.kind));
  }, [data, month, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = useMemo(() => {
    if (!data) return [];
    const from = Date.now() / 1000 - DAY / 2;
    return data.events.filter((e) => e.time >= from && shown.includes(e.kind)).slice(0, 25);
  }, [data, shown]);

  const step = (k: number) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + k) / 12), m: (((m + k) % 12) + 12) % 12 }));
  const toggle = (kind: EventKind) => setShown(shown.includes(kind) ? shown.filter((k) => k !== kind) : [...shown, kind]);

  return (
    <div className="flex h-full min-h-0 text-fs-11">
      <div className="flex-1 min-w-0 flex flex-col p-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="term-btn" onClick={() => step(-1)} aria-label="Bulan sebelumnya">
            ‹
          </button>
          <span className="amber font-bold w-36 text-center text-fs-13">
            {MONTHS[month.m]} {month.y}
          </span>
          <button className="term-btn" onClick={() => step(1)} aria-label="Bulan berikutnya">
            ›
          </button>
          <button className="term-btn" onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>
            Hari ini
          </button>
          <span className="ml-auto flex gap-1">
            {KINDS.map(({ kind, label }) => (
              <button key={kind} className={`term-btn ${shown.includes(kind) ? "active" : ""}`} onClick={() => toggle(kind)}>
                {label}
              </button>
            ))}
          </span>
        </div>
        <div className="flex items-center gap-3 dim text-fs-10">
          <span>Titik: GOLD · BTC —</span>
          <span className="flex items-center gap-1">
            <span className="w-[6px] h-[6px] rounded-full bg-[#2ecc8f]" /> Bullish
          </span>
          <span className="flex items-center gap-1">
            <span className="w-[6px] h-[6px] rounded-full bg-[#e05555]" /> Bearish
          </span>
          <span className="flex items-center gap-1">
            <span className="w-[6px] h-[6px] rounded-full bg-[#555]" /> Netral
          </span>
          {!data && <span className="amber">Menghitung posisi planet…</span>}
        </div>
        <div className="grid grid-cols-7 gap-px bg-[var(--border)] border border-[var(--border)] flex-1 min-h-0 auto-rows-fr">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-[var(--panel-2)] text-center dim py-1 text-fs-10">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            const date = new Date(month.y, month.m, d);
            const inMonth = d >= 1 && d <= daysInMonth;
            const events = inMonth ? monthEvents.filter((e) => sameDay(localDay(e.time), date)) : [];
            const today = inMonth && sameDay(date, now);
            return (
              <div key={i} className={`bg-[var(--bg)] p-1 min-h-[70px] overflow-hidden flex flex-col gap-[2px] ${inMonth ? "" : "opacity-30"}`}>
                <span className={`text-fs-10 ${today ? "amber font-bold" : "dim"}`}>{inMonth ? d : ""}</span>
                {events.slice(0, 5).map((e) => (
                  <button
                    key={e.id}
                    className="flex items-center gap-1 text-left rounded px-1 py-[1px] hover:bg-[#1f1f1f] truncate"
                    title={`${e.title} — klik untuk dampak`}
                    onClick={() => setSelected(e)}
                  >
                    <span className="shrink-0">{e.glyph}</span>
                    <span className="truncate flex-1">{e.title}</span>
                    {data && <Dots event={e} byKey={data.byKey} version={version} />}
                  </button>
                ))}
                {events.length > 5 && <span className="dim text-fs-9 px-1">+{events.length - 5} lainnya</span>}
              </div>
            );
          })}
        </div>
      </div>
      <aside className="w-[290px] shrink-0 border-l border-[var(--border)] overflow-auto">
        <div className="panel-title px-2 py-1.5">Kejadian mendatang</div>
        {upcoming.map((e) => (
          <button key={e.id} className="w-full flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] hover:bg-[#1a1a1a] text-left" onClick={() => setSelected(e)}>
            <span className="w-14 dim shrink-0">{localDay(e.time).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</span>
            <span className="shrink-0">{e.glyph}</span>
            <span className="truncate flex-1">{e.title}</span>
            {data && <Dots event={e} byKey={data.byKey} version={version} />}
          </button>
        ))}
      </aside>
      {selected && data && <EventDialog event={selected} events={data.events} byKey={data.byKey} version={version} onClose={() => setSelected(null)} />}
    </div>
  );
}
