"use client";

import { useEffect, useRef } from "react";
import TopBar from "./TopBar";
import TabBar, { openTabWindow } from "./TabBar";
import Sidebar, { shownMenu } from "./Sidebar";
import { useAiAvailable, useStatus } from "../lib/status";
import PageView from "./PageView";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import { followOtherWindows, useTerminal } from "../store/terminal";
import { startWorkspaceBackup } from "../store/workspace-backup";

const isField = (el: Element | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Whether a letter typed now is meant for the symbol search: on the chart, with no field,
 *  menu or dialog taking keys. */
function typingOpensSearch(): boolean {
  const st = useTerminal.getState();
  if (st.view !== "chart" || st.commandOpen) return false;
  if (isField(document.activeElement)) return false;
  return !document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');
}

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const view = useTerminal((s) => s.view);
  const setView = useTerminal((s) => s.setView);
  const activeTab = useTerminal((s) => s.activeTab);
  // ⌥1 … ⌥9 follow the menu as shown (AI ASSIST only when the server has an AI key).
  const status = useStatus();
  const aiAvailable = useAiAvailable();
  const shownMenuRef = useRef(shownMenu(aiAvailable));
  shownMenuRef.current = shownMenu(aiAvailable);
  // A tab saved on the AI page, with no AI set up: back to the chart.
  useEffect(() => {
    if (status.data && !status.data.ai && view === "ai") setView("chart");
  }, [status.data, view, setView]);

  // Tabs shown in other windows stay in step with this one, and every change also goes to a
  // copy on disk that comes back if the browser's storage is ever cleared.
  useEffect(() => followOtherWindows(), []);
  useEffect(() => startWorkspaceBackup(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      // As on TradingView: a letter typed on the chart (not into a field or a dialog) starts a
      // symbol search with it.
      if (!e.altKey && !e.ctrlKey && !e.metaKey && /^[a-z]$/i.test(e.key) && typingOpensSearch()) {
        e.preventDefault();
        setCommandOpen(true, e.key.toUpperCase());
        return;
      }
      // Typed on quickly, before the search's field has the keys: they go on what's searched.
      const st0 = useTerminal.getState();
      if (st0.commandOpen && !e.altKey && !e.ctrlKey && !e.metaKey && /^[a-z0-9.\-]$/i.test(e.key) && !isField(document.activeElement)) {
        e.preventDefault();
        st0.setCommandOpen(true, st0.commandQuery + e.key.toUpperCase());
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const st = useTerminal.getState();
      const key = e.key.toLowerCase();
      // Tabs: Alt+T copies the tab, Alt+W closes it, Alt+N copies it into a new window,
      // Alt+[ and Alt+] step through the tabs. (The browser keeps Ctrl+T / Ctrl+W for itself.)
      if (!e.shiftKey && (key === "t" || key === "w" || key === "n" || key === "[" || key === "]")) {
        e.preventDefault();
        if (key === "t") st.duplicateTab();
        else if (key === "w") st.closeTab(st.activeTab);
        else if (key === "n") openTabWindow(st.duplicateTab(true));
        else {
          const at = st.windowTabs.indexOf(st.activeTab);
          const n = st.windowTabs.length;
          st.switchTab(st.windowTabs[(at + (key === "]" ? 1 : -1) + n) % n]);
        }
        return;
      }
      // ⌥1 … ⌥9 open the first nine menu pages, ⌥0 the workspace.
      if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        e.preventDefault();
        const item = shownMenuRef.current[n - 1];
        if (n === 0 || item) setView(n === 0 ? "workspace" : item.type);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, setView]);

  return (
    <div className="flex flex-col h-screen">
      <TopBar />
      <TabBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* A tab starts fresh: its charts don't inherit the last tab's zoom and scroll. */}
        <main key={activeTab} className="flex-1 overflow-auto">
          {view === "workspace" ? <Workspace /> : <PageView key={view} type={view} />}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
