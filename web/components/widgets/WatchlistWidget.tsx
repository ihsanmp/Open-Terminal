"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, fmtPrice, pctClass, type Quote } from "../../lib/api";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";
import { listRefreshMs, usePoll } from "../../lib/refresh";
import { displaySymbol, priceDigits } from "../../lib/watchlist";
import CryptoList from "./CryptoList";

// The watchlist, and the markets to pick from beside it: every coin (the Crypto page was this) and
// every forex pair brokers quote, by group, chosen from one dropdown.

type ForexGroup = "major" | "minor" | "exotic" | "metal";
type Category = "mine" | "crypto" | "fx-all" | `fx-${ForexGroup}`;
type ForexRow = { symbol: string; pair: string; group: ForexGroup; name: string | null; price: number; change: number | null; changePercent: number | null; high: number | null; low: number | null };

const FOREX_GROUPS: Array<[Category, string]> = [
  ["fx-all", "Forex · semua pair"],
  ["fx-major", "Forex · Major"],
  ["fx-minor", "Forex · Minor (cross)"],
  ["fx-exotic", "Forex · Exotic"],
  ["fx-metal", "Forex · Logam (XAU, XAG…)"],
];
const GROUP_LABEL: Record<ForexGroup, string> = { major: "Major", minor: "Minor", exotic: "Exotic", metal: "Logam" };

function MyList() {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [input, setInput] = useState("");
  const poll = usePoll(() => listRefreshMs(watchlist));

  const { data = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${watchlist.join(",")}`),
    enabled: watchlist.length > 0,
    refetchInterval: poll,
  });

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <form
        className="flex gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            addToWatchlist(input.trim());
            setInput("");
          }
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add ticker…" className="flex-1" />
        <button className="term-btn" type="submit">
          +
        </button>
      </form>
      <table className="data-table">
        <thead>
          <tr>
            <th>Sym</th>
            <th>Last</th>
            <th>Chg%</th>
            <th>Vol</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {watchlist.map((sym) => {
            const q = data.find((d) => d.symbol === sym);
            return (
              <tr key={sym} onClick={() => setActiveSymbol(sym)}>
                <td className="font-bold">{sym}</td>
                <td>
                  <Flash value={q?.price}>{fmtPrice(q?.price)}</Flash>
                </td>
                <td className={pctClass(q?.changePercent)}>
                  <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
                </td>
                <td>{fmtBig(q?.volume)}</td>
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromWatchlist(sym);
                    }}
                    className="dim hover:text-[var(--down)]"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every forex pair of a group (or all of them), live from the server's one scanner request. */
function ForexList({ group }: { group: ForexGroup | "all" }) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [search, setSearch] = useState("");
  const poll = usePoll(10_000);
  const { data = [], error, isLoading } = useQuery({
    queryKey: ["forex"],
    queryFn: () => apiGet<ForexRow[]>("/api/forex"),
    refetchInterval: poll,
    placeholderData: keepPreviousData,
  });
  // "idr" finds the rupiah's pairs, "eur" the euro's, "gold" gold.
  const q = search.trim().toUpperCase();
  const rows = data.filter((r) => (group === "all" || r.group === group) && (!q || r.pair.includes(q) || (r.name ?? "").toUpperCase().includes(q)));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pair (mis. IDR, EUR, gold)…" className="w-56" />
        <span className="dim text-fs-10 ml-auto">{data.length ? `${rows.length} pair · harga TradingView (FX_IDC; logam OANDA/TVC)` : ""}</span>
      </div>
      {error && !data.length && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {isLoading && <div className="p-2 dim">Memuat semua pair…</div>}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Pair</th>
              {group === "all" && <th className="!text-left">Grup</th>}
              <th>Harga</th>
              <th>Chg%</th>
              <th>High</th>
              <th>Low</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = priceDigits(r.symbol, r.price);
              const listed = watchlist.includes(r.symbol);
              return (
                <tr key={r.symbol} onClick={() => setActiveSymbol(r.symbol)} title={`Buka ${displaySymbol(r.symbol)}`}>
                  <td className="!text-left whitespace-nowrap">
                    <span className="font-bold">{displaySymbol(r.symbol)}</span> <span className="dim">{r.name}</span>
                  </td>
                  {group === "all" && <td className="!text-left dim">{GROUP_LABEL[r.group]}</td>}
                  <td>
                    <Flash value={r.price}>{fmt(r.price, d)}</Flash>
                  </td>
                  <td className={pctClass(r.changePercent)}>
                    <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
                  </td>
                  <td className="dim">{fmt(r.high, d)}</td>
                  <td className="dim">{fmt(r.low, d)}</td>
                  <td>
                    <button
                      title={listed ? "Sudah ada di Watchlist saya" : "Tambah ke Watchlist saya"}
                      className={listed ? "up" : "dim hover:text-[var(--amber)]"}
                      disabled={listed}
                      onClick={(e) => {
                        e.stopPropagation();
                        addToWatchlist(r.symbol);
                      }}
                    >
                      {listed ? "✓" : "+"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {data.length > 0 && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="dim !text-left">
                  Tidak ada pair yang cocok dengan “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function WatchlistWidget() {
  const [category, setCategory] = useWidgetSetting<Category>("category", "mine");
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-1 pt-1">
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Kategori" title="Pilih kategori pair yang ingin dilihat">
          <option value="mine">Watchlist saya</option>
          <option value="crypto">Crypto · semua koin</option>
          <optgroup label="Forex">
            {FOREX_GROUPS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {category === "mine" ? <MyList /> : category === "crypto" ? (
        <div className="flex-1 min-h-0">
          <CryptoList />
        </div>
      ) : <ForexList group={category === "fx-all" ? "all" : (category.slice(3) as ForexGroup)} />}
    </div>
  );
}
