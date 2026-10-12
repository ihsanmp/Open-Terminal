"use client";

import { useEffect, useRef } from "react";

export type MenuItem = { label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick: () => void } | "separator";

/**
 * The chart's right-click menu, as TradingView's: items with their shortcuts, kept inside the
 * window. A click elsewhere, Escape or a choice closes it.
 */
export default function ChartContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  // Kept on screen: it opens up or to the left of the pointer near the edges.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, at.x - r.width)}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, at.y - r.height)}px`;
  }, [at]);
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[230px] py-1 bg-[var(--panel)] border border-[var(--border)] shadow-2xl rounded text-fs-11 select-none"
      style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={`sep-${i}`} className="my-1 border-t border-[var(--border)]" />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            disabled={it.disabled}
            className={`w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left ${
              it.disabled ? "dim opacity-50" : it.danger ? "hover:bg-[#2a1515] hover:text-[var(--down)]" : "hover:bg-[#1f1a10] hover:text-[var(--amber)]"
            }`}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="dim text-fs-10">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  );
}
