"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { useWidgetSetting, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { usePoll } from "../../lib/refresh";
import { CATEGORY_COLOR, NEWS_CATEGORIES } from "../../lib/news-categories";
import { MARKET_LABEL, newsImpact, type Market, type NewsImpact } from "../../lib/news-impact";

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

const CATEGORIES = ["ALL", ...NEWS_CATEGORIES] as const;
const REGIONS = ["ALL", "GLOBAL", "US", "EU", "UK", "ASIA", "INDONESIA", "INDIA", "MENA"] as const;
/** How long a freshly arrived headline stays highlighted. */
const NEW_MS = 90_000;

function age(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A headline's mark when it moves markets: ⚡ and the markets for a big one, a quieter one for a
 *  notable one (lib/news-impact.ts). */
function ImpactMark({ impact }: { impact: NewsImpact }) {
  if (!impact) return null;
  const high = impact.level === "high";
  return (
    <span className="inline-flex items-center gap-1 mr-1.5 align-middle" title={`${high ? "Dampak besar" : "Dampak sedang"}: ${impact.reasons.join(", ")}`}>
      <span className={`text-fs-9 font-bold px-1 rounded-sm ${high ? "bg-[#ef5350] text-black" : "border border-[var(--amber)] amber"}`}>{high ? "⚡ DAMPAK BESAR" : "DAMPAK"}</span>
      {impact.markets.map((m) => (
        <span key={m} className={`text-fs-9 px-1 rounded-sm border ${high ? "border-[#ef5350] text-[#ef9a9a]" : "border-[#444] dim"}`}>
          {MARKET_LABEL[m]}
        </span>
      ))}
    </span>
  );
}

type ImpactFilter = "all" | "high" | "notable";

function LiveWire() {
  const [category, setCategory] = useWidgetSetting<(typeof CATEGORIES)[number]>("category", "ALL");
  const [region, setRegion] = useWidgetSetting<(typeof REGIONS)[number]>("region", "ALL");
  const [search, setSearch] = useWidgetSetting("search", "");
  // Only the headlines that move markets (big ones, or big and notable), and which market.
  const [impactOnly, setImpactOnly] = useWidgetSetting<ImpactFilter>("impact", "all");
  const [impactMarket, setImpactMarket] = useWidgetSetting<Market | "all">("impactMarket", "all");
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

  const impacts = new Map((data?.items ?? []).map((n) => [n.id, newsImpact(n.title)]));
  const counts = { high: 0, notable: 0 };
  for (const imp of impacts.values()) if (imp) imp.level === "high" ? (counts.high++, counts.notable++) : counts.notable++;
  const shown = (data?.items ?? []).filter((n) => {
    const imp = impacts.get(n.id);
    if (impactOnly === "all") return true;
    if (!imp || (impactOnly === "high" && imp.level !== "high")) return false;
    return impactMarket === "all" || imp.markets.includes(impactMarket);
  });

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex flex-wrap gap-1 px-1 pb-1 items-center">
        <button
          className={`term-btn ${impactOnly === "high" ? "active" : ""}`}
          style={impactOnly !== "high" ? { color: "#ef5350" } : undefined}
          title="Hanya berita yang diperkirakan berdampak besar ke pasar crypto, saham atau forex"
          onClick={() => setImpactOnly(impactOnly === "high" ? "all" : "high")}
        >
          ⚡ DAMPAK BESAR <span className="dim">{counts.high}</span>
        </button>
        <button
          className={`term-btn ${impactOnly === "notable" ? "active" : ""}`}
          title="Berita berdampak besar dan sedang"
          onClick={() => setImpactOnly(impactOnly === "notable" ? "all" : "notable")}
        >
          + SEDANG <span className="dim">{counts.notable}</span>
        </button>
        {impactOnly !== "all" &&
          (["all", "crypto", "stocks", "forex"] as const).map((m) => (
            <button key={m} className={`term-btn ${impactMarket === m ? "active" : ""}`} onClick={() => setImpactMarket(m)}>
              {m === "all" ? "SEMUA PASAR" : MARKET_LABEL[m]}
            </button>
          ))}
        <span className="w-px h-4 bg-[var(--border)] mx-0.5" />
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
      <div className="px-2 pb-1 text-fs-10 dim flex gap-2">
        <span>
          {/* With headlines on screen a failed refresh is "reconnecting", not offline. */}
          <span className={!error ? "up" : data ? "amber" : "down"}>●</span> {!error ? "LIVE" : data ? "RECONNECTING" : "OFFLINE"}
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
      {data && shown.length === 0 && <div className="p-2 dim">{impactOnly === "all" ? "No headlines match." : "Belum ada berita berdampak di daftar ini."}</div>}
      {shown.map((n) => {
        const fresh = arrived.current.has(n.id);
        const impact = impacts.get(n.id) ?? null;
        const big = impact?.level === "high";
        return (
          <a
            key={n.id}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            title={n.summary || n.title}
            className={`flex gap-2 px-2 py-1 border-b border-[#161616] hover:bg-[#161616] ${fresh ? "bg-[#1f1a0a]" : big ? "bg-[#1f1212]" : ""}`}
            style={fresh ? { boxShadow: "inset 2px 0 0 var(--amber)" } : big ? { boxShadow: "inset 3px 0 0 #ef5350" } : undefined}
          >
            <span className="dim w-7 shrink-0 text-right tabular-nums text-fs-10 pt-[2px]">{age(n.publishedAt, now)}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${big ? "font-bold text-[var(--text)]" : ""}`}>
                <ImpactMark impact={impact} />
                {n.title}
              </span>
              <span className="dim text-fs-10">
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
          <div className={`truncate ${newsImpact(n.title)?.level === "high" ? "font-bold text-[var(--text)]" : ""}`}>
            <ImpactMark impact={newsImpact(n.title)} />
            {n.title}
          </div>
          <div className="dim text-fs-10">
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
  const [mode, setMode] = useWidgetSetting<"wire" | "symbol">("mode", "wire");

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
