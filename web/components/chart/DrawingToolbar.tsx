"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CURSORS, ERASER, type CursorMode } from "../../lib/chart-cursor";
import { TOOLS, TOOL_BY_ID, type ToolGroup, type ToolId } from "../../lib/drawings/tools";

// TradingView's drawing toolbar, down the left of the chart: the cursor (with its menu: Cross,
// Dot, Arrow, Demonstration, Magic, the Eraser and the values tooltip), each group of tools (a
// button for the one used last, a menu for the rest), then the magnet, locking, hiding and
// removing all drawings. A star in a menu puts a cursor or tool on the favorites bar.

/** How much larger than TradingView's the toolbar is drawn (1.35: a third as large again). */
const TOOLBAR_SCALE = 1.35;
/** A designed text size at the toolbar's scale (and the app's text scale). */
const textPx = (n: number) => `calc(${n * TOOLBAR_SCALE}px * var(--font-scale))`;
const px = (n: number) => Math.round(n * TOOLBAR_SCALE);

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A small picture of each tool, after TradingView's. */
export function ToolIcon({ id, size = px(22) }: { id: ToolId | CursorMode | "cursor" | "magnet" | "lock" | "hide" | "trash"; size?: number }) {
  const dot = (x: number, y: number) => <circle cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />;
  const body = (() => {
    switch (id) {
      case "cursor":
      case "cross":
        return <path {...S} d="M11 3v6M11 13v6M3 11h6M13 11h6" />;
      case "dot":
        return <circle cx="11" cy="11" r="2.2" fill="currentColor" />;
      case "arrow":
        return <path {...S} d="M7 4v13l3.5-3.5 2.5 5.5 2-1-2.5-5.5H17z" />;
      case "demo":
        return <g {...S}><circle cx="11" cy="11" r="8" /><path d="M9 7v9l2.5-2.5 1.8 3.6 1.4-.7-1.8-3.6H16z" /></g>;
      case "magic":
        return <g {...S}><path d="M4 18l9-9" strokeWidth="2" /><path d="M15 3v3M13.5 4.5h3M18 8v2M17 9h2M11 2v1.5" /></g>;
      case "eraser":
        return <path {...S} d="M4 14l8-8a1.4 1.4 0 0 1 2 0l3.5 3.5a1.4 1.4 0 0 1 0 2L11 18H7.5zM8.5 9.5l5 5M4 19h14" />;
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
      case "infoLine":
        return <g {...S}><path d="M4 18L16 6" />{dot(4, 18)}{dot(16, 6)}<path d="M13 15h6v4h-6z" /></g>;
      case "trendAngle":
        return <g {...S}><path d="M4 17L17 5M4 17h14M10 17a6 6 0 0 0-1.6-4.2" />{dot(4, 17)}</g>;
      case "crossLine":
        return <g {...S}><path d="M2 11h18M11 2v18" />{dot(11, 11)}</g>;
      case "regression":
        return <path {...S} d="M3 16L19 6M3 12L19 2M3 20L19 10" strokeDasharray="0" />;
      case "flatTopBottom":
        return <g {...S}><path d="M3 16L19 9M3 5h16" />{dot(3, 16)}{dot(19, 9)}</g>;
      case "disjointChannel":
        return <g {...S}><path d="M3 15L19 9M3 7l16 6" />{dot(3, 15)}{dot(3, 7)}</g>;
      case "pitchfork":
      case "schiffPitchfork":
      case "modifiedSchiff":
      case "insidePitchfork":
        return <g {...S}><path d="M3 15L19 9M8 5l12 4M8 19l12-4M8 5v14" />{dot(3, 15)}</g>;
      case "xabcd":
      case "cypher":
        return <g {...S}><path d="M2 17L6 5l4 9 5-7 5 12" /><path d="M2 17L10 14M10 14l10 5" strokeDasharray="2 2" /></g>;
      case "headShoulders":
        return <path {...S} d="M1 17l3-6 3 4 4-11 4 11 3-4 3 6M3 14h17" />;
      case "abcd":
        return <path {...S} d="M3 18L8 6l5 8 6-11" />;
      case "trianglePattern":
        return <path {...S} d="M2 4l5 14 5-10 4 7 4-3M2 4l18 7M7 18l13-7" />;
      case "threeDrives":
        return <path {...S} d="M1 18l4-6 2 3 4-7 2 3 4-8 2 3" />;
      case "elliottImpulse":
      case "elliottTriangle":
      case "elliottTriple":
        return <path {...S} d="M1 18l4-8 3 4 5-10 3 5 5-6" />;
      case "elliottCorrection":
      case "elliottDouble":
        return <path {...S} d="M3 5l5 10 4-5 6 9" />;
      case "cyclicLines":
        return <path {...S} d="M3 3v16M9 3v16M15 3v16M21 3v16" />;
      case "timeCycles":
        return <path {...S} d="M1 17a5 5 0 0 1 10 0a5 5 0 0 1 10 0" />;
      case "sineLine":
        return <path {...S} d="M1 11c3-8 5-8 7 0s4 8 7 0 4-8 6 0" />;
      case "longPosition":
        return <g {...S}><path d="M3 4h16v7H3z" /><path d="M3 11h16v7H3z" strokeDasharray="2 2" /></g>;
      case "shortPosition":
        return <g {...S}><path d="M3 4h16v7H3z" strokeDasharray="2 2" /><path d="M3 11h16v7H3z" /></g>;
      case "forecast":
        return <g {...S}><path d="M3 17L17 6M13 6h4v4" />{dot(3, 17)}</g>;
      case "anchoredVwap":
        return <g {...S}><path d="M4 17c4-1 5-8 9-9s4 2 7 1" />{dot(4, 17)}</g>;
      case "volumeProfile":
        return <path {...S} d="M3 3v16M3 5h6M3 8h11M3 11h15M3 14h9M3 17h4" />;
      case "priceRange":
        return <path {...S} d="M4 4h14M4 18h14M11 6v10M8 8l3-3 3 3M8 14l3 3 3-3" />;
      case "dateRange":
        return <path {...S} d="M4 4v14M18 4v14M6 11h10M8 8l-3 3 3 3M14 8l3 3-3 3" />;
      case "brush":
        return <path {...S} d="M3 18c3 0 3-3 5-3s1 3 4 1 3-8 7-12" />;
      case "highlighter":
        return <path {...S} d="M5 19l2-6 9-9 3 3-9 9zM4 20h7" />;
      case "arrowMarker":
        return <path {...S} d="M3 17l9-9-2-2h7v7l-2-2-9 9z" />;
      case "arrow":
        return <path {...S} d="M4 18L18 4M11 4h7v7" />;
      case "arrowUp":
        return <path {...S} d="M11 3l6 7h-4v9H9v-9H5z" />;
      case "arrowDown":
        return <path {...S} d="M11 19l6-7h-4V3H9v9H5z" />;
      case "rotatedRect":
        return <path {...S} d="M3 13l7-9 9 5-7 9z" />;
      case "path":
        return <path {...S} d="M3 18l5-8 5 4 6-9M16 5h3v3" />;
      case "circle":
        return <circle {...S} cx="11" cy="11" r="8" />;
      case "ellipse":
        return <ellipse {...S} cx="11" cy="11" rx="9" ry="6" />;
      case "polyline":
        return <path {...S} d="M3 15l4-10 8 3 4 9-11 2z" />;
      case "triangle":
        return <path {...S} d="M11 3l8 15H3z" />;
      case "arc":
        return <path {...S} d="M3 17a9 9 0 0 1 16 0" />;
      case "curve":
        return <path {...S} d="M3 18Q11 0 19 18" />;
      case "doubleCurve":
        return <path {...S} d="M2 17C6 0 10 0 11 11s5 11 9-6" />;
      case "note":
        return <path {...S} d="M4 3h11l3 3v13H4zM7 8h8M7 12h8M7 16h5" />;
      case "priceNote":
        return <g {...S}><path d="M4 17L12 9h7v-4h-7v4" />{dot(4, 17)}</g>;
      case "pin":
        return <g {...S}><circle cx="11" cy="8" r="4" /><path d="M11 12v8" /></g>;
      case "callout":
        return <path {...S} d="M3 4h16v10h-9l-5 5v-5H3z" />;
      case "priceLabel":
        return <path {...S} d="M3 11l5-5h11v10H8z" />;
      case "signpost":
        return <path {...S} d="M11 21V3M5 4h11l3 3-3 3H5z" />;
      case "flagMark":
        return <path {...S} d="M5 21V3M5 4h12l-3 4 3 4H5" />;
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
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden className="shrink-0">
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
  cursor: CursorMode;
  onCursor: (m: CursorMode) => void;
  valuesTooltip: boolean;
  onValuesTooltip: (on: boolean) => void;
  /** Starred cursors ("cursor:dot") and tools, for the favorites bar. */
  favorites: string[];
  onFavorite: (id: string) => void;
};

/** A favorite's id: a tool's own, or a cursor's as "cursor:<mode>". */
export const cursorFav = (m: CursorMode) => `cursor:${m}`;

function Star({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={on}
      title={on ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      style={{ fontSize: textPx(13) }}
      className={`shrink-0 px-1 ${on ? "text-[#f5c518]" : "dim opacity-0 group-hover/item:opacity-100 hover:text-[var(--text)]"}`}
    >
      {on ? "★" : "☆"}
    </span>
  );
}

/** Closes a menu on a click outside it or on Escape. */
function useDismiss(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [ref, onClose]);
}

const MENU_ITEM = "group/item w-full flex items-center gap-3.5 px-4 py-1.5 text-left hover:bg-[#262626]";
const ALL_CURSORS = [...CURSORS, ERASER];

/** The cursor's menu, as TradingView's: the cursors, the Eraser, and the values tooltip switch. */
function CursorMenu(p: {
  at: CSSProperties;
  current: CursorMode;
  active: boolean;
  favorites: string[];
  valuesTooltip: boolean;
  onPick: (m: CursorMode) => void;
  onFavorite: (id: string) => void;
  onValuesTooltip: (on: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, p.onClose);
  const item = ({ id, label }: { id: CursorMode; label: string }) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        p.onPick(id);
        p.onClose();
      }}
      style={{ minHeight: px(36) }}
      className={`${MENU_ITEM} ${p.active && p.current === id ? "bg-[#2a2e39] text-white" : ""}`}
    >
      <ToolIcon id={id} />
      <span className="flex-1 whitespace-nowrap">{label}</span>
      <Star on={p.favorites.includes(cursorFav(id))} label={label} onToggle={() => p.onFavorite(cursorFav(id))} />
    </button>
  );
  return createPortal(
    <div ref={ref} role="menu" style={{ ...p.at, width: `calc(${17 * TOOLBAR_SCALE}rem * var(--font-scale))`, fontSize: textPx(12) }} className="fixed z-[60] bg-[#1a1a1a] border border-[var(--border)] py-1 shadow-xl">
      {CURSORS.map(item)}
      <div className="border-t border-[var(--border)] my-1" />
      {item(ERASER)}
      <div className="border-t border-[var(--border)] my-1" />
      <label style={{ minHeight: px(36) }} className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-[#262626]">
        <span className="flex-1">Values tooltip on long press</span>
        <span
          aria-hidden
          style={{ width: px(30), height: px(16) }}
          className={`relative shrink-0 rounded-full transition-colors ${p.valuesTooltip ? "bg-[#d1d4dc]" : "bg-[#3a3a3a]"}`}
        >
          <span
            style={{ width: px(12), height: px(12), left: p.valuesTooltip ? px(16) : px(2) }}
            className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all ${p.valuesTooltip ? "bg-[#131313]" : "bg-[#9a9a9a]"}`}
          />
        </span>
        <input type="checkbox" role="switch" className="sr-only" checked={p.valuesTooltip} onChange={(e) => p.onValuesTooltip(e.target.checked)} />
      </label>
    </div>,
    document.body
  );
}

/** TradingView's favorites bar: the starred cursors and tools, one click away, over the chart. */
export function FavoritesBar(p: { favorites: string[]; tool: ToolId | null; cursor: CursorMode; onTool: (t: ToolId | null) => void; onCursor: (m: CursorMode) => void }) {
  const items = p.favorites.filter((f) => (f.startsWith("cursor:") ? ALL_CURSORS.some((c) => cursorFav(c.id) === f) : TOOL_BY_ID.has(f as ToolId)));
  if (items.length === 0) return null;
  return (
    <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 flex gap-0.5 p-0.5 bg-[var(--panel)] border border-[var(--border)] rounded shadow-lg" role="toolbar" aria-label="Favorites">
      {items.map((f) => {
        if (f.startsWith("cursor:")) {
          const m = f.slice("cursor:".length) as CursorMode;
          const label = ALL_CURSORS.find((c) => c.id === m)!.label;
          return (
            <Button
              key={f}
              active={p.tool === null && p.cursor === m}
              title={label}
              onClick={() => {
                p.onTool(null);
                p.onCursor(m);
              }}
            >
              <ToolIcon id={m} />
            </Button>
          );
        }
        const t = f as ToolId;
        return (
          <Button key={f} active={p.tool === t} title={TOOL_BY_ID.get(t)!.label} onClick={() => p.onTool(p.tool === t ? null : t)}>
            <ToolIcon id={t} />
          </Button>
        );
      })}
    </div>
  );
}

const GROUPS: Array<{ group: ToolGroup; first: ToolId; title: string }> = [
  { group: "lines", first: "trend", title: "Lines" },
  { group: "fib", first: "fibRetracement", title: "Fibonacci and Gann" },
  { group: "patterns", first: "xabcd", title: "Patterns" },
  { group: "forecast", first: "longPosition", title: "Forecasting and measurement" },
  { group: "shapes", first: "brush", title: "Geometric shapes" },
  { group: "text", first: "text", title: "Annotation" },
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
function GroupMenu({
  group,
  at,
  current,
  favorites,
  onFavorite,
  onPick,
  onClose,
}: {
  group: ToolGroup;
  at: CSSProperties;
  current: ToolId | null;
  favorites: string[];
  onFavorite: (id: string) => void;
  onPick: (t: ToolId) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const tools = TOOLS.filter((t) => t.group === group);
  let section: string | undefined;
  return createPortal(
    <div ref={ref} style={{ ...at, minWidth: `calc(${22 * TOOLBAR_SCALE}rem * var(--font-scale))`, fontSize: textPx(12) }} className="fixed z-[60] w-max max-h-[80vh] overflow-y-auto overflow-x-hidden bg-[#1a1a1a] border border-[var(--border)] py-1 shadow-xl">
      {tools.map((t) => {
        const heading = t.section && t.section !== section ? (section = t.section) : null;
        return (
          <div key={t.id}>
            {heading && <div style={{ fontSize: textPx(10) }} className="dim tracking-wider px-4 pt-3 pb-1.5 border-t border-[var(--border)] first:border-t-0">{heading}</div>}
            <button
              type="button"
              onClick={() => {
                onPick(t.id);
                onClose();
              }}
              style={{ minHeight: px(36) }}
              className={`${MENU_ITEM} ${current === t.id ? "text-[#5b8cff]" : ""}`}
            >
              <ToolIcon id={t.id} />
              <span className="flex-1 whitespace-nowrap">{t.label}</span>
              <Star on={favorites.includes(t.id)} label={t.label} onToggle={() => onFavorite(t.id)} />
              <span style={{ width: px(16), height: px(16), fontSize: textPx(9) }} className="dim shrink-0 rounded-full border border-[#444] flex items-center justify-center" title={t.hint}>
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
  const [menu, setMenu] = useState<{ group: ToolGroup | "cursor"; at: CSSProperties } | null>(null);
  const openMenu = (group: ToolGroup | "cursor", el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ group, at: { left: r.right + 4, top: Math.max(8, Math.min(r.top, window.innerHeight - (group === "cursor" ? 380 : 780))) } });
  };
  const cursorLabel = ALL_CURSORS.find((c) => c.id === p.cursor)?.label ?? "Cross";

  return (
    <div style={{ width: px(40) }} className="shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col items-center gap-0.5 py-1 overflow-y-auto">
      <div className="relative group/tool">
        <Button active={p.tool === null} title={`${cursorLabel} (Esc)`} onClick={() => p.onTool(null)}>
          <ToolIcon id={p.cursor} />
        </Button>
        <button
          type="button"
          title="Cursors"
          aria-label="Cursors menu"
          onClick={(e) => openMenu("cursor", e.currentTarget.parentElement!)}
          style={{ width: px(11), height: px(22), fontSize: textPx(9) }}
          className="absolute -right-1 top-1/2 -translate-y-1/2 dim opacity-0 group-hover/tool:opacity-100 hover:text-[var(--text)]"
        >
          ›
        </button>
      </div>
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
                style={{ width: px(11), height: px(22), fontSize: textPx(9) }}
                className="absolute -right-1 top-1/2 -translate-y-1/2 dim opacity-0 group-hover/tool:opacity-100 hover:text-[var(--text)]"
              >
                ›
              </button>
            )}
          </div>
        );
      })}
      <Button active={p.tool === "measure"} title="Measure" onClick={() => p.onTool(p.tool === "measure" ? null : "measure")}>
        <ToolIcon id="measure" />
      </Button>
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
      {menu && menu.group === "cursor" && (
        <CursorMenu
          at={menu.at}
          current={p.cursor}
          active={p.tool === null}
          favorites={p.favorites}
          valuesTooltip={p.valuesTooltip}
          onPick={(m) => {
            p.onTool(null);
            p.onCursor(m);
          }}
          onFavorite={p.onFavorite}
          onValuesTooltip={p.onValuesTooltip}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && menu.group !== "cursor" && (
        <GroupMenu group={menu.group} at={menu.at} current={p.tool} favorites={p.favorites} onFavorite={p.onFavorite} onPick={(t) => p.onTool(t)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
