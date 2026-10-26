"use client";

import { useMemo, useState } from "react";
import { newId, useJournal } from "../../lib/journal";
import type { Plan } from "../../lib/plan";
import { useChartSymbol } from "../../lib/pair";
import { wib } from "./ui";
import { Icon } from "../Icon";

// Notepad: the research journal — notes with a symbol, tags and a link to a trade plan (the
// decision trail: why a trade was taken, what was learned), searched and filtered by tag, started
// from a template (daily journal, company research, trade review, weekly macro). Kept on disk with
// the plans (data/journal/notes.json).

export type Note = { id: string; title: string; body: string; tags: string[]; symbol: string; planId: string | null; pinned: boolean; createdAt: number; updatedAt: number };

const TEMPLATES: Array<[string, string, string[]]> = [
  [
    "Jurnal harian",
    "## Gambaran pasar\n- Regime / risk-on-off:\n- Yang bergerak paling besar:\n\n## Katalis hari ini\n- \n\n## Rencana & eksekusi\n- \n\n## Emosi & disiplin (1–5):\n\n## Pelajaran\n- ",
    ["jurnal"],
  ],
  [
    "Riset saham",
    "## Bisnis\nApa yang dijual, ke siapa, keunggulannya:\n\n## Angka kunci\n- Pertumbuhan pendapatan:\n- Margin:\n- Valuasi (P/E, EV/EBITDA) vs peers:\n\n## Katalis\n- \n\n## Risiko\n- \n\n## Kesimpulan & harga wajar\n",
    ["riset"],
  ],
  ["Review trade", "## Rencana awal\n(tautkan rencana di bawah)\n\n## Yang terjadi\n\n## Sesuai rencana?\n- Pemicu:\n- Stop:\n- Ukuran:\n\n## Hasil (R)\n\n## Pelajaran\n- ", ["review"]],
  ["Makro mingguan", "## Data minggu ini vs ekspektasi\n- \n\n## Bank sentral\n- \n\n## Regime & perubahan bias\n- \n\n## Minggu depan\n- ", ["makro"]],
];

const tagsOf = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean);

export default function NotepadPage() {
  const activeSymbol = useChartSymbol();
  const [scope, setScope] = useState<"pair" | "all">("pair");
  const { list, isLoading, error, upsert, update, remove } = useJournal<Note>("notes");
  const plans = useJournal<Plan>("plans").list;
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const note = list.find((n) => n.id === openId) ?? null;

  const allTags = useMemo(() => [...new Set(list.flatMap((n) => n.tags))].sort(), [list]);
  const forPair = list.filter((n) => n.symbol.toUpperCase() === activeSymbol.toUpperCase());
  const shown = (scope === "pair" ? forPair : list)
    .filter((n) => (!tag || n.tags.includes(tag)) && (!q || `${n.title} ${n.body} ${n.symbol}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

  const create = (title = "", body = "", tags: string[] = []) => {
    const now = Date.now();
    const n: Note = { id: newId(), title, body, tags, symbol: activeSymbol, planId: null, pinned: false, createdAt: now, updatedAt: now };
    upsert(n);
    setOpenId(n.id);
  };
  const set = (patch: Partial<Note>) => note && update(note.id, { ...patch, updatedAt: Date.now() });

  return (
    <div className="h-full flex min-h-0 text-fs-11 portrait:flex-col">
      <aside className="w-[280px] shrink-0 border-r border-[var(--border)] flex flex-col min-h-0 portrait:w-full portrait:max-h-[35%] portrait:border-r-0 portrait:border-b">
        <div className="p-2 grid gap-1.5 border-b border-[var(--border)]">
          <div className="flex gap-1">
            <button className="term-btn active" onClick={() => create()}>
              + Catatan
            </button>
            <select
              className="flex-1"
              value=""
              onChange={(e) => {
                const t = TEMPLATES.find((x) => x[0] === e.target.value);
                if (t) create(`${t[0]} — ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`, t[1], t[2]);
              }}
            >
              <option value="">+ dari template…</option>
              {TEMPLATES.map(([name]) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1 text-fs-10">
            <button className={`term-btn ${scope === "pair" ? "active" : ""}`} onClick={() => setScope("pair")} title="Pair yang terbuka di Charting">
              {activeSymbol} ({forPair.length})
            </button>
            <button className={`term-btn ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>
              Semua ({list.length})
            </button>
          </div>
          <input placeholder="Cari catatan…" value={q} onChange={(e) => setQ(e.target.value)} />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((t) => (
                <button key={t} onClick={() => setTag(tag === t ? null : t)} className={`text-fs-9 px-1.5 rounded-sm border ${tag === t ? "border-[var(--amber)] text-[var(--amber)]" : "border-[#333] dim"}`}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && <div className="p-2 dim">Memuat…</div>}
          {error && <div className="p-2 down">Gagal memuat catatan.</div>}
          {!isLoading && shown.length === 0 && <div className="p-3 dim">{list.length ? "Tidak ada catatan yang cocok." : "Belum ada catatan."}</div>}
          {shown.map((n) => (
            <button key={n.id} onClick={() => setOpenId(n.id)} className={`w-full text-left px-2 py-1.5 border-b border-[#161616] ${n.id === openId ? "bg-[#1a1a1a]" : "hover:bg-[#121212]"}`}>
              <div className="flex gap-1.5 items-baseline">
                {n.pinned && <Icon name="star" filled className="amber" />}
                <b className="truncate flex-1">{n.title || "(tanpa judul)"}</b>
                <span className="text-fs-9 dim">{n.symbol}</span>
              </div>
              <div className="text-fs-10 dim truncate">{n.body.replace(/[#\n]+/g, " ").trim() || "—"}</div>
              <div className="text-fs-9 dim">{wib(n.updatedAt)}</div>
            </button>
          ))}
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col min-h-0 p-2 gap-1.5">
        {!note ? (
          <div className="p-4 dim leading-relaxed max-w-[640px]">
            <div className="text-fs-15 text-[var(--text)] font-bold mb-2">Notepad</div>
            Jurnal riset dan jejak keputusan: tulis alasan sebelum masuk, tautkan ke rencana di Nodes Plan, lalu tinjau setelah keluar. Catatan tersimpan di disk aplikasi (data/journal), aman walau penyimpanan browser dibersihkan.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input className="flex-1 min-w-[200px] font-bold" placeholder="Judul" value={note.title} onChange={(e) => set({ title: e.target.value })} />
              <input className="w-[110px] uppercase" placeholder="Simbol" value={note.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} />
              <button className={`term-btn ${note.pinned ? "active" : ""}`} onClick={() => set({ pinned: !note.pinned })} title="Sematkan di atas">
                <Icon name="star" filled={note.pinned} />
              </button>
              <button
                className="term-btn hover:!text-[var(--down)]"
                onClick={() => {
                  if (window.confirm("Hapus catatan ini?")) {
                    remove(note.id);
                    setOpenId(null);
                  }
                }}
              >
                Hapus
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <TagInput key={note.id} tags={note.tags} onChange={(tags) => set({ tags })} />
              <select value={note.planId ?? ""} onChange={(e) => set({ planId: e.target.value || null })} title="Tautkan ke rencana trade">
                <option value="">— tautkan ke rencana —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.direction === "long" ? "▲" : "▼"} {p.symbol} · {p.title || p.thesis.slice(0, 40) || "(tanpa judul)"}
                  </option>
                ))}
              </select>
            </div>
            <textarea className="flex-1 min-h-[200px] font-mono leading-relaxed" value={note.body} onChange={(e) => set({ body: e.target.value })} placeholder="Tulis di sini…" />
            <div className="text-fs-9 dim">
              Dibuat {wib(note.createdAt)} · diubah {wib(note.updatedAt)} · {note.body.trim() ? note.body.trim().split(/\s+/).length : 0} kata
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState(tags.join(", "));
  return <input className="flex-1 min-w-[160px]" placeholder="tag, dipisah koma (mis. emas, makro)" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(tagsOf(text))} />;
}
