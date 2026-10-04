"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPicker } from "./ColorPicker";
import { gannLabel, optionsOf } from "../../lib/drawings/geometry";
import { TOOL_BY_ID, TOOL_FEATURES, defaultColor, type DrawLevel, type Drawing, type DrawingOptions, type DrawingTemplate, type TimeframeKind } from "../../lib/drawings/tools";

// A drawing's Settings, as TradingView's: its Style (line, levels with their values and colors,
// background, extending, labels, text), its Coordinates (each point's price and time) and its
// Visibility (the kinds of interval it shows on). Its look can be kept as the default for new
// drawings of the tool, or put back to the tool's own.

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
    <label className="flex items-center gap-2 cursor-pointer min-h-[30px]">
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
  const [tab, setTab] = useState<"style" | "coordinates" | "visibility">("style");
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
          <span className="font-bold text-fs-14 text-white">{def.label}</span>
          <button className="dim hover:text-[var(--text)]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex gap-4 px-4 border-b border-[var(--border)]">
          {(["style", "coordinates", "visibility"] as const).map((t) => (
            <button key={t} className={`py-2 capitalize ${tab === t ? "text-white border-b-2 border-white" : "dim hover:text-[var(--text)]"}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="overflow-auto px-4 py-3 flex flex-col gap-1">
          {tab === "style" && (
            <>
              {tool !== "measure" && (
                <Row>
                  <span className="w-28 dim">{features.levels ? "Trend line" : tool === "text" ? "Color" : "Line"}</span>
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
                    <span className="w-28 dim">Font size</span>
                    <select value={o.fontSize} onChange={(e) => setOpt({ fontSize: Number(e.target.value) })}>
                      {[10, 12, 14, 16, 20, 24, 28, 32, 40].map((s) => (
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
          <button
            className="term-btn"
            title="Back to the tool's default look (or the one saved as default)"
            onClick={() =>
              setD((v) => ({
                ...v,
                color: template?.color ?? defaultColor(tool),
                width: template?.width ?? (def.group === "fib" ? 1 : 2),
                dash: template?.dash,
                options: template?.options,
              }))
            }
          >
            Defaults
          </button>
          <button className="term-btn" title="New drawings of this tool start with this look" onClick={() => onSaveTemplate({ color: d.color, width: d.width, dash: d.dash, options: d.options })}>
            Save as default
          </button>
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
