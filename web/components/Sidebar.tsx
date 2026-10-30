"use client";

import { useEffect, useState } from "react";
import { useAiAvailable } from "../lib/status";
import { flatMenu, GROUPS, hubOf, pageFor, type MenuItem } from "../lib/menu";
import { useTerminal, type View, type WidgetType } from "../store/terminal";
import { TITLES } from "./Workspace";

/** The menu as the keyboard counts it: ⌥1 … ⌥9 open the first nine items shown. */
export function shownMenu(aiAvailable: boolean): MenuItem[] {
  return flatMenu(aiAvailable);
}

/** Every page that can go on the workspace as a widget, by its title. */
const WIDGET_TYPES = Object.keys(TITLES) as WidgetType[];

const COLLAPSED_KEY = "ot-menu-collapsed";
const readCollapsed = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Whether a menu item is what's in view: its page, or (a hub) any of its tabs. */
const showing = (item: View, current: View) => item === current || (hubOf(item) !== null && hubOf(item) === hubOf(current));

function Item({ item, current, hint }: { item: MenuItem; current: View; hint: string }) {
  const setView = useTerminal((s) => s.setView);
  const active = showing(item.view, current);
  return (
    <div
      role="button"
      onClick={() => setView(pageFor(item.view))}
      className={`group flex items-center justify-between pl-3 pr-2 py-1 text-fs-11 cursor-pointer border-l-2 portrait:border-l-0 portrait:border-b-2 portrait:shrink-0 portrait:whitespace-nowrap portrait:gap-1.5 portrait:pl-2 ${
        active ? "border-[var(--amber)] bg-[#1a1a1a] text-[var(--amber)]" : "border-transparent hover:bg-[#1a1a1a] hover:text-[var(--amber)]"
      }`}
    >
      <span>{item.label}</span>
      <span className="dim text-fs-9 portrait:hidden">{hint}</span>
    </div>
  );
}

export default function Sidebar() {
  const view = useTerminal((s) => s.view);
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);
  const aiAvailable = useAiAvailable();
  const flat = shownMenu(aiAvailable);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => setCollapsed(readCollapsed()), []);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // not kept
      }
      return next;
    });

  return (
    <nav className="menu-scale w-[calc(10.5rem*var(--font-scale))] bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-auto portrait:w-full portrait:flex-row portrait:flex-wrap portrait:border-r-0 portrait:border-b portrait:overflow-y-hidden max-sm:portrait:flex-nowrap max-sm:portrait:overflow-x-auto">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => i.view !== "ai" || aiAvailable);
        if (!items.length) return null;
        const open = !collapsed.includes(g.id);
        const holdsCurrent = items.some((i) => showing(i.view, view));
        return (
          <div key={g.id} className="border-b border-[#1c1c1c] portrait:border-b-0 portrait:flex portrait:shrink-0">
            <button
              onClick={() => toggle(g.id)}
              title={g.tagline || undefined}
              aria-expanded={open}
              className={`w-full flex items-start gap-1 text-left px-2 pt-2 pb-1 text-fs-9 font-bold tracking-wide uppercase leading-tight portrait:hidden ${holdsCurrent ? "text-[var(--amber)]" : "text-[#7f93b8] hover:text-[#a9b8d6]"}`}
            >
              <span className="w-2.5 shrink-0 dim">{open ? "▾" : "▸"}</span>
              <span>{g.label}</span>
            </button>
            {(open || holdsCurrent) && (
              <div className="pb-1 portrait:pb-0 portrait:flex">
                {items
                  .filter((i) => open || showing(i.view, view))
                  .map((item) => {
                    const n = flat.findIndex((f) => f.view === item.view);
                    return <Item key={item.view} item={item} current={view} hint={n >= 0 && n < 9 ? `⌥${n + 1}` : ""} />;
                  })}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-auto border-t border-[var(--border)] portrait:mt-0 portrait:ml-auto portrait:border-t-0 portrait:border-l portrait:flex portrait:shrink-0">
        <Item item={{ view: "workspace", label: "WORKSPACE" }} current={view} hint="⌥0" />
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
            {WIDGET_TYPES.filter((t) => t !== "ai" || aiAvailable).map((t) => (
              <option key={t} value={t}>
                {TITLES[t]}
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
