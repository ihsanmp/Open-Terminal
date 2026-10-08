import { describe, expect, it } from "vitest";
import { handleFrom, handlesOf, moveHandle } from "./handles";
import { refIndex } from "./snap";

const A = { time: 100, price: 10 };
const B = { time: 200, price: 20 };
const p = { time: 150, price: 30 };

describe("a rectangle's handles, as TradingView's", () => {
  it("has its four corners as circles and the middle of each side as squares", () => {
    const h = handlesOf("rect", [{ x: 0, y: 100 }, { x: 200, y: 0 }]);
    expect(h.map(({ x, y }) => [x, y])).toEqual([[0, 100], [200, 0], [0, 0], [200, 100], [100, 100], [100, 0], [0, 50], [200, 50]]);
    expect(h.map((x) => !!x.square)).toEqual([false, false, false, false, true, true, true, true]);
  });

  it("moves a corner, or only its side", () => {
    expect(moveHandle("rect", 0, [A, B], p)).toEqual([p, B]);
    expect(moveHandle("rect", 2, [A, B], p)).toEqual([{ time: 150, price: 10 }, { time: 200, price: 30 }]); // A's time, B's price
    expect(moveHandle("rect", 3, [A, B], p)).toEqual([{ time: 100, price: 30 }, { time: 150, price: 20 }]);
    // Sides: a price side keeps every time, a time side every price.
    expect(moveHandle("rect", 4, [A, B], p)).toEqual([{ time: 100, price: 30 }, B]);
    expect(moveHandle("rect", 5, [A, B], p)).toEqual([A, { time: 200, price: 30 }]);
    expect(moveHandle("rect", 6, [A, B], p)).toEqual([{ time: 150, price: 10 }, B]);
    expect(moveHandle("rect", 7, [A, B], p)).toEqual([A, { time: 150, price: 20 }]);
  });

  it("holds a corner from the opposite one with Shift; a side moves alone", () => {
    const anchors = [{ x: 0, y: 100 }, { x: 200, y: 0 }];
    expect(handleFrom("rect", 0, anchors, refIndex)).toEqual({ x: 200, y: 0 });
    expect(handleFrom("rect", 2, anchors, refIndex)).toEqual({ x: 200, y: 100 });
    expect(handleFrom("rect", 5, anchors, refIndex)).toBeNull();
  });

  it("leaves the other tools a handle on each point", () => {
    expect(handlesOf("trend", [{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(moveHandle("trend", 1, [A, B], p)).toEqual([A, p]);
  });
});
