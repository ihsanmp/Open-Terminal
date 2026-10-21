"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";
import { usePairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import { ago, Failed, Loading, Pct, Section, wib } from "./ui";

// Geopolitics: which geopolitical themes are loud in the news now against their own usual week,
// whether the tone is escalation or easing, the safe-haven gauges (gold, oil, the dollar, yields,
// stocks, bitcoin, the VIX) and the textbook direction of each theme for each (labelled as
// theory), and the high-impact releases of the week ahead: the event-risk map. Server:
// server/src/providers/geopolitics.ts.

type AssetKey = "gold" | "oil" | "dxy" | "us10y" | "spx" | "btc" | "vix";
type Theme = {
  id: string;
  label: string;
  day: number;
  week: number;
  usualWeek: number;
  heat: number | null;
  escalation: number;
  easing: number;
  tone: "eskalasi" | "meredam" | "campuran" | null;
  usual: Partial<Record<AssetKey, -1 | 0 | 1>>;
  latest: Array<{ title: string; publisher: string; link: string; time: number }>;
};
type Geo = {
  themes: Theme[];
  gauges: Array<{ key: AssetKey; label: string; price: number | null; day: number | null; week: number | null }>;
  havenBid: boolean | null;
  events: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null }>;
  headlines: number;
  archiveDays: number;
  asOf: number;
};

const ASSETS: AssetKey[] = ["gold", "oil", "dxy", "us10y", "spx", "btc", "vix"];
const SHORT: Record<AssetKey, string> = { gold: "Emas", oil: "Minyak", dxy: "Dolar", us10y: "Yield 10Y", spx: "S&P", btc: "BTC", vix: "VIX" };

function heatClass(h: number | null) {
  if (h == null) return "dim";
  return h >= 2 ? "down font-bold" : h >= 1.3 ? "amber" : h <= 0.7 ? "up" : "dim";
}

export default function GeoPage() {
  const poll = usePoll(120_000);
  const [open, setOpen] = useWidgetSetting<string>("geoTheme", "");
  const { data, error, isLoading } = useQuery({ queryKey: ["desk-geo"], queryFn: () => apiGet<Geo>("/api/desk/geopolitics"), refetchInterval: poll });
  const { symbol, ctx } = usePairContext();
  if (isLoading) return <Loading what="peta geopolitik" />;
  if (error || !data) return <Failed error={error} />;
  const active = data.themes.filter((t) => t.week > 0);
  const chosen = data.themes.find((t) => t.id === open) ?? active[0] ?? data.themes[0];
  const now = Date.now();
  const gk = ctx?.geo?.key ?? null;
  const sign = ctx?.geo?.sign ?? 1;
  // The themes that usually move the pair, loudest first, with the direction for the pair itself.
  const moving = gk ? data.themes.map((t) => ({ t, dir: (t.usual[gk] ?? 0) * sign })).filter((x) => x.dir !== 0 && x.t.week > 0) : [];

  return (
    <div className="p-2 grid gap-2 grid-cols-1 xl:grid-cols-12 text-fs-11">
      <div className="xl:col-span-12">
        <PairBanner symbol={symbol} ctx={ctx}>
          {gk ? (
            moving.length ? (
              <>
                tema yang lazim menggerakkannya:{" "}
                {moving.slice(0, 4).map(({ t, dir }, i) => (
                  <span key={t.id}>
                    {i > 0 && ", "}
                    <span className={dir > 0 ? "up" : "down"}>
                      {dir > 0 ? "▲" : "▼"} {t.label}
                    </span>{" "}
                    ({t.week})
                  </span>
                ))}
                {sign < 0 ? " · arah dibalik karena pair bergerak berlawanan dengan dolar" : ""}
              </>
            ) : (
              "tidak ada tema aktif yang lazim menggerakkannya"
            )
          ) : ctx ? (
            "pair ini tidak terpetakan ke aset safe haven"
          ) : null}
        </PairBanner>
      </div>
      <Section title="Pengukur aset safe haven" note="hari ini / minggu ini" className="xl:col-span-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {data.gauges.map((g) => (
            <div key={g.key}>
              <div className="text-fs-9 dim">{g.label}</div>
              <div className="font-bold tabular-nums">{g.price == null ? "—" : g.price.toLocaleString("en-US", { maximumFractionDigits: g.price > 1000 ? 0 : 2 })}</div>
              <div className="text-fs-10 flex gap-2">
                <Pct v={g.day} />
                <Pct v={g.week} digits={1} />
              </div>
            </div>
          ))}
        </div>
        {data.havenBid && <div className="mt-2 down font-bold">⚠ Pola safe haven hari ini: emas dan VIX naik sementara saham turun — pasar sedang mencari perlindungan.</div>}
      </Section>

      <Section title="Tema geopolitik" note={`dari ${data.headlines.toLocaleString("id-ID")} judul berita (arsip ${Math.min(35, data.archiveDays)} hari)`} className="xl:col-span-5">
        <table className="data-table w-full text-fs-10">
          <thead>
            <tr>
              <th>Tema</th>
              <th>24 jam</th>
              <th>7 hari</th>
              <th title="7 hari ini dibanding rata-rata mingguan 4 minggu sebelumnya">vs biasa</th>
              <th title="Perbandingan kata eskalasi vs meredam dalam judul 7 hari">Nada</th>
            </tr>
          </thead>
          <tbody>
            {data.themes.map((t) => (
              <tr key={t.id} onClick={() => setOpen(t.id)} className={`cursor-pointer ${t.id === chosen?.id ? "bg-[#1a1a1a]" : "hover:bg-[#121212]"}`}>
                <td className={t.id === chosen?.id ? "amber" : ""}>{t.label}</td>
                <td className="tabular-nums">{t.day}</td>
                <td className="tabular-nums">{t.week}</td>
                <td className={`tabular-nums ${heatClass(t.heat)}`}>{t.heat == null ? "—" : `${t.heat.toFixed(1)}×`}</td>
                <td className={t.tone === "eskalasi" ? "down" : t.tone === "meredam" ? "up" : t.tone ? "amber" : "dim"}>{t.tone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.archiveDays < 10 && <div className="text-fs-9 amber mt-2">Arsip berita aplikasi baru {data.archiveDays} hari: kolom &quot;vs biasa&quot; terisi setelah arsip mencakup lebih dari 10 hari.</div>}
        <div className="text-fs-9 dim mt-2">Diukur dari banyaknya judul, bukan tingkat bahaya sebenarnya: tema yang tiba-tiba ramai (≥2× biasa) layak dicek dampaknya.</div>
      </Section>

      <Section title={chosen ? `Berita: ${chosen.label}` : "Berita"} note={chosen ? `${chosen.escalation} eskalasi · ${chosen.easing} meredam (7 hari)` : ""} className="xl:col-span-7">
        {chosen && chosen.latest.length ? (
          <div className="grid gap-1.5">
            {chosen.latest.map((h) => (
              <a key={h.link + h.time} href={h.link} target="_blank" rel="noreferrer" className="flex gap-2 hover:bg-[#121212] px-1 rounded-sm">
                <span className="dim text-fs-9 w-[70px] shrink-0 pt-0.5">{ago(h.time, now)}</span>
                <span>
                  {h.title} <span className="dim text-fs-9">· {h.publisher}</span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="dim">Belum ada berita untuk tema ini.</div>
        )}
      </Section>

      <Section title="Peta dampak (teori)" note="arah lazim aset saat tema memanas · baris bawah: gerak nyata hari ini" className="xl:col-span-7">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Tema</th>
                {ASSETS.map((a) => (
                  <th key={a} className={a === gk ? "!text-[var(--amber)]" : ""}>
                    {a === gk ? "● " : ""}
                    {SHORT[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.themes.map((t) => (
                <tr key={t.id} className={t.week > 0 ? "" : "opacity-50"}>
                  <td>{t.label}</td>
                  {ASSETS.map((a) => {
                    const v = t.usual[a];
                    return (
                      <td key={a} className={`${v === 1 ? "up" : v === -1 ? "down" : "dim"} ${a === gk ? "bg-[#2a2210]" : ""}`}>
                        {v === 1 ? "▲" : v === -1 ? "▼" : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-[#333]">
                <td className="font-bold">Hari ini</td>
                {ASSETS.map((a) => (
                  <td key={a}>
                    <Pct v={data.gauges.find((g) => g.key === a)?.day} digits={1} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="text-fs-9 dim mt-2">Arah lazim adalah pola umum (emas & dolar sebagai pelarian, minyak saat pasokan terancam), bukan hasil uji di data aplikasi ini; reaksi nyata bergantung pada seberapa mengejutkan beritanya.</div>
      </Section>

      <Section title="Kalender risiko 7 hari" note="rilis berdampak tinggi" className="xl:col-span-5">
        {data.events.length ? (
          <table className="w-full text-fs-10">
            <tbody>
              {data.events.map((e) => (
                <tr key={e.date + e.title} className="border-b border-[#161616]">
                  <td className="py-0.5 pr-2 dim whitespace-nowrap">{wib(Date.parse(e.date))}</td>
                  <td className="py-0.5 pr-2 font-bold">{e.country}</td>
                  <td className="py-0.5">{e.title}</td>
                  <td className="py-0.5 pl-2 text-right dim whitespace-nowrap">{e.forecast ? `f ${e.forecast}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dim">Tidak ada rilis berdampak tinggi minggu ini.</div>
        )}
      </Section>
    </div>
  );
}
