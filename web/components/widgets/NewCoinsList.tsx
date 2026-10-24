"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiGet, fmtBig, fmtPrice } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useTerminal } from "../../store/terminal";

// New altcoins (Watchlist → Crypto · altcoin baru): the coins CoinMarketCap, OKX and Gate have
// listed in the last weeks, newest first, each with its best TradingView pair — a click opens its
// chart (server/src/providers/newcoins.ts).

type NewCoin = {
  symbol: string;
  name: string;
  listedAt: number;
  sources: string[];
  chain: string | null;
  marketCap: number | null;
  chart: string | null;
  pair: string | null;
  exchange: string | null;
  dex: boolean;
  sameName: boolean | null;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
};

const DAYS = [7, 30, 90] as const;

/** Dollars, shortened from a thousand up. */
const usd = (v: number) => `$${v < 1000 ? Math.round(v) : fmtBig(v)}`;

function age(ms: number, now: number): string {
  const d = Math.floor((now - ms) / 86_400_000);
  if (d <= 0) return "hari ini";
  if (d === 1) return "kemarin";
  return `${d} hari lalu`;
}

export default function NewCoinsList() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setView = useTerminal((s) => s.setView);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [venue, setVenue] = useState<"all" | "cex" | "dex">("all");
  const [chartOnly, setChartOnly] = useState(true);
  const [q, setQ] = useState("");
  const poll = usePoll(5 * 60_000);
  const { data = [], error, isLoading } = useQuery({ queryKey: ["crypto-new", days], queryFn: () => apiGet<NewCoin[]>(`/api/crypto/new?days=${days}`), refetchInterval: poll });

  const now = Date.now();
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return data.filter(
      (c) =>
        (!chartOnly || c.chart) &&
        (venue === "all" || (venue === "dex" ? c.dex : c.chart && !c.dex)) &&
        (!f || c.symbol.toLowerCase().includes(f) || c.name.toLowerCase().includes(f)),
    );
  }, [data, q, venue, chartOnly]);

  const open = (c: NewCoin) => {
    if (!c.chart) return;
    setActiveSymbol(c.chart);
    setView("chart");
  };

  return (
    <div className="flex flex-col h-full min-h-0 text-fs-11">
      <div className="flex flex-wrap gap-1 items-center p-1 border-b border-[var(--border)]">
        {DAYS.map((d) => (
          <button key={d} className={`term-btn ${days === d ? "active" : ""}`} onClick={() => setDays(d)}>
            {d} hari
          </button>
        ))}
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {(["all", "cex", "dex"] as const).map((v) => (
          <button key={v} className={`term-btn ${venue === v ? "active" : ""}`} onClick={() => setVenue(v)} title={v === "cex" ? "Diperdagangkan di bursa terpusat" : v === "dex" ? "Hanya di bursa terdesentralisasi (pool DEX)" : undefined}>
            {v === "all" ? "Semua" : v === "cex" ? "Bursa (CEX)" : "DEX"}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-1 dim cursor-pointer">
          <input type="checkbox" checked={chartOnly} onChange={(e) => setChartOnly(e.target.checked)} /> hanya yang punya chart
        </label>
        <input className="flex-1 min-w-[120px]" placeholder="cari koin…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="px-2 py-1 text-fs-9 amber border-b border-[#161616]">
        ⚠ Koin yang baru listing sangat berisiko: likuiditas tipis, harga liar, dan banyak penipuan (rug pull). Cek kontrak, bursa, dan volumenya sebelum membeli.
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading && <div className="p-2 dim">Mengumpulkan listing baru dari CoinMarketCap, OKX dan Gate…</div>}
        {error && <div className="p-2 down">Listing baru tidak terbaca: {(error as Error).message}</div>}
        {!isLoading && !error && shown.length === 0 && <div className="p-2 dim">Tidak ada koin baru yang cocok.</div>}
        {shown.length > 0 && (
          <table className="data-table w-full text-fs-10">
            <thead>
              <tr>
                <th>Koin</th>
                <th>Listing</th>
                <th>Sumber</th>
                <th>Diperdagangkan di</th>
                <th>Harga</th>
                <th>24 jam</th>
                <th>Volume 24j</th>
                <th>Market cap</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.symbol} onClick={() => open(c)} className={c.chart ? "cursor-pointer hover:bg-[#121212]" : "opacity-60"} title={c.chart ? `Buka chart ${c.chart}` : "Belum ada pair di TradingView"}>
                  <td className="!text-left !whitespace-normal">
                    <b>{c.symbol}</b> <span className="dim">{c.name}</span>
                    {c.chain && <span className="dim text-fs-9"> · {c.chain}</span>}
                    {c.sameName === false && <div className="text-fs-9 amber">⚠ nama di TradingView berbeda — bisa token lain dengan ticker sama</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {new Date(c.listedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}
                    <div className="dim text-fs-9">{age(c.listedAt, now)}</div>
                  </td>
                  <td className="dim text-fs-9">{c.sources.join(", ")}</td>
                  <td className="whitespace-nowrap">{c.exchange ? <span className={c.dex ? "amber" : ""}>{c.exchange}{c.dex ? " (DEX)" : ""}</span> : <span className="dim">—</span>}</td>
                  <td className="tabular-nums">{c.price == null ? "—" : fmtPrice(c.price)}</td>
                  <td className={`tabular-nums ${(c.change24h ?? 0) >= 0 ? "up" : "down"}`}>{c.change24h == null ? "—" : `${c.change24h > 0 ? "+" : ""}${c.change24h.toFixed(2)}%`}</td>
                  <td className="tabular-nums dim">{c.volume24h ? usd(c.volume24h) : "—"}</td>
                  <td className="tabular-nums dim">{c.marketCap ? usd(c.marketCap) : "—"}</td>
                  <td>
                    {c.chart && (
                      <button
                        className="dim hover:text-[var(--amber)] px-1"
                        title="Tambah ke watchlist saya"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToWatchlist(c.chart!);
                        }}
                      >
                        +
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-2 py-1 text-fs-9 dim border-t border-[#161616]">
        {data.length} koin baru dalam {days} hari · {data.filter((c) => c.chart).length} bisa di-chart · sumber: CoinMarketCap (baru ditambahkan), OKX & Gate (listing baru) · harga dari pair terbaik di TradingView
      </div>
    </div>
  );
}
