"use client";

import type { CSSProperties, ReactElement } from "react";
import type { DrawSize, IndicatorTable } from "../../lib/ta/types";

// Pine's size.* for table text, in CSS pixels.
const TEXT_PX: Record<DrawSize, number> = { tiny: 9, small: 11, normal: 13, large: 16, huge: 22 };

/** A Pine table.new() drawn over the price pane. Cells that were never set take no space,
 *  as in Pine, so the grid is filled with zero-width placeholders. */
/** `paneBottom`: where the price pane ends when indicator panes sit below it — overlay
 *  tables stay inside the price pane, as with Pine's force_overlay. */
export function IndicatorTableView({
  table,
  inset,
  paneBottom,
}: {
  table: IndicatorTable;
  inset: { right: number; bottom: number };
  paneBottom?: number;
}) {
  const cols = Math.max(1, ...table.cells.map((c) => c.col + (c.colSpan ?? 1)));
  const rows = Math.max(1, ...table.cells.map((c) => c.row + 1));
  const taken = new Set<string>();
  for (const c of table.cells) for (let k = 0; k < (c.colSpan ?? 1); k++) taken.add(`${c.row}:${c.col + k}`);

  // Under the legend (z-10), so indicator titles and their buttons stay reachable, as on TradingView.
  const place: CSSProperties = { position: "absolute", zIndex: 5 };
  if (table.position.startsWith("top")) place.top = 4;
  else if (paneBottom !== undefined) {
    place.top = paneBottom - 4;
    place.transform = "translateY(-100%)";
  } else place.bottom = inset.bottom + 4;
  if (table.position.endsWith("right")) place.right = inset.right + 4;
  else place.left = 8;

  const fillers: ReactElement[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!taken.has(`${r}:${c}`)) fillers.push(<div key={`f${r}:${c}`} style={{ gridRow: r + 1, gridColumn: c + 1, background: table.bg }} />);

  return (
    <div
      className="pointer-events-none overflow-hidden"
      style={{
        ...place,
        maxHeight: paneBottom !== undefined ? paneBottom - 8 : `calc(100% - ${inset.bottom + 8}px)`,
        maxWidth: `calc(100% - ${inset.right + 16}px)`,
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, auto)`,
        gap: 1,
        background: table.border,
        border: `1px solid ${table.frame}`,
        lineHeight: 1.25,
      }}
    >
      {table.cells.map((cell) => (
        <div
          key={`${cell.row}:${cell.col}`}
          title={cell.tooltip}
          className={cell.tooltip ? "pointer-events-auto" : undefined}
          style={{
            gridRow: cell.row + 1,
            gridColumn: `${cell.col + 1} / span ${cell.colSpan ?? 1}`,
            background: cell.bg ?? table.bg,
            color: cell.color ?? "#ffffff",
            fontSize: TEXT_PX[cell.size ?? "normal"],
            fontWeight: cell.bold ? 700 : undefined,
            textAlign: cell.align ?? "center",
            padding: cell.thin ? "0 3px" : "1px 4px",
            whiteSpace: "pre",
            overflow: "hidden",
            minWidth: 0,
            display: cell.thin ? "flex" : undefined,
            alignItems: cell.thin ? "center" : undefined,
            height: cell.thin ? 5 : undefined,
          }}
        >
          {cell.thin ? <div style={{ flex: 1, borderTop: `1px solid ${cell.color ?? table.frame}` }} /> : cell.text}
        </div>
      ))}
      {fillers}
    </div>
  );
}
