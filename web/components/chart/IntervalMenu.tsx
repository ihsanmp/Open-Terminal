"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { INTERVAL_GROUPS, INTERVAL_NAME, type ChartInterval } from "../../lib/chart-intervals";

type Props = {
  interval: ChartInterval;
  favorites: readonly string[];
  onSelect: (interval: ChartInterval) => void;
  onToggleFavorite: (interval: ChartInterval) => void;
};

/** TradingView's interval dropdown: intervals by group, each with a star that puts it on the
 *  toolbar. */
export function IntervalMenu({ interval, favorites, onSelect, onToggleFavorite }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className={`term-btn px-1.5 ${open ? "active" : ""}`}
        title="Interval — star intervals to keep them on the toolbar"
        onClick={() => {
          const r = buttonRef.current!.getBoundingClientRect();
          setPlace({ position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - 208)), top: r.bottom + 4, width: 200 });
          setOpen((o) => !o);
        }}
      >
        ▾
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} style={place} className="z-[60] bg-[#1a1a1a] border border-[var(--border)] py-1 text-[12px] shadow-lg max-h-[70vh] overflow-auto">
            {INTERVAL_GROUPS.map(([group, list]) => (
              <div key={group}>
                <div className="dim text-[10px] tracking-wider px-2 pt-2 pb-1">{group}</div>
                {list.map((i) => {
                  const starred = favorites.includes(i);
                  return (
                    <div
                      key={i}
                      role="button"
                      className={`group flex items-center h-7 px-2 cursor-pointer hover:bg-[#262626] ${i === interval ? "amber" : ""}`}
                      onClick={() => {
                        onSelect(i);
                        setOpen(false);
                      }}
                    >
                      <span className="flex-1">{INTERVAL_NAME[i]}</span>
                      <button
                        title={starred ? "Remove from favorites" : "Add to favorites"}
                        className={`w-5 text-[14px] leading-none ${starred ? "text-[#f5c518]" : "dim opacity-0 group-hover:opacity-100 hover:text-[#f5c518]"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(i);
                        }}
                      >
                        {starred ? "★" : "☆"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
