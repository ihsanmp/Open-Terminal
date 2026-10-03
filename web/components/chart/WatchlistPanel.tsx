"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Candle, type Quote } from "../../lib/api";
import { listRefreshMs, quoteRefreshMs, usePoll } from "../../lib/refresh";
import {
  MARKET_DEFAULTS,
  MARKET_KINDS,
  PERF_PERIODS,
  badgeOf,
  displaySymbol,
  groupBySection,
  marketOf,
  marketOpen,
  performance,
  priceDigits,
  sectionOf,
  sectionsFor,
  type MarketKind,
  type Section,
} from "../../lib/watchlist";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";
import { technicals, type Group, type Rating } from "../../lib/technicals";

// TradingView's right-hand Watchlist on the chart page: the watchlist by section (indices, stocks,
// futures, forex, crypto), each row loading its symbol into the chart, and under it the details of
// the symbol on the chart: price, market status, key stats and performance.
//
// It follows the chart's kind of market: a Solana chart lists crypto, a stock chart stocks and
// indices, gold or EURUSD commodities and forex (or one kind, or all, chosen in its header). Each
// kind's list starts with the usual symbols the first time it shows; it is the user's from then on.

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
function AddSymbol({ kind, onAdd, onClose }: { kind: MarketKind | "all"; onAdd: (symbol: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const { data: found = [] } = useQuery({
    queryKey: ["search", q],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    staleTime: 300_000,
  });
  // Suggestions of the kind on show, so what's added appears in the list.
  const results = kind === "all" ? found : found.filter((r) => marketOf(r.symbol) === kind);
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
        placeholder={kind === "all" ? "Add symbol…" : `Add ${MARKET_KINDS.find(([k]) => k === kind)?.[1].toLowerCase()}…`}
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

/** A low–high range with the price marked on it, as TradingView draws Day's and 52-week range. */
function RangeBar({ label, low, high, price, digits }: { label: string; low: number; high: number; price: number | null | undefined; digits: number }) {
  const at = price != null && high > low ? Math.max(0, Math.min(1, (price - low) / (high - low))) : null;
  return (
    <div className="py-1">
      <div className="dim mb-1">{label}</div>
      <div className="relative h-1 rounded bg-[#2a2a2a]">
        {at !== null && (
          <>
            <div className="absolute inset-y-0 left-0 rounded bg-[var(--amber-dim)]" style={{ width: `${at * 100}%` }} />
            <div className="absolute -top-[3px] w-2.5 h-2.5 rounded-full bg-[var(--amber)] -translate-x-1/2" style={{ left: `${at * 100}%` }} />
          </>
        )}
      </div>
      <div className="flex justify-between mt-1 tabular-nums">
        <span>{fmt(low, digits)}</span>
        <span>{fmt(high, digits)}</span>
      </div>
    </div>
  );
}

const RATING_COLOR: Record<Rating, string> = {
  "Strong sell": "#e05555",
  Sell: "#e88080",
  Neutral: "#a8a8a8",
  Buy: "#4fd1a0",
  "Strong buy": "#2ecc8f",
};

/** TradingView's Technicals: a gauge from Strong sell to Strong buy, and the votes behind it. */
function TechnicalsView({ t }: { t: { summary: Group; movingAverages: Group; oscillators: Group } }) {
  const needle = ((t.summary.score + 1) / 2) * 100;
  const row = (label: string, g: Group) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="dim">{label}</span>
      <span>
        <b style={{ color: RATING_COLOR[g.rating] }}>{g.rating}</b>
        <span className="dim text-fs-10">
          {" "}
          · S {g.sell} · N {g.neutral} · B {g.buy}
        </span>
      </span>
    </div>
  );
  return (
    <>
      <div className="text-center text-fs-15 font-bold mb-1" style={{ color: RATING_COLOR[t.summary.rating] }}>
        {t.summary.rating}
      </div>
      <div className="relative h-2 rounded" style={{ background: "linear-gradient(90deg, #e05555, #e88080 30%, #555 50%, #4fd1a0 70%, #2ecc8f)" }}>
        <div className="absolute -top-1 w-1 h-4 bg-white rounded -translate-x-1/2" style={{ left: `${needle}%` }} />
      </div>
      <div className="flex justify-between dim text-fs-9 mt-1 mb-2">
        <span>Strong sell</span>
        <span>Neutral</span>
        <span>Strong buy</span>
      </div>
      {row("Moving averages", t.movingAverages)}
      {row("Oscillators", t.oscillators)}
      <div className="dim text-fs-9 mt-1">From daily candles: a reading of the indicators, not a forecast.</div>
    </>
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
  const tech = useMemo(() => (candles ? technicals(candles) : null), [candles]);
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
  add("P/E (TTM)", q?.pe, (n) => fmt(n));
  add("Dividend yield", q?.dividendYield, (n) => `${fmt(n * 100)}%`);

  return (
    <div className="p-2.5">
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

      {(stats.length > 0 || q?.low != null || q?.week52Low != null) && (
        <>
          <div className="font-bold mt-3 mb-1">Key stats</div>
          {stats.map(([label, value]) => (
            <div key={label} className="flex justify-between py-0.5">
              <span className="dim">{label}</span>
              <span>{value}</span>
            </div>
          ))}
          {q?.low != null && q?.high != null && <RangeBar label="Day's range" low={q.low} high={q.high} price={q.price} digits={digits} />}
          {q?.week52Low != null && q?.week52High != null && <RangeBar label="52-week range" low={q.week52Low} high={q.week52High} price={q.price} digits={digits} />}
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

      {tech && (
        <>
          <div className="font-bold mt-4 mb-1.5">Technicals</div>
          <TechnicalsView t={tech} />
        </>
      )}
    </div>
  );
}

/** The panel itself; `symbol` is the chart's, `onPick` loads another into the chart. */
export default function WatchlistPanel({ symbol, onPick, onHide }: { symbol: string; onPick: (s: string) => void; onHide: () => void }) {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const [collapsed, setCollapsed] = useWidgetSetting<Section[]>("watchlistCollapsed", []);
  const [choice, setChoice] = useWidgetSetting<MarketKind | "all" | "auto">("watchlistMarket", "auto");
  const [seeded, setSeeded] = useWidgetSetting<MarketKind[]>("watchlistSeeded", []);
  const [adding, setAdding] = useState(false);
  const kind = choice === "auto" ? marketOf(symbol) : choice;

  // The first time a kind shows, its list starts with the usual symbols (once: what the user then
  // removes stays removed).
  useEffect(() => {
    const kinds = kind === "all" ? MARKET_KINDS.map(([k]) => k) : [kind];
    const fresh = kinds.filter((k) => !seeded.includes(k));
    if (!fresh.length) return;
    for (const k of fresh) for (const s of MARKET_DEFAULTS[k]) addToWatchlist(s);
    setSeeded((done) => [...done, ...fresh.filter((k) => !done.includes(k))]);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = sectionsFor(kind);
  const listed = watchlist.filter((s) => shown.includes(sectionOf(s)));
  const poll = usePoll(() => listRefreshMs(listed));
  const { data: quotes = [] } = useQuery({
    queryKey: ["watchlist", listed.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${listed.join(",")}`),
    enabled: listed.length > 0,
    refetchInterval: poll,
  });
  const groups = groupBySection(listed);
  const toggle = (s: Section) => setCollapsed((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--panel)]">
      <div className="flex items-center gap-1 px-2.5 h-9 border-b border-[var(--border)] shrink-0">
        <span className="font-bold text-fs-13">Watchlist</span>
        <select
          className="flex-1 min-w-0 ml-1 !bg-transparent !border-transparent hover:!border-[var(--border)] dim"
          title="Which symbols to list: the chart's kind of market, one kind, or all"
          aria-label="Watchlist market"
          value={choice}
          onChange={(e) => setChoice(e.target.value as MarketKind | "all" | "auto")}
        >
          <option value="auto">Auto · {MARKET_KINDS.find(([k]) => k === marketOf(symbol))?.[1]}</option>
          {MARKET_KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
          <option value="all">All</option>
        </select>
        <button className="dim hover:text-[var(--amber)] px-1 text-fs-15" title="Add symbol" aria-label="Add symbol" onClick={() => setAdding((a) => !a)}>
          +
        </button>
        <button className="dim hover:text-[var(--amber)] px-1" title="Hide watchlist" aria-label="Hide watchlist" onClick={onHide}>
          »
        </button>
      </div>
      {adding && <AddSymbol kind={kind} onAdd={addToWatchlist} onClose={() => setAdding(false)} />}
      {/* As tall as its rows (up to 60%, then it scrolls); the details fill the rest, right below. */}
      <div className="shrink min-h-[5rem] max-h-[60%] overflow-auto">
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
        {listed.length === 0 && <div className="dim p-3">Nothing listed here yet: “+” adds a symbol.</div>}
      </div>
      <div className="flex-1 min-h-[40%] overflow-auto border-t border-[var(--border)]">
        <Details symbol={symbol} />
      </div>
    </div>
  );
}
