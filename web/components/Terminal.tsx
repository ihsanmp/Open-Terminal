"use client";

import { useEffect } from "react";
import TopBar from "./TopBar";
import Sidebar, { MENU } from "./Sidebar";
import PageView from "./PageView";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import { useTerminal } from "../store/terminal";

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const view = useTerminal((s) => s.view);
  const setView = useTerminal((s) => s.setView);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      // ⌥1 … ⌥9 open the first nine menu pages, ⌥0 the workspace.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[0-9]$/.test(e.key)) {
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
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          {view === "workspace" ? <Workspace /> : <PageView key={view} type={view} />}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
