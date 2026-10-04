"use client";

import { useEffect, useRef, type RefObject } from "react";
import { RIPPLE_MS, TRAIL_MS, liveTrail, type CursorMode, type TrailPoint } from "../../lib/chart-cursor";

// What the cursors draw over the chart: the Magic cursor's fading trail as it's dragged, the
// Demonstration cursor's ripple on each click, and a long press that asks for the bar's values
// (TradingView's "Values tooltip on long press"). It watches the pointer from the window, ahead
// of the chart, and draws on a canvas that lets every click through.

type Props = {
  /** The chart's element; only presses on its plot (not its axes) count. */
  hostRef: RefObject<HTMLDivElement | null>;
  mode: CursorMode;
  /** No drawing tool in hand. */
  active: boolean;
  longPress: boolean;
  /** The price axis's width and the time axis's height. */
  axes: { right: number; bottom: number };
  /** Held still for a moment: where (in the chart's pixels), until let go (null). */
  onLongPress: (at: { x: number; y: number } | null) => void;
};

const LONG_PRESS_MS = 500;

export function CursorEffects(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    const trails: TrailPoint[][] = [];
    const ripples: Array<{ x: number; y: number; t: number }> = [];
    let raf = 0;
    let trail: TrailPoint[] | null = null;
    let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let held = false;

    const paint = () => {
      raf = 0;
      const cv = canvasRef.current;
      const host = live.current.hostRef.current;
      if (!cv || !host) return;
      const dpr = window.devicePixelRatio || 1;
      const { width: w, height: h } = host.getBoundingClientRect();
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const now = performance.now();
      g.lineCap = "round";
      g.lineJoin = "round";
      for (let i = trails.length - 1; i >= 0; i--) {
        const pts = liveTrail(trails[i], now);
        if (pts.length === 0 && trails[i] !== trail) {
          trails.splice(i, 1);
          continue;
        }
        // Each step of the trail fades with its age; a glow under it.
        for (let k = 1; k < pts.length; k++) {
          const a = 1 - (now - pts[k].t) / TRAIL_MS;
          g.strokeStyle = `rgba(255,213,79,${a})`;
          g.shadowColor = `rgba(255,152,0,${a})`;
          g.shadowBlur = 8;
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(pts[k - 1].x, pts[k - 1].y);
          g.lineTo(pts[k].x, pts[k].y);
          g.stroke();
        }
      }
      g.shadowBlur = 0;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const k = (now - r.t) / RIPPLE_MS;
        if (k >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        g.beginPath();
        g.arc(r.x, r.y, 8 + 26 * k, 0, 2 * Math.PI);
        g.fillStyle = `rgba(255,82,82,${0.25 * (1 - k)})`;
        g.fill();
        g.strokeStyle = `rgba(255,82,82,${0.9 * (1 - k)})`;
        g.lineWidth = 2;
        g.stroke();
      }
      if (trails.length || ripples.length) raf = requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const local = (e: PointerEvent) => {
      const host = live.current.hostRef.current;
      if (!host) return null;
      const r = host.getBoundingClientRect();
      const { right, bottom } = live.current.axes;
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      return { x, y, inPlot: x >= 0 && y >= 0 && x <= r.width - right && y <= r.height - bottom };
    };
    const endPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
      if (held) {
        held = false;
        live.current.onLongPress(null);
      }
    };

    const down = (e: PointerEvent) => {
      const { mode, active, longPress, hostRef } = live.current;
      if (e.button !== 0 || !active || !hostRef.current?.contains(e.target as Node)) return;
      const at = local(e);
      if (!at?.inPlot) return;
      const t = performance.now();
      if (mode === "demo") {
        ripples.push({ x: at.x, y: at.y, t });
        kick();
      }
      if (mode === "magic") {
        trail = [{ x: at.x, y: at.y, t }];
        trails.push(trail);
        kick();
      }
      if (longPress) {
        endPress();
        press = {
          x: at.x,
          y: at.y,
          timer: setTimeout(() => {
            held = true;
            live.current.onLongPress({ x: at.x, y: at.y });
          }, LONG_PRESS_MS),
        };
      }
    };
    const move = (e: PointerEvent) => {
      if (!trail && !press) return;
      const at = local(e);
      if (!at) return;
      if (trail) {
        trail.push({ x: at.x, y: at.y, t: performance.now() });
        kick();
      }
      if (press && !held && Math.hypot(at.x - press.x, at.y - press.y) > 6) endPress();
      else if (held) live.current.onLongPress({ x: at.x, y: at.y });
    };
    const up = () => {
      trail = null;
      endPress();
      kick();
    };

    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (press) clearTimeout(press.timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 w-full h-full pointer-events-none z-[6]" />;
}
