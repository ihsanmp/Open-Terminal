import { describe, expect, it } from "vitest";
import { bucketProbs, levelOf, weighedMoves } from "./h30.js";
import type { ImpactEvent } from "./newsimpact.js";

const ev = (z: number, xau: number): ImpactEvent => ({
  key: "cpi_mom",
  label: "CPI MoM",
  date: "2026-01-01T13:30:00.000Z",
  surprise: z / 10,
  z,
  first: { xau },
  second: {},
  day: {},
  confirm: 0,
  weight: 0.5,
  scale: 0.1,
});

describe("the H-30 conclusion", () => {
  it("turns the engine's band into odds for each surprise bucket", () => {
    // A band centred on the consensus, ±1 z at P10/P90: 40% in line, the rest split evenly.
    const p = bucketProbs([-1, 0, 1]);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(p["dingin kuat"]).toBeCloseTo(0.1, 6);
    expect(p["panas kuat"]).toBeCloseTo(0.1, 6);
    expect(p.sesuai).toBeCloseTo(0.4, 6);
    // A band leaning hot puts most of the weight there.
    const hot = bucketProbs([0.8, 1.5, 2.2]);
    expect(hot["panas kuat"]).toBeCloseTo(0.786, 3);
  });

  it("weighs past moves by those odds: a likely hot print leans gold down", () => {
    const past = [...Array.from({ length: 20 }, () => ev(1.5, -0.5)), ...Array.from({ length: 20 }, () => ev(-1.5, 0.5)), ...Array.from({ length: 20 }, (_, i) => ev(0, i % 2 ? 0.1 : -0.1))];
    const hot = weighedMoves(past, "xau", bucketProbs([0.8, 1.5, 2.2]), 0.5)!;
    expect(hot.pUp).toBeLessThan(0.2);
    expect(hot.p50).toBeCloseTo(-0.5, 6);
    const even = weighedMoves(past, "xau", bucketProbs([-1, 0, 1]), 0.5)!;
    expect(even.pUp).toBeCloseTo(0.5, 1);
  });

  it("writes prices to the precision they're quoted in", () => {
    expect(levelOf(1.11148, 0.1, "%")).toBe(1.11259);
    expect(levelOf(4076.31, -0.5, "%")).toBe(4055.93);
    expect(levelOf(4.852, -3, "bp")).toBe(4.822);
  });
});
