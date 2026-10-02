"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet, type Candle } from "../../lib/api";
import { buildEvents, type AstroEvent, type EventKind } from "../../lib/astro-calendar/events";
import { ASSETS, describeKey, extendSeries, impactOf, indexByKey, MIN_SAMPLES, type Asset, type Impact, type Verdict } from "../../lib/astro-calendar/impact";
import { useWidgetSetting } from "../../store/terminal";

// The astrology calendar: the month's sky events, each with its offline verdict on GOLD and BTC
// (lib/astro-calendar). Clicking an event opens its details: what happens, and the impact with
// the statistics behind it.

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
    <span className="w-8 h-8 rounded-full bg-[#f7931a] flex items-center justify-center shrink-0 text-white font-bold text-[15px]" aria-hidden>
      ₿
    </span>
  );
}

function Badge({ verdict }: { verdict: Verdict }) {
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${VERDICT_STYLE[verdict]}`}>{verdict}</span>;
}

/** The returns after each past event, as small bars (newest on the right). */
function Bars({ impact }: { impact: Impact }) {
  const recent = impact.samples.slice(-40);
  const max = Math.max(0.01, ...recent.map((s) => Math.abs(s.ret)));
  return (
    <div className="flex items-center gap-[2px] h-10" title="Return setelah tiap kejadian sebelumnya (terbaru di kanan)">
      {recent.map((s) => {
        const h = Math.max(1, (Math.abs(s.ret) / max) * 18);
        return (
          <div key={s.time} className="flex flex-col justify-center h-full w-[5px]">
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

function ImpactRow({ impact }: { impact: Impact }) {
  const [open, setOpen] = useState(false);
  const enough = impact.n >= MIN_SAMPLES;
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#151515]">
      <div className="flex items-center gap-3 px-4 py-3">
        <AssetIcon asset={impact.asset} />
        <span className="text-[14px] text-[var(--text)]">{ASSET_LABEL[impact.asset]}</span>
        <Badge verdict={impact.verdict} />
        {impact.confidence && <span className="dim text-[10px]">keyakinan {impact.confidence}</span>}
        <button className="ml-auto text-[12px] text-[#ff6a3d] hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Tutup" : "Lihat Detail"} {open ? "↑" : "→"}
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 text-[11px] space-y-2">
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
                <span className="dim">Naik setelah kejadian</span>
                <span>
                  {(impact.upRate * 100).toFixed(0)}% <span className="dim">(biasanya {(impact.baselineUpRate * 100).toFixed(0)}%)</span>
                </span>
                <span className="dim">Jumlah kejadian sebelumnya</span>
                <span>{impact.n}</span>
                <span className="dim">Kekuatan statistik (t)</span>
                <span>{impact.t.toFixed(2)}</span>
              </div>
              <Bars impact={impact} />
              <div className="dim">
                Dasar: {describeKey(impact.basis)}
                {impact.basisLevel > 0 && " (kejadian persis seperti ini terlalu jarang, jadi dipakai kelompok yang lebih luas)"}.
              </div>
            </>
          ) : (
            <div className="dim">Belum cukup kejadian serupa di data ({impact.n} dari minimal {MIN_SAMPLES}) untuk menarik kesimpulan.</div>
          )}
        </div>
      )}
    </div>
  );
}

function EventDialog({ event, byKey, onClose }: { event: AstroEvent; byKey: Map<string, number[]>; onClose: () => void }) {
  const impacts = useMemo(() => ASSETS.map((a) => impactOf(event, byKey, a)), [event, byKey]);
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
          <h2 className="text-[20px] font-bold text-white">Astrology Calendar Details</h2>
          <button className="ml-auto dim hover:text-white text-[18px]" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] border-l-[3px] border-l-[#7c6cf0] bg-[#141414] px-4 py-3 mb-3">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-[#3b2a7a] border-2 border-white/70 flex items-center justify-center text-white text-[15px] shrink-0">{event.glyph}</span>
            <div>
              <div className="text-[17px] font-bold text-white">{event.title}</div>
              <div className="dim text-[11px]">
                {fmtDate(event.time)}, {fmtTime(event.time)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-[var(--text)]">{event.detail}</p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-3 space-y-3">
          <div className="flex items-center px-1">
            <span className="text-[15px] text-white">Dampak</span>
            <span className="ml-auto text-[13px] text-white">{day.toLocaleDateString("id-ID", { day: "2-digit", month: "long" })}</span>
            <button className="ml-2 w-5 h-5 rounded-full border border-[#4a7dff] text-[#4a7dff] text-[11px] leading-none" onClick={() => setInfo(!info)} aria-label="Cara menghitung">
              i
            </button>
          </div>
          {info && (
            <div className="text-[11px] dim px-1 space-y-1">
              <p>
                Dihitung offline dari riwayat harga (gold sejak 1990, BTC sejak 2011): untuk setiap kejadian yang sama di masa lalu, diukur pergerakan harga
                beberapa hari bursa sesudahnya, lalu dibandingkan dengan pergerakan biasa pada periode yang sama panjang. Bullish/Bearish bila selisihnya
                cukup konsisten (t ≥ 1), selain itu Netral.
              </p>
              <p>Ini pola masa lalu, bukan ramalan: astrologi belum terbukti bisa memprediksi pasar, dan sebagian pola bisa muncul karena kebetulan.</p>
            </div>
          )}
          {impacts.map((im) => (
            <ImpactRow key={im.asset} impact={im} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A dot per asset on a calendar chip: green bullish, red bearish, grey neutral. */
function Dots({ event, byKey }: { event: AstroEvent; byKey: Map<string, number[]> }) {
  const v = useMemo(() => ASSETS.map((a) => impactOf(event, byKey, a).verdict), [event, byKey]);
  const color = (x: Verdict) => (x === "Bullish" ? "#2ecc8f" : x === "Bearish" ? "#e05555" : "#555");
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
  const [, setPricesVersion] = useState(0);
  const gold = useQuery({ queryKey: ["astro-prices", "GOLD"], queryFn: () => apiGet<Candle[]>("/api/history/XAUUSD=X?range=1Y&interval=1D"), staleTime: 3_600_000, retry: 0 });
  const btc = useQuery({ queryKey: ["astro-prices", "BTC"], queryFn: () => apiGet<Candle[]>("/api/history/BTC-USD?range=1Y&interval=1D"), staleTime: 3_600_000, retry: 0 });
  useEffect(() => {
    if (gold.data) extendSeries("GOLD", gold.data);
    if (btc.data) extendSeries("BTC", btc.data);
    setPricesVersion((v) => v + 1);
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
    <div className="flex h-full min-h-0 text-[11px]">
      <div className="flex-1 min-w-0 flex flex-col p-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="term-btn" onClick={() => step(-1)} aria-label="Bulan sebelumnya">
            ‹
          </button>
          <span className="amber font-bold w-36 text-center text-[13px]">
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
        <div className="flex items-center gap-3 dim text-[10px]">
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
            <div key={w} className="bg-[var(--panel-2)] text-center dim py-1 text-[10px]">
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
                <span className={`text-[10px] ${today ? "amber font-bold" : "dim"}`}>{inMonth ? d : ""}</span>
                {events.slice(0, 5).map((e) => (
                  <button
                    key={e.id}
                    className="flex items-center gap-1 text-left rounded px-1 py-[1px] hover:bg-[#1f1f1f] truncate"
                    title={`${e.title} — klik untuk dampak`}
                    onClick={() => setSelected(e)}
                  >
                    <span className="shrink-0">{e.glyph}</span>
                    <span className="truncate flex-1">{e.title}</span>
                    {data && <Dots event={e} byKey={data.byKey} />}
                  </button>
                ))}
                {events.length > 5 && <span className="dim text-[9px] px-1">+{events.length - 5} lainnya</span>}
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
            {data && <Dots event={e} byKey={data.byKey} />}
          </button>
        ))}
      </aside>
      {selected && data && <EventDialog event={selected} byKey={data.byKey} onClose={() => setSelected(null)} />}
    </div>
  );
}
