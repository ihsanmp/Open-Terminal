// Drawing with the pointer on a chart, as on TradingView: with a tool chosen, each click places a
// point (the drawing follows the pointer until its last one); with the cursor, a click selects a
// drawing, dragging a handle moves that point and dragging the drawing moves all of it. The chart
// doesn't pan while it does. A drawing being moved is only redrawn until the pointer is released,
// then saved once. With the Eraser cursor a click removes the drawing under it; with the Magic
// cursor a drag draws its trail (components/chart/CursorEffects) instead of panning.
//
// A point can be placed by a click or by pressing and dragging to it. Holding Shift snaps the
// point being placed or dragged straight from the point before it (a box to a square), and a
// drawing dragged whole to one axis (lib/drawings/snap); pressing or letting go of Shift
// updates it where the pointer is.
//
// Drawings go on the price pane or on an indicator's pane below it, each pane with a layer of its
// own on its own scale: the pane under the pointer is the one worked in, and stays so while a
// drawing is being placed or dragged.

import type { IChartApi } from "lightweight-charts";
import type { CursorMode } from "../chart-cursor";
import { defaultColor, TOOL_BY_ID, timeOfLogical, type Drawing, type DrawPoint, type ToolId } from "./tools";
import type { DrawingLayer } from "./layer";
import { handleFrom, moveHandle } from "./handles";
import { constrainMove, constrainPoint, refIndex, shiftKindOf } from "./snap";

export type DrawState = {
  tool: ToolId | null;
  magnet: boolean;
  locked: boolean;
  drawings: Drawing[];
  selected: string | null;
  /** The cursor in use while no tool is. */
  cursor?: CursorMode;
};

export type DrawCallbacks = {
  state: () => DrawState;
  /** Points placed so far, and on which pane: kept outside the chart, so a data refresh
   *  mid-drawing loses nothing. */
  placing: { current: DrawPoint[] | null; pane?: string | null };
  onAdd: (d: Drawing) => void;
  onUpdate: (id: string, patch: Partial<Drawing>) => void;
  onSelect: (id: string | null) => void;
  /** The drawing is placed: back to the cursor. */
  onToolDone: () => void;
  /** A drawing double-clicked: its Settings. */
  onOpenSettings: (id: string) => void;
  /** A drawing clicked with the Eraser. */
  onErase: (id: string) => void;
  /** The look a tool's new drawings take (the one last given it), while placed and once placed. */
  styleOf: (tool: ToolId) => Partial<Pick<Drawing, "color" | "width" | "dash" | "options">> | undefined;
};

type Bar = { open: number; high: number; low: number; close: number };

/** A pane's drawing layer: the price pane's (pane undefined) or an indicator's (its uid). */
export type PaneLayer = { pane: string | undefined; index: number; layer: DrawingLayer };

export function attachDrawing(el: HTMLElement, chart: IChartApi, layers: PaneLayer[], times: number[], interval: number, bars: Bar[], cb: DrawCallbacks): () => void {
  /** Each pane's top and height, in the chart's pixels. */
  const geometry = () => {
    const top = el.getBoundingClientRect().top;
    const panes = chart.panes();
    return layers.map((pl) => {
      const p = panes[pl.index];
      const r = p?.getHTMLElement()?.getBoundingClientRect();
      return { pl, top: r ? r.top - top : 0, height: p?.getHeight() ?? 0 };
    });
  };
  // The pane being worked in: the one a drawing is being placed on, or else the price pane.
  let active = layers.find((pl) => (pl.pane ?? null) === (cb.placing.pane ?? null)) ?? layers[0];
  let layer = active.layer;
  const setActive = (pl: PaneLayer) => {
    active = pl;
    layer = pl.layer;
  };
  /**
   * The pointer in the pane worked in: the one under it, unless a drawing is being placed or
   * dragged there (which keeps its pane).
   */
  const local = (e: MouseEvent) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const geo = geometry();
    if (!drag && !stroke && !(cb.placing.current?.length ?? 0)) {
      const under = geo.find((g) => y >= g.top && y < g.top + g.height);
      if (under) setActive(under.pl);
    }
    const mine = geo.find((g) => g.pl === active);
    return { x, y: y - (mine?.top ?? 0) };
  };
  // The live canvas: the drawing being dragged or placed, over the panes (layer.ts: Live).
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:3";
  el.appendChild(canvas);
  const drawLive = () => {
    const w = chart.timeScale().width();
    const geo = geometry();
    const h = Math.max(0, ...geo.map((g) => g.top + g.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Each pane's live drawing (one at most has any) in its own place, kept inside it.
    for (const g of geo) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, dpr * g.top);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, g.height);
      ctx.clip();
      g.pl.layer.paintLive(ctx, w, g.height);
      ctx.restore();
    }
  };
  for (const pl of layers) {
    pl.layer.liveSink = drawLive;
    pl.layer.isBusy = () => !!(drag || stroke || held || cb.placing.current || cb.state().tool);
  }
  // Scrolled or zoomed meanwhile: the live drawing moves with the chart.
  chart.timeScale().subscribeVisibleLogicalRangeChange(drawLive);

  // The pointer over the chart, as TradingView's: a hand over a drawing, a resize arrow over a
  // rectangle's corner or side, a move cross over a point, a closed hand while dragging one.
  const setCursor = (cursor: string | null) => {
    if (cursor) el.style.setProperty("--chart-cursor-hover", cursor);
    else el.style.removeProperty("--chart-cursor-hover");
  };
  const cursorOver = (hit: { id: string; handle: number | null } | null): string | null => {
    if (!hit) return null;
    if (hit.handle === null) return drag ? "grabbing" : "pointer";
    const d = cb.state().drawings.find((v) => v.id === hit.id);
    if (d?.tool === "rect") {
      const a = layer.anchorsOfDrawing(d.id);
      if (hit.handle >= 4) return hit.handle <= 5 ? "ns-resize" : "ew-resize";
      if (a && a.length === 2) {
        // A corner: the diagonal it stretches along, from the corner opposite.
        const [A, B] = a;
        const [cx, cy] = [[A.x, A.y], [B.x, B.y], [A.x, B.y], [B.x, A.y]][hit.handle];
        return (cx - (A.x + B.x) / 2) * (cy - (A.y + B.y) / 2) > 0 ? "nwse-resize" : "nesw-resize";
      }
    }
    return "move";
  };

  /** Inside the pane worked in (the pointer's pane coordinates). */
  const inPane = (x: number, y: number) => x >= 0 && y >= 0 && x <= chart.timeScale().width() && y <= (chart.panes()[active.index]?.getHeight() ?? 0);

  /** A pane point as a drawing point, snapped to the bar's open, high, low or close with the magnet on. */
  const pointAt = (x: number, y: number, magnet: boolean): DrawPoint | null => {
    const c = layer.toChart(x, y);
    if (!c) return null;
    let { logical, price } = c;
    if (magnet && active.pane === undefined) {
      const i = Math.round(logical);
      const bar = bars[i];
      if (bar) {
        logical = i;
        price = [bar.open, bar.high, bar.low, bar.close].reduce((best, p) => (Math.abs(p - c.price) < Math.abs(best - c.price) ? p : best));
      }
    }
    return { time: timeOfLogical(times, interval, logical), price };
  };

  /** A tool's look for a new drawing: its own default, then the one last given it. The drawing
   *  being placed shows it already, so it doesn't change look as its last point goes down. */
  const styleFor = (tool: ToolId) => ({ color: defaultColor(tool), width: (TOOL_BY_ID.get(tool)!.group === "fib" ? 1 : 2) as Drawing["width"], ...cb.styleOf(tool) });
  const previewStyle = styleFor;

  const finish = (tool: ToolId, placed: DrawPoint[]) => {
    const def = TOOL_BY_ID.get(tool)!;
    // A position's stop comes from its entry and target until it's moved.
    const points = def.derive ? def.derive(placed) : placed;
    const d: Drawing = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, tool, points, ...styleFor(tool) };
    if (active.pane !== undefined) d.pane = active.pane;
    // A text (a callout's, a signpost's …) is written in its Settings, which open as it's placed.
    if (def.startText) d.text = def.startText;
    if (tool === "gannSquareFixed") {
      // The price per bar that makes it square on screen as drawn; it keeps that from then on.
      const a = layer.toChart(100, 100);
      const b = layer.toChart(200, 200);
      if (a && b && b.logical !== a.logical) d.ratio = Math.abs(b.price - a.price) / Math.abs(b.logical - a.logical);
    }
    layer.add(d);
    cb.onAdd(d);
    cb.onSelect(d.id);
    if (def.startText) cb.onOpenSettings(d.id);
  };

  const done = (tool: ToolId, points: DrawPoint[]) => {
    cb.placing.current = null;
    cb.placing.pane = null;
    finish(tool, points);
    layer.setLive(null);
    cb.onToolDone();
  };

  /** A brush's stroke while it's being drawn (pixels too, to skip points too close together). */
  let stroke: { points: DrawPoint[]; last: { x: number; y: number } } | null = null;

  /** The press is the Eraser's or the Magic cursor's: the chart mustn't pan with it. */
  let held = false;
  let drag: { id: string; handle: number | null; x: number; y: number; points: DrawPoint[]; anchors: Array<{ x: number; y: number }> } | null = null;
  let moved: DrawPoint[] | null = null;

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Where the pointer is held from with Shift: the pixels of a drawing point. */
  const pixelOf = (p: DrawPoint | undefined) => (p ? layer.toPixel(p) : null);
  /** The pointer, held straight from `from` when Shift is down (no magnet then: it would bend it). */
  const snapped = (tool: ToolId, from: { x: number; y: number } | null, x: number, y: number, shift: boolean, magnet: boolean) => {
    if (!shift || !from) return pointAt(x, y, magnet);
    const c = constrainPoint(shiftKindOf(tool), from, { x, y });
    return pointAt(c.x, c.y, false);
  };

  /** The tool in hand's next point, at the pointer: the drawing is placed with its last. */
  const place = (x: number, y: number, shift: boolean) => {
    const s = cb.state();
    if (!s.tool) return;
    const def = TOOL_BY_ID.get(s.tool)!;
    const sofar = cb.placing.current ?? [];
    const prev = pixelOf(sofar[sofar.length - 1]);
    // A path or polyline goes on point by point, and ends when its last point (or, closing a
    // polyline, its first) is clicked again.
    if (def.variable === "clicks" && sofar.length >= def.points - 1) {
      const first = pixelOf(sofar[0]);
      const near = (q: { x: number; y: number } | null) => q !== null && Math.hypot(q.x - x, q.y - y) <= 6;
      if (near(prev) || (s.tool === "polyline" && sofar.length >= 3 && near(first))) {
        if (sofar.length >= def.points) done(s.tool, sofar);
        return;
      }
    }
    const p = snapped(s.tool, prev, x, y, shift, s.magnet);
    if (!p) return;
    const points = [...sofar, p];
    const need = def.variable ? Infinity : def.points;
    if (points.length >= need) {
      done(s.tool, points);
    } else {
      cb.placing.current = points;
      cb.placing.pane = active.pane ?? null;
      layer.setLive({ preview: { tool: s.tool, points: [...points, p], style: previewStyle(s.tool) } });
    }
  };

  /** Where a press that placed a point began: let go far enough away, it places the next. */
  let pressAt: { x: number; y: number } | null = null;
  /** The pointer's last place and Shift, to follow Shift pressed or let go without a move. */
  let last: { x: number; y: number } | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (!inPane(x, y)) return;
    const s = cb.state();
    if (s.tool) {
      swallow(e);
      el.focus({ preventScroll: true });
      if (TOOL_BY_ID.get(s.tool)!.variable === "freehand") {
        const p = pointAt(x, y, false);
        if (p) {
          stroke = { points: [p], last: { x, y } };
          layer.setLive({ preview: { tool: s.tool, points: [p], style: previewStyle(s.tool) } });
        }
        return;
      }
      place(x, y, e.shiftKey);
      pressAt = cb.state().tool && cb.placing.current ? { x, y } : null;
      return;
    }
    if (s.cursor === "magic") {
      held = true;
      swallow(e);
      el.focus({ preventScroll: true });
      return;
    }
    const hit = layer.pick(x, y);
    if (s.cursor === "eraser") {
      const d = hit && s.drawings.find((v) => v.id === hit.id);
      if (!d) return;
      held = true;
      swallow(e);
      if (!d.locked && !s.locked) cb.onErase(d.id);
      return;
    }
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
    setCursor(cursorOver(hit));
  };

  /** The pointer at (x, y): the drawing being dragged follows, or the one being placed. */
  const update = (x: number, y: number, shift: boolean) => {
    const s = cb.state();
    if (drag) {
      const d = s.drawings.find((v) => v.id === drag!.id);
      let points: DrawPoint[] | null;
      if (drag.handle !== null) {
        const h = drag.handle;
        // A point, a corner or (a rectangle's) side: Shift holds it from the handle opposite.
        const p = d ? snapped(d.tool, handleFrom(d.tool, h, drag.anchors, refIndex), x, y, shift, s.magnet) : pointAt(x, y, s.magnet);
        points = p ? (d ? moveHandle(d.tool, h, drag.points, p) : drag.points.map((q, i) => (i === h ? p : q))) : null;
      } else {
        const [dx, dy] = shift ? constrainMove(x - drag.x, y - drag.y) : [x - drag.x, y - drag.y];
        const next = drag.anchors.map((a) => pointAt(a.x + dx, a.y + dy, false));
        points = next.every(Boolean) ? (next as DrawPoint[]) : null;
      }
      if (!points || !d) return;
      moved = points;
      layer.setLive({ drawing: { ...d, points } });
      return;
    }
    if (s.tool) {
      if (!inPane(x, y)) return;
      const sofar = cb.placing.current ?? [];
      const p = snapped(s.tool, pixelOf(sofar[sofar.length - 1]), x, y, shift, s.magnet);
      if (!p) return;
      layer.setLive({ preview: { tool: s.tool, points: [...sofar, p], style: previewStyle(s.tool) } });
    }
  };

  const onMove = (e: PointerEvent) => {
    const { x, y } = local(e);
    last = { x, y };
    const tool = cb.state().tool;
    if (stroke && tool) {
      // The brush follows the pointer, a point every few pixels.
      if (Math.hypot(x - stroke.last.x, y - stroke.last.y) >= 3) {
        const p = pointAt(x, y, false);
        if (p) {
          stroke.points.push(p);
          stroke.last = { x, y };
          layer.setLive({ preview: { tool, points: stroke.points, style: previewStyle(tool) } });
        }
      }
      return;
    }
    if (drag) {
      e.stopImmediatePropagation();
      layer.crosshairAt(x, y);
    } else {
      const s = cb.state();
      setCursor(!s.tool && s.cursor !== "eraser" && s.cursor !== "magic" && inPane(x, y) && !(e.buttons & 1) ? cursorOver(layer.pick(x, y)) : null);
    }
    update(x, y, e.shiftKey);
  };

  const onUp = (e: PointerEvent) => {
    held = false;
    if (stroke) {
      const tool = cb.state().tool;
      const pts = stroke.points;
      stroke = null;
      if (tool && pts.length >= 2) done(tool, pts);
      else layer.setLive(null);
      return;
    }
    if (drag) {
      if (moved) {
        // The chart takes the drawing back where it was let go, in the same frame the live
        // canvas lets it go.
        const id = drag.id;
        const points = moved;
        layer.set({ drawings: cb.state().drawings.map((v) => (v.id === id ? { ...v, points } : v)) });
        cb.onUpdate(id, { points });
      }
      layer.setLive(null);
      setCursor(null);
    }
    drag = null;
    moved = null;
    // Pressed on a point and dragged to the next: placed where it's let go (TradingView's drag).
    if (pressAt && cb.state().tool) {
      const { x, y } = local(e);
      if (Math.hypot(x - pressAt.x, y - pressAt.y) > 6 && inPane(x, y)) place(x, y, e.shiftKey);
    }
    pressAt = null;
  };

  /** Shift pressed or let go with the pointer still: what it holds changes at once. */
  const onShift = (e: KeyboardEvent) => {
    if (e.key !== "Shift" || !last) return;
    if (drag || cb.state().tool) update(last.x, last.y, e.type === "keydown");
  };

  const onDblClick = (e: MouseEvent) => {
    const { x, y } = local(e);
    const hit = layer.pick(x, y);
    const s = cb.state();
    if (!hit || s.tool || s.cursor === "eraser" || s.cursor === "magic") return;
    swallow(e);
    cb.onSelect(hit.id);
    cb.onOpenSettings(hit.id);
  };

  /**
   * A right-click stops what's under way, as on TradingView: a path (or polyline) being placed
   * ends at its last point; any other drawing being placed, a brush stroke, or one too short yet
   * is dropped, the tool staying in hand; with nothing begun the tool is put down (as with Esc);
   * and a drawing being dragged goes back where it was. No menu opens over it.
   */
  const onContextMenu = (e: MouseEvent) => {
    const s = cb.state();
    if (drag) {
      swallow(e);
      drag = null;
      moved = null;
      layer.setLive(null);
      setCursor(null);
      return;
    }
    if (!s.tool) return;
    swallow(e);
    pressAt = null;
    const def = TOOL_BY_ID.get(s.tool)!;
    const sofar = cb.placing.current ?? [];
    if (stroke) {
      stroke = null;
      layer.setLive(null);
      return;
    }
    if (def.variable === "clicks" && sofar.length >= def.points) {
      done(s.tool, sofar);
      return;
    }
    cb.placing.current = null;
    cb.placing.pane = null;
    layer.setLive(null);
    if (sofar.length === 0) cb.onToolDone();
  };

  // Mouse events too: the chart library listens to them, and must not start a pan meanwhile.
  const onMouseDown = (e: MouseEvent) => {
    const s = cb.state();
    const { x, y } = local(e);
    if (e.button === 0 && inPane(x, y) && (s.tool || drag || held)) swallow(e);
  };

  el.addEventListener("pointerdown", onDown, { capture: true });
  el.addEventListener("mousedown", onMouseDown, { capture: true });
  el.addEventListener("dblclick", onDblClick, { capture: true });
  el.addEventListener("contextmenu", onContextMenu, { capture: true });
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onShift);
  window.addEventListener("keyup", onShift);
  return () => {
    el.removeEventListener("pointerdown", onDown, { capture: true });
    el.removeEventListener("mousedown", onMouseDown, { capture: true });
    el.removeEventListener("dblclick", onDblClick, { capture: true });
    el.removeEventListener("contextmenu", onContextMenu, { capture: true });
    window.removeEventListener("pointermove", onMove, { capture: true });
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onShift);
    window.removeEventListener("keyup", onShift);
    for (const pl of layers) {
      pl.layer.liveSink = null;
      pl.layer.isBusy = () => false;
    }
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawLive);
    canvas.remove();
    setCursor(null);
  };
}
