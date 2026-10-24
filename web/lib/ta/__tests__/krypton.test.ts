import { describe, expect, it } from "vitest";
import type { Bars } from "../core";
import { kryptonFearGreed } from "../indicators/community2";
import { INDICATOR_BY_ID } from "../index";

const bars = (closes: number[]): Bars => ({
  time: closes.map((_, i) => i * 86_400),
  open: closes,
  high: closes.map((c) => c + 1),
  low: closes.map((c) => c - 1),
  close: closes,
  volume: closes.map(() => 0),
  length: closes.length,
});
const p = { lengthK: 10, lengthD: 3, overbought: 50, oversold: -50 };

describe("Krypton Fear & Greed (Stochastics Momentum Index)", () => {
  it("is in the catalogue under its short title", () => {
    expect(INDICATOR_BY_ID.get("krypton-fear-greed")?.short).toBe("Krypton Fear & Greed");
  });

  it("climbs toward +100 in a steady rise and fills above +50", () => {
    const up = kryptonFearGreed(bars(Array.from({ length: 80 }, (_, i) => 100 + i)), p);
    const last = up.plots.smi.at(-1)!;
    expect(last).toBeGreaterThan(50);
    expect(last).toBeLessThanOrEqual(100);
    expect(up.plots.upperClip.at(-1)).toBeCloseTo(last);
    expect(up.plots.lowerClip.at(-1)).toBe(-50);
    expect(up.fills).toHaveLength(2);
  });

  it("falls below -50 in a steady decline, and is 0 on a flat line", () => {
    const down = kryptonFearGreed(bars(Array.from({ length: 80 }, (_, i) => 200 - i)), p);
    expect(down.plots.smi.at(-1)!).toBeLessThan(-50);
    expect(down.plots.lowerClip.at(-1)).toBeCloseTo(down.plots.smi.at(-1)!);
    const flat = kryptonFearGreed(bars(Array.from({ length: 80 }, () => 100)), p);
    expect(flat.plots.smi.at(-1)).toBeCloseTo(0);
  });
});
