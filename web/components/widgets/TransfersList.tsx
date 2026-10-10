"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, fmtPrice } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";

// An asset's transactions, newest first, each from whom to whom (server: providers/transfers.ts):
// a Bitcoin transfer between named wallets, a big trade on Binance, a US insider's trade, and the
// big institutions' buys and sales (spot ETFs' daily flows, treasury companies' 8-K reports).

type Party = { name: string | null; address: string | null; role?: string | null; tag?: "etf" | "treasury" };
type Category = "onchain" | "exchange" | "insider" | "institution";
type Row = {
  id: string;
  category: Category;
  time: number;
  from: Party;
  to: Party;
  amount: number;
  unit: string;
  usd: number | null;
  side?: "buy" | "sell";
  price?: number | null;
  note?: string;
  link?: string;
};
type Transfers = { kind: "onchain" | "exchange" | "insider" | "none"; source: string; rows: Row[]; note?: string };

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function ago(t: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - t);
  if (s < 60) return `${Math.floor(s)} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 60 * 86_400) return `${Math.floor(s / 86_400)} hari lalu`;
  return new Date(t * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function PartyCell({ p }: { p: Party }) {
  const named = Boolean(p.name);
  return (
    <span className="min-w-0 truncate flex items-baseline gap-1" title={[p.name, p.role, p.address].filter(Boolean).join(" · ")}>
      <span className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 self-center ${p.tag ? "bg-[var(--amber)]" : named ? "bg-[#5b9cf6]" : "bg-[#404040]"}`} />
      {p.tag && <span className="text-fs-9 px-1 border border-[var(--amber)] amber shrink-0">{p.tag === "etf" ? "ETF" : "8-K"}</span>}
      <span className={p.tag ? "amber font-bold" : named ? "text-[var(--text)]" : "dim"}>{p.name ?? (p.address ? short(p.address) : "Tidak diketahui")}</span>
      {p.name && p.address && <span className="dim text-fs-10">({short(p.address)})</span>}
      {p.role && <span className="dim text-fs-10">{p.role}</span>}
    </span>
  );
}

const OWN_LABEL: Record<Category, string> = { onchain: "ON-CHAIN", exchange: "BINANCE", insider: "INSIDER", institution: "INSTITUSI" };

export default function TransfersList({ symbol }: { symbol: string }) {
  const poll = usePoll(15_000);
  const [only, setOnly] = useWidgetSetting<"all" | Category>("txFilter", "all");
  const { data, error, isLoading } = useQuery({
    queryKey: ["transfers", symbol],
    queryFn: () => apiGet<Transfers>(`/api/transfers/${encodeURIComponent(symbol)}`),
    refetchInterval: poll,
  });
  if (error) return <div className="down">Error: {(error as Error).message}</div>;
  if (isLoading || !data) return <div className="dim">Memuat riwayat transaksi {symbol}…</div>;
  if (data.kind === "none") return <div className="dim">{data.note}</div>;

  // The kinds this asset has, institutions first: each a filter.
  const kinds = (["institution", "onchain", "exchange", "insider"] as Category[]).filter((k) => data.rows.some((r) => r.category === k));
  const shown = only === "all" || !kinds.includes(only) ? data.rows : data.rows.filter((r) => r.category === only);

  return (
    <div className="flex flex-col gap-1">
      {kinds.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          <button className={`term-btn ${only === "all" || !kinds.includes(only) ? "active" : ""}`} onClick={() => setOnly("all")}>
            SEMUA <span className="dim">{data.rows.length}</span>
          </button>
          {kinds.map((k) => (
            <button key={k} className={`term-btn ${only === k ? "active" : ""}`} onClick={() => setOnly(k)} title={k === "institution" ? "ETF spot (BlackRock, Fidelity, Grayscale …) dan perusahaan treasury (Strategy, MARA …)" : undefined}>
              {OWN_LABEL[k]} <span className="dim">{data.rows.filter((r) => r.category === k).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="dim text-fs-10">
        {shown.length} transaksi · sumber: {data.source}
      </div>
      {data.rows.length === 0 && (
        <div className="dim">{data.kind === "exchange" ? "Belum ada transaksi besar yang terekam; daftar ini terisi selama halaman terbuka." : "Belum ada transaksi."}</div>
      )}
      <div className="border border-[var(--border)]">
        {shown.map((r) => {
          const color = r.side === "sell" ? "down" : r.side === "buy" ? "up" : "up";
          const body = (
            <>
              <span className="w-[96px] shrink-0 text-[#5b9cf6] tabular-nums whitespace-nowrap" title={new Date(r.time * 1000).toLocaleString("id-ID")}>
                {ago(r.time)}
              </span>
              <span className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] gap-2 items-baseline">
                <PartyCell p={r.from} />
                <span className="dim">→</span>
                <PartyCell p={r.to} />
              </span>
              {r.note && <span className="dim text-fs-10 shrink-0 w-[96px] truncate">{r.note}</span>}
              {r.side && !r.note && <span className={`${color} text-fs-10 shrink-0 w-[40px] uppercase`}>{r.side === "buy" ? "beli" : "jual"}</span>}
              <span className={`${color} shrink-0 w-[110px] text-right tabular-nums`}>
                {r.amount >= 1000 ? fmtBig(r.amount) : fmt(r.amount, r.amount >= 100 ? 0 : 2)} <span className="dim">{r.unit}</span>
              </span>
              {r.price !== undefined && <span className="dim shrink-0 w-[84px] text-right tabular-nums">{r.price ? `@ ${fmtPrice(r.price)}` : ""}</span>}
              <span className="text-[var(--text)] shrink-0 w-[72px] text-right tabular-nums">{r.usd === null ? "—" : `$${fmtBig(r.usd)}`}</span>
            </>
          );
          const cls = "flex items-baseline gap-3 px-2 py-1.5 border-b border-[#161616] hover:bg-[#161616]";
          return r.link ? (
            <a key={r.id} href={r.link} target="_blank" rel="noreferrer" className={cls} title={r.category === "onchain" ? "Buka transaksi di mempool.space" : "Buka sumbernya"}>
              {body}
            </a>
          ) : (
            <div key={r.id} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
      {data.note && <div className="dim text-fs-10 leading-relaxed">{data.note}</div>}
      {kinds.includes("institution") && (
        <div className="dim text-fs-10 leading-relaxed">
          Institusi: arus harian tiap ETF spot (BlackRock IBIT, Fidelity FBTC, Grayscale GBTC …) dari Farside, dalam koin pada harga penutupan hari itu; dan pembelian/penjualan perusahaan treasury (Strategy, MARA, Strive, BitMine …) dari laporan 8-K mereka ke SEC.
        </div>
      )}
    </div>
  );
}
