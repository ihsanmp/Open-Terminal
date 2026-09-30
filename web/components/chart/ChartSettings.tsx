"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPicker } from "./ColorPicker";
import { DEFAULT_CHART_STYLE, TIMEZONES, utcOffsetLabel, type ChartStyle, type UpDown } from "../../lib/chart-style";

type Tab = "symbol" | "canvas";

type Props = {
  style: ChartStyle;
  exchangeZone: string;
  onApply: (style: ChartStyle) => void;
  onClose: () => void;
};

const PRECISIONS: Array<["default" | number, string]> = [
  ["default", "Default"],
  [0, "1"],
  [1, "0.1"],
  [2, "0.01"],
  [3, "0.001"],
  [4, "0.0001"],
  [5, "0.00001"],
  [6, "0.000001"],
  [7, "0.0000001"],
  [8, "0.00000001"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="dim text-[10px] tracking-wider mt-3 mb-2 first:mt-0">{title}</div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </>
  );
}

/** TradingView's chart Settings dialog: the Symbol tab (candles, precision, timezone) and the
 *  Canvas tab (background and grid). */
export function ChartSettings({ style, exchangeZone, onApply, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("symbol");
  const [draft, setDraft] = useState<ChartStyle>(style);
  const [templateOpen, setTemplateOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const upDown = (key: "body" | "borders" | "wick", label: string) => {
    const v: UpDown = draft[key];
    const set = (patch: Partial<UpDown>) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
    return (
      <div className="flex items-center gap-3 text-[12px]">
        <label className="flex items-center gap-2 w-24">
          <input type="checkbox" checked={v.visible} onChange={(e) => set({ visible: e.target.checked })} />
          {label}
        </label>
        <ColorPicker color={v.up} onColor={(up) => set({ up })} />
        <ColorPicker color={v.down} onColor={(down) => set({ down })} />
      </div>
    );
  };

  const grid = (key: "vertGrid" | "horzGrid", label: string) => (
    <div className="flex items-center gap-3 text-[12px]">
      <label className="flex items-center gap-2 w-40">
        <input type="checkbox" checked={draft[key].visible} onChange={(e) => setDraft((d) => ({ ...d, [key]: { ...d[key], visible: e.target.checked } }))} />
        {label}
      </label>
      <ColorPicker color={draft[key].color} onColor={(color) => setDraft((d) => ({ ...d, [key]: { ...d[key], color } }))} />
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-20" onMouseDown={onClose}>
      <div className="bg-[var(--panel)] border border-[var(--amber-dim)] flex flex-col max-h-[80vh] w-[560px]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <span className="amber font-bold tracking-wide">Settings</span>
          <button className="dim hover:text-[var(--text)]" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex min-h-[300px] overflow-hidden">
          <nav className="w-36 shrink-0 border-r border-[var(--border)] p-1.5 flex flex-col gap-0.5 text-[12px]">
            {(
              [
                ["symbol", "Symbol"],
                ["canvas", "Canvas"],
              ] as const
            ).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`text-left px-2 py-1.5 ${tab === t ? "bg-[#262626] text-[var(--text)]" : "dim hover:text-[var(--text)]"}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-auto p-3">
            {tab === "symbol" && (
              <>
                <Section title="CANDLES">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={draft.colorByPrevClose} onChange={(e) => setDraft((d) => ({ ...d, colorByPrevClose: e.target.checked }))} />
                    Color bars based on previous close
                  </label>
                  {upDown("body", "Body")}
                  {upDown("borders", "Borders")}
                  {upDown("wick", "Wick")}
                </Section>
                <Section title="DATA MODIFICATION">
                  <label className="flex items-center gap-3 text-[12px]">
                    <span className="w-24">Precision</span>
                    <select
                      className="w-48"
                      value={String(draft.precision)}
                      onChange={(e) => setDraft((d) => ({ ...d, precision: e.target.value === "default" ? "default" : Number(e.target.value) }))}
                    >
                      {PRECISIONS.map(([v, label]) => (
                        <option key={String(v)} value={String(v)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-3 text-[12px]">
                    <span className="w-24">Timezone</span>
                    <select className="w-48" value={draft.timezone} onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}>
                      <option value="exchange">Exchange {utcOffsetLabel(exchangeZone)}</option>
                      {TIMEZONES.map(([zone, name]) => (
                        <option key={zone} value={zone}>
                          {zone === "UTC" ? "UTC" : `${utcOffsetLabel(zone)} ${name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </Section>
              </>
            )}
            {tab === "canvas" && (
              <Section title="CHART BASIC STYLES">
                <div className="flex items-center gap-3 text-[12px]">
                  <span className="w-40 pl-6">Background</span>
                  <ColorPicker color={draft.background} onColor={(background) => setDraft((d) => ({ ...d, background }))} />
                </div>
                {grid("vertGrid", "Vert grid lines")}
                {grid("horzGrid", "Horz grid lines")}
              </Section>
            )}
          </div>
        </div>
        <div className="flex justify-between items-center px-3 py-2 border-t border-[var(--border)]">
          <span className="relative">
            <button className="term-btn" onClick={() => setTemplateOpen((o) => !o)}>
              Template ▾
            </button>
            {templateOpen && (
              <div className="absolute bottom-full mb-1 left-0 bg-[#1a1a1a] border border-[var(--border)] py-1 text-[12px] w-40 shadow-lg">
                <button
                  className="w-full text-left px-2 h-7 hover:bg-[#262626]"
                  onClick={() => {
                    setDraft(DEFAULT_CHART_STYLE);
                    setTemplateOpen(false);
                  }}
                >
                  Apply defaults
                </button>
              </div>
            )}
          </span>
          <span className="flex gap-2">
            <button className="term-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="term-btn active"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              Ok
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
