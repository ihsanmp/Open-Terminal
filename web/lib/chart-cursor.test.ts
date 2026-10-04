import { describe, expect, it } from "vitest";
import { CURSORS, ERASER, TRAIL_MS, crosshairFor, cssCursor, liveTrail } from "./chart-cursor";

describe("chart cursors", () => {
  it("TradingView's cursors, then the Eraser", () => {
    expect(CURSORS.map((c) => c.label)).toEqual(["Cross", "Dot", "Arrow", "Demonstration", "Magic"]);
    expect(ERASER.label).toBe("Eraser");
  });

  it("only the Cross shows the crosshair's lines; every cursor keeps the axis labels", () => {
    expect(crosshairFor("cross").vertLine).toEqual({ visible: true, labelVisible: true });
    for (const m of ["dot", "arrow", "demo", "magic", "eraser"] as const) {
      expect(crosshairFor(m).vertLine.visible, m).toBe(false);
      expect(crosshairFor(m).horzLine.labelVisible, m).toBe(true);
    }
  });

  it("each has its pointer, a picture with a fallback for the drawn ones", () => {
    expect(cssCursor("cross")).toBe("crosshair");
    expect(cssCursor("arrow")).toBe("default");
    for (const m of ["dot", "demo", "magic", "eraser"] as const) expect(cssCursor(m)).toMatch(/^url\("data:image\/svg\+xml,.+"\) \d+ \d+, \w+$/);
  });

  it("the Magic trail fades away", () => {
    const pts = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 500 }];
    expect(liveTrail(pts, 400)).toHaveLength(2);
    expect(liveTrail(pts, TRAIL_MS + 100)).toEqual([pts[1]]);
    expect(liveTrail(pts, TRAIL_MS + 600)).toEqual([]);
  });
});
