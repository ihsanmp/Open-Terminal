import { describe, expect, it } from "vitest";
import { INDICATOR_BY_ID, candlesToBars, defaultParams, type IndicatorResult } from "../index";
import { drawingKinds, remap, styleResult, usedColors } from "../style";
import fixture from "./fixtures/tradingview-daily.json";

type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
const aapl = (fixture.symbols as Record<string, Row>).AAPL;
const bars = candlesToBars(aapl.time.map((time, i) => ({ time, open: aapl.open[i], high: aapl.high[i], low: aapl.low[i], close: aapl.close[i], volume: aapl.volume[i] })));

const result: IndicatorResult = {
  plots: {},
  lines: [{ x1: 0, y1: 1, x2: 5, y2: 1, color: "#089981" }],
  labels: [{ index: 2, price: 1, text: "MSB", style: "down", textColor: "#089981", size: "small" }],
  boxes: [{ x1: 0, x2: 3, top: 2, bottom: 1, bg: "rgba(242,54,69,0.2)", border: "#F23645" }],
  markers: [{ index: 1, position: "belowBar", shape: "arrowUp", color: "#089981" }],
  barColors: [undefined, "#F23645"],
  table: { position: "top_right", bg: "#161616", frame: "#2E2E2E", border: "#2E2E2E", cells: [{ col: 0, row: 0, text: "x", color: "#089981" }] },
};

describe("indicator drawing styles", () => {
  it("lists the kinds of drawing and the colors an output uses, most used first", () => {
    expect(drawingKinds(result)).toEqual(["lines", "labels", "boxes", "markers", "barColors", "table"]);
    const colors = usedColors(result);
    expect(colors.map((c) => c.key)).toEqual(["#089981", "#F23645"]);
    expect(colors[0].uses).toEqual(["Lines", "Labels", "Shapes", "Table"]);
  });

  it("replaces a color everywhere, keeping each use's own transparency", () => {
    const styled = styleResult(result, { colors: { "#F23645": "#2962FF" } });
    expect(styled.boxes![0].bg).toBe("rgba(41,98,255,0.2)");
    expect(styled.boxes![0].border).toBe("rgba(41,98,255,1)");
    expect(styled.barColors).toEqual([undefined, "rgba(41,98,255,1)"]);
    expect(styled.lines![0].color).toBe("#089981");
    // A half-transparent replacement halves each use's opacity.
    expect(remap("rgba(242,54,69,0.2)", { "#F23645": "#2962FF80" })).toBe("rgba(41,98,255,0.1)");
  });

  it("hides the kinds switched off", () => {
    const styled = styleResult(result, { drawings: { boxes: false, table: false, barColors: false } });
    expect(styled.boxes).toEqual([]);
    expect(styled.table).toBeUndefined();
    expect(styled.barColors).toBeUndefined();
    expect(styled.lines).toHaveLength(1);
  });

  it("leaves the output untouched without edits", () => {
    expect(styleResult(result, {})).toBe(result);
    expect(styleResult(result, undefined)).toBe(result);
  });

  it("gives every drawing-only indicator something to restyle", () => {
    const chart = { symbol: "AAPL", ticker: "AAPL", type: "stock" as const, timezone: "America/New_York", intervalSeconds: 86_400 };
    for (const def of INDICATOR_BY_ID.values()) {
      // Trading Sessions only draws on intraday charts.
      if (def.plots.some((p) => !p.display) || def.fetches || def.id === "sessions") continue;
      const r = def.compute(bars, defaultParams(def), { chart });
      const editable = drawingKinds(r).length > 0 || usedColors(r).length > 0 || (r.fills?.length ?? 0) > 0;
      expect(editable, def.id).toBe(true);
    }
  });
});
