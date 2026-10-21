"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmtPrice, type Quote } from "../../lib/api";
import { newId, useJournal } from "../../lib/journal";
import { CHECKS, emptyPlan, liveState, nodesDone, positionSize, rewardRisk, riskPerUnit, type Plan, type PlanStatus } from "../../lib/plan";
import { useTerminal } from "../../store/terminal";
import { wib } from "./ui";

// Nodes Plan: a thesis turned into an execution blueprint, as six nodes in a row — thesis,
// context and catalysts (with a pre-trade checklist), the trigger, execution (entry, stop,
// targets with their reward-to-risk), risk (position size from the account and the share risked,
// the invalidation), and the review (exit, result in R, lessons). The live price is set against
// the plan. Kept on disk with the Notepad (data/journal/plans.json).

const STATUSES: Array<[PlanStatus, string, string]> = [
  ["ide", "Ide", "#7f93b8"],
  ["menunggu", "Menunggu pemicu", "#f0c040"],
  ["aktif", "Aktif", "#36c26b"],
  ["selesai", "Selesai", "#a0a0a0"],
  ["batal", "Batal", "#ff5d5d"],
];
const NODES = ["Tesis", "Konteks & katalis", "Pemicu", "Eksekusi", "Risiko", "Review"];

const num = (s: string): number | null => {
  const v = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

function NumInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <input
      className="w-full tabular-nums"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(num(e.target.value));
      }}
    />
  );
}

function Node({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch">
      <div className={`flex-1 min-w-0 border rounded-sm p-2 bg-[var(--panel)] ${done ? "border-[#2f5f3f]" : "border-[var(--border)]"}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-fs-9 font-bold ${done ? "bg-[#36c26b] text-black" : "bg-[#222] text-[#aaa]"}`}>{done ? "✓" : n}</span>
          <span className="font-bold text-fs-11 uppercase tracking-wide text-[#a9b8d6]">{title}</span>
        </div>
        <div className="grid gap-1.5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-0.5">
      <span className="text-fs-9 dim">{label}</span>
      {children}
    </label>
  );
}

export default function NodesPlanPage() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setView = useTerminal((s) => s.setView);
  const { list, isLoading, error, upsert, update, remove } = useJournal<Plan>("plans");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlanStatus | "semua">("semua");
  const plan = list.find((p) => p.id === openId) ?? null;

  const quote = useQuery({
    queryKey: ["plan-quote", plan?.symbol],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(plan!.symbol)}`),
    enabled: Boolean(plan?.symbol),
    refetchInterval: 15_000,
  });
  const price = quote.data?.[0]?.price ?? null;

  const set = (patch: Partial<Plan>) => plan && update(plan.id, { ...patch, updatedAt: Date.now() });
  const create = () => {
    const p = emptyPlan(newId(), activeSymbol);
    upsert(p);
    setOpenId(p.id);
  };

  const shown = list.filter((p) => filter === "semua" || p.status === filter).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="h-full flex min-h-0 text-fs-11 portrait:flex-col">
      <aside className="w-[260px] shrink-0 border-r border-[var(--border)] flex flex-col min-h-0 portrait:w-full portrait:max-h-[35%] portrait:border-r-0 portrait:border-b">
        <div className="p-2 flex gap-1 items-center border-b border-[var(--border)]">
          <button className="term-btn active" onClick={create}>
            + Rencana baru
          </button>
          <select className="ml-auto" value={filter} onChange={(e) => setFilter(e.target.value as PlanStatus | "semua")}>
            <option value="semua">Semua</option>
            {STATUSES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && <div className="p-2 dim">Memuat…</div>}
          {error && <div className="p-2 down">Gagal memuat rencana.</div>}
          {!isLoading && shown.length === 0 && <div className="p-3 dim leading-relaxed">Belum ada rencana. Mulai dari tesis: apa yang Anda yakini akan terjadi, dan kenapa.</div>}
          {shown.map((p) => {
            const st = STATUSES.find((s) => s[0] === p.status)!;
            const done = nodesDone(p).filter(Boolean).length;
            return (
              <button key={p.id} onClick={() => setOpenId(p.id)} className={`w-full text-left px-2 py-1.5 border-b border-[#161616] ${p.id === openId ? "bg-[#1a1a1a]" : "hover:bg-[#121212]"}`}>
                <div className="flex gap-2 items-baseline">
                  <b className={p.direction === "long" ? "up" : "down"}>{p.direction === "long" ? "▲" : "▼"}</b>
                  <b>{p.symbol}</b>
                  <span className="text-fs-9 ml-auto" style={{ color: st[2] }}>
                    {st[1]}
                  </span>
                </div>
                <div className="truncate dim text-fs-10">{p.title || p.thesis || "(tanpa judul)"}</div>
                <div className="flex gap-0.5 mt-0.5">
                  {nodesDone(p).map((d, i) => (
                    <span key={i} className={`h-1 flex-1 rounded-sm ${d ? "bg-[#36c26b]" : "bg-[#262626]"}`} />
                  ))}
                  <span className="text-fs-9 dim ml-1">{done}/6</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto p-2">
        {!plan ? (
          <div className="p-4 dim leading-relaxed max-w-[640px]">
            <div className="text-fs-15 text-[var(--text)] font-bold mb-2">Nodes Plan</div>
            Ubah sebuah tesis menjadi rencana eksekusi yang bisa dievaluasi: <b>tesis → konteks & katalis → pemicu → eksekusi → risiko → review</b>. Setiap node yang terisi menyala hijau. Harga live dibandingkan dengan level rencana Anda, dan
            ukuran posisi dihitung dari modal serta persentase risiko. Pilih rencana di kiri atau buat yang baru (dimulai dengan simbol yang sedang aktif: <b>{activeSymbol}</b>).
          </div>
        ) : (
          <PlanEditor
            plan={plan}
            price={price}
            priceMissing={Boolean(quote.error) || (quote.isFetched && price == null)}
            set={set}
            onDelete={() => {
              if (window.confirm("Hapus rencana ini?")) {
                remove(plan.id);
                setOpenId(null);
              }
            }}
            onChart={() => {
              setActiveSymbol(plan.symbol);
              setView("chart");
            }}
          />
        )}
      </main>
    </div>
  );
}

function PlanEditor({ plan, price, priceMissing, set, onDelete, onChart }: { plan: Plan; price: number | null; priceMissing: boolean; set: (p: Partial<Plan>) => void; onDelete: () => void; onChart: () => void }) {
  const done = nodesDone(plan);
  const risk = riskPerUnit(plan);
  const size = positionSize(plan);
  const live = liveState(plan, price);
  const result = rewardRisk(plan, plan.exit);
  const rr1 = rewardRisk(plan, plan.targets[0] ?? null);
  const stopWrongSide = plan.entry != null && plan.stop != null && risk == null;

  return (
    <div key={plan.id} className="grid gap-2">
      {/* Header */}
      <div className="flex flex-wrap gap-2 items-center">
        <input className="w-[110px] font-bold uppercase" value={plan.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} />
        <div className="flex">
          {(["long", "short"] as const).map((d) => (
            <button key={d} className={`term-btn ${plan.direction === d ? "active" : ""}`} onClick={() => set({ direction: d })}>
              {d === "long" ? "▲ Long" : "▼ Short"}
            </button>
          ))}
        </div>
        <input className="flex-1 min-w-[200px]" placeholder="Judul rencana (mis. Emas: breakout setelah CPI)" value={plan.title} onChange={(e) => set({ title: e.target.value })} />
        <select value={plan.status} onChange={(e) => set({ status: e.target.value as PlanStatus })}>
          {STATUSES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select value={plan.timeframe} onChange={(e) => set({ timeframe: e.target.value })}>
          {["Intraday", "Swing (hari–minggu)", "Posisi (minggu–bulan)", "Investasi (bulan+)"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="term-btn" onClick={onChart}>
          Chart ↗
        </button>
        <button className="term-btn hover:!text-[var(--down)]" onClick={onDelete}>
          Hapus
        </button>
      </div>

      {/* Live strip */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1.5 border border-[var(--border)] rounded-sm bg-[var(--panel-2)]">
        <span>
          Harga {plan.symbol}: <b className="tabular-nums">{price == null ? "—" : fmtPrice(price)}</b>
        </span>
        {priceMissing && <span className="amber">Simbol tidak dikenali: tulis seperti di aplikasi, mis. AAPL, BBCA.JK, OANDA:XAUUSD, GC=F, BTC-USD, EURUSD.</span>}
        {live && <span className={live.where === "kena-stop" ? "down" : live.where === "kena-target" ? "up" : live.where === "di-zona-entry" ? "amber" : ""}>{live.text}</span>}
        <span className="dim ml-auto text-fs-9">
          {done.filter(Boolean).length}/6 node · diubah {wib(plan.updatedAt)}
        </span>
      </div>

      {/* The six nodes */}
      <div className="grid gap-2 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
        <Node n={1} title={NODES[0]} done={done[0]}>
          <Field label="Apa yang saya yakini akan terjadi, dan kenapa?">
            <textarea rows={5} value={plan.thesis} onChange={(e) => set({ thesis: e.target.value })} placeholder="Mis. Emas akan menguat karena yield riil turun setelah data inflasi melunak, dan bank sentral terus membeli." />
          </Field>
        </Node>

        <Node n={2} title={NODES[1]} done={done[1]}>
          <Field label="Regime, posisi pasar, katalis/rilis ke depan">
            <textarea rows={3} value={plan.context} onChange={(e) => set({ context: e.target.value })} placeholder="Mis. Regime reflasi, COT emas netral (index 39), CPI Selasa depan." />
          </Field>
          <div className="grid gap-0.5">
            {CHECKS.map(([id, label]) => (
              <label key={id} className="flex gap-1.5 items-center text-fs-10 cursor-pointer">
                <input type="checkbox" checked={Boolean(plan.checks[id])} onChange={(e) => set({ checks: { ...plan.checks, [id]: e.target.checked } })} />
                <span className={plan.checks[id] ? "" : "dim"}>{label}</span>
              </label>
            ))}
          </div>
        </Node>

        <Node n={3} title={NODES[2]} done={done[2]}>
          <Field label="Apa yang harus terjadi sebelum saya masuk?">
            <textarea rows={5} value={plan.trigger} onChange={(e) => set({ trigger: e.target.value })} placeholder="Mis. Penutupan harian di atas 4.150 dengan volume di atas rata-rata, atau retest 4.120 yang bertahan." />
          </Field>
        </Node>

        <Node n={4} title={NODES[3]} done={done[3]}>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Entry">
              <NumInput value={plan.entry} onChange={(v) => set({ entry: v })} />
            </Field>
            <Field label="Stop (invalidasi harga)">
              <NumInput value={plan.stop} onChange={(v) => set({ stop: v })} />
            </Field>
          </div>
          {stopWrongSide && <div className="down text-fs-10">Stop harus {plan.direction === "long" ? "di bawah" : "di atas"} entry untuk posisi {plan.direction}.</div>}
          <div className="grid grid-cols-3 gap-1.5">
            {plan.targets.map((t, i) => {
              const rr = rewardRisk(plan, t);
              return (
                <Field key={i} label={`Target ${i + 1}${rr != null ? ` · ${rr.toFixed(2)}R` : ""}`}>
                  <NumInput
                    value={t}
                    onChange={(v) => {
                      const targets = [...plan.targets];
                      targets[i] = v;
                      set({ targets });
                    }}
                  />
                </Field>
              );
            })}
          </div>
          {rr1 != null && <div className={`text-fs-10 ${rr1 >= 2 ? "up" : rr1 >= 1 ? "amber" : "down"}`}>Target 1 memberi {rr1.toFixed(2)}× risiko{rr1 < 2 ? " — di bawah 2R, peluang menang harus tinggi agar layak." : "."}</div>}
        </Node>

        <Node n={5} title={NODES[4]} done={done[4]}>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Modal akun">
              <NumInput value={plan.account} onChange={(v) => set({ account: v })} />
            </Field>
            <Field label="Risiko per trade (%)">
              <NumInput value={plan.riskPct} onChange={(v) => set({ riskPct: v })} />
            </Field>
          </div>
          {size ? (
            <div className="text-fs-10 grid gap-0.5 bg-[var(--panel-2)] p-1.5 rounded-sm">
              <div>
                Risiko: <b className="down">{size.riskAmount.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</b> bila kena stop
              </div>
              <div>
                Ukuran: <b>{size.units.toLocaleString("id-ID", { maximumFractionDigits: size.units < 10 ? 4 : 0 })}</b> unit (nilai ±{size.notional.toLocaleString("id-ID", { maximumFractionDigits: 0 })})
              </div>
              <div className="dim">Risiko per unit: {risk == null ? "—" : fmtPrice(risk)}</div>
            </div>
          ) : (
            <div className="text-fs-10 dim">Isi entry, stop, modal dan % risiko untuk menghitung ukuran posisi.</div>
          )}
          <Field label="Kapan tesis dinyatakan salah (selain harga stop)?">
            <textarea rows={2} value={plan.invalidation} onChange={(e) => set({ invalidation: e.target.value })} placeholder="Mis. CPI lebih panas dari perkiraan dan yield 10Y tembus 4,8%." />
          </Field>
        </Node>

        <Node n={6} title={NODES[5]} done={done[5]}>
          <Field label={`Harga keluar${result != null ? ` · hasil ${result >= 0 ? "+" : ""}${result.toFixed(2)}R` : ""}`}>
            <NumInput value={plan.exit} onChange={(v) => set({ exit: v })} />
          </Field>
          <Field label="Apa yang berjalan sesuai/tidak sesuai rencana? Pelajaran?">
            <textarea rows={4} value={plan.review} onChange={(e) => set({ review: e.target.value })} placeholder="Nilai proses, bukan hanya hasil: apakah saya mengikuti pemicu, stop dan ukuran yang direncanakan?" />
          </Field>
        </Node>
      </div>
    </div>
  );
}
