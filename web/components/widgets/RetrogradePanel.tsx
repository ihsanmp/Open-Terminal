"use client";

import { useEffect, useMemo, useState } from "react";
import { RETRO_PLANETS, retrogradePeriods, type RetroPeriod, type RetroPlanet } from "../../lib/astro-calendar/retrograde";
import { SIGNS } from "../../lib/astro-calendar/events";
import { useWidgetSetting } from "../../store/terminal";

// A planet's retrograde periods of a year, as cards: when it turns retrograde and direct again (to
// the minute, from its precise position: lib/astro-calendar/retrograde.ts), where in the zodiac,
// its shadow, and whether the period is over, running or ahead.

const PLANET: Record<RetroPlanet, { name: string; glyph: string }> = {
  Mercury: { name: "Merkurius", glyph: "☿" },
  Venus: { name: "Venus", glyph: "♀" },
  Mars: { name: "Mars", glyph: "♂" },
  Jupiter: { name: "Jupiter", glyph: "♃" },
  Saturn: { name: "Saturnus", glyph: "♄" },
  Uranus: { name: "Uranus", glyph: "♅" },
  Neptune: { name: "Neptunus", glyph: "♆" },
  Pluto: { name: "Pluto", glyph: "♇" },
};
/** "Pisces 22°34′": to the nearest arcminute, as the almanacs give a station. */
function position(lon: number): string {
  const minutes = Math.round((((lon % 360) + 360) % 360) * 60) % (360 * 60);
  const sign = Math.floor(minutes / 1800);
  const inSign = minutes - sign * 1800;
  return `${SIGNS[sign]} ${Math.floor(inSign / 60)}°${String(inSign % 60).padStart(2, "0")}′`;
}
const ORDINAL = ["Pertama", "Kedua", "Ketiga", "Keempat", "Kelima", "Keenam"];

export type Zone = "local" | "America/New_York" | "UTC";
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const ZONE_NAME: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Pontianak": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
export function zoneLabel(zone: Zone): string {
  if (zone === "America/New_York") return "Eastern Time (ET)";
  if (zone === "UTC") return "UTC";
  const z = localZone();
  return ZONE_NAME[z] ? `${ZONE_NAME[z]} (waktu lokal)` : `${z} (waktu lokal)`;
}
export const tzOf = (zone: Zone) => (zone === "local" ? undefined : zone);
/** To the nearest minute, as the almanacs give the times (the date with it, at midnight). */
const toMinute = (ms: number) => Math.round(ms / 60_000) * 60_000;
const fmtDay = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: tzOf(zone) });
const fmtShortDay = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: tzOf(zone) });
const fmtClock = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: tzOf(zone) });

type Status = "done" | "running" | "ahead";
const statusOf = (p: RetroPeriod, now: number): Status => (now < p.start.time ? "ahead" : now <= p.end.time ? "running" : "done");
const BADGE: Record<Status, { text: string; cls: string }> = {
  done: { text: "Selesai", cls: "bg-[#ffffff14] text-[#cfc3b0]" },
  running: { text: "Sedang berlangsung", cls: "bg-[#f0a020] text-[#2a1600]" },
  ahead: { text: "Akan datang", cls: "bg-[#e0352b] text-white" },
};

function Card({ p, index, zone, now, focus }: { p: RetroPeriod; index: number; zone: Zone; now: number; focus: boolean }) {
  const status = statusOf(p, now);
  const days = (p.end.time - p.start.time) / 86_400_000;
  const done = status === "done" ? 1 : status === "running" ? (now - p.start.time) / (p.end.time - p.start.time) : 0;
  const inShadow =
    status === "ahead" && p.shadowStart !== null && now >= p.shadowStart
      ? "Pre-shadow berjalan"
      : status === "done" && p.shadowEnd !== null && now <= p.shadowEnd
        ? "Post-shadow berjalan"
        : null;
  const ordinal = ORDINAL[index] ?? `ke-${index + 1}`;
  return (
    <div
      className={`relative flex items-center gap-4 rounded-xl border px-4 py-3 ${
        focus ? "border-[#ff9a3c] shadow-[0_0_18px_rgba(255,140,40,0.45),inset_0_0_24px_rgba(255,140,40,0.12)]" : "border-[#c8963c66]"
      }`}
      style={{ background: "linear-gradient(100deg, #3b2717 0%, #2c1d12 55%, #24180f 100%)" }}
    >
      <div
        className="w-14 h-14 shrink-0 rounded-full flex items-center justify-center text-[#2a1a08] font-extrabold text-[28px] shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
        style={{ background: "radial-gradient(circle at 35% 30%, #ffe39a 0%, #e0aa48 55%, #a8741f 100%)" }}
        aria-hidden
      >
        {index + 1}
      </div>
      <div className="w-[190px] shrink-0">
        <div className="text-[18px] font-bold text-[#f6ead6] leading-tight">Retrograde {ordinal}</div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          <span className={`px-2.5 py-0.5 rounded-md text-fs-11 font-semibold ${BADGE[status].cls}`}>{BADGE[status].text}</span>
          {inShadow && <span className="px-2 py-0.5 rounded-md text-fs-10 bg-[#c8963c33] text-[#f0c878]">{inShadow}</span>}
        </div>
      </div>
      <div className="flex-1 min-w-[260px]">
        <div className="flex justify-between items-end gap-3 text-[#f6ead6]">
          <div>
            <div className="text-[15px] font-semibold">{fmtDay(p.start.time, zone)}</div>
            <div className="text-fs-10 text-[#c9b597]">
              ℞ {fmtClock(p.start.time, zone)} · {position(p.start.lon)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-semibold">{fmtDay(p.end.time, zone)}</div>
            <div className="text-fs-10 text-[#c9b597]">
              D {fmtClock(p.end.time, zone)} · {position(p.end.lon)}
            </div>
          </div>
        </div>
        <div className="relative h-4 mt-1.5" title={status === "running" ? `${Math.round(done * 100)}% berjalan` : undefined}>
          <div className="absolute left-1.5 right-1.5 top-1/2 h-[2px] -translate-y-1/2 bg-[#c8963c55]" />
          <div className="absolute left-1.5 top-1/2 h-[2px] -translate-y-1/2 bg-[#e8b04e]" style={{ width: `calc((100% - 12px) * ${done})` }} />
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#e8b04e]" />
          <span className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#e8b04e]" />
          {status === "running" && (
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#ff9a3c] ring-2 ring-[#ffd9a8] animate-pulse"
              style={{ left: `calc(6px + (100% - 12px) * ${done})` }}
              title="Hari ini"
            />
          )}
        </div>
        {(p.shadowStart !== null || p.shadowEnd !== null) && (
          <div className="text-fs-10 text-[#a8957a] mt-0.5" title="Shadow: sejak planet pertama kali mencapai derajat titik direct-nya, sampai kembali ke derajat titik retrograde-nya">
            Shadow: {p.shadowStart !== null ? fmtShortDay(p.shadowStart, zone) : "—"} → {p.shadowEnd !== null ? fmtShortDay(p.shadowEnd, zone) : "—"}
          </div>
        )}
      </div>
      <div className="w-[150px] shrink-0 self-stretch border-l border-[#c8963c44] pl-4 flex flex-col justify-center text-right">
        <div className="text-[13px] text-[#cfc3b0]">{zoneLabel(zone)}</div>
        <div className="text-fs-10 text-[#a8957a] mt-1">
          {days >= 2 ? `${Math.round(days)} hari` : `${days.toFixed(1)} hari`}
          {status === "running" && ` · sisa ${Math.max(0, Math.ceil((p.end.time - now) / 86_400_000))} hari`}
          {status === "ahead" && ` · ${Math.ceil((p.start.time - now) / 86_400_000)} hari lagi`}
        </div>
      </div>
    </div>
  );
}

/** The retrograde periods of a planet in a year, the current or next one lit. */
export default function RetrogradePanel() {
  const [planet, setPlanet] = useWidgetSetting<RetroPlanet>("retroPlanet", "Mercury");
  const [zone, setZone] = useWidgetSetting<Zone>("retroZone", "local");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const periods = useMemo(() => retrogradePeriods(planet, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)), [planet, year]);
  // Lit: the one running, else the next one ahead.
  const focus = periods.findIndex((p) => statusOf(p, now) !== "done");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {RETRO_PLANETS.map((p) => (
          <button key={p} className={`term-btn ${p === planet ? "active" : ""}`} onClick={() => setPlanet(p)} title={`Retrograde ${PLANET[p].name}`}>
            {PLANET[p].glyph} {PLANET[p].name}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button className="term-btn" onClick={() => setYear((y) => y - 1)} aria-label="Tahun sebelumnya">
            ‹
          </button>
          <span className="amber font-bold w-12 text-center text-fs-13">{year}</span>
          <button className="term-btn" onClick={() => setYear((y) => y + 1)} aria-label="Tahun berikutnya">
            ›
          </button>
          <select value={zone} onChange={(e) => setZone(e.target.value as Zone)} aria-label="Zona waktu" className="ml-1">
            <option value="local">{zoneLabel("local")}</option>
            <option value="America/New_York">Eastern Time (ET)</option>
            <option value="UTC">UTC</option>
          </select>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3 pr-1">
        {periods.length === 0 && (
          <div className="dim p-3">
            {PLANET[planet].name} tidak retrograde sepanjang {year}.
          </div>
        )}
        {periods.map((p, k) => (
          <Card key={p.start.time} p={p} index={k} zone={zone} now={now} focus={k === focus} />
        ))}
        <div className="dim text-fs-10 leading-relaxed">
          Dihitung dari posisi tampak geosentris planet pada ekliptika sejati tanggal itu (astronomy-engine: koreksi waktu cahaya dan aberasi), titik stasiun dicari sampai ketelitian menit. Diuji terhadap jadwal resmi retrograde Merkurius 2026 (selisih &lt; 5 menit, &lt; 0,05°). ℞ = mulai retrograde, D = kembali direct. Periode yang mulai di tahun sebelumnya ikut ditampilkan bila masih berjalan di tahun ini.
        </div>
      </div>
    </div>
  );
}
