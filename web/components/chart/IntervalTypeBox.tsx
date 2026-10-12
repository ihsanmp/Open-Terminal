"use client";

import { useEffect, useRef, useState } from "react";
import { INTERVAL_NAME, parseIntervalInput, type ChartInterval } from "../../lib/chart-intervals";

/**
 * TradingView's "Change interval" box: a number typed on the chart opens it with that number,
 * more can be typed (15, 240, 4h, 1D, 1W …), the interval it means shows under it, and Enter
 * changes to it. Escape, or a click elsewhere, closes it.
 */
export default function IntervalTypeBox({ initial, onApply, onClose }: { initial: string; onApply: (i: ChartInterval) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const parsed = parseIntervalInput(text);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Change interval"
        className="bg-[var(--panel)] border border-[var(--border)] shadow-2xl rounded px-5 py-4 w-[260px] text-center"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-fs-13 font-bold text-[var(--text)] mb-3">Change interval</div>
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && parsed) {
              onApply(parsed);
              onClose();
            }
          }}
          onBlur={onClose}
          className="w-full text-center text-fs-15 py-1.5 !border-[var(--amber)] rounded"
          spellCheck={false}
        />
        <div className={`mt-1.5 text-fs-10 ${parsed ? "dim" : "down"}`}>{parsed ? INTERVAL_NAME[parsed] : "Not available"}</div>
      </div>
    </div>
  );
}
