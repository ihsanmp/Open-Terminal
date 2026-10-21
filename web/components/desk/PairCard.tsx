"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { KIND_LABEL, useChartSymbol, type PairContext } from "../../lib/pair";
import { useTerminal, type View } from "../../store/terminal";
import { ago, Pct, Section, signed, wib } from "./ui";

// The Dashboard's first card: the pair open on the chart through every tool — its regime record,
// futures curve, positioning, quant forecast, the releases for its currencies, the Watcher Guru
// lines that name it, the geopolitical themes that usually move it, the ETFs that hold it.

type Stat = { n: number; mean: number; hit: number; t: number } | null;
type Brief = {
  context: PairContext;
  quote: { price: number | null; day: number | null; week: number | null; month: number | null } | null;
  regime: { quadrant: string; label: string; row: { label: string; aboveSma10: boolean | null; byRegime: Record<string, Stat>; all: Stat; textbook: -1 | 0 | 1; measured: string } | null } | null;
  curve: { label: string; kind: "price" | "rate"; shape: string | null; spread: number | null; annualCarry: number | null; moves25: number | null; points: Array<{ label: string; value: number }> } | null;
  cot: { label: string; names: { spec: string }; latest: { spec: number } | null; specChange: number | null; specPctOi: number | null; cotIndex: number | null; crowding: string | null } | null;
  quant: { label: string; unit: string; horizons: Record<string, { pUp: number; baseRate: number; verdict: string; band: { p10: number; p50: number; p90: number }; proven: boolean }> } | null;
  events: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null }>;
  flashes: Array<{ id: number; text: string; time: number; url: string }>;
  geo: Array<{ id: string; label: string; week: number; heat: number | null; tone: string | null; direction: -1 | 0 | 1 }>;
  etfs: Array<{ symbol: string; label: string; day: number | null; month: number | null; relVolume: number | null; rotation: string | null }>;
};

const kfmt = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}rb` : v.toFixed(0)}`);

function Block({ title, to, children }: { title: string; to?: View; children: React.ReactNode }) {
  const setView = useTerminal((s) => s.setView);
  return (
    <div className="border border-[#1f1f1f] rounded-sm p-2 min-w-0">
      <div className="flex items-baseline mb-1">
        <span className="text-fs-9 font-bold uppercase tracking-wide text-[#7f93b8]">{title}</span>
        {to && (
          <button className="ml-auto text-fs-9 dim hover:text-[var(--amber)]" onClick={() => setView(to)}>
            buka →
          </button>
        )}
      </div>
      <div className="text-fs-10 grid gap-0.5">{children}</div>
    </div>
  );
}

export default function PairCard() {
  const symbol = useChartSymbol();
  const poll = usePoll(60_000);
  const { data, isLoading, error } = useQuery({ queryKey: ["pair-brief", symbol], queryFn: () => apiGet<Brief>(`/api/desk/pair/brief?symbol=${encodeURIComponent(symbol)}`), refetchInterval: poll });
  if (isLoading || !data)
    return (
      <Section title="Pair aktif" note={symbol} className="xl:col-span-12">
        <div className="dim">{error ? `Gagal memuat ringkasan ${symbol}.` : `Mengumpulkan semua alat untuk ${symbol}…`}</div>
      </Section>
    );
  const c = data.context;
  const r = data.regime;
  const row = r?.row;
  const cur = row && r ? row.byRegime[r.quadrant] : null;
  const q10 = data.quant?.horizons["10"];

  return (
    <Section
      title={`Pair aktif · ${symbol}`}
      note={`${c.label} · ${KIND_LABEL[c.kind]}${c.sector ? ` · ${c.sector}` : ""} — ganti pair di Charting, semua alat ikut`}
      className="xl:col-span-12"
      right={
        data.quote && (
          <span className="flex gap-2 items-baseline text-fs-11">
            <b className="tabular-nums">{data.quote.price?.toLocaleString("en-US", { maximumFractionDigits: (data.quote.price ?? 0) < 10 ? 5 : 2 }) ?? "—"}</b>
            <Pct v={data.quote.day} />
            <Pct v={data.quote.week} digits={1} />
            <Pct v={data.quote.month} digits={1} />
          </span>
        )
      }
    >
      <div className="grid gap-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <Block title={`Regime${c.regimeProxy && row ? ` (lewat ${row.label})` : ""}`} to="regime">
          {r && row ? (
            <>
              <div>
                {r.label}: rata-rata <b className={(cur?.mean ?? 0) >= 0 ? "up" : "down"}>{cur ? signed(cur.mean, 2) : "—"}</b>/bln{cur ? `, naik ${cur.hit.toFixed(0)}% dari ${cur.n} bln` : ""}
              </div>
              <div className="dim">
                Biasanya {row.all ? signed(row.all.mean, 2) : "—"}/bln · teori {row.textbook > 0 ? "▲ mendukung" : row.textbook < 0 ? "▼ menekan" : "netral"} · {row.measured === "positive" ? "terukur unggul" : row.measured === "negative" ? "terukur tertinggal" : "beda tidak nyata"}
              </div>
              <div>Tren 10 bln: {row.aboveSma10 == null ? "—" : row.aboveSma10 ? <span className="up">naik</span> : <span className="down">turun</span>}</div>
            </>
          ) : (
            <div className="dim">Tidak ada padanan di tabel regime.</div>
          )}
        </Block>

        <Block title={`Futures${data.curve ? ` · ${data.curve.label}` : ""}`} to="futures">
          {data.curve ? (
            data.curve.kind === "rate" ? (
              <div>
                Jalur suku bunga: {data.curve.points[0]?.value.toFixed(2)}% → {data.curve.points.at(-1)?.value.toFixed(2)}% ({data.curve.moves25 != null ? `${data.curve.moves25 > 0 ? "+" : ""}${data.curve.moves25}× 25 bp` : "—"})
              </div>
            ) : (
              <>
                <div>
                  <b className={data.curve.shape === "backwardation" ? "down" : data.curve.shape === "contango" ? "up" : ""}>{data.curve.shape ?? "—"}</b> · ujung kurva {signed(data.curve.spread, 1)}
                </div>
                <div className="dim">Carry ±{signed(data.curve.annualCarry, 1)} per tahun</div>
              </>
            )
          ) : (
            <div className="dim">Tidak ada kurva futures untuk pair ini.</div>
          )}
        </Block>

        <Block title={`Posisi COT${data.cot ? ` · ${data.cot.label}` : ""}`} to="cot">
          {data.cot ? (
            <>
              <div>
                {data.cot.names.spec}: <b className={(data.cot.latest?.spec ?? 0) >= 0 ? "up" : "down"}>{kfmt(data.cot.latest?.spec)}</b> kontrak ({kfmt(data.cot.specChange)} seminggu)
              </div>
              <div>
                COT index <b>{data.cot.cotIndex ?? "—"}</b>
                {data.cot.crowding && <span className={data.cot.crowding === "crowded-long" ? "up" : "down"}> · {data.cot.crowding === "crowded-long" ? "long penuh" : "short penuh"}</span>}
              </div>
            </>
          ) : (
            <div className="dim">Tidak dilaporkan CFTC.</div>
          )}
        </Block>

        <Block title={`Quant${data.quant ? ` · ${data.quant.label}` : ""}`} to="quant">
          {data.quant && q10 ? (
            <>
              <div>
                Peluang naik 5/10/20 hari:{" "}
                <b>
                  {["5", "10", "20"].map((h) => `${Math.round((data.quant!.horizons[h]?.pUp ?? 0) * 100)}%`).join(" / ")}
                </b>{" "}
                <span className="dim">(biasanya {Math.round(q10.baseRate * 100)}%)</span>
              </div>
              <div className="dim">
                Rentang 10 hari {q10.band.p10.toFixed(1)}…{q10.band.p90.toFixed(1)}
                {data.quant.unit === "bp" ? " bp" : "%"} · {q10.proven ? `sinyal teruji: ${q10.verdict}` : "model belum terbukti untuk aset ini"}
              </div>
            </>
          ) : (
            <div className="dim">{c.quantKey ? "Model sedang dihitung atau belum tersedia." : "Tidak dicakup model quant."}</div>
          )}
        </Block>

        <Block title={`Kalender ${c.currencies.join("/")} · 7 hari`} to="calendar">
          {data.events.length ? (
            data.events.slice(0, 6).map((e) => (
              <div key={e.date + e.title} className="flex gap-1.5">
                <span className="dim whitespace-nowrap">{wib(Date.parse(e.date))}</span>
                <span className={e.impact === "High" ? "font-bold" : ""}>
                  {e.country} {e.title}
                </span>
              </div>
            ))
          ) : (
            <div className="dim">Tidak ada rilis penting untuk {c.currencies.join("/")} dalam 7 hari.</div>
          )}
        </Block>

        <Block title="Watcher Guru menyebutnya" to="watcher">
          {data.flashes.length ? (
            data.flashes.slice(0, 4).map((f) => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="hover:text-[var(--amber)] line-clamp-2">
                <span className="dim">{ago(f.time)} · </span>
                {f.text}
              </a>
            ))
          ) : (
            <div className="dim">Belum ada kilat terbaru yang menyebut {c.label}.</div>
          )}
        </Block>

        <Block title="Geopolitik yang biasa menggerakkannya" to="geo">
          {data.geo.length ? (
            data.geo.map((g) => (
              <div key={g.id} className="flex gap-1.5">
                <span className={g.direction > 0 ? "up" : "down"}>{g.direction > 0 ? "▲" : "▼"}</span>
                <span className="flex-1">{g.label}</span>
                <span className="dim">{g.week} berita</span>
                {g.tone && <span className={g.tone === "eskalasi" ? "down" : g.tone === "meredam" ? "up" : "amber"}>{g.tone}</span>}
              </div>
            ))
          ) : (
            <div className="dim">{c.geo ? "Tidak ada tema geopolitik aktif yang lazim menggerakkannya." : "Tidak terpetakan ke aset safe haven."}</div>
          )}
          {data.geo.length > 0 && <div className="dim text-fs-9">▲/▼ = arah lazim (teori) bila tema memanas</div>}
        </Block>

        <Block title="ETF terkait" to="etf">
          {data.etfs.length ? (
            data.etfs.map((e) => (
              <div key={e.symbol} className="flex gap-2">
                <b>{e.symbol}</b>
                <span className="dim flex-1 truncate">{e.label}</span>
                <Pct v={e.day} />
                <Pct v={e.month} digits={1} />
                <span className={(e.relVolume ?? 0) >= 1.5 ? "amber" : "dim"}>RV {e.relVolume?.toFixed(1) ?? "—"}</span>
              </div>
            ))
          ) : (
            <div className="dim">Tidak ada ETF yang dipetakan.</div>
          )}
        </Block>
      </div>
    </Section>
  );
}
