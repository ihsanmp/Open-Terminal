"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";

// The news data the app keeps as CSV (server/src/newsdata/newsdata.ts): every release and Fed
// event, watched or not, what's still missing, and what Claude's scheduled search brought in.

type Gap = { key: string; kind: string; date_wib: string; title: string; missing: string; hint: string };
type Status = { dir: string; lastRun: string | null; error: string | null; files: Array<{ name: string; rows: number }>; gaps: Gap[]; inbox: { waiting: number; taken: number; rejected: number } };

const FILE_NOTE: Record<string, string> = {
  "releases.csv": "rilis data besar AS sejak 2016: aktual, konsensus, kejutan",
  "reactions.csv": "gerak tiap aset 30 menit pertama dan hari itu, setelah tiap rilis dan acara The Fed",
  "fed_events.csv": "acara The Fed: menit yang didengar live, teks resmi, bacaan hawkish/dovish",
  "gaps.csv": "yang masih kurang, dicari Claude di internet",
};

export default function NewsDataPanel() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["newsdata"], queryFn: () => apiGet<Status>("/api/newsdata"), refetchInterval: 60_000 });
  const run = useMutation({ mutationFn: () => apiPost<Status>("/api/newsdata/run", {}), onSuccess: (s) => qc.setQueryData(["newsdata"], s) });
  if (error) return <div className="p-2 down">Data berita belum bisa dibaca: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Membaca data berita…</div>;
  return (
    <div className="p-2 flex flex-col gap-2 text-fs-11">
      <div className="dim leading-relaxed">
        Semua rilis dan acara The Fed disimpan sebagai CSV, ditonton atau tidak, setiap 30 menit selama aplikasi berjalan. Yang terlewat atau hanya terdengar sebagian dicari tugas terjadwal Claude di internet, lalu masuk ke berkas yang sama dengan sumbernya.
      </div>
      <div className="flex items-center gap-2">
        <span className="dim truncate" title={data.dir}>
          {data.dir}
        </span>
        <button className="term-btn ml-auto shrink-0" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Menyimpan…" : "Perbarui sekarang"}
        </button>
      </div>
      <div className="dim text-fs-10">
        {data.lastRun ? `Terakhir diperbarui ${new Date(data.lastRun).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` : "Belum diperbarui sejak aplikasi dibuka (pertama kali satu menit setelah dibuka)."}
        {data.error && <span className="down"> · gagal: {data.error}</span>}
      </div>
      <table className="data-table w-full text-fs-10">
        <tbody>
          {data.files.map((f) => (
            <tr key={f.name}>
              <td className="!text-left whitespace-nowrap">{f.name}</td>
              <td className="tabular-nums">{f.rows.toLocaleString("id-ID")}</td>
              <td className="!text-left dim">{FILE_NOTE[f.name]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dim text-fs-10">
        Kotak masuk Claude: {data.inbox.waiting} menunggu · putaran terakhir {data.inbox.taken} diterima, {data.inbox.rejected} ditolak
      </div>
      <div className="panel-title py-1">Yang masih kurang ({data.gaps.length})</div>
      {data.gaps.length === 0 && <div className="dim">Tidak ada: semua acara dan rilis sudah lengkap.</div>}
      {data.gaps
        .slice()
        .reverse()
        .map((g) => (
          <div key={g.key} className="border-b border-[var(--border)] pb-1">
            <div>
              <span className="dim">{g.date_wib} WIB</span> <span className="text-[var(--text)]">{g.title}</span>
            </div>
            <div className="dim text-fs-10">{g.missing}</div>
          </div>
        ))}
    </div>
  );
}
