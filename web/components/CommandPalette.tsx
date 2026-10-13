"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet, type Quote } from "../lib/api";
import { kindOf } from "../lib/recent-symbols";
import { useTerminal } from "../store/terminal";

// The symbol search, as TradingView's: typed on a chart it opens with what was typed; the
// categories under the field narrow it (stocks, funds, futures, forex, crypto, indices, bonds,
// economy); each result shows its ticker, name, kind and exchange. Enter loads the first (or the
// one picked with the arrows), Shift+Enter adds it to the watchlist too. Before anything is typed
// it lists the symbols opened last (lib/recent-symbols.ts), the category narrowing them too.

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

/** The categories, as TradingView's chips, with the API's type for each ("" is all). */
const CATEGORIES: Array<[label: string, type: string]> = [
  ["All", ""],
  ["Stocks", "stocks"],
  ["Funds", "funds"],
  ["Futures", "futures"],
  ["Forex", "forex"],
  ["Crypto", "crypto"],
  ["Indices", "index"],
  ["Bonds", "bond"],
  ["Economy", "economic"],
];

/** The kinds of symbol each category holds (a search result's type). */
const CATEGORY_KINDS: Record<string, string[]> = {
  stocks: ["stock", "dr"],
  funds: ["fund"],
  futures: ["futures", "commodity"],
  forex: ["forex"],
  crypto: ["crypto"],
  index: ["index"],
  bond: ["bond"],
  economic: ["economic"],
};

/** Each kind's badge color, as TradingView's symbol icons are colored by market. */
const KIND_COLOR: Record<string, string> = {
  stock: "#2962ff",
  dr: "#2962ff",
  fund: "#7e57c2",
  crypto: "#f7931a",
  forex: "#26a69a",
  index: "#ff9800",
  bond: "#8d6e63",
  futures: "#ef5350",
  commodity: "#fbc02d",
  economic: "#00bcd4",
};
const KIND_LABEL: Record<string, string> = { dr: "dr", stock: "stock", fund: "fund", crypto: "crypto", forex: "forex", index: "index", bond: "bond", futures: "futures", commodity: "commodity", economic: "economy" };

/** The ticker as shown: without its exchange (OANDA:EURUSD shows EURUSD). */
const tickerOf = (symbol: string) => (symbol.includes(":") ? symbol.slice(symbol.indexOf(":") + 1) : symbol);

export default function CommandPalette() {
  const open = useTerminal((s) => s.commandOpen);
  const setOpen = useTerminal((s) => s.setCommandOpen);
  const initial = useTerminal((s) => s.commandQuery);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", category, q],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}${category ? `&type=${category}` : ""}`),
    enabled: open && q.length > 0,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });
  // The recent symbols, in the chosen category; names looked up for those opened other ways.
  const recent = useTerminal((s) => s.recentSymbols) ?? [];
  const addRecent = useTerminal((s) => s.addRecentSymbol);
  const removeRecent = useTerminal((s) => s.removeRecentSymbol);
  const clearRecent = useTerminal((s) => s.clearRecentSymbols);
  const recentShown = recent.filter((r) => !category || (CATEGORY_KINDS[category] ?? [category]).includes(r.type ?? kindOf(r.symbol)));
  const unnamed = open && !q ? recentShown.filter((r) => !r.name).map((r) => r.symbol) : [];
  const { data: named = [] } = useQuery({
    queryKey: ["recent-names", unnamed.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${unnamed.map(encodeURIComponent).join(",")}`),
    enabled: unnamed.length > 0,
    staleTime: 3_600_000,
  });
  const recentRows: SearchResult[] = recentShown.map((r) => ({
    symbol: r.symbol,
    name: r.name ?? named.find((x) => x.symbol === r.symbol)?.name ?? "",
    exchange: r.exchange ?? "",
    type: r.type ?? kindOf(r.symbol),
  }));
  const shown = q ? results : recentRows;

  useEffect(() => {
    if (open) {
      // Opened by typing on a chart, it starts with what was typed.
      setQuery(initial);
      setSelected(0);
      // The field shows it at once, so keys typed straight after go on after it.
      if (inputRef.current) inputRef.current.value = initial;
      const focus = () => {
        const el = inputRef.current;
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      };
      focus();
      setTimeout(focus, 30);
    }
  }, [open, initial]);

  useEffect(() => setSelected(0), [shown.length, category]);
  // The row picked with the arrows stays in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const pick = (r: SearchResult, watch = false) => {
    // Its name, kind and exchange are kept with it for the recent list.
    addRecent({ symbol: r.symbol, name: r.name || undefined, exchange: r.exchange || undefined, type: r.type || undefined });
    setActiveSymbol(r.symbol);
    if (watch) addToWatchlist(r.symbol);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-16" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Symbol search"
        className="w-[min(760px,92vw)] max-h-[80vh] flex flex-col bg-[var(--panel)] border border-[var(--border)] rounded-md shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-fs-15 font-bold text-[var(--text)]">Symbol search</span>
          <button className="dim hover:text-[var(--text)] text-fs-15 px-1" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-4">
          <div className="flex items-center gap-2 border border-[var(--border)] focus-within:border-[var(--amber)] rounded px-2">
            <span className="dim" aria-hidden>
              ⌕
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelected((s) => Math.min(s + 1, shown.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelected((s) => Math.max(s - 1, 0));
                }
                if (e.key === "Enter" && shown[selected]) pick(shown[selected], e.shiftKey);
              }}
              placeholder="Symbol, ISIN, or CUSIP"
              spellCheck={false}
              className="flex-1 !border-0 !bg-transparent py-2 text-fs-13 uppercase placeholder:normal-case"
            />
            {query && (
              <button
                className="dim hover:text-[var(--text)] px-1"
                aria-label="Clear"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                ⊗
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 py-2.5">
            {CATEGORIES.map(([label, type]) => (
              <button
                key={label}
                onClick={() => {
                  setCategory(type);
                  inputRef.current?.focus();
                }}
                className={`px-3 py-1 rounded-full text-fs-11 border ${
                  category === type ? "bg-[var(--text)] text-[var(--bg)] border-[var(--text)] font-bold" : "border-[var(--border)] hover:border-[#555] text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div ref={listRef} className="flex-1 min-h-[120px] overflow-auto border-t border-[var(--border)]">
          {!q && recentRows.length > 0 && (
            <div className="px-4 pt-2 pb-1 flex items-center justify-between dim text-fs-10 uppercase tracking-wider">
              <span>Terakhir dibuka</span>
              <button className="normal-case hover:text-[var(--text)]" onClick={() => clearRecent()}>
                Hapus semua
              </button>
            </div>
          )}
          {shown.map((r, i) => (
            <div
              key={r.symbol + i}
              data-row={i}
              onClick={() => pick(r)}
              onMouseEnter={() => setSelected(i)}
              className={`px-4 py-2 flex items-center gap-3 cursor-pointer border-b border-[#161616] ${i === selected ? "bg-[#1f1a10]" : ""}`}
            >
              <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-fs-10 font-bold text-white" style={{ background: KIND_COLOR[r.type] ?? "#555" }}>
                {tickerOf(r.symbol).replace(/[^A-Z0-9]/gi, "").slice(0, 1)}
              </span>
              <span className={`w-28 shrink-0 font-bold truncate ${i === selected ? "amber" : "text-[var(--text)]"}`}>{tickerOf(r.symbol)}</span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="dim text-fs-10 shrink-0">{KIND_LABEL[r.type] ?? r.type}</span>
              <span className="text-[var(--text)] text-fs-10 w-28 text-right truncate shrink-0">{r.exchange}</span>
              {!q && (
                <button
                  className="dim hover:text-[var(--down)] px-1 shrink-0"
                  title="Hapus dari daftar terakhir dibuka"
                  aria-label={`Remove ${r.symbol} from recent`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecent(r.symbol);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {q && !isFetching && shown.length === 0 && <div className="px-4 py-10 text-center dim">No symbols match your criteria</div>}
          {!q && recentRows.length === 0 && (
            <div className="px-4 py-10 text-center dim">
              {recent.length > 0 ? `Belum ada ${CATEGORIES.find(([, t]) => t === category)?.[0] ?? ""} di riwayat. Ketik ticker, nama perusahaan, pair mata uang atau indeks.` : "Type a ticker, a company, a currency pair or an index"}
            </div>
          )}
        </div>
        <div className="px-4 py-1.5 dim text-fs-10 border-t border-[var(--border)]">Enter: load · Shift+Enter: load and add to the watchlist · ↑↓: pick</div>
      </div>
    </div>
  );
}
