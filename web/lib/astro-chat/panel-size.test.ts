import { describe, expect, it } from "vitest";
import { MIN_PANEL, fitSize, resized } from "./panel-size";

const view = { w: 1400, h: 850 };
const start = { x: 600, y: 200, w: 360, h: 560 };

describe("the chat panel's size", () => {
  it("keeps a chosen size within what the chat needs and the window holds", () => {
    expect(fitSize({ w: 500, h: 600 }, view)).toEqual({ w: 500, h: 600 });
    expect(fitSize({ w: 100, h: 100 }, view)).toEqual(MIN_PANEL);
    expect(fitSize({ w: 5000, h: 5000 }, view)).toEqual({ w: 1384, h: 834 });
    // A window with no size (minimized): the least, not nothing.
    expect(fitSize({ w: 500, h: 600 }, { w: 0, h: 0 })).toEqual(MIN_PANEL);
  });

  it("grows from the edge dragged, the opposite edges staying put", () => {
    expect(resized(start, { r: true, b: true }, 100, 50, view)).toEqual({ x: 600, y: 200, w: 460, h: 610 });
    // From the left and the top: the right and bottom edges stay where they were.
    const r = resized(start, { l: true, t: true }, -100, -50, view);
    expect(r).toEqual({ x: 500, y: 150, w: 460, h: 610 });
    expect(r.x + r.w).toBe(start.x + start.w);
  });

  it("stops at the least size and at the window's edge", () => {
    const small = resized(start, { l: true }, 1000, 0, view);
    expect(small.w).toBe(MIN_PANEL.w);
    expect(small.x + small.w).toBe(start.x + start.w);
    expect(resized(start, { r: true }, 2000, 0, view).w).toBe(view.w - 8 - start.x);
    expect(resized(start, { t: true }, 0, -2000, view).y).toBe(8);
  });
});
