"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { addDays, dayIn, daysOf, rangeOf, step, weekStart, type Period } from "../../lib/econ-range";
import { useWidgetSetting } from "../../store/terminal";

// The news recap: what the server's offline recap (server/src/news/recap.ts) makes of a day's or
// a week's headlines from the news tab, sector by sector. Each headline opens the article, as in
// the news tab.

type Item = { id: string; title: string; link: string; summary: string; publisher: string; category: string; region: string; publishedAt: string; tone: -1 | 0 | 1 };
type Story = { id: string; headline: Item; related: Item[]; publishers: number; tone: number };
type Sector = {
  id: string;
  name: string;
  count: number;
  publishers: number;
  tone: number;
  toneLabel: string;
  positive: number;
  negative: number;
  neutral: number;
  topics: string[];
  conclusion: string;
  stories: Story[];
};
type Recap = { from: string; to: string; kind: "day" | "week"; total: number; publishers: number; summary: string; sectors: Sector[]; archiveSince: string | null };

const TONE_CLASS: Record<string, string> = {
  positif: "up",
  "cenderung positif": "up",
  negatif: "down",
  "cenderung negatif": "down",
  campuran: "amber",
  netral: "dim",
};
const toneDot = (t: number) => (t > 0 ? "up" : t < 0 ? "down" : "dim");
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

function label(p: Period): string {
  const { first, end } = daysOf(p);
  if (p.kind === "day") return utc(first).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const last = addDays(end, -1);
  const a = utc(first).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
  const b = utc(last).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${a} – ${b}`;
}

function NewsLink({ item, kind, extra }: { item: Item; kind: "day" | "week"; extra?: React.ReactNode }) {
  const at = new Date(item.publishedAt).toLocaleString("id-ID", kind === "day" ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex gap-2 items-baseline">
      <span className={`${toneDot(item.tone)} shrink-0 text-fs-10`} title={item.tone > 0 ? "Positif" : item.tone < 0 ? "Negatif" : "Netral"}>
        ●
      </span>
      <span className="min-w-0 flex-1">
        <a href={item.link} target="_blank" rel="noreferrer" title={item.summary || item.title} className="hover:underline">
          {item.title}
        </a>
        <span className="dim text-fs-10">
          {" "}
          · {item.publisher} · {at}
        </span>
        {extra}
      </span>
    </div>
  );
}

function StoryRow({ story, kind }: { story: Story; kind: "day" | "week" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-[3px]">
      <NewsLink
        item={story.headline}
        kind={kind}
        extra={
          story.related.length > 0 && (
            <button className="ml-1 text-fs-10 amber hover:underline" onClick={() => setOpen(!open)} title="Berita yang sama dari sumber lain">
              {open ? "▾" : "▸"} +{story.related.length} sumber lain
            </button>
          )
        }
      />
      {open && (
        <div className="ml-4 mt-[2px] pl-2 border-l border-[var(--border)] flex flex-col gap-[2px]">
          {story.related.map((r) => (
            <NewsLink key={r.id} item={r} kind={kind} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectorCard({ sector, kind, startOpen }: { sector: Sector; kind: "day" | "week"; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [all, setAll] = useState(false);
  const shown = all ? sector.stories : sector.stories.slice(0, 3);
  const pos = (sector.positive / sector.count) * 100;
  const neg = (sector.negative / sector.count) * 100;
  return (
    <div className="border-b border-[var(--border)] px-2 py-1.5">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="dim w-3">{open ? "▾" : "▸"}</span>
        <span className="font-bold text-[var(--text)]">{sector.name}</span>
        <span className="dim text-fs-10">
          {sector.count} berita · {sector.publishers} sumber
        </span>
        <span className={`ml-auto text-fs-10 uppercase ${TONE_CLASS[sector.toneLabel] ?? "dim"}`}>{sector.toneLabel}</span>
        <span className="w-16 h-[5px] flex bg-[var(--panel-2)] shrink-0" title={`${sector.positive} positif · ${sector.neutral} netral · ${sector.negative} negatif`}>
          <span style={{ width: `${pos}%` }} className="bg-[#2ecc8f]" />
          <span className="flex-1" />
          <span style={{ width: `${neg}%` }} className="bg-[#e05555]" />
        </span>
      </button>
      {open && (
        <div className="mt-1 ml-5">
          <p className="leading-relaxed mb-1">{sector.conclusion}</p>
          {sector.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {sector.topics.map((t) => (
                <span key={t} className="text-fs-10 px-1.5 border border-[var(--border)] dim">
                  {t}
                </span>
              ))}
            </div>
          )}
          {shown.map((s) => (
            <StoryRow key={s.id} story={s} kind={kind} />
          ))}
          {sector.stories.length > 3 && (
            <button className="text-fs-10 amber hover:underline mt-[2px]" onClick={() => setAll(!all)}>
              {all ? "Lebih sedikit" : `Tampilkan ${sector.stories.length - 3} berita utama lainnya`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewsRecap() {
  const [kind, setKind] = useWidgetSetting<"day" | "week">("newsRecapKind", "day");
  const today = dayIn(Date.now());
  const [day, setDay] = useState(today);
  const period: Period = { kind, day: kind === "week" ? weekStart(day) : day };
  const { from, to } = rangeOf(period);
  const current = from <= Date.now() && Date.now() < to;

  const { data, error, isFetching } = useQuery({
    queryKey: ["news-recap", kind, from, to],
    queryFn: () => apiGet<Recap>(`/api/news/recap?kind=${kind}&from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`),
    placeholderData: keepPreviousData,
    // The period under way takes in new headlines; the server reads the feeds at most every 5 minutes.
    refetchInterval: current ? 300_000 : false,
  });
  const partial = data?.archiveSince && Date.parse(data.archiveSince) > from;

  return (
    <div className="text-fs-11">
      <div className="flex gap-1 p-1 items-center flex-wrap border-b border-[var(--border)]">
        <button className={`term-btn ${kind === "day" ? "active" : ""}`} onClick={() => setKind("day")}>
          HARIAN
        </button>
        <button className={`term-btn ${kind === "week" ? "active" : ""}`} onClick={() => setKind("week")}>
          MINGGUAN
        </button>
        <span className="w-2" />
        <button className="term-btn !px-2" onClick={() => setDay(step(period, -1).day)} title={kind === "day" ? "Hari sebelumnya" : "Minggu sebelumnya"}>
          ‹
        </button>
        <span className="amber min-w-[150px] text-center">{label(period)}</span>
        <button className="term-btn !px-2" onClick={() => setDay(step(period, 1).day)} disabled={current} title={kind === "day" ? "Hari berikutnya" : "Minggu berikutnya"}>
          ›
        </button>
        {!current && (
          <button className="term-btn" onClick={() => setDay(today)}>
            {kind === "day" ? "HARI INI" : "MINGGU INI"}
          </button>
        )}
        {isFetching && <span className="dim text-fs-10">menyusun recap…</span>}
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {!data && !error && <div className="p-2 dim">Membaca berita dan menyusun recap…</div>}
      {data && (
        <>
          <div className="px-2 py-1.5 leading-relaxed border-b border-[var(--border)]">
            {data.summary}
            {partial && (
              <div className="dim text-fs-10 mt-1">
                Arsip berita baru dimulai {new Date(data.archiveSince!).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, jadi recap
                periode ini belum lengkap. Arsip terisi selama aplikasi terbuka.
              </div>
            )}
            <div className="dim text-fs-9 mt-1">Disusun di komputer ini dari berita tab News, dengan aturan kata kunci (tanpa AI). ● hijau positif · merah negatif.</div>
          </div>
          {data.sectors.map((s) => (
            <SectorCard key={`${data.from}-${s.id}`} sector={s} kind={data.kind} startOpen={s.id !== "other"} />
          ))}
        </>
      )}
    </div>
  );
}
