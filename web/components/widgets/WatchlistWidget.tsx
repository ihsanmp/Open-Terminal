"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, fmt, fmtBig, fmtPrice, pctClass, type Quote } from "../../lib/api";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";
import { listRefreshMs, usePoll } from "../../lib/refresh";
import { displaySymbol, priceDigits } from "../../lib/watchlist";
import CryptoList from "./CryptoList";

// The watchlist, and the markets to pick from beside it: every stock of a market, the world's
// indices by region, every coin (the Crypto page was this) and every forex pair brokers quote, by
// group, chosen from one dropdown.

type ForexGroup = "major" | "minor" | "exotic" | "metal";
type IndexRegion = "Americas" | "Europe" | "Asia-Pacific" | "Middle East & Africa";
type Category = "mine" | "crypto" | "fx-all" | `fx-${ForexGroup}` | `stocks-${string}` | "idx-all" | `idx-${IndexRegion}`;
type StockRow = { symbol: string; code: string; name: string; price: number | null; changePercent: number | null; marketCap: number | null; volume: number | null; sector: string | null; currency: string | null };
type StockPage = { total: number; page: number; perPage: number; rows: StockRow[] };
type IndexRow = { symbol: string; name: string; country: string; region: IndexRegion; price: number | null; changePercent: number | null; currency: string | null };

/** The stock markets, as the server's scanners name them (providers/heatmap.ts STOCK_MARKETS). */
const STOCK_MARKETS: Array<[string, string]> = [
  ["us", "Amerika Serikat"],
  ["indonesia", "Indonesia (IDX)"],
  ["japan", "Jepang"],
  ["china", "China"],
  ["hongkong", "Hong Kong"],
  ["korea", "Korea Selatan"],
  ["taiwan", "Taiwan"],
  ["india", "India"],
  ["singapore", "Singapura"],
  ["malaysia", "Malaysia"],
  ["uk", "Inggris"],
  ["germany", "Jerman"],
  ["france", "Prancis"],
  ["canada", "Kanada"],
  ["australia", "Australia"],
  ["brazil", "Brasil"],
];
const INDEX_REGIONS: Array<[IndexRegion, string]> = [
  ["Americas", "Amerika"],
  ["Europe", "Eropa"],
  ["Asia-Pacific", "Asia-Pasifik"],
  ["Middle East & Africa", "Timur Tengah & Afrika"],
];
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

/** The + that puts a symbol on the watchlist, a ✓ once it's there. */
function AddButton({ symbol }: { symbol: string }) {
  const listed = useTerminal((s) => s.watchlist.includes(symbol));
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  return (
    <button
      title={listed ? "Sudah ada di Watchlist saya" : "Tambah ke Watchlist saya"}
      className={listed ? "up" : "dim hover:text-[var(--amber)]"}
      disabled={listed}
      onClick={(e) => {
        e.stopPropagation();
        addToWatchlist(symbol);
      }}
    >
      {listed ? "✓" : "+"}
    </button>
  );
}

/** Every stock of a market, biggest first, 100 at a time, or those a search finds. */
function StockList({ market }: { market: string }) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => setPage(1), [market]);
  const poll = usePoll(15_000);
  const params = new URLSearchParams({ market, page: String(page) });
  if (query) params.set("q", query);
  const { data, error, isFetching } = useQuery({
    queryKey: ["stocks", market, page, query],
    queryFn: () => apiGet<StockPage>(`/api/stocks?${params}`),
    refetchInterval: poll,
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const first = (page - 1) * (data?.perPage ?? 100);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)]">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Cari kode atau nama (mis. BBCA, bank)…" className="w-64" />
        <span className="dim text-fs-10 ml-auto">
          {data ? `${data.total.toLocaleString("id-ID")} saham${query ? ` cocok dengan “${query}”` : ""} · urut kapitalisasi pasar` : ""}
        </span>
      </div>
      {error && !rows.length && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {!data && !error && <div className="p-2 dim">Memuat saham…</div>}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="!text-left">Saham</th>
              <th>Harga</th>
              <th>Chg%</th>
              <th>MCap</th>
              <th>Vol</th>
              <th className="!text-left">Sektor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol} onClick={() => setActiveSymbol(r.symbol)} title={`Buka ${r.symbol}`}>
                <td className="dim">{first + i + 1}</td>
                <td className="!text-left whitespace-nowrap">
                  <span className="font-bold">{r.code}</span> <span className="dim">{r.name}</span>
                </td>
                <td>
                  <Flash value={r.price}>{fmtPrice(r.price)}</Flash> <span className="dim text-fs-9">{r.currency}</span>
                </td>
                <td className={pctClass(r.changePercent)}>
                  <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
                </td>
                <td>{fmtBig(r.marketCap)}</td>
                <td>{fmtBig(r.volume)}</td>
                <td className="!text-left dim truncate max-w-[180px]">{r.sector}</td>
                <td>
                  <AddButton symbol={r.symbol} />
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && !isFetching && (
              <tr>
                <td colSpan={8} className="dim !text-left">
                  Tidak ada saham yang cocok dengan “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--border)] shrink-0">
        <button className="term-btn" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ‹ Prev
        </button>
        <span className="dim">
          Hal. {page} dari {pages}
        </span>
        <button className="term-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}

/** The world's benchmark indices, all of them or a region's. */
function IndexList({ region }: { region: IndexRegion | "all" }) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const poll = usePoll(15_000);
  const { data = [], error, isLoading } = useQuery({
    queryKey: ["indices"],
    queryFn: () => apiGet<IndexRow[]>("/api/indices"),
    refetchInterval: poll,
    placeholderData: keepPreviousData,
  });
  const rows = data.filter((r) => region === "all" || r.region === region);
  const regionLabel = new Map(INDEX_REGIONS);
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {error && !data.length && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {isLoading && <div className="p-2 dim">Memuat indeks…</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Indeks</th>
            <th className="!text-left">Negara</th>
            {region === "all" && <th className="!text-left">Region</th>}
            <th>Harga</th>
            <th>Chg%</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} onClick={() => setActiveSymbol(r.symbol)} title={`Buka ${displaySymbol(r.symbol)}`}>
              <td className="!text-left whitespace-nowrap">
                <span className="font-bold">{displaySymbol(r.symbol)}</span> <span className="dim">{r.name}</span>
              </td>
              <td className="!text-left dim">{r.country}</td>
              {region === "all" && <td className="!text-left dim">{regionLabel.get(r.region) ?? r.region}</td>}
              <td>
                <Flash value={r.price}>{fmtPrice(r.price)}</Flash>
              </td>
              <td className={pctClass(r.changePercent)}>
                <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
              </td>
              <td>
                <AddButton symbol={r.symbol} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
          <optgroup label="Saham">
            {STOCK_MARKETS.map(([m, label]) => (
              <option key={m} value={`stocks-${m}`}>
                Saham · {label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Indeks">
            <option value="idx-all">Indeks · semua</option>
            {INDEX_REGIONS.map(([r, label]) => (
              <option key={r} value={`idx-${r}`}>
                Indeks · {label}
              </option>
            ))}
          </optgroup>
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
      {category === "mine" ? (
        <MyList />
      ) : category === "crypto" ? (
        <div className="flex-1 min-h-0">
          <CryptoList />
        </div>
      ) : category.startsWith("stocks-") ? (
        <StockList market={category.slice("stocks-".length)} />
      ) : category.startsWith("idx-") ? (
        <IndexList region={category === "idx-all" ? "all" : (category.slice(4) as IndexRegion)} />
      ) : (
        <ForexList group={category === "fx-all" ? "all" : (category.slice(3) as ForexGroup)} />
      )}
    </div>
  );
}
