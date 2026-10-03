"use client";

import { useEffect, useRef, useState } from "react";
import { useTerminal, WidgetIdContext, type WidgetInstance, type WidgetType } from "../store/terminal";
import { SYMBOL_AWARE, SymbolTag, TITLES, WidgetBody } from "./Workspace";
import WatchlistPanel from "./chart/WatchlistPanel";

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;

/** A watchlist icon for the right-hand toolbar, as TradingView's. */
function WatchlistIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="2.5" y="3" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6.5h8M5 9h8M5 11.5h5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * The chart page's right side: the Watchlist panel (shown or hidden from the toolbar strip at the
 * edge, its width dragged at its left edge; both remembered with the page) and the strip itself.
 */
function ChartSide({ page }: { page: WidgetInstance }) {
  const setWidgetSetting = useTerminal((s) => s.setWidgetSetting);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const open = (page.settings?.watchlistOpen as boolean | undefined) ?? true;
  const saved = (page.settings?.watchlistWidth as number | undefined) ?? 360;
  const [width, setWidth] = useState(saved);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => setWidth(saved), [saved]);

  const symbol = page.linked ? activeSymbol : page.symbol ?? activeSymbol;
  const pick = (s: string) => (page.linked ? setActiveSymbol(s) : setWidgetSymbol(page.id, s));
  const setOpen = (v: boolean) => setWidgetSetting(page.id, "watchlistOpen", v);

  return (
    <>
      {open && (
        <div className="relative shrink-0 border-l border-[var(--border)] min-h-0" style={{ width }}>
          <div
            className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-[var(--amber-dim)]/40"
            title="Drag to resize"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, w: width };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.current.w + drag.current.x - e.clientX)));
            }}
            onPointerUp={() => {
              if (!drag.current) return;
              drag.current = null;
              setWidgetSetting(page.id, "watchlistWidth", width);
            }}
          />
          <WidgetIdContext.Provider value={page.id}>
            <WatchlistPanel symbol={symbol} onPick={pick} onHide={() => setOpen(false)} />
          </WidgetIdContext.Provider>
        </div>
      )}
      <div className="w-9 shrink-0 border-l border-[var(--border)] bg-[var(--panel-2)] flex flex-col items-center pt-1.5">
        <button
          className={`w-7 h-7 flex items-center justify-center rounded ${open ? "text-[var(--amber)] bg-[#1f1a10]" : "dim hover:text-[var(--text)]"}`}
          title={open ? "Hide watchlist" : "Show watchlist"}
          aria-label={open ? "Hide watchlist" : "Show watchlist"}
          aria-pressed={open}
          onClick={() => setOpen(!open)}
        >
          <WatchlistIcon />
        </button>
      </div>
    </>
  );
}

/** One feature full-page (the sidebar's menu): the chart alone, the news alone, and so on. */
export default function PageView({ type }: { type: WidgetType }) {
  const page = useTerminal((s) => s.pages.find((p) => p.type === type));
  const ensurePage = useTerminal((s) => s.ensurePage);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);

  useEffect(() => {
    if (!page) ensurePage(type);
  }, [page, type, ensurePage]);

  if (!page) return null;
  const panel = (
    <div className="terminal-panel">
      <div className="panel-title">
        <span>
          {TITLES[type]}
          {SYMBOL_AWARE.has(type) && <SymbolTag widget={page} activeSymbol={activeSymbol} />}
        </span>
        {SYMBOL_AWARE.has(type) && (
          <button
            title={page.linked ? "Linked to active symbol (click to unlink)" : "Unlinked (click to link)"}
            onClick={() => toggleLinked(page.id)}
            className={page.linked ? "text-[var(--amber)]" : "dim"}
          >
            ⛓
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        <WidgetBody widget={page} />
      </div>
    </div>
  );
  if (type !== "chart") return <div className="h-full p-1">{panel}</div>;
  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 p-1">{panel}</div>
      <ChartSide page={page} />
    </div>
  );
}
