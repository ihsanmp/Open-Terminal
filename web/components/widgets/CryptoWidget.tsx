"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, fmt, fmtBig, fmtPrice, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { usePoll } from "../../lib/refresh";

type CryptoRow = {
  id: string; symbol: string; ticker: string; name: string; price: number;
  changePercent24h: number | null; marketCap: number | null; volume24h: number | null;
  rank: number | null; sparkline: number[]; image: string | null;
};
type GlobalStats = { totalMarketCap: number; btcDominance: number; ethDominance: number; coins?: number };

const PER_PAGE = 100;

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 60;
  const h = 16;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`)
    .join(" ");
  const upTrend = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={upTrend ? "#00c853" : "#ff3d3d"} strokeWidth={1} />
    </svg>
  );
}

export default function CryptoWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const poll = usePoll(10_000);
  const pollGlobal = usePoll(120_000);

  // Debounce typing so each keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const { data = [], error, isFetching } = useQuery({
    queryKey: ["crypto", page, query],
    queryFn: () =>
      apiGet<CryptoRow[]>(query ? `/api/crypto?q=${encodeURIComponent(query)}&perPage=${PER_PAGE}` : `/api/crypto?page=${page}&perPage=${PER_PAGE}`),
    refetchInterval: poll,
    placeholderData: keepPreviousData,
  });
  const { data: global } = useQuery({
    queryKey: ["crypto-global"],
    queryFn: () => apiGet<GlobalStats>("/api/crypto/global"),
    refetchInterval: pollGlobal,
  });

  const hasSparklines = data.some((c) => c.sparkline.length > 1);
  const lastPage = !query && data.length < PER_PAGE;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1 border-b border-[var(--border)] dim shrink-0">
        {global && (
          <>
            <span>Total MCap <span className="text-[var(--text)]">{fmtBig(global.totalMarketCap)}</span></span>
            <span>BTC.D <span className="amber">{fmt(global.btcDominance, 1)}%</span></span>
            <span>ETH.D <span className="amber">{fmt(global.ethDominance, 1)}%</span></span>
            {global.coins ? <span>Coins <span className="text-[var(--text)]">{global.coins.toLocaleString("en-US")}</span></span> : null}
          </>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search all coins…"
          className="ml-auto w-36 !py-0.5"
        />
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Asset</th><th>Price</th><th>24h%</th><th>MCap</th><th>Vol 24h</th>
              {hasSparklines && <th>7d</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} onClick={() => setActiveSymbol(c.ticker)} title={`Open ${c.ticker}`}>
                <td className="dim">{c.rank ?? "—"}</td>
                <td className="!text-left">
                  <span className="inline-flex items-center gap-1.5 max-w-[220px]">
                    {c.image ? <img src={c.image} alt="" width={14} height={14} className="rounded-full" loading="lazy" /> : null}
                    <span className="font-bold">{c.symbol}</span>
                    <span className="dim truncate">{c.name}</span>
                  </span>
                </td>
                <td>{fmtPrice(c.price)}</td>
                <td className={pctClass(c.changePercent24h)}>{fmt(c.changePercent24h)}%</td>
                <td>{fmtBig(c.marketCap)}</td>
                <td>{fmtBig(c.volume24h)}</td>
                {hasSparklines && <td><Sparkline data={c.sparkline.filter((_, i) => i % 4 === 0)} /></td>}
                <td>
                  <button
                    title="Add to watchlist"
                    className="dim hover:text-[var(--amber)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      addToWatchlist(c.ticker);
                    }}
                  >
                    +
                  </button>
                </td>
              </tr>
            ))}
            {data.length === 0 && !isFetching && (
              <tr><td colSpan={8} className="dim !text-left">No coins match “{query}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!query && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--border)] shrink-0">
          <button className="term-btn" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span className="dim">
            Page {page} · #{(page - 1) * PER_PAGE + 1}–{(page - 1) * PER_PAGE + data.length}
          </span>
          <button className="term-btn" disabled={lastPage} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
