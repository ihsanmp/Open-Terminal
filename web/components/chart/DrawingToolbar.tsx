"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TOOLS, TOOL_BY_ID, type ToolGroup, type ToolId } from "../../lib/drawings/tools";

// TradingView's drawing toolbar, down the left of the chart: the cursor, each group of tools (a
// button for the one used last, a menu for the rest), then the magnet, locking, hiding and
// removing all drawings.

/** How much larger than TradingView's the toolbar is drawn (1.5: half as large again). */
const TOOLBAR_SCALE = 1.5;
const px = (n: number) => Math.round(n * TOOLBAR_SCALE);

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A small picture of each tool, after TradingView's. */
export function ToolIcon({ id, size = px(22) }: { id: ToolId | "cursor" | "magnet" | "lock" | "hide" | "trash"; size?: number }) {
  const dot = (x: number, y: number) => <circle cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />;
  const body = (() => {
    switch (id) {
      case "cursor":
        return <path {...S} d="M11 3v6M11 13v6M3 11h6M13 11h6" />;
      case "trend":
        return <g {...S}><path d="M5 17L17 5" />{dot(5, 17)}{dot(17, 5)}</g>;
      case "ray":
        return <g {...S}><path d="M5 17L20 2" />{dot(5, 17)}{dot(11, 11)}</g>;
      case "extended":
        return <g {...S}><path d="M2 20L20 2" />{dot(8, 14)}{dot(14, 8)}</g>;
      case "hline":
        return <g {...S}><path d="M2 11h18" />{dot(11, 11)}</g>;
      case "hray":
        return <g {...S}><path d="M7 11h13" />{dot(7, 11)}</g>;
      case "vline":
        return <g {...S}><path d="M11 2v18" />{dot(11, 11)}</g>;
      case "channel":
        return <g {...S}><path d="M3 14L15 4M7 19L19 9" />{dot(3, 14)}{dot(15, 4)}{dot(19, 9)}</g>;
      case "fibRetracement":
        return <path {...S} d="M3 4h16M3 8h16M3 12h16M3 16h16M3 20h16" />;
      case "fibExtension":
        return <path {...S} d="M3 18L8 8l4 6M10 4h10M10 9h10M10 14h10" />;
      case "fibChannel":
        return <path {...S} d="M3 12L13 3M5 16L15 7M7 20L17 11" />;
      case "fibTimeZone":
        return <path {...S} d="M4 3v16M6 3v16M9 3v16M13 3v16M19 3v16" />;
      case "fibSpeedFan":
        return <path {...S} d="M3 19L19 3M3 19L19 8M3 19L19 13M3 19L8 3M3 19L13 3" />;
      case "fibTrendTime":
        return <path {...S} d="M2 18L6 8l3 6M12 3v16M15 3v16M19 3v16" />;
      case "fibCircles":
        return <g {...S}><circle cx="11" cy="11" r="3" /><circle cx="11" cy="11" r="6" /><circle cx="11" cy="11" r="9" /></g>;
      case "fibSpiral":
        return <path {...S} d="M11 11a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a5 5 0 0 1 10 0a8 8 0 0 1-16 0" />;
      case "fibSpeedArcs":
        return <path {...S} d="M3 19a4 4 0 0 1 8 0M3 19a8 8 0 0 1 16 0M3 19L19 4" />;
      case "fibWedge":
        return <path {...S} d="M3 19L20 6M3 19h17M9 19a6 6 0 0 0-1-4M14 19a11 11 0 0 0-2-7M19 19a16 16 0 0 0-3-10" />;
      case "pitchfan":
        return <path {...S} d="M3 19L20 3M3 19L20 9M3 19L20 15M3 19L14 3M17 3l3 12" />;
      case "gannBox":
        return <path {...S} d="M3 3h16v16H3zM3 9h16M3 14h16M9 3v16M14 3v16" />;
      case "gannSquareFixed":
      case "gannSquare":
        return <path {...S} d="M3 3h16v16H3zM3 3l16 16M19 3L3 19M3 11h16M11 3v16" />;
      case "gannFan":
        return <path {...S} d="M3 19L20 2M3 19L20 8M3 19L20 14M3 19L9 2M3 19L15 2" />;
      case "rect":
        return <g {...S}><rect x="4" y="6" width="14" height="10" />{dot(4, 6)}{dot(18, 16)}</g>;
      case "text":
        return <path {...S} d="M5 5h12M11 5v13M8 18h6" />;
      case "measure":
        return <path {...S} d="M3 15L15 3l4 4L7 19zM7 11l2 2M10 8l2 2M13 5l2 2" />;
      case "magnet":
        return <path {...S} d="M5 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM5 7h4M13 7h4" />;
      case "lock":
        return <path {...S} d="M6 10h10v9H6zM8 10V7a3 3 0 0 1 6 0v3" />;
      case "hide":
        return <path {...S} d="M2 11s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zM11 9a2 2 0 1 0 0 4a2 2 0 0 0 0-4M3 3l16 16" />;
      case "trash":
        return <path {...S} d="M4 6h14M9 6V4h4v2M6 6l1 13h8l1-13M10 9v7M12 9v7" />;
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      {body}
    </svg>
  );
}

type Props = {
  tool: ToolId | null;
  onTool: (t: ToolId | null) => void;
  magnet: boolean;
  onMagnet: (on: boolean) => void;
  locked: boolean;
  onLock: (on: boolean) => void;
  hidden: boolean;
  onHide: (on: boolean) => void;
  count: number;
  onRemoveAll: () => void;
  /** The tool last used in each group, for its button. */
  last: Partial<Record<ToolGroup, ToolId>>;
};

const GROUPS: Array<{ group: ToolGroup; first: ToolId; title: string }> = [
  { group: "lines", first: "trend", title: "Lines" },
  { group: "fib", first: "fibRetracement", title: "Fibonacci and Gann" },
  { group: "shapes", first: "rect", title: "Shapes" },
  { group: "text", first: "text", title: "Text" },
  { group: "measure", first: "measure", title: "Measure" },
];

function Button({ active, title, onClick, children }: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      style={{ width: px(32), height: px(32) }}
      className={`flex items-center justify-center rounded ${active ? "bg-[#1f2a44] text-[#5b8cff]" : "dim hover:bg-[#1f1f1f] hover:text-[var(--text)]"}`}
    >
      {children}
    </button>
  );
}

/** A group's menu, as TradingView's: its tools under their headings, each with a hint. */
function GroupMenu({ group, at, current, onPick, onClose }: { group: ToolGroup; at: CSSProperties; current: ToolId | null; onPick: (t: ToolId) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const tools = TOOLS.filter((t) => t.group === group);
  let section: string | undefined;
  return createPortal(
    <div ref={ref} style={at} className="fixed z-[60] w-[calc(33rem*var(--font-scale))] text-fs-18 max-h-[80vh] overflow-auto bg-[#1a1a1a] border border-[var(--border)] py-1 shadow-xl">
      {tools.map((t) => {
        const heading = t.section && t.section !== section ? (section = t.section) : null;
        return (
          <div key={t.id}>
            {heading && <div className="dim text-fs-15 tracking-wider px-4 pt-3.5 pb-1.5 border-t border-[var(--border)] first:border-t-0">{heading}</div>}
            <button
              type="button"
              onClick={() => {
                onPick(t.id);
                onClose();
              }}
              style={{ minHeight: px(36) }}
              className={`w-full flex items-center gap-3.5 px-4 py-1.5 text-left hover:bg-[#262626] ${current === t.id ? "text-[#5b8cff]" : ""}`}
            >
              <ToolIcon id={t.id} />
              <span className="flex-1 whitespace-nowrap">{t.label}</span>
              <span className="dim w-6 h-6 shrink-0 rounded-full border border-[#444] text-fs-13 flex items-center justify-center" title={t.hint}>
                ?
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

export function DrawingToolbar(p: Props) {
  const [menu, setMenu] = useState<{ group: ToolGroup; at: CSSProperties } | null>(null);
  const openMenu = (group: ToolGroup, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ group, at: { left: r.right + 4, top: Math.max(8, Math.min(r.top, window.innerHeight - 780)) } });
  };

  return (
    <div style={{ width: px(40) }} className="shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col items-center gap-0.5 py-1 overflow-y-auto">
      <Button active={p.tool === null} title="Cursor (Esc)" onClick={() => p.onTool(null)}>
        <ToolIcon id="cursor" />
      </Button>
      {GROUPS.map(({ group, first, title }) => {
        const shown = p.last[group] ?? first;
        const inGroup = p.tool !== null && TOOL_BY_ID.get(p.tool)?.group === group;
        const many = TOOLS.filter((t) => t.group === group).length > 1;
        return (
          <div key={group} className="relative group/tool">
            <Button active={inGroup} title={TOOL_BY_ID.get(shown)!.label} onClick={() => p.onTool(p.tool === shown ? null : shown)}>
              <ToolIcon id={shown} />
            </Button>
            {many && (
              <button
                type="button"
                title={`${title}: all tools`}
                aria-label={`${title} menu`}
                onClick={(e) => openMenu(group, e.currentTarget.parentElement!)}
                className="absolute -right-1 top-1/2 -translate-y-1/2 w-4 h-8 text-fs-13 dim opacity-0 group-hover/tool:opacity-100 hover:text-[var(--text)]"
              >
                ›
              </button>
            )}
          </div>
        );
      })}
      <div style={{ width: px(24) }} className="border-t border-[var(--border)] my-1.5" />
      <Button active={p.magnet} title={p.magnet ? "Magnet on: points snap to open, high, low, close" : "Magnet"} onClick={() => p.onMagnet(!p.magnet)}>
        <ToolIcon id="magnet" />
      </Button>
      <Button active={p.locked} title={p.locked ? "Drawings locked" : "Lock all drawings"} onClick={() => p.onLock(!p.locked)}>
        <ToolIcon id="lock" />
      </Button>
      <Button active={p.hidden} title={p.hidden ? "Show drawings" : "Hide all drawings"} onClick={() => p.onHide(!p.hidden)}>
        <ToolIcon id="hide" />
      </Button>
      <Button
        title={`Remove all drawings${p.count ? ` (${p.count})` : ""}`}
        onClick={() => {
          if (p.count && window.confirm(`Remove all ${p.count} drawings on this symbol?`)) p.onRemoveAll();
        }}
      >
        <ToolIcon id="trash" />
      </Button>
      {menu && <GroupMenu group={menu.group} at={menu.at} current={p.tool} onPick={(t) => p.onTool(t)} onClose={() => setMenu(null)} />}
    </div>
  );
}
