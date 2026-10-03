"use client";

import { useEffect, useRef, useState } from "react";
import { tabLabel, useTerminal, type TabData } from "../store/terminal";

/**
 * Opens a tab (one no window shows) in its own app window: a popup, so it has no browser toolbar
 * either. `noopener`, or the browser would hand it this window's session, and with it this
 * window's identity and tabs.
 */
export function openTabWindow(id: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("tab", id);
  window.open(url, `openterminal-${id}`, `popup,noopener,width=${window.outerWidth},height=${window.outerHeight},left=${window.screenX + 40},top=${window.screenY + 40}`);
}

/** Moves a tab out of this window into a new one (a copy when it's this window's only tab). */
export function moveTabToWindow(id: string) {
  const st = useTerminal.getState();
  if (st.windowTabs.length <= 1) return openTabWindow(st.duplicateTab(true));
  st.releaseTab(id);
  openTabWindow(id);
}

function Tab({ tab, active, only }: { tab: TabData; active: boolean; only: boolean }) {
  const switchTab = useTerminal((s) => s.switchTab);
  const closeTab = useTerminal((s) => s.closeTab);
  const renameTab = useTerminal((s) => s.renameTab);
  const moveTab = useTerminal((s) => s.moveTab);
  const windowTabs = useTerminal((s) => s.windowTabs);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = tabLabel(tab);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  return (
    <div
      role="tab"
      aria-selected={active}
      title={`${label} — double-click to rename, drag to reorder`}
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData("text/openterminal-tab", tab.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/openterminal-tab");
        if (id && id !== tab.id) moveTab(id, windowTabs.indexOf(tab.id));
      }}
      onMouseDown={(e) => {
        // Middle click closes, as in a browser.
        if (e.button === 1 && !only) {
          e.preventDefault();
          closeTab(tab.id);
        }
      }}
      onClick={() => !active && switchTab(tab.id)}
      onDoubleClick={() => setEditing(true)}
      className={`group flex items-center gap-1 h-full pl-2.5 pr-1 max-w-[220px] min-w-[90px] border-r border-[var(--border)] cursor-pointer select-none shrink ${
        active ? "bg-[var(--bg)] text-[var(--text)] border-t-2 border-t-[var(--amber)]" : "dim hover:text-[var(--text)] hover:bg-[var(--panel)]"
      }`}
    >
      {editing ? (
        <input
          ref={input}
          defaultValue={label}
          className="h-5 w-full text-fs-11 px-1"
          onBlur={(e) => {
            renameTab(tab.id, e.currentTarget.value === tabLabel({ ...tab, title: undefined }) ? "" : e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1">{label}</span>
      )}
      <button
        className="opacity-0 group-hover:opacity-100 px-1 hover:text-[var(--amber)]"
        title="Move this tab to a new window"
        aria-label="Move to a new window"
        onClick={(e) => {
          e.stopPropagation();
          moveTabToWindow(tab.id);
        }}
      >
        ⧉
      </button>
      {!only && (
        <button
          className={`px-1 hover:text-[var(--down)] ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
          title="Close tab (Alt+W)"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Tabs like a browser's: each has its own symbol, page, workspace and chart settings, and each
 * window has its own tabs. "+" copies the current tab; ⧉ moves a tab into a window of its own, so
 * several can be watched side by side.
 */
export default function TabBar() {
  const allTabs = useTerminal((s) => s.tabs);
  const windowTabs = useTerminal((s) => s.windowTabs);
  const tabs = windowTabs.map((id) => allTabs.find((t) => t.id === id)).filter((t): t is TabData => Boolean(t));
  const activeTab = useTerminal((s) => s.activeTab);
  const duplicateTab = useTerminal((s) => s.duplicateTab);
  const active = tabs.find((t) => t.id === activeTab);

  // The window's title names its tab, to tell windows apart on the taskbar. Next.js writes its
  // own <title> after hydrating, so it's put back whenever it changes.
  useEffect(() => {
    if (!active) return;
    const want = `${tabLabel(active)} — OpenTerminal`;
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [active]);

  return (
    <nav role="tablist" className="flex items-stretch h-7 bg-[var(--panel-2)] border-b border-[var(--border)] text-fs-11 shrink-0 overflow-hidden">
      {tabs.map((t) => (
        <Tab key={t.id} tab={t} active={t.id === activeTab} only={tabs.length === 1} />
      ))}
      <button className="px-2.5 dim hover:text-[var(--amber)] shrink-0" title="Duplicate this tab (Alt+T)" aria-label="Duplicate tab" onClick={() => duplicateTab()}>
        +
      </button>
      <button
        className="ml-auto px-3 dim hover:text-[var(--amber)] shrink-0 border-l border-[var(--border)]"
        title="Copy this tab into a new window (Alt+N)"
        onClick={() => openTabWindow(duplicateTab(true))}
      >
        ⧉ New window
      </button>
    </nav>
  );
}
