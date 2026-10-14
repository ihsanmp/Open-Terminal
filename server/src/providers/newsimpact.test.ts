import { describe, expect, it } from "vitest";
import { bucketOf, conditional, scaleOf, type ImpactEvent } from "./newsimpact.js";
import { INSTRUMENTS } from "./reactions.js";

const gold = INSTRUMENTS.find((i) => i.key === "xau")!;
const ev = (z: number, xau: number, weight = 0.5): ImpactEvent => ({
  key: "cpi_mom",
  label: "CPI MoM",
  date: "2026-01-01T13:30:00.000Z",
  surprise: z / 10,
  z,
  first: { xau },
  second: {},
  day: {},
  confirm: 0,
  weight,
});

describe("news impact", () => {
  it("scales surprises robustly: a few huge misses (2020's claims) don't swamp the usual size", () => {
    const usual = [5, -5, 10, -10, 5, -5, 10, -10, 5, -5];
    expect(scaleOf(usual)).toBeCloseTo(5 * 1.4826, 3);
    expect(scaleOf([...usual, 3000, -2500])).toBeLessThan(15);
  });

  it("buckets surprises by size and side", () => {
    expect([-1.5, -0.7, 0, 0.6, 2].map(bucketOf)).toEqual(["dingin kuat", "dingin", "sesuai", "panas", "panas kuat"]);
  });

  it("gives an asset's moves after past events alike, scaled to this release's size, pooling a thin bucket with its side", () => {
    const past = [
      ...Array.from({ length: 20 }, (_, i) => ev(1.5, -0.4 - i * 0.01)),
      ...Array.from({ length: 5 }, () => ev(0.7, -0.2)),
      ...Array.from({ length: 30 }, (_, i) => ev(0, (i % 3) * 0.1 - 0.1)),
    ];
    // Very hot: twenty alike, gold down; this release moves markets twice as much (weight 1 vs 0.5).
    const hot = conditional(past, gold, "first", 2, 1)!;
    expect(hot.n).toBe(20);
    expect(hot.p50).toBeLessThan(-0.8);
    // Hot (five alike): pooled with the very hot ones, the same side.
    expect(conditional(past, gold, "first", 0.7, 0.5)!.n).toBe(25);
    // Cool: nothing alike on that side.
    expect(conditional(past, gold, "first", -1, 0.5)).toBeNull();
  });
});
