// The Style tab's edits that apply to an indicator's whole output rather than to one plot:
// showing or hiding each kind of drawing, and replacing any color the indicator uses.
// Script-style indicators (order blocks, liquidity levels, labels, tables…) are drawn mostly
// with drawings, so this is what makes them restylable like a plotted EMA.

import { parseColor, toHex } from "../color";
import type { Color, DrawingKind, IndicatorResult, IndicatorStyle, LineDash } from "./types";

export type { DrawingKind };

export const DRAWING_KINDS: Array<[DrawingKind, string]> = [
  ["lines", "Lines"],
  ["labels", "Labels"],
  ["boxes", "Boxes"],
  ["markers", "Shapes"],
  ["barColors", "Bar colors"],
  ["background", "Background colors"],
  ["table", "Table"],
];

/** Which kinds of drawing this output contains. */
export function drawingKinds(r: IndicatorResult | undefined): DrawingKind[] {
  if (!r) return [];
  const has: Record<DrawingKind, boolean> = {
    lines: Boolean(r.lines?.length),
    labels: Boolean(r.labels?.length),
    boxes: Boolean(r.boxes?.length),
    markers: Boolean(r.markers?.length),
    barColors: Boolean(r.barColors?.some(Boolean)),
    background: Boolean(r.bgColors?.some(Boolean)),
    table: Boolean(r.table),
  };
  return DRAWING_KINDS.map(([k]) => k).filter((k) => has[k]);
}

/** The key a color is remapped by: its "#RRGGBB", or none for a missing or invisible color. */
export function colorKey(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const { a } = parseColor(c);
  return a > 0 ? toHex(c) : undefined;
}

export type UsedColor = { key: string; uses: string[]; count: number };

/** Every visible color the output uses, most used first, with where it appears. */
export function usedColors(r: IndicatorResult | undefined): UsedColor[] {
  if (!r) return [];
  const found = new Map<string, { uses: Set<string>; count: number }>();
  const add = (c: string | undefined, use: string) => {
    const key = colorKey(c);
    if (!key) return;
    const e = found.get(key) ?? { uses: new Set<string>(), count: 0 };
    e.uses.add(use);
    e.count += 1;
    found.set(key, e);
  };
  for (const cs of Object.values(r.colors ?? {})) for (const c of cs) add(c, "Plots");
  for (const f of r.fills ?? []) for (const c of typeof f.color === "string" ? [f.color] : f.color) add(c, "Fills");
  for (const h of r.hlines ?? []) add(h.color, "Levels");
  for (const l of r.lines ?? []) add(l.color, "Lines");
  for (const l of r.labels ?? []) (add(l.bg, "Labels"), add(l.textColor, "Labels"));
  for (const b of r.boxes ?? []) (add(b.bg, "Boxes"), add(b.border, "Boxes"), add(b.textColor, "Boxes"));
  for (const m of r.markers ?? []) add(m.color, "Shapes");
  for (const c of r.barColors ?? []) add(c, "Bar colors");
  for (const c of r.bgColors ?? []) add(c, "Background colors");
  for (const cell of r.table?.cells ?? []) (add(cell.color, "Table"), add(cell.bg, "Table"));
  return [...found.entries()].map(([key, e]) => ({ key, uses: [...e.uses], count: e.count })).sort((a, b) => b.count - a.count);
}

/** Replace a color by its remapping, keeping the original's transparency (scaled by the new one's). */
export function remap(c: string, colors: Record<string, string>): string;
export function remap(c: string | undefined, colors: Record<string, string>): string | undefined;
export function remap(c: string | undefined, colors: Record<string, string>): string | undefined {
  const key = colorKey(c);
  const to = key && colors[key];
  if (!to) return c;
  const from = parseColor(c!);
  const next = parseColor(to);
  return `rgba(${next.r},${next.g},${next.b},${+(from.a * next.a).toFixed(3)})`;
}

/** The output with the Style tab's drawing visibility and color replacements applied. */
export function styleResult(r: IndicatorResult, style: IndicatorStyle | undefined): IndicatorResult {
  const shown = style?.drawings ?? {};
  const colors = style?.colors ?? {};
  const recolor = Object.keys(colors).length > 0;
  if (!recolor && !Object.values(shown).includes(false)) return r;
  const c = (x: string | undefined) => (recolor ? remap(x, colors) : x);
  const cs = (xs: Color[] | undefined) => (xs && recolor ? xs.map((x) => remap(x, colors)) : xs);
  const off = (k: DrawingKind) => shown[k] === false;
  return {
    ...r,
    colors: r.colors && Object.fromEntries(Object.entries(r.colors).map(([k, v]) => [k, cs(v)!])),
    fills: r.fills?.map((f) => ({ ...f, color: typeof f.color === "string" ? c(f.color)! : cs(f.color)! })),
    hlines: r.hlines?.map((h) => ({ ...h, color: c(h.color)! })),
    lines: off("lines") ? [] : r.lines?.map((l) => ({ ...l, color: c(l.color)! })),
    labels: off("labels") ? [] : r.labels?.map((l) => ({ ...l, bg: c(l.bg), textColor: c(l.textColor) })),
    boxes: off("boxes") ? [] : r.boxes?.map((b) => ({ ...b, bg: c(b.bg)!, border: c(b.border), textColor: c(b.textColor) })),
    markers: off("markers") ? [] : r.markers?.map((m) => ({ ...m, color: c(m.color)! })),
    barColors: off("barColors") ? undefined : cs(r.barColors),
    bgColors: off("background") ? undefined : cs(r.bgColors),
    table: off("table") || !r.table ? undefined : { ...r.table, cells: r.table.cells.map((cell) => ({ ...cell, color: c(cell.color), bg: c(cell.bg) })) },
  };
}

/**
 * What each horizontal level is called on the Style tab: its own title, or as TradingView names
 * a band indicator's levels (Upper / Middle / Lower Band, by height), or "Level <price>".
 */
export function levelTitles(hlines: NonNullable<IndicatorResult["hlines"]>): string[] {
  const byHeight = [...hlines.map((h) => h.price)].sort((a, b) => b - a);
  const rank = (price: number) => byHeight.indexOf(price);
  return hlines.map((h) => {
    if (h.title) return h.title;
    if (hlines.length === 3) return ["Upper Band", "Middle Band", "Lower Band"][rank(h.price)] ?? `Level ${h.price}`;
    if (hlines.length === 2) return rank(h.price) === 0 ? "Upper Band" : "Lower Band";
    if (hlines.length === 1 && h.price === 0) return "Zero Line";
    return `Level ${h.price}`;
  });
}

export type StyledLevel = { title: string; price: number; color: string; width: 1 | 2 | 3 | 4; dash: LineDash; visible: boolean };

/** Each level as drawn: the indicator's, with the Style tab's row for it (or the older group setting). */
export function styledLevels(r: IndicatorResult | undefined, style: IndicatorStyle | undefined): StyledLevel[] {
  const hlines = r?.hlines ?? [];
  const titles = levelTitles(hlines);
  const group = style?.levels ?? {};
  return hlines.map((h, i) => {
    const o = style?.hlines?.[i] ?? {};
    return {
      title: titles[i],
      price: o.price ?? h.price,
      color: o.color ?? group.color ?? h.color,
      width: o.width ?? 1,
      dash: o.dash ?? group.dash ?? (h.dashed ? "dashed" : "solid"),
      visible: o.visible ?? group.visible ?? true,
    };
  });
}

/**
 * A fill's bound at a constant level, after the levels were moved on the Style tab: a fill between
 * the 80 and 20 bands follows them to 75 and 25, as TradingView's fill(hline, hline) does.
 */
export function movedBound(ref: string | number, r: IndicatorResult | undefined, style: IndicatorStyle | undefined): string | number {
  if (typeof ref !== "number") return ref;
  const i = (r?.hlines ?? []).findIndex((h) => h.price === ref);
  return i >= 0 ? style?.hlines?.[i]?.price ?? ref : ref;
}
