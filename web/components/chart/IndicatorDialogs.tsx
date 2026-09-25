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
  type IndicatorResult,
  type IndicatorStyle,
  type Params,
  type PlotStyleOverride,
  type TimeframeKind,
} from "../../lib/ta";
import { ColorPicker } from "./ColorPicker";

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
  result,
  onApply,
  onClose,
}: {
  def: IndicatorDef;
  instance: IndicatorInstance;
  /** Other indicators' plots on the chart, offered by source inputs marked `external`. */
  plotSources?: Array<{ value: string; label: string }>;
  /** The indicator's latest output, to list its fills and levels on the Style tab. */
  result?: IndicatorResult;
  onApply: (params: Params, style: IndicatorStyle) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"inputs" | "style" | "visibility">(def.inputs.length > 0 ? "inputs" : "style");
  const [draft, setDraft] = useState<Params>({ ...defaultParams(def), ...instance.params });
  const [style, setStyle] = useState<IndicatorStyle>(instance.style ?? {});
  const set = (key: string, value: Params[string]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Modal title={def.short || def.name} onClose={onClose} width={420}>
      <div className="flex gap-4 px-3 pt-2 border-b border-[var(--border)] text-[12px]">
        {(["inputs", "style", "visibility"] as const).map((t) => (
          <button
            key={t}
            className={`pb-1.5 capitalize ${tab === t ? "text-[var(--text)] border-b-2 border-[var(--amber)]" : "dim hover:text-[var(--text)]"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "style" && <StyleTab def={def} result={result} style={style} setStyle={setStyle} />}
      {tab === "visibility" && <VisibilityTab style={style} setStyle={setStyle} />}
      <div className={`overflow-auto px-3 py-2 flex flex-col gap-1.5 ${tab === "inputs" ? "" : "hidden"}`}>
        {def.inputs.length === 0 && <div className="dim py-2">This indicator has no inputs.</div>}
        {def.inputs.map((input) => (
          <label key={input.key} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="dim">{input.label}</span>
            {input.type === "bool" ? (
              <input type="checkbox" checked={Boolean(draft[input.key])} onChange={(e) => set(input.key, e.target.checked)} />
            ) : input.type === "text" ? (
              <input type="text" className="w-40" value={String(draft[input.key])} onChange={(e) => set(input.key, e.target.value.toUpperCase())} />
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
        <button
          className="term-btn"
          title="Reset inputs and style"
          onClick={() => {
            setDraft(defaultParams(def));
            setStyle({});
          }}
        >
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
              onApply(clean, style);
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

// ---- Style tab ------------------------------------------------------------------------

type SetStyle = (update: (s: IndicatorStyle) => IndicatorStyle) => void;

const firstColor = (c: string | Array<string | undefined>) => (typeof c === "string" ? c : c.find(Boolean) ?? "#787B86");

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-[12px] min-h-[28px]">{children}</div>;
}

function StyleTab({ def, result, style, setStyle }: { def: IndicatorDef; result?: IndicatorResult; style: IndicatorStyle; setStyle: SetStyle }) {
  const plots = def.plots.filter((p) => !p.display);
  const setPlot = (key: string, patch: PlotStyleOverride) =>
    setStyle((s) => ({ ...s, plots: { ...s.plots, [key]: { ...s.plots?.[key], ...patch } } }));
  const title = (ref: string | number) => (typeof ref === "number" ? String(ref) : def.plots.find((p) => p.key === ref)?.title ?? ref);
  const fills = result?.fills ?? [];
  const hasLevels = (result?.hlines?.length ?? 0) > 0;

  return (
    <div className="overflow-auto px-3 py-2 flex flex-col">
      {plots.length === 0 && fills.length === 0 && !hasLevels && <div className="dim py-2">This indicator draws nothing that can be restyled.</div>}
      {plots.map((p) => {
        const o = style.plots?.[p.key] ?? {};
        const lineLike = !p.style || p.style === "line" || p.style === "step";
        return (
          <Row key={p.key}>
            <input type="checkbox" checked={o.visible ?? true} onChange={(e) => setPlot(p.key, { visible: e.target.checked })} />
            <span className="flex-1 dim truncate">{p.title}</span>
            <ColorPicker
              color={o.color ?? p.color}
              onColor={(color) => setPlot(p.key, { color })}
              width={p.style === "histogram" || p.style === "circles" ? undefined : o.width ?? p.width ?? 1}
              onWidth={p.style === "histogram" || p.style === "circles" ? undefined : (width) => setPlot(p.key, { width })}
              dash={lineLike ? o.dash ?? (p.dashed ? "dashed" : "solid") : undefined}
              onDash={lineLike ? (dash) => setPlot(p.key, { dash }) : undefined}
            />
          </Row>
        );
      })}
      {fills.map((fl, i) => {
        const o = style.fills?.[i] ?? {};
        return (
          <Row key={`fill${i}`}>
            <input
              type="checkbox"
              checked={o.visible ?? true}
              onChange={(e) => setStyle((s) => ({ ...s, fills: { ...s.fills, [i]: { ...s.fills?.[i], visible: e.target.checked } } }))}
            />
            <span className="flex-1 dim truncate">
              Background{fills.length > 1 ? ` (${title(fl.a)} – ${title(fl.b)})` : ""}
            </span>
            <ColorPicker color={o.color ?? firstColor(fl.color)} onColor={(color) => setStyle((s) => ({ ...s, fills: { ...s.fills, [i]: { ...s.fills?.[i], color } } }))} />
          </Row>
        );
      })}
      {hasLevels && (
        <Row>
          <input type="checkbox" checked={style.levels?.visible ?? true} onChange={(e) => setStyle((s) => ({ ...s, levels: { ...s.levels, visible: e.target.checked } }))} />
          <span className="flex-1 dim">Levels</span>
          <ColorPicker
            color={style.levels?.color ?? result!.hlines![0].color}
            onColor={(color) => setStyle((s) => ({ ...s, levels: { ...s.levels, color } }))}
            width={1}
            dash={style.levels?.dash ?? (result!.hlines![0].dashed ? "dashed" : "solid")}
            onDash={(dash) => setStyle((s) => ({ ...s, levels: { ...s.levels, dash } }))}
          />
        </Row>
      )}
      <div className="dim text-[10px] tracking-wider mt-3 mb-1">OUTPUT VALUES</div>
      <Row>
        <span className="flex-1 dim">Precision</span>
        <select
          className="w-32"
          value={style.precision === undefined ? "default" : String(style.precision)}
          onChange={(e) => setStyle((s) => ({ ...s, precision: e.target.value === "default" ? undefined : Number(e.target.value) }))}
        >
          <option value="default">Default</option>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Row>
      <Row>
        <input type="checkbox" checked={style.labelsOnPriceScale ?? true} onChange={(e) => setStyle((s) => ({ ...s, labelsOnPriceScale: e.target.checked }))} />
        <span className="dim">Labels on price scale</span>
      </Row>
      <Row>
        <input type="checkbox" checked={style.valuesInStatusLine ?? true} onChange={(e) => setStyle((s) => ({ ...s, valuesInStatusLine: e.target.checked }))} />
        <span className="dim">Values in status line</span>
      </Row>
      <div className="dim text-[10px] tracking-wider mt-3 mb-1">INPUT VALUES</div>
      <Row>
        <input type="checkbox" checked={style.inputsInStatusLine ?? true} onChange={(e) => setStyle((s) => ({ ...s, inputsInStatusLine: e.target.checked }))} />
        <span className="dim">Inputs in status line</span>
      </Row>
    </div>
  );
}

// ---- Visibility tab ----------------------------------------------------------------------

const TIMEFRAMES: Array<[TimeframeKind, string]> = [
  ["minutes", "Minutes"],
  ["hours", "Hours"],
  ["days", "Days"],
  ["weeks", "Weeks"],
  ["months", "Months"],
];

function VisibilityTab({ style, setStyle }: { style: IndicatorStyle; setStyle: SetStyle }) {
  return (
    <div className="overflow-auto px-3 py-2 flex flex-col">
      <div className="dim text-[11px] mb-1">Show this indicator on these chart intervals:</div>
      {TIMEFRAMES.map(([kind, label]) => (
        <Row key={kind}>
          <input
            type="checkbox"
            checked={style.visibility?.[kind] ?? true}
            onChange={(e) => setStyle((s) => ({ ...s, visibility: { ...s.visibility, [kind]: e.target.checked } }))}
          />
          <span className="dim">{label}</span>
        </Row>
      ))}
    </div>
  );
}
