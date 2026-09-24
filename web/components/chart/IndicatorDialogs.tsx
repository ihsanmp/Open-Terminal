"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SOURCES } from "../../lib/ta/core";
import {
  CATEGORIES,
  INDICATORS,
  defaultParams,
  matchesQuery,
  type Category,
  type IndicatorDef,
  type IndicatorInstance,
  type Params,
} from "../../lib/ta";

function Modal({ title, onClose, width, children }: { title: string; onClose: () => void; width: number; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portaled: widget panels are transformed by react-grid-layout, which would
  // otherwise trap a position:fixed overlay inside the panel.
  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-20" onMouseDown={onClose}>
      <div
        className="bg-[var(--panel)] border border-[var(--amber-dim)] flex flex-col max-h-[80vh]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <span className="amber font-bold tracking-wide">{title}</span>
          <button className="dim hover:text-[var(--text)]" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function IndicatorPicker({ onAdd, onClose }: { onAdd: (def: IndicatorDef) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "All">("All");
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    return INDICATORS.filter((d) => (category === "All" || d.category === category) && matchesQuery(d, query));
  }, [query, category]);

  const add = (def: IndicatorDef) => {
    onAdd(def);
    setFlash(def.id);
    setTimeout(() => setFlash((f) => (f === def.id ? null : f)), 600);
  };

  return (
    <Modal title="Indicators" onClose={onClose} width={640}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && results[0] && add(results[0])}
        placeholder={`Search ${INDICATORS.length} indicators…`}
        className="!border-0 !border-b !border-[var(--border)] px-3 py-2 text-[13px]"
      />
      <div className="flex min-h-0 flex-1">
        <div className="w-44 shrink-0 border-r border-[var(--border)] py-1 overflow-auto">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <div
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1 cursor-pointer text-[12px] ${category === c ? "bg-[#1f1a10] text-[var(--amber)]" : "hover:bg-[#161616]"}`}
            >
              {c}
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-auto py-1">
          {results.map((d) => (
            <div
              key={d.id}
              onClick={() => add(d)}
              title={d.description}
              className={`px-3 py-1.5 flex gap-3 cursor-pointer items-baseline ${flash === d.id ? "bg-[#10261a]" : "hover:bg-[#161616]"}`}
            >
              <span className="flex-1 truncate">{d.name}</span>
              <span className="dim text-[11px]">{d.overlay ? "overlay" : "pane"}</span>
              <span className="dim text-[11px] w-32 text-right truncate">{d.category}</span>
            </div>
          ))}
          {results.length === 0 && <div className="px-3 py-3 dim">No indicators match “{query}”</div>}
        </div>
      </div>
      <div className="px-3 py-1.5 border-t border-[var(--border)] dim text-[11px]">
        Click to add (you can add the same indicator more than once) · Enter adds the first match · Esc closes
      </div>
    </Modal>
  );
}

export function IndicatorSettings({
  def,
  instance,
  plotSources = [],
  onApply,
  onClose,
}: {
  def: IndicatorDef;
  instance: IndicatorInstance;
  /** Other indicators' plots on the chart, offered by source inputs marked `external`. */
  plotSources?: Array<{ value: string; label: string }>;
  onApply: (params: Params) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Params>({ ...defaultParams(def), ...instance.params });
  const set = (key: string, value: Params[string]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Modal title={def.name} onClose={onClose} width={420}>
      <div className="overflow-auto px-3 py-2 flex flex-col gap-1.5">
        {def.inputs.length === 0 && <div className="dim py-2">This indicator has no inputs.</div>}
        {def.inputs.map((input) => (
          <label key={input.key} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="dim">{input.label}</span>
            {input.type === "bool" ? (
              <input type="checkbox" checked={Boolean(draft[input.key])} onChange={(e) => set(input.key, e.target.checked)} />
            ) : input.type === "color" ? (
              <input type="color" className="w-40 h-6 bg-transparent" value={String(draft[input.key])} onChange={(e) => set(input.key, e.target.value)} />
            ) : input.type === "source" || input.type === "select" ? (
              <select className="w-40" value={String(draft[input.key])} onChange={(e) => set(input.key, e.target.value)}>
                {(input.type === "source" ? SOURCES : input.options).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {input.type === "source" && input.external && plotSources.length > 0 && (
                  <optgroup label="Indicators on this chart">
                    {plotSources.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {input.type === "source" &&
                  String(draft[input.key]).startsWith("plot:") &&
                  !plotSources.some((o) => o.value === draft[input.key]) && (
                    <option value={String(draft[input.key])}>(removed indicator)</option>
                  )}
              </select>
            ) : (
              <input
                type="number"
                className="w-40"
                value={String(draft[input.key])}
                step={input.step}
                min={input.min}
                max={input.max}
                onChange={(e) => set(input.key, e.target.value === "" ? "" : Number(e.target.value))}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex justify-between px-3 py-2 border-t border-[var(--border)]">
        <button className="term-btn" onClick={() => setDraft(defaultParams(def))}>
          Defaults
        </button>
        <span className="flex gap-2">
          <button className="term-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="term-btn active"
            onClick={() => {
              // Clamp numbers to their declared bounds; empty fields fall back to defaults.
              const clean: Params = { ...draft };
              for (const input of def.inputs) {
                if (input.type !== "int" && input.type !== "float") continue;
                let v = Number(clean[input.key]);
                if (clean[input.key] === "" || !Number.isFinite(v)) v = input.default;
                if (input.min !== undefined) v = Math.max(input.min, v);
                if (input.max !== undefined) v = Math.min(input.max, v);
                clean[input.key] = input.type === "int" ? Math.round(v) : v;
              }
              onApply(clean);
              onClose();
            }}
          >
            Ok
          </button>
        </span>
      </div>
    </Modal>
  );
}
