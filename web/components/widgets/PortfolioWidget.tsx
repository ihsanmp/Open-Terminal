"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, fmt, fmtPrice, pctClass, type Quote } from "../../lib/api";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";
import { useTerminal, useWidgetSetting } from "../../store/terminal";

type Portfolio = { id: number; name: string };
type Position = { symbol: string; quantity: number; avgCost: number; realizedPnl: number };
/** One trade in the journal, laid out like the TWX journal template. */
type Entry = {
  id: number;
  traded_at: string;
  symbol: string;
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  price: number | null;
  reason: string;
  emotion_before: string;
  emotion_after: string;
  grade: number | null;
  lesson: string;
  chart_image: string | null;
  chart_url: string | null;
};
type Draft = Omit<Entry, "id" | "chart_image" | "quantity" | "price"> & { quantity: string; price: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");
const imageUrl = (name: string) => `/api/portfolios/journal-images/${name}`;
const GRADE_HINT = ["", "Buruk — langgar plan", "Kurang", "Cukup", "Baik", "Sempurna — sesuai plan"];

async function send<T>(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

const base64Of = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A picked or pasted image as a PNG (or JPEG when that's much smaller), at most 1600 px wide. */
async function chartPhoto(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const as = (type: string, q?: number) => new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("image encode failed"))), type, q));
  const png = await as("image/png");
  return png.size > 2_000_000 ? as("image/jpeg", 0.9) : png;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="dim text-fs-10 uppercase tracking-wide">
        {label} {hint && <span className="normal-case tracking-normal">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Add or edit one journal entry: before the trade, after it, and its chart. */
function EntryEditor({ pid, entry, onClose }: { pid: number; entry: Entry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [d, setD] = useState<Draft>(() =>
    entry
      ? { ...entry, quantity: entry.quantity?.toString() ?? "", price: entry.price?.toString() ?? "", chart_url: entry.chart_url ?? "" }
      : {
          traded_at: today(), symbol: activeSymbol ?? "", side: "BUY", quantity: "", price: "", reason: "", emotion_before: "",
          emotion_after: "", grade: null, lesson: "", chart_url: "",
        }
  );
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  const takePhoto = async (file: Blob | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const blob = await chartPhoto(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
      setDropPhoto(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // A chart copied to the clipboard (TradingView's "Copy chart image", a screenshot) pastes in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        void takePhoto(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  const lastPrice = async () => {
    if (!d.symbol) return;
    const [q] = await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(d.symbol)}`).catch(() => []);
    if (q?.price) set("price", String(q.price));
  };

  const save = async () => {
    setError(null);
    const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
    const body = {
      ...d,
      symbol: d.symbol.trim(),
      quantity: num(d.quantity),
      price: num(d.price),
      chart_url: d.chart_url?.trim() || null,
    };
    if (!body.symbol) return setError("Isi pair / ticker.");
    if ([body.quantity, body.price].some((x) => x !== null && !Number.isFinite(x))) return setError("Qty dan price harus angka.");
    setBusy(true);
    try {
      const saved = entry ? await send<Entry>("PUT", `/api/portfolios/${pid}/journal/${entry.id}`, body) : await apiPost<Entry>(`/api/portfolios/${pid}/journal`, body);
      if (photo) await send("POST", `/api/portfolios/${pid}/journal/${saved.id}/image`, { data: await base64Of(photo.blob) });
      else if (dropPhoto && entry?.chart_image) await send("DELETE", `/api/portfolios/${pid}/journal/${saved.id}/image`);
      qc.invalidateQueries({ queryKey: ["journal", pid] });
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!entry || !confirm(`Hapus entri ${entry.symbol} ${ddmmyyyy(entry.traded_at)}?`)) return;
    await apiDelete(`/api/portfolios/${pid}/journal/${entry.id}`);
    qc.invalidateQueries({ queryKey: ["journal", pid] });
    qc.invalidateQueries({ queryKey: ["positions", pid] });
    onClose();
  };

  const shownPhoto = photo?.url ?? (!dropPhoto && entry?.chart_image ? imageUrl(entry.chart_image) : null);
  const area = "w-full bg-[var(--panel)] border border-[var(--border)] px-1 py-0.5 resize-y";

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-12 overflow-auto" onMouseDown={onClose}>
      <div
        className="bg-[var(--panel)] border border-[var(--border)] w-[min(760px,94vw)] mb-12"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
        }}
      >
        <div className="flex items-center px-3 py-2 border-b border-[var(--border)]">
          <span className="amber font-bold">{entry ? `Entri #${entry.id} · ${entry.symbol}` : "Entri jurnal baru"}</span>
          <button className="ml-auto dim hover:text-[var(--text)]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-3 grid gap-3 text-fs-12">
          <div>
            <div className="amber text-fs-11 font-bold mb-1">SEBELUM TRADE</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              <Field label="Tanggal">
                <input type="date" value={d.traded_at} onChange={(e) => set("traded_at", e.target.value)} />
              </Field>
              <Field label="Pair / ticker">
                <input value={d.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="BBCA.JK, BTC-USD" autoFocus={!entry} />
              </Field>
              <Field label="Side">
                <select value={d.side ?? ""} onChange={(e) => set("side", (e.target.value || null) as Draft["side"])}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                  <option value="">—</option>
                </select>
              </Field>
              <Field label="Qty">
                <input inputMode="decimal" value={d.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="opsional" />
              </Field>
              <Field label="Price">
                <span className="flex gap-1">
                  <input className="min-w-0 flex-1" inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value)} placeholder="opsional" />
                  <button type="button" className="term-btn" onClick={lastPrice} title="Harga terakhir pair ini">
                    LAST
                  </button>
                </span>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="Reason" hint="kenapa masuk: setup, level, R:R">
                <textarea className={area} rows={3} value={d.reason} onChange={(e) => set("reason", e.target.value)} />
              </Field>
              <Field label="Emotion sebelum">
                <textarea className={area} rows={3} value={d.emotion_before} onChange={(e) => set("emotion_before", e.target.value)} />
              </Field>
            </div>
          </div>

          <div>
            <div className="amber text-fs-11 font-bold mb-1">SESUDAH TRADE</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Emotion sesudah">
                <textarea className={area} rows={3} value={d.emotion_after} onChange={(e) => set("emotion_after", e.target.value)} />
              </Field>
              <Field label="Lesson / pembelajaran" hint="1 kalimat">
                <textarea className={area} rows={3} value={d.lesson} onChange={(e) => set("lesson", e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <span className="dim text-fs-10 uppercase tracking-wide mr-1">Grade</span>
              {[1, 2, 3, 4, 5].map((g) => (
                <button key={g} type="button" className={`term-btn w-8 ${d.grade === g ? "active" : ""}`} onClick={() => set("grade", d.grade === g ? null : g)} title={GRADE_HINT[g]}>
                  {g}
                </button>
              ))}
              <span className="dim ml-2">{d.grade ? GRADE_HINT[d.grade] : "1 = langgar plan · 5 = sesuai plan"}</span>
            </div>
          </div>

          <div>
            <div className="amber text-fs-11 font-bold mb-1">FOTO CHART</div>
            <div className="flex gap-3 items-start">
              <div
                className="w-56 h-32 border border-dashed border-[var(--border)] flex items-center justify-center text-center dim cursor-pointer shrink-0 overflow-hidden"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void takePhoto(e.dataTransfer.files[0]);
                }}
                title="Klik, seret gambar ke sini, atau tempel (Ctrl+V)"
              >
                {shownPhoto ? <img src={shownPhoto} alt="Chart" className="max-w-full max-h-full object-contain" /> : <span className="px-2">Klik, seret, atau Ctrl+V gambar chart</span>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void takePhoto(e.target.files?.[0])} />
              <div className="flex-1 grid gap-2">
                <Field label="Link chart" hint="opsional, mis. snapshot TradingView">
                  <input value={d.chart_url ?? ""} onChange={(e) => set("chart_url", e.target.value)} placeholder="https://www.tradingview.com/x/…" />
                </Field>
                {shownPhoto && (
                  <button
                    type="button"
                    className="term-btn justify-self-start"
                    onClick={() => {
                      setPhoto(null);
                      setDropPhoto(true);
                    }}
                  >
                    HAPUS FOTO
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && <div className="down">{error}</div>}
          <div className="flex gap-2 items-center">
            <button className="term-btn active" onClick={save} disabled={busy}>
              {busy ? "MENYIMPAN…" : "SIMPAN"}
            </button>
            <button className="term-btn" onClick={onClose}>
              BATAL
            </button>
            <span className="dim text-fs-10">Ctrl+Enter untuk simpan</span>
            {entry && (
              <button className="term-btn ml-auto hover:!text-[var(--down)] hover:!border-[var(--down)]" onClick={remove}>
                HAPUS ENTRI
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A text cell that shows a few lines and the rest on hover. */
const Note = ({ text, todo }: { text: string; todo?: string }) =>
  text ? (
    <td className="!text-left !whitespace-normal align-top min-w-[12rem] max-w-[22rem]" title={text}>
      <div className="line-clamp-3">{text}</div>
    </td>
  ) : (
    <td className="!text-left align-top">
      <span className="text-fs-10 text-[var(--amber-dim)]">{todo ?? ""}</span>
    </td>
  );

function Journal({ entries, onEdit }: { entries: Entry[]; onEdit: (e: Entry) => void }) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [zoom, setZoom] = useState<string | null>(null);
  // Numbered oldest-first, as in the template, though the newest is shown on top.
  const number = new Map([...entries].reverse().map((e, i) => [e.id, i + 1]));
  if (entries.length === 0)
    return (
      <div className="p-4 dim leading-relaxed">
        Belum ada entri. Klik <span className="amber">+ ENTRI</span> untuk mencatat trade: tulis REASON dan EMOTION SEBELUM sebelum masuk, lalu EMOTION SESUDAH, GRADE dan LESSON setelah keluar. Atau{" "}
        <span className="amber">IMPORT XLSX</span> jurnal yang sudah kamu isi di template.
      </div>
    );
  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="!text-left">Tanggal</th>
            <th className="!text-left">Pair</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th className="!text-left">Reason</th>
            <th className="!text-left">Emotion sebelum</th>
            <th className="!text-left">Emotion sesudah</th>
            <th>Grade</th>
            <th className="!text-left">Lesson</th>
            <th>Foto</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} onClick={() => onEdit(e)} className="cursor-pointer" title="Klik untuk edit">
              <td className="dim align-top">{number.get(e.id)}</td>
              <td className="!text-left align-top whitespace-nowrap">{ddmmyyyy(e.traded_at)}</td>
              <td className="!text-left align-top">
                <button
                  className="amber font-bold hover:underline"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setActiveSymbol(e.symbol);
                  }}
                  title="Buka di chart"
                >
                  {e.symbol}
                </button>
              </td>
              <td className={`align-top ${e.side === "BUY" ? "up" : e.side === "SELL" ? "down" : "dim"}`}>{e.side ?? "—"}</td>
              <td className="align-top">{e.quantity === null ? "—" : fmt(e.quantity, e.quantity % 1 ? 4 : 0)}</td>
              <td className="align-top">{fmtPrice(e.price)}</td>
              <Note text={e.reason} />
              <Note text={e.emotion_before} />
              <Note text={e.emotion_after} todo="isi setelah trade" />
              <td className="align-top amber font-bold text-fs-14">{e.grade ?? <span className="text-fs-10 font-normal text-[var(--amber-dim)]">—</span>}</td>
              <Note text={e.lesson} todo="isi setelah trade" />
              <td className="align-top">
                {e.chart_image ? (
                  <img
                    src={imageUrl(e.chart_image)}
                    alt={`Chart ${e.symbol}`}
                    className="h-10 max-w-[5rem] object-cover border border-[var(--border)] inline-block"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setZoom(imageUrl(e.chart_image!));
                    }}
                  />
                ) : e.chart_url ? (
                  <a href={e.chart_url} target="_blank" rel="noreferrer" className="amber hover:underline" onClick={(ev) => ev.stopPropagation()}>
                    link ↗
                  </a>
                ) : (
                  <span className="dim">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {zoom && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-6 cursor-zoom-out" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Chart" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  );
}

function Holdings({ positions, quotes }: { positions: Position[]; quotes: Quote[] }) {
  if (positions.length === 0)
    return <div className="p-4 dim">Holdings dihitung dari entri yang punya Side, Qty dan Price. Belum ada entri seperti itu.</div>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="!text-left">Sym</th>
          <th>Qty</th>
          <th>Avg Cost</th>
          <th>Last</th>
          <th>Mkt Val</th>
          <th>Unrl PnL</th>
          <th>Unrl %</th>
          <th>Rlzd PnL</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const q = quotes.find((x) => x.symbol === p.symbol);
          const last = q?.price ?? null;
          const mv = last !== null ? last * p.quantity : null;
          const upnl = last !== null && p.quantity > 0 ? (last - p.avgCost) * p.quantity : null;
          const upct = last !== null && p.avgCost > 0 && p.quantity > 0 ? (last / p.avgCost - 1) * 100 : null;
          return (
            <tr key={p.symbol}>
              <td className="!text-left font-bold">{p.symbol}</td>
              <td>{fmt(p.quantity, p.quantity % 1 ? 4 : 0)}</td>
              <td>{fmtPrice(p.avgCost)}</td>
              <td>{fmtPrice(last)}</td>
              <td>{fmt(mv)}</td>
              <td className={pctClass(upnl)}>{fmt(upnl)}</td>
              <td className={pctClass(upct)}>{upct === null ? "—" : `${fmt(upct)}%`}</td>
              <td className={pctClass(p.realizedPnl)}>{fmt(p.realizedPnl)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function PortfolioWidget() {
  const qc = useQueryClient();
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [view, setView] = useWidgetSetting<"journal" | "holdings">("portfolioView", "journal");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const poll = usePoll(sessionRefreshMs(30_000, 300_000));
  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<Portfolio[]>("/api/portfolios"),
  });
  const pid = portfolioId ?? portfolios[0]?.id;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["journal", pid],
    queryFn: () => apiGet<Entry[]>(`/api/portfolios/${pid}/journal`),
    enabled: !!pid,
  });
  const { data: positions = [] } = useQuery({
    queryKey: ["positions", pid],
    queryFn: () => apiGet<Position[]>(`/api/portfolios/${pid}/positions`),
    enabled: !!pid,
  });
  const held = positions.filter((p) => p.quantity > 0).map((p) => p.symbol);
  const { data: quotes = [] } = useQuery({
    queryKey: ["pf-quotes", held.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${held.map(encodeURIComponent).join(",")}`),
    enabled: held.length > 0 && view === "holdings",
    refetchInterval: poll,
  });

  const importXlsx = useMutation({
    mutationFn: async (file: File) => apiPost<{ imported: number; photos: number }>(`/api/portfolios/${pid}/journal/import`, { data: await base64Of(file) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["journal", pid] });
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      setNotice({ text: `${r.imported} entri diimpor${r.photos ? `, ${r.photos} foto` : ""}.` });
    },
    onError: (e) => setNotice({ text: (e as Error).message, bad: true }),
  });
  const exportXlsx = async () => {
    try {
      const res = await fetch(`/api/portfolios/${pid}/journal.xlsx`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `trading-journal-${today()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice({ text: `Diekspor ${entries.length} entri ke Downloads.` });
    } catch (e) {
      setNotice({ text: (e as Error).message, bad: true });
    }
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const graded = entries.filter((e) => e.grade !== null);
  const avgGrade = graded.length ? graded.reduce((s, e) => s + e.grade!, 0) / graded.length : null;
  const pending = entries.filter((e) => !e.emotion_after || !e.lesson || e.grade === null).length;
  const totals = positions.reduce(
    (acc, p) => {
      const q = quotes.find((x) => x.symbol === p.symbol);
      acc.marketValue += (q?.price ?? p.avgCost) * p.quantity;
      acc.cost += p.avgCost * p.quantity;
      acc.realized += p.realizedPnl;
      return acc;
    },
    { marketValue: 0, cost: 0, realized: 0 }
  );

  return (
    <div>
      <div className="flex gap-1 p-1 items-center flex-wrap border-b border-[var(--border)]">
        <select value={pid ?? ""} onChange={(e) => setPortfolioId(Number(e.target.value))} aria-label="Portfolio">
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className={`term-btn ${view === "journal" ? "active" : ""}`} onClick={() => setView("journal")}>
          JOURNAL
        </button>
        <button className={`term-btn ${view === "holdings" ? "active" : ""}`} onClick={() => setView("holdings")}>
          HOLDINGS
        </button>
        <span className="w-px h-3 bg-[var(--border)] mx-1" />
        <button className="term-btn" onClick={() => setEditing("new")} disabled={!pid}>
          + ENTRI
        </button>
        <button className="term-btn" onClick={() => importRef.current?.click()} disabled={!pid || importXlsx.isPending} title="Tambahkan entri dari jurnal .xlsx (template TWX atau ekspor dari sini)">
          {importXlsx.isPending ? "MENGIMPOR…" : "IMPORT XLSX"}
        </button>
        <button className="term-btn" onClick={exportXlsx} disabled={!pid} title="Unduh jurnal sebagai .xlsx dengan layout template">
          EXPORT XLSX
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importXlsx.mutate(f);
            e.target.value = "";
          }}
        />
        {notice && <span className={notice.bad ? "down" : "up"}>{notice.text}</span>}
        <span className="ml-auto dim">
          {view === "journal" ? (
            <>
              {entries.length} entri · avg grade <span className="amber">{avgGrade === null ? "—" : fmt(avgGrade, 1)}</span>
              {pending > 0 && <span className="text-[var(--amber-dim)]"> · {pending} belum diisi sesudah trade</span>}
            </>
          ) : (
            <>
              MV <span className="amber">{fmt(totals.marketValue)}</span> Unrl{" "}
              <span className={pctClass(totals.marketValue - totals.cost)}>{fmt(totals.marketValue - totals.cost)}</span> Rlzd{" "}
              <span className={pctClass(totals.realized)}>{fmt(totals.realized)}</span>
            </>
          )}
        </span>
      </div>

      {isLoading ? (
        <div className="p-2 dim">Loading…</div>
      ) : view === "journal" ? (
        <Journal entries={entries} onEdit={setEditing} />
      ) : (
        <Holdings positions={positions} quotes={quotes} />
      )}

      {editing && pid && <EntryEditor pid={pid} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
