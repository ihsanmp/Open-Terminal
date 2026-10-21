"use client";

import { useEffect } from "react";
import { HUBS, rememberHubTab } from "../lib/menu";
import { useTerminal, type HubId, type WidgetType } from "../store/terminal";
import PageView from "./PageView";

/** A hub: its pages' tabs along the top, the chosen one below (each its own page, settings and all). */
export default function HubView({ hub, type }: { hub: HubId; type: WidgetType }) {
  const setView = useTerminal((s) => s.setView);
  const def = HUBS[hub];
  useEffect(() => rememberHubTab(hub, type), [hub, type]);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-end gap-0.5 px-2 pt-1 border-b border-[var(--border)] bg-[var(--panel)] shrink-0 overflow-x-auto">
        <span className="text-fs-9 font-bold uppercase tracking-wide text-[#7f93b8] mr-2 mb-1.5 whitespace-nowrap">{def.label}</span>
        {def.tabs.map((t) => (
          <button
            key={t.type}
            onClick={() => setView(t.type)}
            className={`px-3 py-1 text-fs-11 whitespace-nowrap border border-b-0 rounded-t ${
              t.type === type ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--amber)]" : "border-transparent dim hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <PageView key={type} type={type} />
      </div>
    </div>
  );
}
