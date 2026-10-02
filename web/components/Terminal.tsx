"use client";

import { useEffect } from "react";
import TopBar from "./TopBar";
import TabBar, { openTabWindow } from "./TabBar";
import Sidebar, { MENU } from "./Sidebar";
import PageView from "./PageView";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import { followOtherWindows, useTerminal } from "../store/terminal";
import { startWorkspaceBackup } from "../store/workspace-backup";

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const view = useTerminal((s) => s.view);
  const setView = useTerminal((s) => s.setView);
  const activeTab = useTerminal((s) => s.activeTab);

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
          const at = st.tabs.findIndex((t) => t.id === st.activeTab);
          const next = st.tabs[(at + (key === "]" ? 1 : -1) + st.tabs.length) % st.tabs.length];
          st.switchTab(next.id);
        }
        return;
      }
      // ⌥1 … ⌥9 open the first nine menu pages, ⌥0 the workspace.
      if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        e.preventDefault();
        setView(n === 0 ? "workspace" : MENU[n - 1].type);
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
