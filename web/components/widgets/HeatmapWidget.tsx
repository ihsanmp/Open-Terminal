"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { apiGet } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";

type Cell = { symbol: string; name: string | null; sector: string; marketCap: number | null; changePercent: number | null };

type CellNodes = { rect: SVGRectElement; title: Element; pct: SVGTextElement | null; fill: string; pctText: string };

// Built once: creating an interpolator per cell on every refresh was pure churn.
const toUp = d3.interpolateRgb("#1a1a1a", "#00c853");
const toDown = d3.interpolateRgb("#1a1a1a", "#ff3d3d");
const color = (chg: number) => {
  const clamped = Math.max(-3, Math.min(3, chg));
  return clamped >= 0 ? toUp(clamped / 3) : toDown(-clamped / 3);
};
const pctLabel = (chg: number) => `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
const titleText = (c: Cell) => `${c.symbol} ${c.name ?? ""}: ${c.changePercent!.toFixed(2)}%`;

// Market caps drift a little every refresh; re-running the treemap then moves every
// rectangle and forces a full repaint. The layout is kept until the widget resizes,
// the set of names changes, or this long has passed.
const RELAYOUT_MS = 10 * 60_000;

/** Same names in the same sectors keep the same layout. */
function layoutKey(rows: Cell[]): string {
  return rows
    .map((r) => `${r.sector}:${r.symbol}`)
    .sort()
    .join("|");
}

const drawable = (rows: Cell[]) => rows.filter((d) => d.marketCap && d.changePercent !== null);

export default function HeatmapWidget() {
  const ref = useRef<HTMLDivElement>(null);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const poll = usePoll(sessionRefreshMs(15_000, 300_000));
  const { data, error } = useQuery({
    queryKey: ["heatmap"],
    queryFn: () => apiGet<Cell[]>("/api/heatmap"),
    refetchInterval: poll,
  });

  const latest = useRef<Cell[]>([]);
  const built = useRef<{ key: string; width: number; height: number; at: number; cells: Map<string, CellNodes> } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;
    latest.current = data;

    const build = () => {
      const rows = drawable(latest.current);
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0) return;
      el.innerHTML = "";

      type Node = { name: string; children?: Node[]; data?: Cell };
      const root = d3
        .hierarchy<Node>({
          name: "root",
          children: [...d3.group(rows, (d) => d.sector)].map(([sector, items]) => ({
            name: sector,
            children: items.map((d) => ({ name: d.symbol, data: d })),
          })),
        })
        .sum((d) => d.data?.marketCap ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      d3.treemap<Node>().size([width, height]).paddingInner(1).paddingTop(12)(root);

      // Absolutely positioned inside an overflow-hidden box: an in-flow SVG exactly the size of
      // the panel toggled the panel's scrollbars, which resized it, which rebuilt the SVG —
      // a rebuild loop running every frame.
      const svg = d3.select(el).append("svg").attr("width", width).attr("height", height).style("position", "absolute").style("inset", "0");

      // Clip each sector label to its own column so long names never bleed
      // into the neighboring sector (the visible cause of overlapping text).
      const sectorClipId = (name: string) => `sector-clip-${name.replace(/[^a-zA-Z0-9]/g, "")}`;

      svg
        .selectAll("clipPath.sector-clip")
        .data(root.children ?? [])
        .join("clipPath")
        .attr("class", "sector-clip")
        .attr("id", (d: any) => sectorClipId(d.data.name))
        .append("rect")
        .attr("x", (d: any) => d.x0)
        .attr("y", (d: any) => d.y0)
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0 - 4))
        .attr("height", 12);

      svg
        .selectAll("text.sector")
        .data((root.children ?? []).filter((d: any) => d.x1 - d.x0 > 20))
        .join("text")
        .attr("class", "sector")
        .attr("x", (d: any) => d.x0 + 3)
        .attr("y", (d: any) => d.y0 + 9)
        .attr("clip-path", (d: any) => `url(#${sectorClipId(d.data.name)})`)
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
          const fill = color(cell.changePercent!);
          const rect = g.append("rect").attr("width", Math.max(0, w)).attr("height", Math.max(0, h)).attr("fill", fill);
          const title = rect.append("title").text(titleText(cell));
          if (w > 32 && h > 18) {
            g.append("text").attr("x", 3).attr("y", 11).attr("fill", "#fff").attr("font-size", 9).attr("font-weight", "bold").text(cell.symbol);
          }
          const pctText = pctLabel(cell.changePercent!);
          const pct = w > 40 && h > 30 ? g.append("text").attr("x", 3).attr("y", 22).attr("fill", "#ddd").attr("font-size", 8).text(pctText).node() : null;
          cells.set(cell.symbol, { rect: rect.node()!, title: title.node()!, pct, fill, pctText });
        });

      built.current = { key: layoutKey(rows), width, height, at: Date.now(), cells };
    };

    /** Recolor in place: only cells whose value changed are touched, so only they repaint. */
    const update = () => {
      const cells = built.current!.cells;
      for (const cell of drawable(latest.current)) {
        const nodes = cells.get(cell.symbol);
        if (!nodes) continue;
        const fill = color(cell.changePercent!);
        if (fill !== nodes.fill) {
          nodes.rect.setAttribute("fill", fill);
          nodes.fill = fill;
        }
        const text = pctLabel(cell.changePercent!);
        if (text !== nodes.pctText) {
          if (nodes.pct) nodes.pct.textContent = text;
          nodes.title.textContent = titleText(cell);
          nodes.pctText = text;
        }
      }
    };

    const sameSize = (cur: { width: number; height: number }) =>
      Math.abs(cur.width - el.clientWidth) <= 2 && Math.abs(cur.height - el.clientHeight) <= 2;
    const b = built.current;
    const reusable =
      b !== null && el.firstChild !== null && sameSize(b) &&
      b.key === layoutKey(drawable(data)) && Date.now() - b.at < RELAYOUT_MS;
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
  }, [data, setActiveSymbol]);

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading heatmap…</div>;
  return <div ref={ref} className="relative w-full h-full overflow-hidden" />;
}
