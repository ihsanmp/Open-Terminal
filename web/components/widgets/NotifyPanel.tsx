"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";

// THE FED's 🔔 tab: the Windows notifications the server raises (server/src/notify/notifier.ts),
// each kind turned on or off, a test, and the last ones sent.

type Kind = "fed" | "early" | "h30" | "result" | "reaction";
type Sent = { at: number; kind: Kind | "test"; title: string; lines: string[]; shown: boolean };
type Reply = { supported: boolean; settings: Record<Kind, boolean>; recent: Sent[] };

const KINDS: Array<{ kind: Kind; label: string; hint: string }> = [
  { kind: "fed", label: "Siaran The Fed live", hint: "Saat channel The Fed (Board dan Fed regional) mulai siaran live" },
  { kind: "early", label: "Pengingat rilis besar (±3 jam sebelum)", hint: "Sekitar tiga jam sebelum rilis besar AS: apa yang rilis, konsensusnya, dan skenario 30 menit pertama (emas, BTC, S&P) kalau datanya jauh lebih panas atau dingin, dengan seberapa sering arahnya benar" },
  { kind: "h30", label: "H-30 rilis data", hint: "30 menit sebelum CPI, PPI, NFP, PCE, retail sales, GDP, klaim, ISM dan keputusan suku bunga: konsensus, pita model dan bias H-30" },
  { kind: "result", label: "Hasil rilis", hint: "Begitu angka aktual keluar: dibanding konsensus, hawkish atau dovish" },
  { kind: "reaction", label: "Reaksi 5 menit", hint: "Gerak emas, BTC, S&P futures, DXY dan yield 2Y lima menit setelah rilis, dan berapa yang searah kejutannya" },
];

const KIND_LABEL: Record<Sent["kind"], string> = { fed: "FED", early: "PENGINGAT", h30: "H-30", result: "HASIL", reaction: "REAKSI", test: "TES" };

export default function NotifyPanel() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["notify"], queryFn: () => apiGet<Reply>("/api/notify"), refetchInterval: 30_000 });
  const save = useMutation({
    mutationFn: (patch: Partial<Record<Kind, boolean>>) => apiPost<{ settings: Reply["settings"] }>("/api/notify/settings", patch),
    onSuccess: (r) => qc.setQueryData<Reply>(["notify"], (d) => (d ? { ...d, settings: r.settings } : d)),
  });
  const test = useMutation({
    mutationFn: () => apiPost<Sent>("/api/notify/test", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notify"] }),
  });

  if (error) return <div className="p-2 down text-fs-11">Pengaturan notifikasi gagal dimuat: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim text-fs-11">Memuat…</div>;

  return (
    <div className="p-2 space-y-2 text-fs-11">
      <div className="dim text-fs-10">
        Notifikasi Windows dari server: tetap muncul walau tab ini tidak dibuka, selama aplikasi berjalan. Tiap momen diberi tahu sekali.
      </div>
      {!data.supported && <div className="amber text-fs-10">Notifikasi hanya tampil di Windows; di sistem ini hanya dicatat di bawah.</div>}
      <div className="space-y-1">
        {KINDS.map((k) => (
          <label key={k.kind} className="flex items-start gap-2 cursor-pointer" title={k.hint}>
            <input type="checkbox" className="mt-0.5" checked={data.settings[k.kind]} disabled={save.isPending} onChange={(e) => save.mutate({ [k.kind]: e.target.checked })} />
            <span>
              {k.label}
              <span className="block dim text-fs-10">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button className="term-btn" onClick={() => test.mutate()} disabled={test.isPending}>
          Kirim notifikasi tes
        </button>
        {test.data && <span className={test.data.shown ? "up text-fs-10" : "down text-fs-10"}>{test.data.shown ? "terkirim ke Windows" : "tidak bisa ditampilkan"}</span>}
        {test.error && <span className="down text-fs-10">{(test.error as Error).message}</span>}
      </div>
      <div className="dim text-fs-10">
        Tidak muncul? Cek Settings Windows → System → Notifications: OpenTerminal (atau Windows PowerShell bila aplikasi dijalankan tanpa installer) harus On, dan
        Do not disturb mati.
      </div>
      <div>
        <div className="dim text-fs-10 mb-1">Terakhir dikirim</div>
        {data.recent.length === 0 && <div className="dim text-fs-10">Belum ada.</div>}
        {data.recent.map((s) => (
          <div key={`${s.at}|${s.title}`} className="py-1 border-b border-[#1c1c1c]">
            <div className="flex items-center gap-1.5">
              <span className="text-fs-9 px-1 border border-[#444] dim">{KIND_LABEL[s.kind]}</span>
              <span className="dim text-fs-10 tabular-nums">{new Date(s.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              {!s.shown && <span className="down text-fs-10">tidak tampil</span>}
            </div>
            <div className="text-[var(--text)]">{s.title}</div>
            {s.lines.map((l) => (
              <div key={l} className="dim text-fs-10">
                {l}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
