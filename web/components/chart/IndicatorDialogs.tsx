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
  type LevelOverride,
  type Params,
  type PlotStyleOverride,
  type TimeframeKind,
} from "../../lib/ta";
import { ColorPicker } from "./ColorPicker";
import { DRAWING_KINDS, drawingKinds, styledLevels, usedColors } from "../../lib/ta/style";
import { PlotTypeMenu } from "./PlotTypeMenu";

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
        className="!border-0 !border-b !border-[var(--border)] px-3 py-2 text-fs-13"
      />
      <div className="flex min-h-0 flex-1">
        <div className="w-44 shrink-0 border-r border-[var(--border)] py-1 overflow-auto">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <div
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1 cursor-pointer text-fs-12 ${category === c ? "bg-[#1f1a10] text-[var(--amber)]" : "hover:bg-[#161616]"}`}
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
              <span className="dim text-fs-11">{d.overlay ? "overlay" : "pane"}</span>
              <span className="dim text-fs-11 w-32 text-right truncate">{d.category}</span>
            </div>
          ))}
          {results.length === 0 && <div className="px-3 py-3 dim">No indicators match “{query}”</div>}
        </div>
      </div>
      <div className="px-3 py-1.5 border-t border-[var(--border)] dim text-fs-11">
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
      <div className="flex gap-4 px-3 pt-2 border-b border-[var(--border)] text-fs-12">
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
          <label key={input.key} className="flex items-center justify-between gap-3 text-fs-12">
            <span className="dim">{input.label}</span>
            {input.type === "bool" ? (
              <input type="checkbox" checked={Boolean(draft[input.key])} onChange={(e) => set(input.key, e.target.checked)} />
            ) : input.type === "text" ? (
              <input type="text" className="w-40" value={String(draft[input.key])} onChange={(e) => set(input.key, e.target.value.toUpperCase())} />
            ) : input.type === "color" ? (
              <ColorPicker color={String(draft[input.key])} onColor={(c) => set(input.key, c)} />
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

/** A level's value: typed freely (an empty or partial number doesn't move the level), and back
 *  in step when it changes from outside (Defaults). */
function LevelValue({ label, value, onValue }: { label: string; value: number; onValue: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== "" ? t : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      step="any"
      className="w-24"
      aria-label={`${label} value`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onValue(v);
      }}
    />
  );
}

/** The name column of a Style row, as wide as TradingView's so the swatches line up. */
const LABEL = "w-32 shrink-0";

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-fs-12 min-h-[28px]">{children}</div>;
}

function StyleTab({ def, result, style, setStyle }: { def: IndicatorDef; result?: IndicatorResult; style: IndicatorStyle; setStyle: SetStyle }) {
  const plots = def.plots.filter((p) => !p.display);
  const setPlot = (key: string, patch: PlotStyleOverride) =>
    setStyle((s) => ({ ...s, plots: { ...s.plots, [key]: { ...s.plots?.[key], ...patch } } }));
  const title = (ref: string | number) => (typeof ref === "number" ? String(ref) : def.plots.find((p) => p.key === ref)?.title ?? ref);
  const fills = result?.fills ?? [];
  const levels = styledLevels(result, style);
  const setLevel = (i: number, patch: LevelOverride) =>
    setStyle((s) => ({ ...s, hlines: { ...s.hlines, [i]: { ...s.hlines?.[i], ...patch } } }));
  const kinds = drawingKinds(result);
  // Levels and fills have rows of their own above; this lists colors nothing else lets you change.
  const colors = usedColors(result)
    .map((c) => ({ ...c, uses: c.uses.filter((u) => u !== "Levels" && u !== "Fills") }))
    .filter((c) => c.uses.length > 0)
    .slice(0, 24);
  const setColor = (key: string, color: string | undefined) =>
    setStyle((s) => {
      const next = { ...s.colors };
      if (color === undefined) delete next[key];
      else next[key] = color;
      return { ...s, colors: next };
    });

  return (
    <div className="overflow-auto px-3 py-2 flex flex-col">
      {plots.length === 0 && fills.length === 0 && levels.length === 0 && kinds.length === 0 && colors.length === 0 && (
        <div className="dim py-2">This indicator draws nothing that can be restyled.</div>
      )}
      {plots.map((p) => {
        const o = style.plots?.[p.key] ?? {};
        const kind = o.style ?? p.style ?? "line";
        const lineLike = kind === "line" || kind === "step";
        const thin = kind === "histogram" || kind === "circles";
        return (
          <Row key={p.key}>
            <input type="checkbox" checked={o.visible ?? true} onChange={(e) => setPlot(p.key, { visible: e.target.checked })} />
            <span className={`${LABEL} dim truncate`}>{p.title}</span>
            <ColorPicker
              color={o.color ?? p.color}
              onColor={(color) => setPlot(p.key, { color })}
              width={thin ? undefined : o.width ?? p.width ?? 1}
              onWidth={thin ? undefined : (width) => setPlot(p.key, { width })}
              dash={lineLike ? o.dash ?? (p.dotted ? "dotted" : p.dashed ? "dashed" : "solid") : undefined}
              onDash={lineLike ? (dash) => setPlot(p.key, { dash }) : undefined}
            />
            <PlotTypeMenu type={kind} onType={(t) => setPlot(p.key, { style: t === (p.style ?? "line") ? undefined : t })} />
          </Row>
        );
      })}
      {levels.map((l, i) => (
        <Row key={`level${i}`}>
          <input type="checkbox" checked={l.visible} onChange={(e) => setLevel(i, { visible: e.target.checked })} />
          <span className={`${LABEL} dim truncate`}>{l.title}</span>
          <ColorPicker
            color={l.color}
            onColor={(color) => setLevel(i, { color })}
            width={l.width}
            onWidth={(width) => setLevel(i, { width })}
            dash={l.dash}
            onDash={(dash) => setLevel(i, { dash })}
          />
          <LevelValue label={l.title} value={l.price} onValue={(v) => setLevel(i, { price: v === result!.hlines![i].price ? undefined : v })} />
        </Row>
      ))}
      {fills.map((fl, i) => {
        const o = style.fills?.[i] ?? {};
        return (
          <Row key={`fill${i}`}>
            <input
              type="checkbox"
              checked={o.visible ?? true}
              onChange={(e) => setStyle((s) => ({ ...s, fills: { ...s.fills, [i]: { ...s.fills?.[i], visible: e.target.checked } } }))}
            />
            <span className={`${LABEL} dim truncate`}>
              Background{fills.length > 1 ? ` (${title(fl.a)} – ${title(fl.b)})` : ""}
            </span>
            <ColorPicker color={o.color ?? firstColor(fl.color)} onColor={(color) => setStyle((s) => ({ ...s, fills: { ...s.fills, [i]: { ...s.fills?.[i], color } } }))} />
          </Row>
        );
      })}
      {kinds.length > 0 && (
        <>
          <div className="dim text-fs-10 tracking-wider mt-3 mb-1">DRAWINGS</div>
          {DRAWING_KINDS.filter(([k]) => kinds.includes(k)).map(([k, label]) => (
            <Row key={k}>
              <input
                type="checkbox"
                checked={style.drawings?.[k] ?? true}
                onChange={(e) => setStyle((s) => ({ ...s, drawings: { ...s.drawings, [k]: e.target.checked } }))}
              />
              <span className="dim">{label}</span>
            </Row>
          ))}
        </>
      )}
      {colors.length > 0 && (
        <>
          <div className="dim text-fs-10 tracking-wider mt-3 mb-1">COLORS</div>
          {colors.map(({ key, uses }) => {
            const chosen = style.colors?.[key];
            return (
              <Row key={key}>
                <ColorPicker color={chosen ?? key} onColor={(color) => setColor(key, color)} />
                <span className="flex-1 dim truncate" title={uses.join(", ")}>
                  {uses.join(", ")}
                </span>
                {chosen && (
                  <button className="dim hover:text-[var(--text)]" title={`Back to ${key}`} onClick={() => setColor(key, undefined)}>
                    ↺
                  </button>
                )}
              </Row>
            );
          })}
        </>
      )}
      <div className="dim text-fs-10 tracking-wider mt-3 mb-1">OUTPUT VALUES</div>
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
      <div className="dim text-fs-10 tracking-wider mt-3 mb-1">INPUT VALUES</div>
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
      <div className="dim text-fs-11 mb-1">Show this indicator on these chart intervals:</div>
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
