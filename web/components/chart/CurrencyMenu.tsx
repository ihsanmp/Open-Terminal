"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CURRENCIES } from "../../lib/currency";

type Props = {
  /** Where the button is (the menu opens under it, right-aligned). */
  anchor: DOMRect;
  /** The symbol's own currency, and the one the chart shows. */
  native: string;
  shown: string;
  /** A currency picked whose rates couldn't be had. */
  failed: string | null;
  onPick: (code: string) => void;
  onClose: () => void;
};

/** TradingView's currency menu on the price scale: search, the chart's own currency first, then the rest. */
export function CurrencyMenu({ anchor, native, shown, failed, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const W = 240;
  const left = Math.max(8, Math.min(anchor.right - W, window.innerWidth - W - 8));
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 200);
  const needle = q.trim().toUpperCase();
  const own = CURRENCIES.find((c) => c.code === native) ?? { code: native, name: "Mata uang simbol ini" };
  const rest = CURRENCIES.filter((c) => c.code !== native);
  const match = (c: { code: string; name: string }) => !needle || c.code.includes(needle) || c.name.toUpperCase().includes(needle);

  const row = (c: { code: string; name: string }, note?: string) => (
    <button
      key={c.code}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[#262626] ${c.code === shown ? "bg-[#1f1a10]" : ""}`}
      onClick={() => {
        onPick(c.code);
        onClose();
      }}
    >
      <span className="flex-1 min-w-0">
        <span className={`block font-bold ${c.code === shown ? "amber" : "text-[var(--text)]"}`}>{c.code}</span>
        <span className="block dim text-fs-10 truncate">{c.name}</span>
      </span>
      {note && <span className="dim text-fs-9 shrink-0">{note}</span>}
    </button>
  );

  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, width: W, maxHeight: Math.max(200, window.innerHeight - top - 8) }} className="z-[60] flex flex-col bg-[#1a1a1a] border border-[var(--border)] text-fs-12 shadow-lg">
      <div className="px-3 pt-2 pb-1 dim text-fs-10 uppercase tracking-wider">Currencies</div>
      <div className="px-3 pb-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" spellCheck={false} className="w-full !bg-transparent border border-[var(--border)] rounded px-2 py-1" />
      </div>
      {failed && <div className="px-3 pb-2 down text-fs-10">Kurs {failed} tidak tersedia: chart tetap dalam {native}.</div>}
      <div className="overflow-auto border-t border-[var(--border)]">
        {match(own) && row(own, "asli")}
        {match(own) && <div className="border-t border-[var(--border)]" />}
        {rest.filter(match).map((c) => row(c))}
      </div>
      <div className="px-3 py-1.5 dim text-fs-9 border-t border-[var(--border)] leading-snug">Tiap candle dikonversi dengan kurs pada waktunya sendiri. Volume tetap dalam unit.</div>
    </div>,
    document.body
  );
}
