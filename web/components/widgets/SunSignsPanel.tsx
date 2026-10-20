"use client";

import { useEffect, useMemo, useState } from "react";
import { sunIngresses, type SunIngress } from "../../lib/astro-calendar/retrograde";
import { SIGNS } from "../../lib/astro-calendar/events";
import { useWidgetSetting } from "../../store/terminal";
import { tzOf, zoneLabel, type Zone } from "./RetrogradePanel";

// When the Sun enters each sign of the zodiac in a year, to the minute (its precise apparent
// position: lib/astro-calendar/retrograde.ts), the equinoxes and solstices marked, and the sign
// it is in now lit.

const SIGN_GLYPH = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"].map((g) => `${g}\uFE0E`); // as text, in its colour, not an emoji
/** Fire, earth, air, water: the colours the zodiac tables give them. */
const ELEMENT_COLOR = ["#ff6b5a", "#7ccf5a", "#f0c040", "#5aa8ff"];
const SIGN_ID = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagitarius", "Kaprikornus", "Akuarius", "Pisces"];
const SEASON: Record<NonNullable<SunIngress["season"]>, string> = {
  spring: "Ekuinoks Maret (musim semi utara)",
  summer: "Solstis Juni (musim panas utara)",
  autumn: "Ekuinoks September (musim gugur utara)",
  winter: "Solstis Desember (musim dingin utara)",
};

/** To the nearest minute, as the almanacs give the times (the date with it, at midnight). */
const toMinute = (ms: number) => Math.round(ms / 60_000) * 60_000;
const fmtDay = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: tzOf(zone) });
const fmtClock = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: tzOf(zone) });
const fmtWeekday = (ms: number, zone: Zone) => new Date(toMinute(ms)).toLocaleDateString("id-ID", { weekday: "long", timeZone: tzOf(zone) });

export default function SunSignsPanel() {
  const [zone, setZone] = useWidgetSetting<Zone>("retroZone", "local");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const list = useMemo(() => sunIngresses(year), [year]);
  // The sign the Sun is in now: the last entry before now (in the year shown).
  const current = list.reduce((at, x, k) => (x.time <= now ? k : at), -1);
  const next = list.findIndex((x) => x.time > now);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="amber font-bold text-fs-13">Tanggal masuk Matahari ke tiap zodiak</span>
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
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="rounded-xl border border-[#c8963c66] overflow-hidden" style={{ background: "linear-gradient(100deg, #2e1f13 0%, #22170f 100%)" }}>
          {list.map((x, k) => {
            const isNow = k === current;
            const color = ELEMENT_COLOR[x.sign % 4];
            return (
              <div
                key={x.sign}
                className={`flex items-center gap-4 px-4 py-2.5 border-b border-[#c8963c26] last:border-b-0 ${
                  isNow ? "bg-[#ff9a3c1f] shadow-[inset_3px_0_0_#ff9a3c]" : ""
                }`}
              >
                <div className="w-[230px] shrink-0 text-right">
                  <span className="text-[15px] font-bold text-[#f6ead6]">{fmtDay(x.time, zone)}</span>
                  <span className="text-[13px] text-[#c9b597]">, {fmtClock(x.time, zone)}</span>
                  <div className="text-fs-10 text-[#a8957a]">{fmtWeekday(x.time, zone)}</div>
                </div>
                <div className="w-px self-stretch bg-[#c8963c44]" />
                <span className="text-[24px] w-8 text-center leading-none" style={{ color }} aria-hidden>
                  {SIGN_GLYPH[x.sign]}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[16px] font-bold text-[#f6ead6]">{SIGNS[x.sign]}</span>
                  {SIGN_ID[x.sign] !== SIGNS[x.sign] && <span className="text-fs-11 text-[#a8957a]"> · {SIGN_ID[x.sign]}</span>}
                  {x.season && <span className="ml-2 text-[13px] text-[#c9b597]">({SEASON[x.season]})</span>}
                </div>
                {isNow && <span className="px-2.5 py-0.5 rounded-md text-fs-11 font-semibold bg-[#f0a020] text-[#2a1600] shrink-0">Sekarang</span>}
                {k === next && <span className="px-2.5 py-0.5 rounded-md text-fs-11 font-semibold bg-[#e0352b] text-white shrink-0">Berikutnya · {Math.ceil((x.time - now) / 86_400_000)} hari lagi</span>}
              </div>
            );
          })}
        </div>
        <div className="dim text-fs-10 leading-relaxed mt-2">
          Saat posisi tampak Matahari (geosentris, ekliptika sejati tanggal itu) mencapai 0° tiap tanda zodiak tropis; dihitung dengan astronomy-engine sampai ketelitian detik, zona waktu: {zoneLabel(zone)}. Diuji terhadap tabel 2026 yang dipublikasikan: ke-12 tanggal cocok sampai menit. Ekuinoks dan solstis adalah awal Aries, Cancer, Libra dan Capricorn.
        </div>
      </div>
    </div>
  );
}
