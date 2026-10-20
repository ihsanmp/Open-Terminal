"use client";

import { useState } from "react";
import { EVENT_LABEL, pct, QUANT_HORIZONS, SEASON_LABEL, signedPts, useQuantForecast, type AssetForecast, type HorizonForecast, type QuantHorizon } from "../../lib/quant";
import { useTerminal, useWidgetSetting } from "../../store/terminal";

// The Live TV's Prakiraan tab: every market's chance of a rise over the next 5, 10 or 20 trading
// days from the shared quant forecaster (the Astro Calendar reads the same), its tested record, what
// the US data and the season add to it, and its range, widened for the big US days within the span.

const GROUP_LABEL = { market: "pasar", macro: "data makro", astro: "musim" } as const;
const fmtDay = (d: number) => new Date(d * 86_400_000).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtShort = (d: number) => new Date(d * 86_400_000).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });

/** The span's big US days, "FOMC 28 Okt, FOMC 29 Okt, NFP 6 Nov". */
const eventList = (f: HorizonForecast) => (f.events ?? []).map((e) => `${e.kinds.map((k) => EVENT_LABEL[k]).join("+")} ${fmtShort(e.day)}`).join(", ");

function Band({ a, h }: { a: AssetForecast; h: QuantHorizon }) {
  const x = a.horizons[h];
  const b = x.band;
  const u = a.unit === "bp" ? " bp" : "%";
  const f = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(a.unit === "bp" ? 0 : 1)}${u}`;
  const factor = b.factor ?? 1;
  const shown = Math.abs(factor - 1) >= 0.03;
  const why = [eventList(x) && `jadwal: ${eventList(x)}`, a.key === "btc" && "BTC lebih liar di musim dingin"].filter(Boolean).join("; ");
  const title = `Gerak ${h} hari bursa: 10% kemungkinan di bawah ${f(b.p10)}, 10% di atas ${f(b.p90)}. Dari gerak 3 tahun terakhir${
    shown ? `, ×${factor.toFixed(2)} karena isi jadwalnya dibanding biasanya` : ""
  }${why ? ` (${why})` : ""}.`;
  return (
    <span className="dim whitespace-nowrap" title={title}>
      {f(b.p10)} … {f(b.p90)}
      {shown && <span className={`block text-fs-9 ${factor > 1 ? "amber" : ""}`}>×{factor.toFixed(2)}</span>}
    </span>
  );
}

function Detail({ a, h }: { a: AssetForecast; h: QuantHorizon }) {
  const f = a.horizons[h];
  const s = f.score;
  const seasonAdds = s.acc - f.without.astro.acc;
  const macroAdds = s.acc - f.without.macro.acc;
  return (
    <div className="px-2 pb-2 pt-1 text-fs-10 space-y-1 bg-[#101010]">
      <div>
        <span className="dim">Uji walk-forward 2016–sekarang ({s.n.toLocaleString("id-ID")} hari): </span>
        arah benar <b>{pct(s.acc)}</b> vs tebakan sederhana {pct(s.baseAcc)} <span className="dim">(z {s.z.toFixed(2)}, skor probabilitas {s.bss >= 0 ? "+" : ""}{(s.bss * 100).toFixed(1)}%)</span>
        {s.proven ? <span className="up"> · sinyal teruji</span> : <span className="amber"> · belum terbukti lebih baik</span>}
      </div>
      <div>
        <span className="dim">Sumbangan fitur (akurasi dengan vs tanpa): </span>
        data makro <b className={macroAdds >= 0 ? "up" : "down"}>{signedPts(macroAdds)}</b>, musim <b className={seasonAdds >= 0 ? "up" : "down"}>{signedPts(seasonAdds)}</b>
        <span className="dim"> (selisih di bawah ±2 poin masih dalam batas kebetulan)</span>
      </div>
      <div>
        <span className="dim">Pendorong terkuat sekarang: </span>
        {/* A pull under 0.02 in log-odds moves the chance by half a point: the model is at the market's usual. */}
        {f.drivers.every((d) => Math.abs(d.pull) < 0.02) && <span className="dim">tidak ada yang berarti: model kembali ke kebiasaan pasarnya</span>}
        {f.drivers.filter((d) => Math.abs(d.pull) >= 0.02).map((d, i) => (
          <span key={d.name}>
            {i > 0 && ", "}
            {d.name} <span className="dim">({GROUP_LABEL[d.group]})</span> <span className={d.pull >= 0 ? "up" : "down"}>{d.pull >= 0 ? "↑" : "↓"}</span>
          </span>
        ))}
      </div>
      {!!f.events?.length && (
        <div>
          <span className="dim">Jadwal besar dalam {h} hari bursa: </span>
          {eventList(f)}
        </div>
      )}
    </div>
  );
}

export default function QuantPanel() {
  const { data, error, isLoading } = useQuantForecast();
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [h, setH] = useWidgetSetting<QuantHorizon>("quantHorizon", 10);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <div className="p-2 dim">Menghitung model quant (pertama kali ±1 menit)…</div>;
  if (error || !data) return <div className="p-2 down">Prakiraan gagal dimuat: {(error as Error)?.message}</div>;
  const proven = data.assets.filter((a) => a.horizons[h].score.proven);
  // The big US days ahead, as a market trading on weekdays has them (the dollar's).
  const ref = data.assets.find((a) => a.key === "dxy") ?? data.assets[0];
  const ahead = ref ? eventList(ref.horizons[h]) : "";

  return (
    <div className="p-2 space-y-2 text-fs-11">
      <div className="flex items-center gap-1">
        <span className="dim">Peluang naik dalam</span>
        {QUANT_HORIZONS.map((x) => (
          <button key={x} className={`term-btn ${h === x ? "active" : ""}`} onClick={() => setH(x)}>
            {x} hari
          </button>
        ))}
        <span className="dim ml-auto text-fs-10">per {fmtDay(data.asOfDay)}</span>
      </div>
      <div className={`text-fs-10 ${proven.length ? "up" : "amber"}`}>
        {proven.length
          ? `Sinyal teruji untuk ${h} hari: ${proven.map((a) => a.label).join(", ")}.`
          : `Belum ada aset dengan sinyal teruji untuk ${h} hari: peluang di bawah ini mendekati kebiasaan pasarnya, jadi tidak diberi Bullish/Bearish.`}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Aset</th>
            <th>Naik</th>
            <th className="!text-left">Rentang wajar</th>
            <th className="!text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.assets.map((a) => {
            const f = a.horizons[h];
            const lean = f.pUp - f.baseRate;
            return [
              <tr key={a.key} onClick={() => setOpen(open === a.key ? null : a.key)} className="cursor-pointer" title="Klik untuk rincian">
                <td className="!text-left !whitespace-normal">
                  <button
                    className="hover:underline text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveSymbol(a.symbol);
                    }}
                    title={`Buka ${a.label} di chart`}
                  >
                    {a.label}
                  </button>
                </td>
                <td title={`Biasanya naik ${pct(f.baseRate)} dari periode ${h} hari`}>
                  <b className={f.score.proven ? (lean >= 0.03 ? "up" : lean <= -0.03 ? "down" : "") : ""}>{pct(f.pUp)}</b> <span className="dim text-fs-9">({pct(f.baseRate)})</span>
                </td>
                <td className="!text-left">
                  <Band a={a} h={h} />
                </td>
                <td className="!text-left !whitespace-normal">
                  {f.verdict !== "Netral" ? <b className={f.verdict === "Bullish" ? "up" : "down"}>{f.verdict}</b> : f.score.proven ? <span>Netral</span> : <span className="dim">tanpa sinyal</span>}
                </td>
              </tr>,
              open === a.key && (
                <tr key={`${a.key}-detail`}>
                  <td colSpan={4} className="!p-0 !text-left !whitespace-normal">
                    <Detail a={a} h={h} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      <div className="text-fs-10">
        <span className="dim">Jadwal besar dalam {h} hari bursa ke depan: </span>
        {ahead || "tidak ada CPI, NFP, ISM atau FOMC"}
        {data.season && <span className="dim"> · musim {SEASON_LABEL[data.season]}</span>}
      </div>
      <div className="dim text-fs-10">
        Model gradient-boosted trees (gaya XGBoost, kedalaman 3; di uji walk-forward lebih dekat ke kenyataan daripada regresi logistik sebelumnya, tapi belum mengalahkan tebakan sederhana) per aset dan horizon, dari momentum, tren, volatilitas, aset lain (DXY, yield, kurva, VIX, saham, minyak, emas, BTC), surprise
        data AS per jenis rilis (inflasi/CPI, dibaca terpisah sejak 2021; tenaga kerja; ISM; lainnya) dan musim (posisi Matahari). Fase bulan, gerhana, retrograde
        dan aspek tidak dipakai lagi: riset 2005–2026 tidak menemukan pengaruhnya. Diuji walk-forward per tahun: tiap tahun diprakirakan dengan model yang hanya
        belajar dari tahun-tahun sebelumnya. Bullish/Bearish hanya muncul bila hasil uji mengalahkan tebakan sederhana secara signifikan. Angka dalam kurung =
        seberapa sering aset itu biasanya naik. Rentang wajar = gerak 10%–90% dalam 3 tahun terakhir, dilebarkan bila horizonnya memuat lebih banyak hari CPI,
        NFP, ISM atau FOMC daripada biasanya (pengali volatilitas per aset dari riset; BTC juga lebih liar di musim dingin), ditandai ×angka di sampingnya. Astro
        Calendar membaca prakiraan yang sama.
      </div>
    </div>
  );
}
