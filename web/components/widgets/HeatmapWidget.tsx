"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { apiGet } from "../../lib/api";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";

/** The periods a box's change can be over. */
const PERIODS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
type Period = (typeof PERIODS)[number];

/** The change at which a box is fully green or red: a wider move is normal over a longer period. */
const SCALE: Record<Period, number> = { "1D": 3, "1W": 6, "1M": 10, "3M": 15, "6M": 25, YTD: 25, "1Y": 40 };

/** The maps on offer, as the server names them: stock markets, then the other kinds. */
const MARKETS: Array<[string, Array<[string, string]>]> = [
  [
    "Stocks",
    [
      ["us", "US"],
      ["indonesia", "Indonesia"],
      ["japan", "Japan"],
      ["china", "China"],
      ["hongkong", "Hong Kong"],
      ["korea", "Korea"],
      ["taiwan", "Taiwan"],
      ["india", "India"],
      ["singapore", "Singapore"],
      ["malaysia", "Malaysia"],
      ["uk", "UK"],
      ["germany", "Germany"],
      ["france", "France"],
      ["canada", "Canada"],
      ["australia", "Australia"],
      ["brazil", "Brazil"],
    ],
  ],
  [
    "Other",
    [
      ["crypto", "Crypto"],
      ["etf", "ETFs (US)"],
      ["indices", "World Indices"],
      ["forex", "Forex"],
      ["commodities", "Commodities"],
    ],
  ],
];
/** What a box's size stands for, by map. */
const SIZED_BY: Record<string, string> = { etf: "AUM", indices: "equal", forex: "equal", commodities: "equal" };

type Cell = { symbol: string; label: string; name: string; group: string; size: number; perf: Partial<Record<Period, number | null>> };

type CellNodes = { rect: SVGRectElement; title: Element; pct: SVGTextElement | null; fill: string; pctText: string };

// Built once: creating an interpolator per cell on every refresh was pure churn.
const toUp = d3.interpolateRgb("#1a1a1a", "#00c853");
const toDown = d3.interpolateRgb("#1a1a1a", "#ff3d3d");
const colorFor = (chg: number, period: Period) => {
  const full = SCALE[period];
  const clamped = Math.max(-full, Math.min(full, chg));
  return clamped >= 0 ? toUp(clamped / full) : toDown(-clamped / full);
};
const pctLabel = (chg: number) => `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
const changeOf = (c: Cell, period: Period) => c.perf[period] ?? null;
const titleText = (c: Cell, period: Period) => `${c.label} · ${c.name}\n${c.group}\n${period}: ${pctLabel(changeOf(c, period)!)}`;

// Market caps drift a little every refresh; re-running the treemap then moves every
// rectangle and forces a full repaint. The layout is kept until the widget resizes,
// the set of names changes, or this long has passed.
const RELAYOUT_MS = 10 * 60_000;

/** Same names in the same groups keep the same layout. */
function layoutKey(rows: Cell[]): string {
  return rows
    .map((r) => `${r.group}:${r.symbol}`)
    .sort()
    .join("|");
}

/** Boxes with a size and a change over the period; one per symbol. */
const drawable = (rows: Cell[], period: Period) => {
  const seen = new Set<string>();
  return rows.filter((d) => {
    if (!(d.size > 0) || changeOf(d, period) === null || seen.has(d.symbol)) return false;
    seen.add(d.symbol);
    return true;
  });
};

/** A label cut to what fits `width` at `size` px. */
const fit = (text: string, width: number, size: number) => {
  const chars = Math.floor((width - 6) / (size * 0.62));
  return chars >= text.length ? text : chars >= 3 ? `${text.slice(0, chars - 1)}…` : "";
};

export default function HeatmapWidget() {
  const ref = useRef<HTMLDivElement>(null);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [market, setMarket] = useWidgetSetting("heatMarket", "us");
  const [period, setPeriod] = useWidgetSetting<Period>("heatPeriod", "1D");
  const poll = usePoll(sessionRefreshMs(15_000, 300_000));
  const { data, error } = useQuery({
    queryKey: ["heatmap", market],
    queryFn: () => apiGet<Cell[]>(`/api/heatmap?market=${market}`),
    refetchInterval: poll,
  });

  const latest = useRef<Cell[]>([]);
  const periodRef = useRef<Period>(period);
  const built = useRef<{ key: string; width: number; height: number; at: number; cells: Map<string, CellNodes> } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;
    latest.current = data;
    periodRef.current = period;

    const build = () => {
      const p = periodRef.current;
      const rows = drawable(latest.current, p);
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0) return;
      el.innerHTML = "";

      type Node = { name: string; children?: Node[]; data?: Cell };
      const root = d3
        .hierarchy<Node>({
          name: "root",
          children: [...d3.group(rows, (d) => d.group)].map(([group, items]) => ({
            name: group,
            children: items.map((d) => ({ name: d.symbol, data: d })),
          })),
        })
        .sum((d) => d.data?.size ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      d3.treemap<Node>().size([width, height]).paddingInner(1).paddingTop(12)(root);

      // Absolutely positioned inside an overflow-hidden box: an in-flow SVG exactly the size of
      // the panel toggled the panel's scrollbars, which resized it, which rebuilt the SVG —
      // a rebuild loop running every frame.
      const svg = d3.select(el).append("svg").attr("width", width).attr("height", height).style("position", "absolute").style("inset", "0");

      // Clip each group label to its own column so long names never bleed
      // into the neighboring group (the visible cause of overlapping text).
      const groupClipId = (name: string, i: number) => `heat-group-clip-${i}-${name.replace(/[^a-zA-Z0-9]/g, "")}`;

      svg
        .selectAll("clipPath.group-clip")
        .data(root.children ?? [])
        .join("clipPath")
        .attr("class", "group-clip")
        .attr("id", (d: any, i) => groupClipId(d.data.name, i))
        .append("rect")
        .attr("x", (d: any) => d.x0)
        .attr("y", (d: any) => d.y0)
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0 - 4))
        .attr("height", 12);

      svg
        .selectAll("text.group")
        .data(root.children ?? [])
        .join("text")
        .attr("class", "group")
        .attr("display", (d: any) => (d.x1 - d.x0 > 20 ? null : "none"))
        .attr("x", (d: any) => d.x0 + 3)
        .attr("y", (d: any) => d.y0 + 9)
        .attr("clip-path", (d: any, i) => `url(#${groupClipId(d.data.name, i)})`)
        .attr("fill", "#808080")
        .attr("font-size", 8)
        .text((d: any) => d.data.name.toUpperCase());

      const cells = new Map<string, CellNodes>();
      svg
        .selectAll("g.leaf")
        .data(root.leaves())
        .join("g")
        .attr("class", "leaf")
        .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`)
        .style("cursor", "pointer")
        .on("click", (_e, d: any) => setActiveSymbol(d.data.data.symbol))
        .each(function (d: any) {
          const cell: Cell = d.data.data;
          const w = d.x1 - d.x0;
          const h = d.y1 - d.y0;
          const g = d3.select(this);
          const chg = changeOf(cell, p)!;
          const fill = colorFor(chg, p);
          const rect = g.append("rect").attr("width", Math.max(0, w)).attr("height", Math.max(0, h)).attr("fill", fill);
          const title = rect.append("title").text(titleText(cell, p));
          // Bigger boxes get bigger text, as on TradingView.
          const fs = Math.max(9, Math.min(20, Math.min(w / 5, h / 3.2)));
          const label = h > 18 ? fit(cell.label, w, fs) : "";
          if (label) g.append("text").attr("x", 3).attr("y", fs + 2).attr("fill", "#fff").attr("font-size", fs).attr("font-weight", "bold").text(label);
          const pctText = pctLabel(chg);
          const pctSize = Math.max(8, fs * 0.8);
          const pct =
            label && w > 40 && h > fs + pctSize + 8
              ? g.append("text").attr("x", 3).attr("y", fs + pctSize + 5).attr("fill", "#ddd").attr("font-size", pctSize).text(pctText).node()
              : null;
          cells.set(cell.symbol, { rect: rect.node()!, title: title.node()!, pct, fill, pctText });
        });

      built.current = { key: layoutKey(rows), width, height, at: Date.now(), cells };
    };

    /** Recolor in place: only cells whose value changed are touched, so only they repaint. */
    const update = () => {
      const p = periodRef.current;
      const cells = built.current!.cells;
      for (const cell of drawable(latest.current, p)) {
        const nodes = cells.get(cell.symbol);
        if (!nodes) continue;
        const chg = changeOf(cell, p)!;
        const fill = colorFor(chg, p);
        if (fill !== nodes.fill) {
          nodes.rect.setAttribute("fill", fill);
          nodes.fill = fill;
        }
        const text = pctLabel(chg);
        if (text !== nodes.pctText) {
          if (nodes.pct) nodes.pct.textContent = text;
          nodes.pctText = text;
        }
        nodes.title.textContent = titleText(cell, p);
      }
    };

    const sameSize = (cur: { width: number; height: number }) =>
      Math.abs(cur.width - el.clientWidth) <= 2 && Math.abs(cur.height - el.clientHeight) <= 2;
    const b = built.current;
    const reusable =
      b !== null && el.firstChild !== null && sameSize(b) &&
      b.key === layoutKey(drawable(data, period)) && Date.now() - b.at < RELAYOUT_MS;
    if (reusable) update();
    else build();

    // Resizing (e.g. dragging the panel edge) rebuilds at most once per animation frame.
    let frame = 0;
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cur = built.current;
        if (!cur || !sameSize(cur)) build();
      });
    });
    obs.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      obs.disconnect();
    };
  }, [data, period, setActiveSymbol]);

  const full = SCALE[period];
  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex items-center gap-1 px-1 py-0.5 flex-wrap text-fs-11 shrink-0">
        <select
          value={market}
          onChange={(e) => {
            built.current = null;
            setMarket(e.target.value);
          }}
          className="bg-[var(--panel)] border border-[var(--border)] px-1 cursor-pointer"
          aria-label="Market"
          title="Market"
        >
          {MARKETS.map(([label, options]) => (
            <optgroup key={label} label={label}>
              {options.map(([v, name]) => (
                <option key={v} value={v}>
                  {name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="w-px h-3 bg-[var(--border)] mx-1" />
        <span className="dim">Chg over</span>
        <span className="flex items-center gap-1" role="group" aria-label="Change over">
          {PERIODS.map((p) => (
            <button key={p} className={`term-btn ${p === period ? "active" : ""}`} onClick={() => setPeriod(p)} aria-pressed={p === period}>
              {p}
            </button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1 dim" title="Fully red or green at this change">
          <span>−{full}%</span>
          <span className="inline-block w-20 h-2" style={{ background: "linear-gradient(to right, #ff3d3d, #1a1a1a, #00c853)" }} />
          <span>+{full}%</span>
          <span className="ml-2">size: {SIZED_BY[market] ?? "market cap"}</span>
        </span>
      </div>
      {error && !data ? (
        <div className="p-2 down">Error: {(error as Error).message}</div>
      ) : !data ? (
        <div className="p-2 dim">Loading heatmap…</div>
      ) : (
        <div ref={ref} className="relative w-full flex-1 min-h-0 overflow-hidden" />
      )}
    </div>
  );
}
