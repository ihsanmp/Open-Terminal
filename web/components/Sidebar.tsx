"use client";

import { useAiAvailable } from "../lib/status";
import { useTerminal, type View, type WidgetType } from "../store/terminal";

/** The menu: each item opens its feature full-page; ⌥ + number jumps to the first nine shown. */
export const MENU: Array<{ type: WidgetType; label: string }> = [
  { type: "chart", label: "CHART" },
  { type: "moneyflow", label: "MONEY FLOW" },
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
  { type: "calendar", label: "MACRO" },
  { type: "astrocal", label: "ASTRO CALENDAR" },
  { type: "insider", label: "INSIDER" },
  { type: "tv", label: "LIVE TV" },
  { type: "recap", label: "NEWS RECAP" },
];

/** The menu as shown: AI ASSIST only once the server has an AI key (it can't answer without). */
export function shownMenu(aiAvailable: boolean) {
  return MENU.filter((item) => item.type !== "ai" || aiAvailable);
}

function Item({ view, current, label, hint }: { view: View; current: View; label: string; hint: string }) {
  const setView = useTerminal((s) => s.setView);
  const active = view === current;
  return (
    <div
      role="button"
      onClick={() => setView(view)}
      className={`group flex items-center justify-between px-2 py-1.5 text-fs-11 cursor-pointer border-l-2 portrait:border-l-0 portrait:border-b-2 portrait:shrink-0 portrait:whitespace-nowrap portrait:gap-1.5 ${
        active ? "border-[var(--amber)] bg-[#1a1a1a] text-[var(--amber)]" : "border-transparent hover:bg-[#1a1a1a] hover:text-[var(--amber)]"
      }`}
    >
      <span>{label}</span>
      <span className="dim text-fs-9 portrait:hidden">{hint}</span>
    </div>
  );
}

export default function Sidebar() {
  const view = useTerminal((s) => s.view);
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);
  const menu = shownMenu(useAiAvailable());

  return (
    <nav className="w-[calc(8rem*var(--font-scale))] bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-auto portrait:w-full portrait:flex-row portrait:flex-wrap portrait:border-r-0 portrait:border-b portrait:overflow-y-hidden max-sm:portrait:flex-nowrap max-sm:portrait:overflow-x-auto">
      {menu.map((item, i) => (
        <Item
          key={item.type}
          view={item.type}
          current={view}
          label={item.label}
          hint={i < 9 ? `⌥${i + 1}` : ""}
        />
      ))}
      <div className="mt-auto border-t border-[var(--border)] portrait:mt-0 portrait:ml-auto portrait:border-t-0 portrait:border-l portrait:flex portrait:shrink-0">
        <Item view="workspace" current={view} label="WORKSPACE" hint="⌥0" />
        {/* On the workspace: a page to add to it as a widget, then its layout's reset. */}
        {view === "workspace" && (
          <select
            aria-label="Add a widget to the workspace"
            className="w-full !bg-transparent !border-0 px-2 py-1.5 text-fs-11 dim hover:text-[var(--amber)] cursor-pointer portrait:w-auto"
            value=""
            onChange={(e) => {
              if (e.target.value) addWidget(e.target.value as WidgetType);
            }}
          >
            <option value="">+ ADD WIDGET</option>
            {menu.map((item) => (
              <option key={item.type} value={item.type}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        {view === "workspace" && (
          <button onClick={resetWorkspace} className="w-full text-left px-2 py-1.5 text-fs-11 dim hover:text-[var(--down)] portrait:w-auto portrait:whitespace-nowrap">
            RESET LAYOUT
          </button>
        )}
      </div>
    </nav>
  );
}
