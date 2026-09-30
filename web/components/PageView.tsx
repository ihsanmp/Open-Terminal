"use client";

import { useEffect } from "react";
import { useTerminal, type WidgetType } from "../store/terminal";
import { SYMBOL_AWARE, SymbolTag, TITLES, WidgetBody } from "./Workspace";

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
  return (
    <div className="h-full p-1">
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
    </div>
  );
}
