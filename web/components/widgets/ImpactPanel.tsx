"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { useWidgetSetting } from "../../store/terminal";

// What a big US release does to crypto, forex, stocks, the dollar, oil, gold and yields (server:
// providers/newsimpact.ts), as a reaction framework: scenarios before the release (how each asset
// moved after past prints as hot or as cool), and after it the confirmation watch — the 10-year
// yield and the dollar moving the surprise's way together — with how often moves followed through.

type Band = { p10: number; p50: number; p90: number; n: number };
type Inst = { key: string; label: string; unit: string; hawk: number; group: string };
type Scenario = { name: string; z: number; print: number; first: Record<string, Band>; day: Record<string, Band> };
type Skill = { calls: number; hits: number; ruleHits: number; coverage: number; n: number };
type Live = {
  key: string;
  label: string;
  release: string;
  minutes: number;
  actual: number;
  consensus: number;
  z: number;
  status: "CONFIRMED" | "WAIT" | "INVALID" | "NETRAL";
  moves: Record<string, number | null>;
  next: Record<string, Band>;
};
type Impact = {
  asOf: string;
  instruments: Inst[];
  upcoming: Array<{ key: string; label: string; release: string; consensus: number; unit: string; p10: number; p90: number; scenarios: Scenario[] }>;
  live: Live[];
  skill: Array<{ key: string; first: Skill; day: Skill }>;
  confirmation: Array<{ key: string; confirmed: { n: number; agree: number }; unconfirmed: { n: number; agree: number } }>;
  events: number;
  since30: string | null;
  h30: H30;
};

type Lean = { pUp: number; p10: number; p50: number; p90: number; n: number };
type AssetConclusion = { key: string; label: string; group: string; unit: string; dir: "naik" | "turun" | "datar"; chance: number; lean: Lean; price: number | null; levels: { p10: number; p50: number; p90: number } | null };
type Conclusion = {
  release: string;
  driver: { key: string; label: string; consensus: number; p10: number; p50: number; p90: number };
  others: string[];
  probs: Record<string, number>;
  assets: AssetConclusion[];
  at: string;
  final: boolean;
};
type H30 = {
  next: Conclusion | null;
  recent: Array<Conclusion & { moves: Record<string, number | null>; hits: number; calls: number }>;
  skill: Record<string, { calls: number; hits: number }>;
};

const DIR = { naik: { label: "▲ naik", cls: "up" }, turun: { label: "▼ turun", cls: "down" }, datar: { label: "◆ datar", cls: "dim" } };
const price = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 5 : 3 }));

/** The conclusion 30 minutes before the next release: each asset's lean, range and the prices they mean. */
function H30Card({ h, now }: { h: H30; now: number }) {
  const c = h.next;
  if (!c) return <div className="dim">Belum ada rilis besar berikutnya dengan konsensus.</div>;
  const left = Date.parse(c.release) - now;
  const inWindow = left > 0 && left <= 30 * 60_000;
  const groups = [...new Set(c.assets.map((a) => a.group))];
  const order = ["dingin kuat", "dingin", "sesuai", "panas", "panas kuat"];
  const totalSkill = Object.values(h.skill).reduce((n, s) => ({ calls: n.calls + s.calls, hits: n.hits + s.hits }), { calls: 0, hits: 0 });
  return (
    <div className={`border rounded-sm ${c.final || inWindow ? "border-[#f5a623]" : "border-[var(--border)]"}`}>
      <div className="px-2 py-1 bg-[#141414] flex items-center gap-2 flex-wrap">
        <span className="font-bold text-[var(--text)]">🧭 KESIMPULAN H-30 · {c.driver.label}</span>
        {c.others.length > 0 && <span className="dim">(bersama {c.others.join(", ")})</span>}
        <span className={`text-fs-9 px-1 rounded-sm font-bold ${c.final ? "bg-[#f5a623] text-black" : "border border-[#555] dim"}`}>{c.final ? "FINAL H-30" : "pratinjau"}</span>
        <span className="ml-auto amber tabular-nums">
          {left > 0 ? `${Math.floor(left / 3_600_000)} jam ${Math.floor((left % 3_600_000) / 60_000)} mnt lagi` : "rilis sekarang"}
        </span>
      </div>
      <div className="px-2 py-1 text-fs-10">
        Konsensus {c.driver.consensus} · engine P10–P90 {c.driver.p10}–{c.driver.p90}. Peluang skenario:{" "}
        {order.map((b) => (
          <span key={b} className={SCEN[b]?.cls ?? ""}>
            {" "}
            {SCEN[b]?.label ?? b} {Math.round((c.probs[b] ?? 0) * 100)}%
          </span>
        ))}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Aset</th>
            <th>Arah 30 mnt</th>
            <th>Median</th>
            <th>Harga kini</th>
            <th title="Harga setelah gerak P50 (rentang P10–P90)">Perkiraan harga (P10 – P90)</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={`g-${g}`}>
              <td colSpan={5} className="!text-left dim text-fs-9 !py-0">
                {g.toUpperCase()}
              </td>
            </tr>,
            ...c.assets
              .filter((a) => a.group === g)
              .map((a) => (
                <tr key={a.key} title={`Dari ${a.lean.n} rilis, ditimbang dengan peluang skenario. Gerak P10 ${mv(a.lean.p10, a.unit)} · P90 ${mv(a.lean.p90, a.unit)}`}>
                  <td className="!text-left">{a.label}</td>
                  <td className={DIR[a.dir].cls}>
                    {DIR[a.dir].label} <span className="dim text-fs-9">{Math.round((a.dir === "datar" ? Math.max(a.lean.pUp, 1 - a.lean.pUp) : a.chance) * 100)}%</span>
                  </td>
                  <td className="tabular-nums">{mv(a.lean.p50, a.unit)}</td>
                  <td className="tabular-nums">{price(a.price)}</td>
                  <td className="tabular-nums">
                    {a.levels ? (
                      <>
                        <span className="text-[var(--text)]">{price(a.levels.p50)}</span> <span className="dim">({price(a.levels.p10)} – {price(a.levels.p90)})</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              )),
          ])}
        </tbody>
      </table>
      <div className="px-2 py-1 dim text-fs-10 leading-relaxed">
        Diuji walk-forward pada rilis lalu, kesimpulan arah seperti ini benar {totalSkill.calls ? Math.round((totalSkill.hits / totalSkill.calls) * 100) : "-"}% dari {totalSkill.calls} kali: sebelum rilis, engine jarang berbeda dari konsensus, jadi arah praktis masih 50:50. Pakai sebagai peta risiko (rentang harga per skenario); arah yang lebih bisa diandalkan muncul setelah angka keluar (lihat LIVE di atas, ±65–75%). Kesimpulan dibekukan otomatis 30 menit sebelum rilis.
      </div>
      {h.recent.length > 0 && (
        <div className="px-2 pb-1 text-fs-10">
          <div className="text-[var(--text)] font-bold">H-30 sebelumnya vs hasil 30 menit</div>
          {h.recent.slice(0, 6).map((r) => (
            <div key={r.release} className="tabular-nums">
              {new Date(r.release).toLocaleDateString([], { day: "numeric", month: "short" })} {r.driver.label}: benar arah {r.hits}/{r.calls}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SCEN: Record<string, { label: string; cls: string }> = {
  "dingin kuat": { label: "🕊🕊 dingin kuat", cls: "up" },
  dingin: { label: "🕊 dingin", cls: "up" },
  sesuai: { label: "⚖ sesuai", cls: "dim" },
  panas: { label: "🦅 panas", cls: "down" },
  "panas kuat": { label: "🦅🦅 panas kuat", cls: "down" },
};
const STATUS: Record<Live["status"], { cls: string; text: string }> = {
  CONFIRMED: { cls: "bg-[#ef5350] text-black", text: "Yield 10Y dan DXY bergerak bersama searah kejutan: reaksi terkonfirmasi." },
  WAIT: { cls: "bg-[#f5a623] text-black", text: "Yield 10Y dan DXY belum kompak: tunggu konfirmasi." },
  INVALID: { cls: "bg-[#26a69a] text-black", text: "Yield 10Y dan DXY bergerak berlawanan dengan kejutan: bacaan batal." },
  NETRAL: { cls: "border border-[#555] dim", text: "Kejutan kecil (< 0,5 simpangan): tidak ada bias." },
};

const pctOf = (h: number, n: number) => (n ? `${Math.round((h / n) * 100)}%` : "-");
const mv = (v: number | null | undefined, unit: string, digits = 2) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : ""}${fmt(v, unit === "bp" ? 1 : digits)}${unit === "bp" ? "bp" : "%"}`);

function useNow(step = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(id);
  }, [step]);
  return now;
}

function Cell({ b, unit, hawk, z }: { b: Band | undefined; unit: string; hawk: number; z: number }) {
  if (!b) return <span className="dim">-</span>;
  // Coloured by whether the median goes the textbook way for the scenario.
  const expected = Math.sign(z) * hawk;
  const cls = Math.abs(z) < 0.5 || b.p50 === 0 ? "" : Math.sign(b.p50) === expected ? "text-[var(--text)]" : "amber";
  return (
    <span className={`tabular-nums ${cls}`} title={`P10 ${mv(b.p10, unit)} · P50 ${mv(b.p50, unit)} · P90 ${mv(b.p90, unit)} (dari ${b.n} rilis serupa)`}>
      {mv(b.p50, unit)}
    </span>
  );
}

export default function ImpactPanel() {
  const now = useNow();
  const [span, setSpan] = useWidgetSetting<"first" | "day">("impactSpan", "first");
  const { data, isLoading, error } = useQuery({ queryKey: ["macro-impact"], queryFn: () => apiGet<Impact>("/api/macro/impact"), staleTime: 30_000, refetchInterval: 60_000 });
  if (isLoading) return <div className="dim p-2">Melatih dari ±1.200 rilis sejak 2016…</div>;
  if (error || !data) return <div className="down p-2">Dampak berita gagal dimuat: {(error as Error)?.message}</div>;
  const inst = data.instruments;
  const groups = [...new Set(inst.map((i) => i.group))];

  return (
    <div className="flex flex-col gap-2 p-2 text-fs-11">
      <div className="flex items-center gap-2">
        <span className="font-bold text-[var(--text)]">💥 DAMPAK BERITA KE PASAR</span>
        <span className="ml-auto flex gap-1">
          <button className={`term-btn ${span === "first" ? "active" : ""}`} onClick={() => setSpan("first")} title="0–30 menit setelah rilis">
            30 menit
          </button>
          <button className={`term-btn ${span === "day" ? "active" : ""}`} onClick={() => setSpan("day")} title="Penutupan hari rilis vs sebelumnya">
            harian
          </button>
        </span>
      </div>

      <H30Card h={data.h30} now={now} />

      {data.live.map((l) => (
        <div key={`${l.key}${l.release}`} className="border border-[#f5a623] rounded-sm">
          <div className="px-2 py-1 bg-[#141414] flex items-center gap-2">
            <span className="font-bold text-[var(--text)]">● LIVE {l.label}</span>
            <span className="tabular-nums">
              aktual {l.actual} vs {l.consensus} <span className={l.z >= 0.5 ? "down" : l.z <= -0.5 ? "up" : "dim"}>({l.z > 0 ? "+" : ""}
              {fmt(l.z, 1)}σ)</span>
            </span>
            <span className={`ml-auto text-fs-9 px-1 rounded-sm font-bold ${STATUS[l.status].cls}`}>{l.status}</span>
          </div>
          <div className="px-2 py-1 text-fs-10">{STATUS[l.status].text} · {l.minutes} menit sejak rilis</div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="!text-left">Aset</th>
                <th>Sejak rilis</th>
                <th title="Gerak 30–90 menit setelah rilis serupa di masa lalu (konfirmasi sama)">Lanjutan historis</th>
              </tr>
            </thead>
            <tbody>
              {inst.map((i) => {
                const m = l.moves[i.key];
                const ok = m === null || m === undefined || Math.abs(l.z) < 0.5 || m === 0 ? null : Math.sign(m) === Math.sign(l.z) * i.hawk;
                const n = l.next[i.key];
                return (
                  <tr key={i.key}>
                    <td className="!text-left">{i.label}</td>
                    <td className={`tabular-nums ${ok === null ? "" : ok ? "up" : "down"}`}>{mv(m, i.unit)}</td>
                    <td className="tabular-nums dim">{n ? `${mv(n.p50, i.unit)} (P10 ${mv(n.p10, i.unit)} · P90 ${mv(n.p90, i.unit)}, n=${n.n})` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {data.upcoming.length === 0 && <div className="dim">Tidak ada rilis besar dengan konsensus dalam 7 hari ke depan.</div>}
      {data.upcoming.map((u) => {
        const left = Date.parse(u.release) - now;
        return (
          <div key={u.key} className="border border-[var(--border)] rounded-sm overflow-auto">
            <div className="px-2 py-1 bg-[#141414] flex items-center gap-2">
              <span className="font-bold text-[var(--text)]">{u.label}</span>
              <span className="dim tabular-nums">
                konsensus {u.consensus} · engine P10–P90 {u.p10}–{u.p90}
              </span>
              <span className="ml-auto amber tabular-nums">
                {left > 0 ? `${Math.floor(left / 3_600_000)} jam ${Math.floor((left % 3_600_000) / 60_000)} mnt` : "sekarang"}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="!text-left">Skenario</th>
                  {groups.map((g) => (
                    <th key={g} colSpan={inst.filter((i) => i.group === g).length} className="!text-center">
                      {g}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="!text-left dim">rilis</th>
                  {groups.flatMap((g) =>
                    inst
                      .filter((i) => i.group === g)
                      .map((i) => (
                        <th key={i.key} className="text-fs-9">
                          {i.label}
                        </th>
                      )),
                  )}
                </tr>
              </thead>
              <tbody>
                {u.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td className={`!text-left whitespace-nowrap ${SCEN[s.name]?.cls ?? ""}`}>
                      {SCEN[s.name]?.label ?? s.name} <span className="dim">{s.print}</span>
                    </td>
                    {groups.flatMap((g) =>
                      inst
                        .filter((i) => i.group === g)
                        .map((i) => (
                          <td key={i.key}>
                            <Cell b={(span === "first" ? s.first : s.day)[i.key]} unit={i.unit} hawk={i.hawk} z={s.z} />
                          </td>
                        )),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="border border-[var(--border)] rounded-sm">
        <div className="px-2 py-1 bg-[#141414] font-bold text-[var(--text)]">📋 Kerangka reaksi (cara dari video)</div>
        <div className="px-2 py-1 text-fs-10 leading-relaxed">
          <div>
            <b>1 · Trigger</b>: rilis jauh dari konsensus (≥ 0,5 simpangan kejutan biasanya). Panas = hawkish, dingin = dovish.
          </div>
          <div>
            <b>2 · Konfirmasi</b>: yield 10Y <i>dan</i> DXY bergerak searah kejutan bersamaan (panas: keduanya naik).
          </div>
          <div>
            <b>3 · Entry</b>: setelah konfirmasi, tunggu pantulan gagal (mis. emas gagal naik lagi) sebelum mengikuti arah.
          </div>
          <div>
            <b>4 · Batal</b>: rilis ternyata dingin, atau yield turun, atau aset bertahan di support.
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Lanjutan 30–90 mnt searah kejutan</th>
              {inst.map((i) => (
                <th key={i.key} className="text-fs-9">
                  {i.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["confirmed", "unconfirmed"] as const).map((k) => (
              <tr key={k}>
                <td className="!text-left">{k === "confirmed" ? "terkonfirmasi (10Y + DXY)" : "tidak terkonfirmasi"}</td>
                {data.confirmation.map((c) => (
                  <td key={c.key} className="tabular-nums" title={`${c[k].agree} dari ${c[k].n}`}>
                    {pctOf(c[k].agree, c[k].n)}
                    <span className="dim text-fs-9">/{c[k].n}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-[var(--border)] rounded-sm overflow-auto">
        <div className="px-2 py-1 bg-[#141414] font-bold text-[var(--text)]">🎯 Akurasi arah (uji walk-forward)</div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Aset</th>
              <th title="Median historis vs gerak sebenarnya, 0–30 menit, kejutan ≥ 0,5σ">30 mnt</th>
              <th title="Aturan buku: hawkish → arah biasa aset">aturan</th>
              <th>harian</th>
              <th>aturan</th>
              <th title="Porsi gerak di dalam P10–P90 (ideal 80%)">pita 30 mnt</th>
            </tr>
          </thead>
          <tbody>
            {data.skill.map((s) => {
              const i = inst.find((x) => x.key === s.key)!;
              return (
                <tr key={s.key}>
                  <td className="!text-left">{i.label}</td>
                  <td className="tabular-nums">
                    {pctOf(s.first.hits, s.first.calls)}
                    <span className="dim text-fs-9">/{s.first.calls}</span>
                  </td>
                  <td className="tabular-nums dim">{pctOf(s.first.ruleHits, s.first.calls)}</td>
                  <td className="tabular-nums">
                    {pctOf(s.day.hits, s.day.calls)}
                    <span className="dim text-fs-9">/{s.day.calls}</span>
                  </td>
                  <td className="tabular-nums dim">{pctOf(s.day.ruleHits, s.day.calls)}</td>
                  <td className="tabular-nums">{Math.round(s.first.coverage * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dim text-fs-10 leading-relaxed">
        Dilatih dari {data.events} rilis sejak 2016 (gerak 30 menit tersedia sejak {data.since30 ? new Date(data.since30).toLocaleDateString([], { month: "short", year: "numeric" }) : "-"}; harian sejak 2016). Kejutan dibandingkan dengan kejutan biasa rilis itu (σ robust), lalu tiap skenario memakai gerak aset setelah rilis-rilis serupa, disesuaikan dengan besarnya rilis. Angka = median (arahkan kursor untuk P10–P90 dan jumlah rilis). Putih = searah teori, oranye = berlawanan. Gerak 30 menit pertama cukup konsisten (±65–75% searah); harian dan lanjutan 30–90 menit mendekati 50%. Satu video yang tepat belum membuktikan pola: lihat persentasenya. Bacaan arah, bukan sinyal trading.
      </div>
    </div>
  );
}
