// Drawing with the pointer on a chart, as on TradingView: with a tool chosen, each click places a
// point (the drawing follows the pointer until its last one); with the cursor, a click selects a
// drawing, dragging a handle moves that point and dragging the drawing moves all of it. The chart
// doesn't pan while it does. A drawing being moved is only redrawn until the pointer is released,
// then saved once.

import type { IChartApi } from "lightweight-charts";
import { defaultColor, TOOL_BY_ID, timeOfLogical, type Drawing, type DrawPoint, type ToolId } from "./tools";
import type { DrawingLayer } from "./layer";

export type DrawState = {
  tool: ToolId | null;
  magnet: boolean;
  locked: boolean;
  drawings: Drawing[];
  selected: string | null;
};

export type DrawCallbacks = {
  state: () => DrawState;
  /** Points placed so far: kept outside the chart, so a data refresh mid-drawing loses nothing. */
  placing: { current: DrawPoint[] | null };
  onAdd: (d: Drawing) => void;
  onUpdate: (id: string, patch: Partial<Drawing>) => void;
  onSelect: (id: string | null) => void;
  /** The drawing is placed: back to the cursor. */
  onToolDone: () => void;
  /** A drawing double-clicked: its Settings. */
  onOpenSettings: (id: string) => void;
};

type Bar = { open: number; high: number; low: number; close: number };

export function attachDrawing(el: HTMLElement, chart: IChartApi, layer: DrawingLayer, times: number[], interval: number, bars: Bar[], cb: DrawCallbacks): () => void {
  const local = (e: MouseEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inMainPane = (x: number, y: number) => x >= 0 && y >= 0 && x <= chart.timeScale().width() && y <= (chart.panes()[0]?.getHeight() ?? 0);

  /** A pane point as a drawing point, snapped to the bar's open, high, low or close with the magnet on. */
  const pointAt = (x: number, y: number, magnet: boolean): DrawPoint | null => {
    const c = layer.toChart(x, y);
    if (!c) return null;
    let { logical, price } = c;
    if (magnet) {
      const i = Math.round(logical);
      const bar = bars[i];
      if (bar) {
        logical = i;
        price = [bar.open, bar.high, bar.low, bar.close].reduce((best, p) => (Math.abs(p - c.price) < Math.abs(best - c.price) ? p : best));
      }
    }
    return { time: timeOfLogical(times, interval, logical), price };
  };

  const previewStyle = (tool: ToolId) => ({ color: defaultColor(tool), width: 1 as const });

  const finish = (tool: ToolId, points: DrawPoint[]) => {
    const def = TOOL_BY_ID.get(tool)!;
    const d: Drawing = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, tool, points, color: defaultColor(tool), width: def.group === "fib" ? 1 : 2 };
    if (tool === "text") {
      const text = window.prompt("Text", "");
      if (!text) return;
      d.text = text;
    }
    if (tool === "gannSquareFixed") {
      // The price per bar that makes it square on screen as drawn; it keeps that from then on.
      const a = layer.toChart(100, 100);
      const b = layer.toChart(200, 200);
      if (a && b && b.logical !== a.logical) d.ratio = Math.abs(b.price - a.price) / Math.abs(b.logical - a.logical);
    }
    cb.onAdd(d);
    cb.onSelect(d.id);
  };

  let drag: { id: string; handle: number | null; x: number; y: number; points: DrawPoint[]; anchors: Array<{ x: number; y: number }> } | null = null;
  let moved: DrawPoint[] | null = null;

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (!inMainPane(x, y)) return;
    const s = cb.state();
    if (s.tool) {
      swallow(e);
      el.focus({ preventScroll: true });
      const p = pointAt(x, y, s.magnet);
      if (!p) return;
      const points = [...(cb.placing.current ?? []), p];
      const need = TOOL_BY_ID.get(s.tool)!.points;
      if (points.length >= need) {
        cb.placing.current = null;
        layer.set({ preview: null });
        finish(s.tool, points);
        cb.onToolDone();
      } else {
        cb.placing.current = points;
        layer.set({ preview: { tool: s.tool, points: [...points, p], style: previewStyle(s.tool) } });
      }
      return;
    }
    const hit = layer.pick(x, y);
    if (!hit) {
      if (s.selected) cb.onSelect(null);
      return;
    }
    cb.onSelect(hit.id);
    const d = s.drawings.find((v) => v.id === hit.id);
    if (!d || d.locked || s.locked) return;
    swallow(e);
    el.focus({ preventScroll: true });
    drag = { id: d.id, handle: hit.handle, x, y, points: d.points, anchors: layer.anchorsOfDrawing(d.id) ?? [] };
    moved = null;
  };

  const onMove = (e: PointerEvent) => {
    const s = cb.state();
    if (drag) {
      e.stopImmediatePropagation();
      const { x, y } = local(e);
      const dx = x - drag.x;
      const dy = y - drag.y;
      let points: DrawPoint[] | null;
      if (drag.handle !== null) {
        const p = pointAt(x, y, s.magnet);
        points = p ? drag.points.map((q, i) => (i === drag!.handle ? p : q)) : null;
      } else {
        const next = drag.anchors.map((a) => pointAt(a.x + dx, a.y + dy, false));
        points = next.every(Boolean) ? (next as DrawPoint[]) : null;
      }
      if (!points) return;
      moved = points;
      layer.set({ drawings: s.drawings.map((d) => (d.id === drag!.id ? { ...d, points } : d)) });
      return;
    }
    if (s.tool) {
      const { x, y } = local(e);
      if (!inMainPane(x, y)) return;
      const p = pointAt(x, y, s.magnet);
      if (!p) return;
      layer.set({ preview: { tool: s.tool, points: [...(cb.placing.current ?? []), p], style: previewStyle(s.tool) } });
    }
  };

  const onUp = () => {
    if (drag && moved) cb.onUpdate(drag.id, { points: moved });
    drag = null;
    moved = null;
  };

  const onDblClick = (e: MouseEvent) => {
    const { x, y } = local(e);
    const hit = layer.pick(x, y);
    const s = cb.state();
    if (!hit || s.tool) return;
    swallow(e);
    cb.onSelect(hit.id);
    cb.onOpenSettings(hit.id);
  };

  // Mouse events too: the chart library listens to them, and must not start a pan meanwhile.
  const onMouseDown = (e: MouseEvent) => {
    const s = cb.state();
    const { x, y } = local(e);
    if (e.button === 0 && inMainPane(x, y) && (s.tool || drag)) swallow(e);
  };

  el.addEventListener("pointerdown", onDown, { capture: true });
  el.addEventListener("mousedown", onMouseDown, { capture: true });
  el.addEventListener("dblclick", onDblClick, { capture: true });
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onUp);
  return () => {
    el.removeEventListener("pointerdown", onDown, { capture: true });
    el.removeEventListener("mousedown", onMouseDown, { capture: true });
    el.removeEventListener("dblclick", onDblClick, { capture: true });
    window.removeEventListener("pointermove", onMove, { capture: true });
    window.removeEventListener("pointerup", onUp);
  };
}
