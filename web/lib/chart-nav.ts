// Chart navigation the way TradingView does it, as pure range arithmetic the chart widget
// feeds with its own ranges:
//  - the mouse wheel zooms time with the newest bar held in place, Ctrl + wheel (and a trackpad
//    pinch, which browsers send as Ctrl + wheel) zooms at the cursor, Shift + wheel or a sideways
//    two-finger swipe scrolls;
//  - the wheel over the price axis, or dragging it, stretches the price range;
//  - dragging the chart up or down moves the price range (and turns auto-scale off).

export type Span = { from: number; to: number };

/** Pixels of a wheel event, whatever unit the browser reported it in. */
export function wheelPixels(delta: number, deltaMode: number, pageHeight = 800): number {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * pageHeight : delta;
}

/** How much one wheel event zooms: a mouse notch (~100 px) about 16 %, a pinch step gently. */
export function zoomFactor(deltaPx: number, pinch = false): number {
  const k = pinch ? 0.01 : 0.0015;
  return Math.exp(Math.max(-300, Math.min(300, deltaPx)) * k);
}

/** A trackpad pinch arrives as Ctrl + wheel in small steps; a Ctrl + mouse notch is ~100 px. */
export const isPinch = (ctrlKey: boolean, deltaPx: number) => ctrlKey && Math.abs(deltaPx) < 50;

/** Zoom a visible bar range by `factor` (>1 shows more bars) around `anchor`, keeping at least
 *  `minBars` and at most `maxBars` in view. */
export function zoomSpan(r: Span, factor: number, anchor: number, minBars = 10, maxBars = Infinity): Span {
  const width = r.to - r.from;
  const next = Math.max(minBars, Math.min(maxBars, width * factor));
  const f = next / width;
  return { from: anchor - (anchor - r.from) * f, to: anchor + (r.to - anchor) * f };
}

export const shiftSpan = (r: Span, by: number): Span => ({ from: r.from + by, to: r.to + by });

const toLog = (r: Span): Span => ({ from: Math.log(r.from), to: Math.log(r.to) });
const fromLog = (r: Span): Span => ({ from: Math.exp(r.from), to: Math.exp(r.to) });

/** The price range after dragging the chart `dyPx` pixels down (content follows the pointer). */
export function panPrice(r: Span, dyPx: number, heightPx: number, opts: { log?: boolean; inverted?: boolean } = {}): Span {
  const log = Boolean(opts.log && r.from > 0 && r.to > 0);
  const s = log ? toLog(r) : r;
  const perPx = (s.to - s.from) / Math.max(1, heightPx);
  const shifted = shiftSpan(s, dyPx * perPx * (opts.inverted ? -1 : 1));
  return log ? fromLog(shifted) : shifted;
}

/** The price range stretched by `factor` (>1 shows more prices) around `anchor`. */
export function scalePrice(r: Span, factor: number, anchor: number, log = false): Span {
  const useLog = log && r.from > 0 && r.to > 0 && anchor > 0;
  const s = useLog ? toLog(r) : r;
  const a = useLog ? Math.log(anchor) : anchor;
  const out = { from: a - (a - s.from) * factor, to: a + (s.to - a) * factor };
  return useLog ? fromLog(out) : out;
}

/** Keyboard navigation (TradingView's chart hotkeys). */
export type NavAction =
  | { kind: "scroll"; bars: number }
  | { kind: "zoom"; factor: number }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "reset" }
  | { kind: "toggle"; what: "log" | "percent" | "invert" };

export function keyAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, visibleBars: number): NavAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey && e.shiftKey && key === "ArrowLeft") return { kind: "first" };
  if (e.altKey && e.shiftKey && key === "ArrowRight") return { kind: "last" };
  if (e.altKey && !ctrl && !e.shiftKey) {
    if (key === "r") return { kind: "reset" };
    if (key === "l") return { kind: "toggle", what: "log" };
    if (key === "p") return { kind: "toggle", what: "percent" };
    if (key === "i") return { kind: "toggle", what: "invert" };
    return null;
  }
  if (e.altKey || e.shiftKey) return null;
  const far = Math.max(1, Math.round(visibleBars / 4));
  if (key === "ArrowLeft") return { kind: "scroll", bars: ctrl ? -far : -1 };
  if (key === "ArrowRight") return { kind: "scroll", bars: ctrl ? far : 1 };
  if (ctrl && key === "ArrowUp") return { kind: "zoom", factor: 1 / 1.25 };
  if (ctrl && key === "ArrowDown") return { kind: "zoom", factor: 1.25 };
  return null;
}
