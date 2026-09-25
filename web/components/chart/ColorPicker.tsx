"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PALETTE, opacityOf, toHex, withOpacity } from "../../lib/color";
import type { LineDash } from "../../lib/ta/types";

type Props = {
  color: string;
  onColor: (color: string) => void;
  /** Line plots also get thickness and line style, as in TradingView's popover. */
  width?: number;
  onWidth?: (w: 1 | 2 | 3 | 4) => void;
  dash?: LineDash;
  onDash?: (d: LineDash) => void;
};

const DASH_SAMPLE: Record<LineDash, string> = { solid: "", dashed: "4 3", dotted: "1 3" };

/** A swatch that opens TradingView's color popover: palette, custom color, opacity, and for lines
 *  thickness and line style. */
export function ColorPicker({ color, onColor, width, onWidth, dash, onDash }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const opacity = opacityOf(color);
  const hex = toHex(color);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    // Capture phase: the settings dialog stops mousedown from bubbling (so it doesn't close itself).
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1">
      <button
        type="button"
        title="Color"
        onClick={(e) => {
          // Drawn in a portal at a fixed position so the settings dialog's scroll area can't
          // clip it; opens below the swatch, or above when there's no room.
          const r = e.currentTarget.getBoundingClientRect();
          const W = 234;
          const H = onWidth ? 410 : 300;
          const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
          const top = r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
          setPlace({ position: "fixed", left, top, width: W });
          setOpen((o) => !o);
        }}
        className={`flex items-center gap-1.5 px-1.5 h-6 border ${open ? "border-[var(--amber)]" : "border-[var(--border)]"} hover:border-[var(--amber-dim)]`}
      >
        <span className="w-4 h-4 border border-[#333]" style={{ background: color }} />
        {width !== undefined && (
          <svg width="22" height="8" aria-hidden>
            <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth={width} strokeDasharray={DASH_SAMPLE[dash ?? "solid"]} />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
        <div ref={popRef} style={place} className="z-[60] bg-[#1a1a1a] border border-[var(--border)] p-2 shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-[3px]">
            {PALETTE.map((row, r) => (
              <div key={r} className={`flex gap-[3px] ${r === 2 ? "mt-1.5" : ""}`}>
                {row.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => onColor(withOpacity(c, opacity))}
                    className={`w-[19px] h-[19px] border ${hex === c ? "border-white" : "border-transparent"} hover:border-[#aaa]`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--border)] my-2" />
          <div className="flex items-center gap-2">
            <button type="button" title="Custom color" className="term-btn px-2" onClick={() => customRef.current?.click()}>
              +
            </button>
            <input ref={customRef} type="color" className="w-0 h-0 opacity-0" value={hex.toLowerCase()} onChange={(e) => onColor(withOpacity(e.target.value, opacity))} />
            <span className="dim text-[11px]">{hex}</span>
          </div>
          <div className="mt-2 text-[11px] dim">Opacity</div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => onColor(withOpacity(hex, Number(e.target.value)))}
              className="flex-1"
              style={{ accentColor: hex }}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => onColor(withOpacity(hex, Math.max(0, Math.min(100, Number(e.target.value) || 0))))}
              className="w-14"
            />
            <span className="dim text-[11px]">%</span>
          </div>
          {onWidth && (
            <>
              <div className="mt-2 text-[11px] dim">Thickness</div>
              <div className="flex gap-1">
                {([1, 2, 3, 4] as const).map((w) => (
                  <button key={w} type="button" onClick={() => onWidth(w)} className={`flex-1 h-6 border ${width === w ? "border-[var(--amber)] bg-[#262626]" : "border-[var(--border)]"}`}>
                    <svg width="100%" height="8" aria-hidden>
                      <line x1="15%" y1="4" x2="85%" y2="4" stroke="#d1d4dc" strokeWidth={w} />
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}
          {onDash && (
            <>
              <div className="mt-2 text-[11px] dim">Line style</div>
              <div className="flex gap-1">
                {(["solid", "dashed", "dotted"] as const).map((d) => (
                  <button key={d} type="button" title={d} onClick={() => onDash(d)} className={`flex-1 h-6 border ${(dash ?? "solid") === d ? "border-[var(--amber)] bg-[#262626]" : "border-[var(--border)]"}`}>
                    <svg width="100%" height="8" aria-hidden>
                      <line x1="12%" y1="4" x2="88%" y2="4" stroke="#d1d4dc" strokeWidth={2} strokeDasharray={DASH_SAMPLE[d]} />
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
