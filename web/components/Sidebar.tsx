"use client";

import { useAiAvailable } from "../lib/status";
import { useTerminal, type View, type WidgetType } from "../store/terminal";

/** The menu: each item opens its feature full-page; ⌥ + number jumps to the first nine shown. */
export const MENU: Array<{ type: WidgetType; label: string }> = [
  { type: "chart", label: "CHART" },
  { type: "quote", label: "QUOTE" },
  { type: "news", label: "NEWS" },
  { type: "screener", label: "SCREENER" },
  { type: "heatmap", label: "HEATMAP" },
  { type: "crypto", label: "CRYPTO" },
  { type: "bonds", label: "US BONDS" },
  { type: "portfolio", label: "PORTFOLIO" },
  { type: "ai", label: "AI ASSIST" },
  { type: "research", label: "EQUITY RESEARCH" },
  { type: "indices", label: "WORLD INDICES" },
  { type: "watchlist", label: "WATCHLIST" },
  { type: "watcher", label: "WATCHER GURU" },
  { type: "calendar", label: "CALENDAR" },
  { type: "astrocal", label: "ASTRO CALENDAR" },
  { type: "insider", label: "INSIDER" },
  { type: "tv", label: "LIVE TV" },
  { type: "recap", label: "MARKET RECAP" },
];

/** The menu as shown: AI ASSIST only once the server has an AI key (it can't answer without). */
export function shownMenu(aiAvailable: boolean) {
  return MENU.filter((item) => item.type !== "ai" || aiAvailable);
}

function Item({ view, current, label, hint, onAdd }: { view: View; current: View; label: string; hint: string; onAdd?: () => void }) {
  const setView = useTerminal((s) => s.setView);
  const active = view === current;
  return (
    <div
      role="button"
      onClick={() => setView(view)}
      className={`group flex items-center justify-between px-2 py-1.5 text-fs-11 cursor-pointer border-l-2 ${
        active ? "border-[var(--amber)] bg-[#1a1a1a] text-[var(--amber)]" : "border-transparent hover:bg-[#1a1a1a] hover:text-[var(--amber)]"
      }`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {onAdd && (
          <button
            title="Add to the workspace"
            className="hidden group-hover:inline dim hover:text-[var(--amber)] px-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            +
          </button>
        )}
        <span className="dim text-fs-9">{hint}</span>
      </span>
    </div>
  );
}

export default function Sidebar() {
  const view = useTerminal((s) => s.view);
  const setView = useTerminal((s) => s.setView);
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);
  const menu = shownMenu(useAiAvailable());

  return (
    <nav className="w-[calc(8rem*var(--font-scale))] bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-auto">
      {menu.map((item, i) => (
        <Item
          key={item.type}
          view={item.type}
          current={view}
          label={item.label}
          hint={i < 9 ? `⌥${i + 1}` : ""}
          onAdd={() => {
            addWidget(item.type);
            setView("workspace");
          }}
        />
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <Item view="workspace" current={view} label="WORKSPACE" hint="⌥0" />
        {view === "workspace" && (
          <button onClick={resetWorkspace} className="w-full text-left px-2 py-1.5 text-fs-11 dim hover:text-[var(--down)]">
            RESET LAYOUT
          </button>
        )}
      </div>
    </nav>
  );
}
