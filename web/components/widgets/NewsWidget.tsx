"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { usePoll } from "../../lib/refresh";

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

type WireItem = {
  id: string;
  title: string;
  link: string;
  summary: string;
  publisher: string;
  category: string;
  region: string;
  tier: number;
  publishedAt: string;
};
type Wire = { updatedAt: string; sources: { total: number; live: number }; items: WireItem[] };

const CATEGORIES = ["ALL", "MARKETS", "ECONOMIC", "REGULATORY", "GEOPOLITICS", "CRYPTO", "ENERGY", "TECH"] as const;
const REGIONS = ["ALL", "GLOBAL", "US", "EU", "UK", "ASIA", "INDONESIA", "INDIA", "MENA"] as const;
const CATEGORY_COLOR: Record<string, string> = {
  MARKETS: "#ff9900",
  ECONOMIC: "#26c6da",
  REGULATORY: "#b388ff",
  GEOPOLITICS: "#ff5252",
  CRYPTO: "#f7931a",
  ENERGY: "#ffeb3b",
  TECH: "#00e676",
};
/** How long a freshly arrived headline stays highlighted. */
const NEW_MS = 90_000;

function age(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

function LiveWire() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("ALL");
  const [region, setRegion] = useState<(typeof REGIONS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const params = new URLSearchParams({ limit: "200" });
  if (category !== "ALL") params.set("category", category);
  if (region !== "ALL") params.set("region", region);
  if (q) params.set("q", q);

  // The server polls every feed each minute; this only reads its in-memory wire.
  const poll = usePoll(15_000);
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["news-wire", category, region, q],
    queryFn: () => apiGet<Wire>(`/api/news/wire?${params}`),
    refetchInterval: poll,
    placeholderData: (prev) => prev,
  });

  // Headlines that arrive while the wire is open are marked until NEW_MS has passed.
  const seen = useRef<Set<string> | null>(null);
  const arrived = useRef(new Map<string, number>());
  const now = dataUpdatedAt || Date.now();
  if (data) {
    if (seen.current === null) seen.current = new Set(data.items.map((i) => i.id));
    for (const item of data.items) {
      if (!seen.current.has(item.id)) {
        seen.current.add(item.id);
        arrived.current.set(item.id, now);
      }
    }
    for (const [id, at] of arrived.current) if (now - at > NEW_MS) arrived.current.delete(id);
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex flex-wrap gap-1 px-1 pb-1 items-center">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`term-btn ${category === c ? "active" : ""}`}
            style={c !== "ALL" && category !== c ? { color: CATEGORY_COLOR[c] } : undefined}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
        <select className="ml-1" value={region} onChange={(e) => setRegion(e.target.value as (typeof REGIONS)[number])} title="Region">
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r === "ALL" ? "ALL REGIONS" : r}
            </option>
          ))}
        </select>
        <input className="flex-1 min-w-[90px]" placeholder="filter headlines…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="px-2 pb-1 text-[10px] dim flex gap-2">
        <span>
          <span className={error ? "down" : "up"}>●</span> {error ? "OFFLINE" : "LIVE"}
        </span>
        {data && (
          <>
            <span>
              {data.sources.live}/{data.sources.total} sources
            </span>
            <span>{data.items.length} headlines</span>
            <span>feeds checked {age(data.updatedAt, Date.now())} ago</span>
          </>
        )}
      </div>
      {isLoading && <div className="p-2 dim">Connecting to the news wire…</div>}
      {data?.items.length === 0 && <div className="p-2 dim">No headlines match.</div>}
      {data?.items.map((n) => {
        const fresh = arrived.current.has(n.id);
        return (
          <a
            key={n.id}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            title={n.summary || n.title}
            className={`flex gap-2 px-2 py-1 border-b border-[#161616] hover:bg-[#161616] ${fresh ? "bg-[#1f1a0a]" : ""}`}
            style={fresh ? { boxShadow: "inset 2px 0 0 var(--amber)" } : undefined}
          >
            <span className="dim w-7 shrink-0 text-right tabular-nums text-[10px] pt-[2px]">{age(n.publishedAt, now)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{n.title}</span>
              <span className="dim text-[10px]">
                <span style={{ color: CATEGORY_COLOR[n.category] }}>{n.category}</span> · {n.publisher}
                {n.region !== "GLOBAL" ? ` · ${n.region}` : ""} · {new Date(n.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function SymbolNews({ symbol }: { symbol: string }) {
  const poll = usePoll(120_000);
  const { data = [], isLoading } = useQuery({
    queryKey: ["news", "symbol", symbol],
    queryFn: () => apiGet<NewsItem[]>(`/api/news?symbol=${symbol}`),
    refetchInterval: poll,
  });
  return (
    <>
      {isLoading && <div className="p-2 dim">Loading news…</div>}
      {data.map((n, i) => (
        <a key={i} href={n.link} target="_blank" rel="noreferrer" className="block px-2 py-1 border-b border-[#161616] hover:bg-[#161616]">
          <div className="truncate">{n.title}</div>
          <div className="dim text-[10px]">
            {n.publisher}
            {n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString() : ""}
          </div>
        </a>
      ))}
    </>
  );
}

export default function NewsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<"wire" | "symbol">("wire");

  return (
    <div>
      <div className="flex gap-1 p-1">
        <button className={`term-btn ${mode === "wire" ? "active" : ""}`} onClick={() => setMode("wire")} title="Every source, live">
          LIVE WIRE
        </button>
        <button className={`term-btn ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          {symbol}
        </button>
      </div>
      {mode === "wire" ? <LiveWire /> : <SymbolNews symbol={symbol} />}
    </div>
  );
}
