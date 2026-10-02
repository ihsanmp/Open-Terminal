"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useTerminal, WidgetIdContext, type WidgetInstance } from "../store/terminal";
import { WidgetVisibleContext } from "../lib/refresh";
import QuoteWidget from "./widgets/QuoteWidget";
import ChartWidget from "./widgets/ChartWidget";
import WatchlistWidget from "./widgets/WatchlistWidget";
import NewsWidget from "./widgets/NewsWidget";
import HeatmapWidget from "./widgets/HeatmapWidget";
import ScreenerWidget from "./widgets/ScreenerWidget";
import CryptoWidget from "./widgets/CryptoWidget";
import MacroWidget from "./widgets/MacroWidget";
import OptionsWidget from "./widgets/OptionsWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AiWidget from "./widgets/AiWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import InsiderWidget from "./widgets/InsiderWidget";
import TvWidget from "./widgets/TvWidget";
import RecapWidget from "./widgets/RecapWidget";
import IndicesWidget from "./widgets/IndicesWidget";
import ResearchWidget from "./widgets/ResearchWidget";
// Loaded when first shown: it carries 35 years of gold and bitcoin closes for its offline statistics.
const AstroCalendarWidget = dynamic(() => import("./widgets/AstroCalendarWidget"), { ssr: false, loading: () => <div className="p-2 dim">Memuat kalender astrologi…</div> });

const Grid = WidthProvider(GridLayout);

/** A widget, with its id available to useWidgetSetting so its choices are saved with it. */
export function WidgetBody({ widget }: { widget: WidgetInstance }) {
  return (
    <WidgetIdContext.Provider value={widget.id}>
      <WidgetContent widget={widget} />
    </WidgetIdContext.Provider>
  );
}

function WidgetContent({ widget }: { widget: WidgetInstance }) {
  switch (widget.type) {
    case "quote": return <QuoteWidget widget={widget} />;
    case "chart": return <ChartWidget widget={widget} />;
    case "watchlist": return <WatchlistWidget />;
    case "news": return <NewsWidget widget={widget} />;
    case "heatmap": return <HeatmapWidget />;
    case "screener": return <ScreenerWidget />;
    case "crypto": return <CryptoWidget />;
    case "macro": return <MacroWidget />;
    case "options": return <OptionsWidget widget={widget} />;
    case "portfolio": return <PortfolioWidget />;
    case "ai": return <AiWidget />;
    case "calendar": return <CalendarWidget />;
    case "insider": return <InsiderWidget widget={widget} />;
    case "tv": return <TvWidget />;
    case "recap": return <RecapWidget />;
    case "indices": return <IndicesWidget />;
    case "research": return <ResearchWidget widget={widget} />;
    case "astrocal": return <AstroCalendarWidget />;
  }
}

/** Tells widgets whether they are on screen, so off-screen ones stop polling and repainting. */
function VisibilityScope({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="h-full">
      <WidgetVisibleContext.Provider value={visible}>{children}</WidgetVisibleContext.Provider>
    </div>
  );
}

export function SymbolTag({ widget, activeSymbol }: { widget: WidgetInstance; activeSymbol: string }) {
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = widget.linked ? activeSymbol : widget.symbol ?? activeSymbol;

  useEffect(() => {
    if (!editing) return;
    setDraft(shown);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = draft.trim();
            if (v) setWidgetSymbol(widget.id, v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="ml-2 w-16 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent text-[var(--text)] px-0 py-0 text-[13px] leading-none"
      />
    );
  }

  return (
    <span
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title="Click to set this widget's ticker"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </span>
  );
}

export const TITLES: Record<string, string> = {
  quote: "Quote", chart: "Chart", watchlist: "Watchlist", news: "News",
  heatmap: "Heatmap", screener: "Screener", crypto: "Crypto",
  macro: "Macro / Indexes", options: "Option Chain", portfolio: "Portfolio", ai: "AI Assistant",
  calendar: "Calendar", insider: "Insider Transactions", tv: "Live TV", recap: "Market Recap",
  indices: "World Indices", research: "Equity Research",
};

/** Widgets that show one symbol (their own, or the active one when linked). */
export const SYMBOL_AWARE = new Set(["quote", "chart", "news", "options", "insider", "research"]);

export default function Workspace() {
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);


  return (
    <Grid
      className="layout"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[4, 4]}
      draggableHandle=".panel-title"
      onLayoutChange={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <div className="terminal-panel">
            <div className="panel-title">
              <span>
                {TITLES[w.type]}
                {SYMBOL_AWARE.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}
              </span>
              <span className="flex gap-2 items-center">
                {SYMBOL_AWARE.has(w.type) && (
                  <button
                    title={w.linked ? "Linked to active symbol (click to unlink)" : "Unlinked (click to link)"}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => toggleLinked(w.id)}
                    className={w.linked ? "text-[var(--amber)]" : "dim"}
                  >
                    ⛓
                  </button>
                )}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => removeWidget(w.id)}
                  className="dim hover:text-[var(--down)]"
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <VisibilityScope>
                <WidgetBody widget={w} />
              </VisibilityScope>
            </div>
          </div>
        </div>
      ))}
    </Grid>
  );
}
