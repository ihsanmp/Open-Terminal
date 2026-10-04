"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPicker } from "./ColorPicker";
import { gannLabel, optionsOf, withAlpha } from "../../lib/drawings/geometry";
import { TOOL_BY_ID, TOOL_FEATURES, defaultColor, type DrawLevel, type Drawing, type DrawingOptions, type DrawingTemplate, type TimeframeKind } from "../../lib/drawings/tools";

// A drawing's Settings, as TradingView's: its Style (line, levels with their values and colors,
// background, extending, labels, text), its Coordinates (each point's price and time) and its
// Visibility (the kinds of interval it shows on). Its look can be kept as the default for new
// drawings of the tool, or put back to the tool's own.

/** The label column of a settings row. */
const LABEL = "w-[calc(8.5rem*var(--font-scale))] shrink-0 whitespace-nowrap";

const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];

const TIMEFRAMES: Array<[TimeframeKind, string]> = [
  ["minutes", "Minutes"],
  ["hours", "Hours"],
  ["days", "Days"],
  ["weeks", "Weeks"],
  ["months", "Months"],
];

/** Unix seconds ⇄ a datetime-local input's value, in this computer's time. */
const toLocalInput = (t: number) => {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t / 1000 : null;
};

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 min-h-[30px]">{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer min-h-[30px] whitespace-nowrap">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A number typed freely (a partial one doesn't apply), kept in step when it changes from outside. */
function NumberField({ value, onValue, step = "any", className = "w-[calc(5.5rem*var(--font-scale))]" }: { value: number; onValue: (v: number) => void; step?: string; className?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((t) => (Number(t) === value && t.trim() !== "" ? t : String(value))), [value]);
  return (
    <input
      type="number"
      step={step}
      className={className}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onValue(v);
      }}
    />
  );
}

/** TradingView's Template menu: keep this look for new drawings of the tool, or put one back. */
function TemplateMenu({ hasTemplate, onSave, onApply, onReset }: { hasTemplate: boolean; onSave: () => void; onApply: () => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [open]);
  const item = (label: string, title: string, run: () => void, disabled = false) => (
    <button
      role="menuitem"
      className="block w-full text-left px-3 py-1.5 hover:bg-[var(--border)] disabled:opacity-40 disabled:hover:bg-transparent"
      title={title}
      disabled={disabled}
      onClick={() => {
        run();
        setOpen(false);
      }}
    >
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button className={`term-btn ${open ? "active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Template ▾
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 mb-1 min-w-[calc(12rem*var(--font-scale))] bg-[var(--panel)] border border-[var(--amber-dim)] py-1 z-10">
          {item("Save as default", "New drawings of this tool start with this look", onSave)}
          {item("Apply default", "The look saved as this tool's default", onApply, !hasTemplate)}
          {item("Reset settings", "The tool's own look", onReset)}
        </div>
      )}
    </div>
  );
}

type Props = {
  drawing: Drawing;
  /** Saved default for the tool, if any. */
  template?: DrawingTemplate;
  onApply: (d: Drawing) => void;
  onSaveTemplate: (t: DrawingTemplate) => void;
  onClose: () => void;
};

export function DrawingSettings({ drawing, template, onApply, onSaveTemplate, onClose }: Props) {
  const tool = drawing.tool;
  const def = TOOL_BY_ID.get(tool)!;
  const features = TOOL_FEATURES[tool];
  const [d, setD] = useState<Drawing>(drawing);
  const [tab, setTab] = useState<"style" | "text" | "coordinates" | "visibility">("style");
  const [renaming, setRenaming] = useState(false);
  const tabs: Array<typeof tab> = features.box ? ["style", "text", "coordinates", "visibility"] : ["style", "coordinates", "visibility"];
  const o = optionsOf(tool, d.options);
  const setOpt = (patch: Partial<DrawingOptions>) => setD((v) => ({ ...v, options: { ...v.options, ...patch } }));
  const setLevels = (f: (ls: DrawLevel[]) => DrawLevel[]) => setOpt({ levels: f(o.levels) });

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const levelLabel = features.levels === "angle" ? "Angles" : features.levels === "time" ? "Time levels" : "Levels";

  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={`${def.label} settings`}
        className="bg-[var(--panel)] border border-[var(--amber-dim)] flex flex-col max-h-[84vh] w-[calc(32rem*var(--font-scale))] max-w-[95vw]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
          {renaming ? (
            <input
              autoFocus
              className="font-bold text-fs-14 flex-1 mr-3"
              value={d.name ?? def.label}
              onChange={(e) => setD((v) => ({ ...v, name: e.target.value }))}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(false);
                }
              }}
              aria-label="Name"
            />
          ) : (
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-fs-14 text-white truncate">{d.name?.trim() || def.label}</span>
              <button className="dim hover:text-[var(--text)]" title="Rename" aria-label="Rename" onClick={() => setRenaming(true)}>
                ✎
              </button>
            </span>
          )}
          <button className="dim hover:text-[var(--text)]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex gap-4 px-4 border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button key={t} className={`py-2 capitalize ${tab === t ? "text-white border-b-2 border-white" : "dim hover:text-[var(--text)]"}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="overflow-auto px-4 py-3 flex flex-col gap-1">
          {tab === "style" && features.box && (
            <>
              <Row>
                <span className={`${LABEL} dim`}>Extend</span>
                <select
                  value={o.extendLeft && o.extendRight ? "both" : o.extendLeft ? "left" : o.extendRight ? "right" : "none"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOpt({ extendLeft: v === "left" || v === "both", extendRight: v === "right" || v === "both" });
                  }}
                  aria-label="Extend"
                >
                  <option value="none">Don&apos;t extend</option>
                  <option value="left">Extend left</option>
                  <option value="right">Extend right</option>
                  <option value="both">Extend both</option>
                </select>
              </Row>
              <Row>
                <span className={`${LABEL} dim`}>Border</span>
                <ColorPicker
                  color={d.color}
                  onColor={(color) => setD((v) => ({ ...v, color }))}
                  width={d.width}
                  onWidth={(width) => setD((v) => ({ ...v, width }))}
                  dash={d.dash ?? "solid"}
                  onDash={(dash) => setD((v) => ({ ...v, dash }))}
                />
              </Row>
              <Row>
                <span className={LABEL}>
                  <Check label="Middle line" checked={o.middleLine} onChange={(v) => setOpt({ middleLine: v })} />
                </span>
                <ColorPicker
                  color={o.middleColor ?? d.color}
                  onColor={(middleColor) => setOpt({ middleColor })}
                  width={o.middleWidth}
                  onWidth={(middleWidth) => setOpt({ middleWidth })}
                  dash={o.middleDash}
                  onDash={(middleDash) => setOpt({ middleDash })}
                />
              </Row>
              <Row>
                <span className={LABEL}>
                  <Check label="Background" checked={o.fill} onChange={(v) => setOpt({ fill: v })} />
                </span>
                <ColorPicker color={o.fillColor ?? withAlpha(d.color, o.fillOpacity)} onColor={(fillColor) => setOpt({ fillColor })} />
              </Row>
            </>
          )}

          {tab === "text" && (
            <>
              <Row>
                <ColorPicker color={o.textColor ?? d.color} onColor={(textColor) => setOpt({ textColor })} />
                <select value={o.fontSize} onChange={(e) => setOpt({ fontSize: Number(e.target.value) })} aria-label="Font size">
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button className={`term-btn font-bold ${o.bold ? "active" : ""}`} onClick={() => setOpt({ bold: !o.bold })} aria-pressed={o.bold} title="Bold">
                  B
                </button>
                <button className={`term-btn italic ${o.italic ? "active" : ""}`} onClick={() => setOpt({ italic: !o.italic })} aria-pressed={o.italic} title="Italic">
                  I
                </button>
              </Row>
              <textarea className="w-full min-h-[80px] mt-1" value={d.text ?? ""} onChange={(e) => setD((v) => ({ ...v, text: e.target.value }))} placeholder="Add text" />
              <Row>
                <span className={`${LABEL} dim`}>Text alignment</span>
                <select value={o.textVAlign} onChange={(e) => setOpt({ textVAlign: e.target.value as typeof o.textVAlign })} aria-label="Vertical alignment">
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </select>
                <select value={o.textHAlign} onChange={(e) => setOpt({ textHAlign: e.target.value as typeof o.textHAlign })} aria-label="Horizontal alignment">
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </Row>
            </>
          )}

          {tab === "style" && !features.box && (
            <>
              {tool !== "measure" && (
                <Row>
                  <span className={`${LABEL} dim`}>{features.levels ? "Trend line" : tool === "text" ? "Color" : "Line"}</span>
                  <ColorPicker
                    color={d.color}
                    onColor={(color) => setD((v) => ({ ...v, color }))}
                    width={tool === "text" ? undefined : d.width}
                    onWidth={tool === "text" ? undefined : (width) => setD((v) => ({ ...v, width }))}
                    dash={features.dash ? d.dash ?? "solid" : undefined}
                    onDash={features.dash ? (dash) => setD((v) => ({ ...v, dash })) : undefined}
                  />
                </Row>
              )}

              {features.text && (
                <>
                  <textarea className="w-full min-h-[80px] mt-1" value={d.text ?? ""} onChange={(e) => setD((v) => ({ ...v, text: e.target.value }))} placeholder="Text" />
                  <Row>
                    <span className={`${LABEL} dim`}>Font size</span>
                    <select value={o.fontSize} onChange={(e) => setOpt({ fontSize: Number(e.target.value) })}>
                      {FONT_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Check label="Background" checked={o.textBackground} onChange={(v) => setOpt({ textBackground: v })} />
                </>
              )}

              {features.levels && (
                <>
                  <div className="dim text-fs-10 tracking-wider mt-2 mb-1">{levelLabel.toUpperCase()}</div>
                  <div className="grid grid-cols-2 gap-x-4">
                    {o.levels.map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5 min-h-[32px]">
                        <input type="checkbox" checked={l.visible} onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)))} />
                        <NumberField value={l.value} onValue={(value) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, value } : x)))} />
                        {features.levels === "angle" && <span className="dim text-fs-10 w-10">{gannLabel(l.value)}</span>}
                        <ColorPicker color={l.color} onColor={(color) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, color } : x)))} />
                        <button className="dim hover:text-[var(--down)] px-1" title="Remove level" aria-label="Remove level" onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="term-btn self-start mt-1"
                    onClick={() => setLevels((ls) => [...ls, { value: ls.length ? +(Math.max(...ls.map((x) => x.value)) + 0.5).toFixed(3) : 1, color: d.color, visible: true }])}
                  >
                    + Add level
                  </button>
                </>
              )}

              {(features.fill || features.extend || features.reverse || features.labels || features.middleLine || features.priceLabel) && (
                <div className="dim text-fs-10 tracking-wider mt-3 mb-1">OPTIONS</div>
              )}
              {features.fill && (
                <Row>
                  <Check label="Background" checked={o.fill} onChange={(v) => setOpt({ fill: v })} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(o.fillOpacity * 100)}
                    disabled={!o.fill}
                    onChange={(e) => setOpt({ fillOpacity: Number(e.target.value) / 100 })}
                    className="flex-1 ml-2"
                    aria-label="Background opacity"
                  />
                  <span className="dim w-10 text-right">{Math.round(o.fillOpacity * 100)}%</span>
                </Row>
              )}
              {features.extend && (
                <div className="flex gap-6">
                  <Check label="Extend left" checked={o.extendLeft} onChange={(v) => setOpt({ extendLeft: v })} />
                  <Check label="Extend right" checked={o.extendRight} onChange={(v) => setOpt({ extendRight: v })} />
                </div>
              )}
              {features.reverse && <Check label="Reverse" checked={o.reverse} onChange={(v) => setOpt({ reverse: v })} />}
              {features.middleLine && <Check label="Middle line" checked={o.middleLine} onChange={(v) => setOpt({ middleLine: v })} />}
              {features.priceLabel && <Check label="Price label" checked={o.priceLabel} onChange={(v) => setOpt({ priceLabel: v })} />}
              {features.labels && (
                <div className="flex gap-6">
                  <Check label={features.levels === "angle" ? "Labels" : "Levels"} checked={o.showLevels} onChange={(v) => setOpt({ showLevels: v })} />
                  {features.levels === "price" && <Check label="Prices" checked={o.showPrices} onChange={(v) => setOpt({ showPrices: v })} />}
                </div>
              )}
            </>
          )}

          {tab === "coordinates" &&
            d.points.map((p, i) => (
              <Row key={i}>
                <span className="w-16 dim">#{i + 1}</span>
                <span className="dim">Price</span>
                <NumberField value={p.price} className="w-32" onValue={(price) => setD((v) => ({ ...v, points: v.points.map((q, j) => (j === i ? { ...q, price } : q)) }))} />
                <span className="dim ml-2">Time</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(p.time)}
                  onChange={(e) => {
                    const time = fromLocalInput(e.target.value);
                    if (time !== null) setD((v) => ({ ...v, points: v.points.map((q, j) => (j === i ? { ...q, time } : q)) }));
                  }}
                />
              </Row>
            ))}

          {tab === "visibility" && (
            <>
              <div className="dim mb-1">Show this drawing on these intervals:</div>
              {TIMEFRAMES.map(([k, label]) => (
                <Check key={k} label={label} checked={d.visibility?.[k] ?? true} onChange={(v) => setD((x) => ({ ...x, visibility: { ...x.visibility, [k]: v } }))} />
              ))}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border)]">
          <TemplateMenu
            hasTemplate={!!template}
            onSave={() => onSaveTemplate({ color: d.color, width: d.width, dash: d.dash, options: d.options })}
            onApply={() => setD((v) => ({ ...v, color: template?.color ?? v.color, width: template?.width ?? v.width, dash: template?.dash, options: template?.options }))}
            onReset={() => setD((v) => ({ ...v, color: defaultColor(tool), width: def.group === "fib" ? 1 : 2, dash: undefined, options: undefined }))}
          />
          <span className="flex-1" />
          <button className="term-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="term-btn active"
            onClick={() => {
              onApply(d);
              onClose();
            }}
          >
            Ok
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
