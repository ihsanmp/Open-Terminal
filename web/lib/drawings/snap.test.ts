import { describe, expect, it } from "vitest";
import { constrainMove, constrainPoint, refIndex, shiftKindOf } from "./snap";

const o = { x: 100, y: 100 };

describe("Shift while drawing", () => {
  it("lines snap to horizontal, vertical or 45°, whichever is nearest", () => {
    expect(constrainPoint("angle", o, { x: 200, y: 130 })).toEqual({ x: 200, y: 100 }); // shallow: flat
    expect(constrainPoint("angle", o, { x: 20, y: 120 })).toEqual({ x: 20, y: 100 }); // leftwards too
    expect(constrainPoint("angle", o, { x: 110, y: 10 })).toEqual({ x: 100, y: 10 }); // steep: upright
    expect(constrainPoint("angle", o, { x: 180, y: 40 })).toEqual({ x: 170, y: 30 }); // 45° up-right
    expect(constrainPoint("angle", o, { x: 40, y: 150 })).toEqual({ x: 45, y: 155 }); // 45° down-left
  });

  it("boxes become squares towards the pointer", () => {
    expect(constrainPoint("square", o, { x: 160, y: 120 })).toEqual({ x: 160, y: 160 });
    expect(constrainPoint("square", o, { x: 90, y: 20 })).toEqual({ x: 20, y: 20 });
  });

  it("single points and the same spot are left alone", () => {
    expect(constrainPoint("none", o, { x: 150, y: 170 })).toEqual({ x: 150, y: 170 });
    expect(constrainPoint("angle", o, o)).toEqual(o);
  });

  it("each tool's kind, and the point a point is held from", () => {
    expect(shiftKindOf("trend")).toBe("angle");
    expect(shiftKindOf("fibRetracement")).toBe("angle");
    expect(shiftKindOf("channel")).toBe("angle");
    expect(shiftKindOf("rect")).toBe("square");
    expect(shiftKindOf("gannBox")).toBe("square");
    expect(shiftKindOf("hline")).toBe("none");
    expect(shiftKindOf("text")).toBe("none");
    expect([refIndex(0), refIndex(1), refIndex(2)]).toEqual([1, 0, 1]);
  });

  it("a drawing dragged whole keeps to the axis it's mostly moving on", () => {
    expect(constrainMove(30, 8)).toEqual([30, 0]);
    expect(constrainMove(-5, -40)).toEqual([0, -40]);
  });
});
