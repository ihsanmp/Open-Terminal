"use client";

import { useEffect, useState } from "react";
import { useStatus } from "../lib/status";
import { useTerminal } from "../store/terminal";
import TabBar, { openTabWindow } from "./TabBar";

const CLOCKS = [
  { tz: "America/New_York", label: "NY" },
  { tz: "Europe/Rome", label: "MIL" },
  { tz: "Europe/London", label: "LDN" },
  { tz: "Asia/Tokyo", label: "TYO" },
].map((c) => ({ ...c, format: new Intl.DateTimeFormat("en-GB", { timeZone: c.tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) }));

/** All four clocks share one timer aligned to the second, instead of four independent re-renders. */
function Clocks() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      t = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  if (!now) return null;
  return (
    <>
      {CLOCKS.map((c) => (
        <span key={c.label} className={`dim shrink-0 ${c.label === "NY" ? "" : "max-sm:hidden"}`}>
          {c.label} <span className="text-[var(--text)]">{c.format.format(now)}</span>
        </span>
      ))}
    </>
  );
}

function marketStateNY(): { label: string; open: boolean } {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { label: open ? "NYSE OPEN" : "NYSE CLOSED", open };
}

export default function TopBar() {
  const duplicateTab = useTerminal((s) => s.duplicateTab);
  const { data: status } = useStatus();

  const market = marketStateNY();
  const healthy = status?.providers.filter((p) => p.ok > 0) ?? [];

  return (
    <header className="flex items-center gap-4 px-3 h-8 whitespace-nowrap bg-[var(--panel-2)] border-b border-[var(--border)] text-fs-11 shrink-0 portrait:flex-wrap portrait:h-auto portrait:min-h-8 portrait:py-1 portrait:gap-x-3 portrait:gap-y-1">
      <span className="amber font-bold tracking-widest shrink-0">OPENTERMINAL</span>
      <span className={`shrink-0 ${market.open ? "up" : "down"}`}>● {market.label}</span>
      <Clocks />
      {/* The tabs, then "+" for another, left of "⧉ Window". A click on the tab in view changes its
          symbol (as ⌘K or typing on a chart does). */}
      <TabBar />
      <span className="flex gap-1 shrink-0">
        <button className="term-btn dim hover:text-[var(--amber)]" title="New window: a copy of this tab (Alt+N)" aria-label="New window" onClick={() => openTabWindow(duplicateTab(true))}>
          ⧉ Window
        </button>
      </span>
      <span className="dim ml-auto max-sm:hidden truncate min-w-0 shrink">
        feeds:{" "}
        {healthy.length > 0
          ? healthy.map((p) => `${p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : "connecting…"}
      </span>
      {/* Only when the assistant is set up (an Anthropic key on the server); its menu item too. */}
      {status?.ai && <span className="up">AI ●</span>}
    </header>
  );
}
