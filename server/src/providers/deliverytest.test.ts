import { describe, expect, it } from "vitest";
import { deliveryTest, interaction, mergeSamples, reactionsOf, spearman, summarize, type DeliverySample } from "./deliverytest.js";

let seed = 3;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const samples = (confidence: number, minutes = 30): DeliverySample[] =>
  Array.from({ length: minutes }, (_, k) => ({ at: k * 60_000, confidence, stress: 1 - confidence, hesitation: 0.2, tension: k % 2 ? 0.3 : null }));

/** Broadcasts whose reaction (the 2Y yield, the dollar, gold and S&P) is `f` of the words and the delivery. */
function broadcasts(n: number, f: (words: number, conf: number) => number) {
  return Array.from({ length: n }, (_, k) => {
    const words = rand() * 2 - 1;
    const conf = 0.3 + rand() * 0.6;
    const r = f(words, conf);
    return {
      videoId: `v${k}`, title: `b${k}`, start: k, index: words, wordsIndex: words, delivery: samples(conf),
      moves: { us2y: 3 * r, dxy: 0.1 * r, xau: -0.3 * r, es: -0.2 * r },
    };
  });
}

describe("the voice-and-face test", () => {
  it("sums a broadcast's delivery and merges runs by the minute", () => {
    expect(summarize(samples(0.8, 12))).toMatchObject({ minutes: 12, faceMinutes: 6, confidence: 0.8, tension: 0.3 });
    const merged = mergeSamples(samples(0.5, 3), [{ at: 120_000, confidence: 0.9, stress: 0, hesitation: 0, tension: null }, { at: 300_000, confidence: 0.9, stress: 0, hesitation: 0, tension: null }]);
    expect(merged.map((s) => s.at)).toEqual([0, 60_000, 120_000, 300_000]);
    expect(merged[2].confidence).toBe(0.9);
  });

  it("reads one reaction a broadcast, hawk-signed and scaled per instrument", () => {
    const r = reactionsOf([{ moves: { us2y: 4, dxy: 0.2, xau: -0.4, es: -0.2 } }, { moves: { us2y: -4, dxy: -0.2, xau: 0.4, es: 0.2 } }, { moves: { us2y: 2 } }]);
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[1]).toBeCloseTo(-1, 5);
    expect(r[2]).toBeNull();
  });

  it("finds a planted follow-through (H1), and not where there is none", () => {
    seed = 3;
    const planted = deliveryTest(broadcasts(40, (w, c) => w * (c - 0.6) * 4 + (rand() - 0.5) * 0.3));
    const h1 = planted.hypotheses.find((h) => h.id === "H1")!;
    expect(planted.n).toBe(40);
    expect(h1.p!).toBeLessThan(0.01);
    expect(h1.shown).toBe(true);
    seed = 4;
    const none = deliveryTest(broadcasts(40, (w) => w * 0.5 + (rand() - 0.5)));
    expect(none.hypotheses.find((h) => h.id === "H1")!.shown).toBe(false);
  });

  it("calls nothing shown with too few broadcasts, whatever the numbers", () => {
    seed = 5;
    const few = deliveryTest(broadcasts(8, (w, c) => w * (c - 0.6) * 4));
    expect(few.n).toBe(8);
    expect(few.hypotheses.every((h) => !h.shown)).toBe(true);
    // Broadcasts with under ten minutes of delivery don't count.
    expect(deliveryTest([{ videoId: "x", title: "x", start: 0, index: 0.5, delivery: samples(0.5, 5), moves: { us2y: 1, dxy: 0.1 } }]).n).toBe(0);
  });

  it("has its statistics right", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    // y = 1 + 2a + 3b exactly.
    const a = [0, 1, 2, 3, 4, 5];
    const b = [1, 0, 3, 1, 2, 5];
    expect(interaction(a.map((x, k) => 1 + 2 * x + 3 * b[k]), a, b)).toBeCloseTo(3, 8);
  });
});
