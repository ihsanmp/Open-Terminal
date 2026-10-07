import { describe, expect, it } from "vitest";
import { PALETTE, contrastText, opacityOf, parseColor, toHex, withOpacity } from "./color";
import { timeframeKind } from "./ta/types";

describe("style editor colors", () => {
  it("reads hex, short hex, hex with alpha and rgba", () => {
    expect(parseColor("#2962FF")).toEqual({ r: 41, g: 98, b: 255, a: 1 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#2962FF80").a).toBeCloseTo(128 / 255, 5);
    expect(parseColor("rgba(8,153,129,0.5)")).toEqual({ r: 8, g: 153, b: 129, a: 0.5 });
  });

  it("round-trips a color through opacity changes", () => {
    const c = withOpacity("rgba(242,54,69,1)", 40);
    expect(c).toBe("#F2364566");
    expect(toHex(c)).toBe("#F23645");
    expect(opacityOf(c)).toBe(40);
    expect(withOpacity(c, 100)).toBe("#F23645");
  });

  it("has TradingView's 8 × 10 palette", () => {
    expect(PALETTE).toHaveLength(8);
    for (const row of PALETTE) expect(row).toHaveLength(10);
  });

  it("files intervals under the Visibility tab's kinds", () => {
    expect(timeframeKind(300)).toBe("minutes");
    expect(timeframeKind(14_400)).toBe("hours");
    expect(timeframeKind(86_400)).toBe("days");
    expect(timeframeKind(604_800)).toBe("weeks");
    expect(timeframeKind(2_592_000)).toBe("months");
  });
});

describe("text on a label", () => {
  it("is black on light colors and white on dark ones, as the chart's own labels are", () => {
    expect(contrastText("#FFFFFF")).toBe("#000000"); // white candles: the countdown was white on white
    expect(contrastText("rgba(255,255,255,1)")).toBe("#000000");
    expect(contrastText("#FFEB3B")).toBe("#000000");
    expect(contrastText("#ff9900")).toBe("#ffffff"); // the line chart's orange, as the library labels it
    expect(contrastText("#089981")).toBe("#ffffff");
    expect(contrastText("#F23645")).toBe("#ffffff");
    expect(contrastText("#000000")).toBe("#ffffff");
  });
});
