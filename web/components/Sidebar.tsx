"use client";

import { useTerminal, type View, type WidgetType } from "../store/terminal";

/** The menu: each item opens its feature full-page; ⌥ + number jumps to the first nine. */
export const MENU: Array<{ type: WidgetType; label: string; key: string }> = [
  { type: "chart", label: "CHART", key: "⌥1" },
  { type: "quote", label: "QUOTE", key: "⌥2" },
  { type: "news", label: "NEWS", key: "⌥3" },
  { type: "screener", label: "SCREENER", key: "⌥4" },
  { type: "heatmap", label: "HEATMAP", key: "⌥5" },
  { type: "crypto", label: "CRYPTO", key: "⌥6" },
  { type: "options", label: "OPTIONS", key: "⌥7" },
  { type: "portfolio", label: "PORTFOLIO", key: "⌥8" },
  { type: "ai", label: "AI ASSIST", key: "⌥9" },
  { type: "research", label: "EQUITY RESEARCH", key: "" },
  { type: "indices", label: "WORLD INDICES", key: "" },
  { type: "watchlist", label: "WATCHLIST", key: "" },
  { type: "macro", label: "MACRO", key: "" },
  { type: "calendar", label: "CALENDAR", key: "" },
  { type: "insider", label: "INSIDER", key: "" },
  { type: "tv", label: "LIVE TV", key: "" },
  { type: "recap", label: "MARKET RECAP", key: "" },
];

function Item({ view, current, label, hint, onAdd }: { view: View; current: View; label: string; hint: string; onAdd?: () => void }) {
  const setView = useTerminal((s) => s.setView);
  const active = view === current;
  return (
    <div
      role="button"
      onClick={() => setView(view)}
      className={`group flex items-center justify-between px-2 py-1.5 text-[11px] cursor-pointer border-l-2 ${
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
        <span className="dim text-[9px]">{hint}</span>
      </span>
    </div>
  );
}

export default function Sidebar() {
  const view = useTerminal((s) => s.view);
  const setView = useTerminal((s) => s.setView);
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  return (
    <nav className="w-32 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-auto">
      {MENU.map((item) => (
        <Item
          key={item.type}
          view={item.type}
          current={view}
          label={item.label}
          hint={item.key}
          onAdd={() => {
            addWidget(item.type);
            setView("workspace");
          }}
        />
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <Item view="workspace" current={view} label="WORKSPACE" hint="⌥0" />
        {view === "workspace" && (
          <button onClick={resetWorkspace} className="w-full text-left px-2 py-1.5 text-[11px] dim hover:text-[var(--down)]">
            RESET LAYOUT
          </button>
        )}
      </div>
    </nav>
  );
}
