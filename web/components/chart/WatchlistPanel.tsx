"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Candle, type Quote } from "../../lib/api";
import { listRefreshMs, quoteRefreshMs, usePoll } from "../../lib/refresh";
import { PERF_PERIODS, badgeOf, displaySymbol, groupBySection, marketOpen, performance, priceDigits, sectionOf, type Section } from "../../lib/watchlist";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";

// TradingView's right-hand Watchlist on the chart page: the watchlist by section (indices, stocks,
// futures, forex, crypto), each row loading its symbol into the chart, and under it the details of
// the symbol on the chart: price, market status, key stats and performance.

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

const SECTION_KIND: Record<Section, string> = { indices: "Index", stocks: "Stock", futures: "Futures", forex: "Forex", crypto: "Crypto" };

function Badge({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const b = badgeOf(symbol);
  return (
    <span
      className="rounded-full inline-flex items-center justify-center shrink-0 text-white font-bold"
      style={{ width: size, height: size, background: b.color, fontSize: size * 0.42 }}
      aria-hidden
    >
      {b.text}
    </span>
  );
}

/** The "+" button's search: a symbol typed, or picked from the suggestions. */
function AddSymbol({ onAdd, onClose }: { onAdd: (symbol: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const { data: results = [] } = useQuery({
    queryKey: ["search", q],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    staleTime: 300_000,
  });
  const add = (s: string) => {
    if (s.trim()) onAdd(s.trim().toUpperCase());
    onClose();
  };
  return (
    <div className="border-b border-[var(--border)] p-1.5">
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add(results[0]?.symbol ?? q);
          if (e.key === "Escape") onClose();
        }}
        placeholder="Add symbol…"
        className="w-full"
      />
      {results.slice(0, 8).map((r) => (
        <button key={r.symbol} className="w-full flex items-center gap-2 px-1 py-1 text-left hover:bg-[#1f1f1f]" onClick={() => add(r.symbol)}>
          <Badge symbol={r.symbol} size={16} />
          <span className="font-bold">{displaySymbol(r.symbol)}</span>
          <span className="dim truncate flex-1">{r.name}</span>
          <span className="dim text-fs-10">{r.exchange}</span>
        </button>
      ))}
    </div>
  );
}

function Details({ symbol }: { symbol: string }) {
  const poll = usePoll(() => quoteRefreshMs(symbol));
  const { data: q } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${symbol}`))[0],
    refetchInterval: poll,
  });
  const { data: candles } = useQuery({
    queryKey: ["perf-history", symbol],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(symbol)}?range=1Y&interval=1D`),
    staleTime: 600_000,
  });
  const perf = useMemo(() => (candles ? performance(candles) : null), [candles]);
  const open = marketOpen(symbol, q?.marketState);
  const section = sectionOf(symbol);
  const digits = priceDigits(symbol, q?.price);

  const stats: Array<[string, string]> = [];
  const add = (label: string, v: number | null | undefined, f: (n: number) => string) => {
    if (v !== null && v !== undefined && Number.isFinite(v)) stats.push([label, f(v)]);
  };
  add("Volume", q?.volume || null, fmtBig); // forex reports none (0)
  add("Average volume (3M)", q?.avgVolume, fmtBig);
  add("Market capitalization", q?.marketCap, fmtBig);
  if (q?.low != null && q?.high != null) stats.push(["Day's range", `${fmt(q.low, digits)} – ${fmt(q.high, digits)}`]);
  if (q?.week52Low != null && q?.week52High != null) stats.push(["52-week range", `${fmt(q.week52Low, digits)} – ${fmt(q.week52High, digits)}`]);
  add("P/E (TTM)", q?.pe, (n) => fmt(n));
  add("Dividend yield", q?.dividendYield, (n) => `${fmt(n * 100)}%`);

  return (
    <div className="p-2.5 border-t border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Badge symbol={symbol} size={26} />
        <span className="font-bold text-fs-14">{displaySymbol(symbol)}</span>
      </div>
      <div className="mt-1.5 text-[var(--text)] truncate" title={q?.name ?? undefined}>
        {q?.name ?? symbol}
        {q?.exchange && <span className="dim"> · {q.exchange}</span>}
      </div>
      <div className="dim text-fs-10">{SECTION_KIND[section]}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <Flash value={q?.price} className="text-fs-20 font-bold">
          {fmt(q?.price, digits)}
        </Flash>
        <span className="dim text-fs-10">{q?.currency ?? ""}</span>
      </div>
      <div className={`${pctClass(q?.changePercent)}`}>
        {q?.change != null && q.change >= 0 ? "+" : ""}
        {fmt(q?.change, digits)} {q?.changePercent != null && q.changePercent >= 0 ? "+" : ""}
        {fmt(q?.changePercent)}%
      </div>
      <div className={`text-fs-10 mt-0.5 ${open ? "up" : "dim"}`}>● {open ? "Market open" : "Market closed"}</div>

      {stats.length > 0 && (
        <>
          <div className="font-bold mt-3 mb-1">Key stats</div>
          {stats.map(([label, value]) => (
            <div key={label} className="flex justify-between py-0.5">
              <span className="dim">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </>
      )}

      <div className="font-bold mt-3 mb-1.5">Performance</div>
      <div className="grid grid-cols-3 gap-1">
        {PERF_PERIODS.map((p) => {
          const v = perf?.[p] ?? null;
          const tone = v === null ? "bg-[#1a1a1a] dim" : v >= 0 ? "bg-[#0f2e22] up" : "bg-[#3a1515] down";
          return (
            <div key={p} className={`rounded py-1.5 text-center ${tone}`}>
              <div className="font-bold">{v === null ? "—" : `${fmt(v)}%`}</div>
              <div className="dim text-fs-10">{p}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The panel itself; `symbol` is the chart's, `onPick` loads another into the chart. */
export default function WatchlistPanel({ symbol, onPick, onHide }: { symbol: string; onPick: (s: string) => void; onHide: () => void }) {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const [collapsed, setCollapsed] = useWidgetSetting<Section[]>("watchlistCollapsed", []);
  const [adding, setAdding] = useState(false);
  const poll = usePoll(() => listRefreshMs(watchlist));
  const { data: quotes = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${watchlist.join(",")}`),
    enabled: watchlist.length > 0,
    refetchInterval: poll,
  });
  const groups = groupBySection(watchlist);
  const toggle = (s: Section) => setCollapsed((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--panel)]">
      <div className="flex items-center gap-1 px-2.5 h-9 border-b border-[var(--border)] shrink-0">
        <span className="font-bold text-fs-13 flex-1">Watchlist</span>
        <button className="dim hover:text-[var(--amber)] px-1 text-fs-15" title="Add symbol" aria-label="Add symbol" onClick={() => setAdding((a) => !a)}>
          +
        </button>
        <button className="dim hover:text-[var(--amber)] px-1" title="Hide watchlist" aria-label="Hide watchlist" onClick={onHide}>
          »
        </button>
      </div>
      {adding && <AddSymbol onAdd={addToWatchlist} onClose={() => setAdding(false)} />}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[var(--panel)] z-[1]">
            <tr className="dim text-fs-11">
              <th className="text-left font-normal px-2.5 py-1">Symbol</th>
              <th className="text-right font-normal px-1 py-1">Last</th>
              <th className="text-right font-normal px-1 py-1">Chg</th>
              <th className="text-right font-normal pl-1 pr-2.5 py-1">Chg%</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const shut = collapsed.includes(g.section);
              return [
                <tr key={g.section} className="cursor-pointer select-none" onClick={() => toggle(g.section)}>
                  <td colSpan={4} className="dim text-fs-10 tracking-wider px-2.5 pt-2.5 pb-1">
                    <span className="inline-block w-3">{shut ? "›" : "⌄"}</span> {g.label}
                  </td>
                </tr>,
                ...(shut
                  ? []
                  : g.symbols.map((s) => {
                      const q = quotes.find((x) => x.symbol === s);
                      const active = s.toUpperCase() === symbol.toUpperCase();
                      return (
                        <tr
                          key={s}
                          onClick={() => onPick(s)}
                          title={q?.name ?? s}
                          className={`group cursor-pointer ${active ? "bg-[#1f1a10] outline outline-1 outline-[var(--amber-dim)] -outline-offset-1" : "hover:bg-[#161616]"}`}
                        >
                          <td className="px-2.5 py-1">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <Badge symbol={s} />
                              <span className="font-bold truncate">{displaySymbol(s)}</span>
                              <button
                                className="ml-auto opacity-0 group-hover:opacity-100 dim hover:text-[var(--down)] px-0.5"
                                title="Remove from watchlist"
                                aria-label={`Remove ${s}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFromWatchlist(s);
                                }}
                              >
                                ×
                              </button>
                            </span>
                          </td>
                          <td className="text-right px-1 tabular-nums">
                            <Flash value={q?.price}>{fmt(q?.price, priceDigits(s, q?.price))}</Flash>
                          </td>
                          <td className={`text-right px-1 tabular-nums ${pctClass(q?.change)}`}>{fmt(q?.change, priceDigits(s, q?.price))}</td>
                          <td className={`text-right pl-1 pr-2.5 tabular-nums ${pctClass(q?.changePercent)}`}>{fmt(q?.changePercent)}%</td>
                        </tr>
                      );
                    })),
              ];
            })}
          </tbody>
        </table>
        {watchlist.length === 0 && <div className="dim p-3">The watchlist is empty: “+” adds a symbol.</div>}
      </div>
      <div className="shrink-0 max-h-[55%] overflow-auto">
        <Details symbol={symbol} />
      </div>
    </div>
  );
}
