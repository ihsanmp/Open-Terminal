import { describe, expect, it } from "vitest";
import { isPinch, keyAction, panPrice, scalePrice, wheelPixels, zoomFactor, zoomSpan } from "./chart-nav";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("TradingView-style chart navigation", () => {
  it("zooms with the newest bar held in place, or around the cursor", () => {
    // Wheel down (zoom out) with the anchor at the right edge keeps `to`.
    const out = zoomSpan({ from: 900, to: 1000 }, 2, 1000);
    expect(out).toEqual({ from: 800, to: 1000 });
    // Focused zoom in at bar 950: that bar stays where it is on screen.
    const focused = zoomSpan({ from: 900, to: 1000 }, 0.5, 950);
    expect(focused).toEqual({ from: 925, to: 975 });
  });

  it("keeps a sensible number of bars in view", () => {
    expect(zoomSpan({ from: 0, to: 20 }, 0.1, 20, 10)).toEqual({ from: 10, to: 20 });
    expect(zoomSpan({ from: 0, to: 100 }, 100, 100, 10, 500)).toEqual({ from: -400, to: 100 });
  });

  it("reads wheel deltas in pixels and tells a pinch from a Ctrl + mouse notch", () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(100, 0)).toBe(100);
    expect(zoomFactor(100)).toBeCloseTo(Math.exp(0.15), 10);
    expect(zoomFactor(-100)).toBeLessThan(1);
    expect(isPinch(true, 4)).toBe(true);
    expect(isPinch(true, 100)).toBe(false);
    expect(isPinch(false, 4)).toBe(false);
  });

  it("moves the price range with a vertical drag", () => {
    // The content follows the pointer: dragging down a quarter of the pane shows prices a
    // quarter of the range higher.
    expect(panPrice({ from: 100, to: 200 }, 50, 200)).toEqual({ from: 125, to: 225 });
    expect(panPrice({ from: 100, to: 200 }, 50, 200, { inverted: true })).toEqual({ from: 75, to: 175 });
    const log = panPrice({ from: 10, to: 1000 }, 100, 200, { log: true });
    expect(log.from).toBeCloseTo(100, 8);
    expect(log.to).toBeCloseTo(10_000, 6);
  });

  it("stretches the price range around a price", () => {
    expect(scalePrice({ from: 100, to: 200 }, 2, 150)).toEqual({ from: 50, to: 250 });
    const log = scalePrice({ from: 10, to: 1000 }, 0.5, 100, true);
    expect(log.from).toBeCloseTo(100 / Math.sqrt(10), 8);
    expect(log.to).toBeCloseTo(100 * Math.sqrt(10), 8);
  });

  it("maps TradingView's chart hotkeys", () => {
    expect(keyAction(key("ArrowLeft"), 100)).toEqual({ kind: "scroll", bars: -1 });
    expect(keyAction(key("ArrowRight", { ctrlKey: true }), 100)).toEqual({ kind: "scroll", bars: 25 });
    expect(keyAction(key("ArrowUp", { ctrlKey: true }), 100)).toEqual({ kind: "zoom", factor: 0.8 });
    expect(keyAction(key("ArrowDown", { ctrlKey: true }), 100)).toEqual({ kind: "zoom", factor: 1.25 });
    expect(keyAction(key("ArrowLeft", { altKey: true, shiftKey: true }), 100)).toEqual({ kind: "first" });
    expect(keyAction(key("ArrowRight", { altKey: true, shiftKey: true }), 100)).toEqual({ kind: "last" });
    expect(keyAction(key("r", { altKey: true }), 100)).toEqual({ kind: "reset" });
    expect(keyAction(key("L", { altKey: true }), 100)).toEqual({ kind: "toggle", what: "log" });
    expect(keyAction(key("p", { altKey: true }), 100)).toEqual({ kind: "toggle", what: "percent" });
    expect(keyAction(key("i", { altKey: true }), 100)).toEqual({ kind: "toggle", what: "invert" });
    expect(keyAction(key("a"), 100)).toBeNull();
    expect(keyAction(key("ArrowUp"), 100)).toBeNull();
  });
});
