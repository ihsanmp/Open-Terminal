"use client";

import { KIND_LABEL, type PairContext } from "../../lib/pair";
import { useTerminal } from "../../store/terminal";

/** The strip atop a desk page: the chart's pair it follows, and what the page shows for it. */
export default function PairBanner({ symbol, ctx, children }: { symbol: string; ctx: PairContext | null; children?: React.ReactNode }) {
  const setView = useTerminal((s) => s.setView);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border border-[#3a3220] bg-[#16130b] rounded-sm text-fs-10">
      <span className="dim">Mengikuti pair di Charting:</span>
      <button className="font-bold text-[var(--amber)] hover:underline" onClick={() => setView("chart")} title="Buka chart (ganti pair di sana)">
        {symbol}
      </button>
      {ctx && (
        <span>
          {ctx.label} <span className="dim">· {KIND_LABEL[ctx.kind]}{ctx.sector ? ` · ${ctx.sector}` : ""}</span>
        </span>
      )}
      {children && <span className="dim">— {children}</span>}
    </div>
  );
}
