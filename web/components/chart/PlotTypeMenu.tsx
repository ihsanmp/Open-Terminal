"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PlotStyle } from "../../lib/ta/types";

// TradingView's plot-type button on the Style tab (the ∿ next to a plot's color): draws the plot
// as a line, step line, histogram, area or circles.

const TYPES: Array<[PlotStyle, string]> = [
  ["line", "Line"],
  ["step", "Step line"],
  ["histogram", "Histogram"],
  ["area", "Area"],
  ["circles", "Circles"],
];

function Icon({ type }: { type: PlotStyle }) {
  const stroke = { stroke: "currentColor", strokeWidth: 1.3, fill: "none" } as const;
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
      {type === "line" && <path d="M1 9 C4 1, 6 1, 9 6 S14 11, 17 3" {...stroke} />}
      {type === "step" && <path d="M1 9 H5 V4 H10 V7 H14 V2 H17" {...stroke} />}
      {type === "histogram" && [2, 6, 10, 14].map((x, i) => <rect key={x} x={x} y={[6, 3, 7, 4][i]} width="2" height={11 - [6, 3, 7, 4][i]} fill="currentColor" />)}
      {type === "area" && <path d="M1 11 V8 C4 2, 7 3, 9 6 S14 9, 17 3 V11 Z" fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1" />}
      {type === "circles" && [2, 6.5, 11, 15.5].map((x, i) => <circle key={x} cx={x} cy={[8, 4, 6, 3][i]} r="1.4" fill="currentColor" />)}
    </svg>
  );
}

export function PlotTypeMenu({ type, onType }: { type: PlotStyle; onType: (t: PlotStyle) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    // Capture phase: the settings dialog stops mousedown from bubbling.
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        title={`Plot type: ${TYPES.find(([t]) => t === type)?.[1]}`}
        aria-label="Plot type"
        onClick={(e) => {
          // In a portal at a fixed position, so the dialog's scroll area can't clip it.
          const r = e.currentTarget.getBoundingClientRect();
          const H = TYPES.length * 28 + 8;
          setPlace({ position: "fixed", left: Math.min(r.left, window.innerWidth - 168), top: r.bottom + 4 + H > window.innerHeight ? r.top - H - 4 : r.bottom + 4, width: 160 });
          setOpen((o) => !o);
        }}
        className={`flex items-center justify-center w-7 h-6 border ${open ? "border-[var(--amber)]" : "border-[var(--border)]"} hover:border-[var(--amber-dim)]`}
      >
        <Icon type={type} />
      </button>
      {open &&
        createPortal(
          <div ref={popRef} style={place} className="z-[60] bg-[#1a1a1a] border border-[var(--border)] py-1 shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
            {TYPES.map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  onType(t);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2 h-7 text-left hover:bg-[#262626] ${t === type ? "text-[var(--amber)]" : ""}`}
              >
                <Icon type={t} />
                {label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
