"use client";

import { useEffect, useRef, useState } from "react";
import { useTerminal, WidgetIdContext, type WidgetInstance, type WidgetType } from "../store/terminal";
import { SYMBOL_AWARE, SymbolTag, TITLES, WidgetBody } from "./Workspace";
import WatchlistPanel from "./chart/WatchlistPanel";
import { usePortrait } from "../lib/use-portrait";

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;
// Upright, the panel sits below the chart: its height, as a share of the page's.
const MIN_HEIGHT = 0.15;
const MAX_HEIGHT = 0.7;

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
 * Upright (portrait) it's the bottom: the panel below the chart, its height dragged at its top.
 */
function ChartSide({ page }: { page: WidgetInstance }) {
  const portrait = usePortrait();
  const setWidgetSetting = useTerminal((s) => s.setWidgetSetting);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const open = (page.settings?.watchlistOpen as boolean | undefined) ?? true;
  const saved = (page.settings?.watchlistWidth as number | undefined) ?? 360;
  const [width, setWidth] = useState(saved);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => setWidth(saved), [saved]);
  const savedShare = (page.settings?.watchlistShare as number | undefined) ?? 0.38;
  const [share, setShare] = useState(savedShare);
  useEffect(() => setShare(savedShare), [savedShare]);
  const box = useRef<HTMLDivElement>(null);

  const symbol = page.linked ? activeSymbol : page.symbol ?? activeSymbol;
  const pick = (s: string) => (page.linked ? setActiveSymbol(s) : setWidgetSymbol(page.id, s));
  const setOpen = (v: boolean) => setWidgetSetting(page.id, "watchlistOpen", v);

  const toggle = (
    <button
      className={`w-7 h-7 flex items-center justify-center rounded ${open ? "text-[var(--amber)] bg-[#1f1a10]" : "dim hover:text-[var(--text)]"}`}
      title={open ? "Hide watchlist" : "Show watchlist"}
      aria-label={open ? "Hide watchlist" : "Show watchlist"}
      aria-pressed={open}
      onClick={() => setOpen(!open)}
    >
      <WatchlistIcon />
    </button>
  );

  if (portrait)
    return (
      <>
        {open && (
          <div ref={box} className="relative shrink-0 border-t border-[var(--border)] min-h-0" style={{ height: `${share * 100}%` }}>
            <div
              className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10 hover:bg-[var(--amber-dim)]/40"
              title="Drag to resize"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientY, w: share };
              }}
              onPointerMove={(e) => {
                const page = box.current?.parentElement;
                if (!drag.current || !page) return;
                const next = drag.current.w + (drag.current.x - e.clientY) / page.clientHeight;
                setShare(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next)));
              }}
              onPointerUp={() => {
                if (!drag.current) return;
                drag.current = null;
                setWidgetSetting(page.id, "watchlistShare", share);
              }}
            />
            <WidgetIdContext.Provider value={page.id}>
              <WatchlistPanel symbol={symbol} onPick={pick} onHide={() => setOpen(false)} below />
            </WidgetIdContext.Provider>
          </div>
        )}
        <div className="h-9 shrink-0 border-t border-[var(--border)] bg-[var(--panel-2)] flex items-center px-1.5">{toggle}</div>
      </>
    );

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
      <div className="w-9 shrink-0 border-l border-[var(--border)] bg-[var(--panel-2)] flex flex-col items-center pt-1.5">{toggle}</div>
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
    <div className="h-full flex min-h-0 portrait:flex-col">
      <div className="flex-1 min-w-0 min-h-0 p-1">{panel}</div>
      <ChartSide page={page} />
    </div>
  );
}
