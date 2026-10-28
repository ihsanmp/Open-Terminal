import { describe, expect, it } from "vitest";
import { analyzeSegment, RATE, yin } from "./prosody.js";
import { Speakers, smooth } from "./speakers.js";

/** A voiced tone: a fundamental and two harmonics, `secs` long. */
const tone = (hz: number, secs: number, amp = 0.3) =>
  Float32Array.from({ length: Math.round(RATE * secs) }, (_, i) => {
    const t = i / RATE;
    return amp * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t));
  });
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("prosody", () => {
  it("finds a voice's pitch", () => {
    for (const hz of [110, 180, 240]) expect(yin(tone(hz, 0.1), 0)).toBeCloseTo(hz, -0.5);
    expect(yin(new Float32Array(512), 0)).toBeNull();
  });

  it("tells speech from silence, counts the pauses, and gives each spoken second a voice print", () => {
    const quiet = () => Float32Array.from({ length: RATE * 0.5 }, () => (Math.random() - 0.5) * 0.002);
    const p = analyzeSegment(join(tone(120, 1.5), quiet(), tone(120, 1), quiet(), tone(120, 1.5)));
    expect(p.pauses).toBe(2);
    expect(p.voicedRatio).toBeGreaterThan(0.7);
    expect(p.seconds).toHaveLength(5);
    expect(p.seconds[0].f0).toBeCloseTo(120, -0.5);
    expect(p.seconds[0].print).toHaveLength(15);
  });
});

describe("speakers", () => {
  it("keeps two voices apart and names the one heard longest", () => {
    const sp = new Speakers();
    const low = analyzeSegment(tone(105, 1)).seconds[0].print!;
    const high = analyzeSegment(tone(230, 1, 0.2)).seconds[0].print!;
    const jitter = (p: number[]) => p.map((v) => v + (Math.random() - 0.5) * 0.02);
    const ids = [...Array(20)].map((_, i) => sp.assign(jitter(i % 3 === 2 ? high : low)));
    const lowIds = new Set(ids.filter((_, i) => i % 3 !== 2 && i >= 8));
    const highIds = new Set(ids.filter((_, i) => i % 3 === 2 && i >= 8));
    expect(lowIds.size).toBe(1);
    expect(highIds.size).toBe(1);
    expect([...lowIds][0]).not.toBe([...highIds][0]);
    expect(sp.main()).toBe([...lowIds][0]);
  });

  it("follows the voice heard lately, not a presenter's long opening", () => {
    const sp = new Speakers();
    const low = analyzeSegment(tone(105, 1)).seconds[0].print!;
    const high = analyzeSegment(tone(230, 1, 0.2)).seconds[0].print!;
    // Twenty minutes of the opening, then twelve of the chair: the chair's, though heard less.
    const opening = [...Array(1200)].map(() => sp.assign(high))[0];
    const chair = [...Array(720)].map(() => sp.assign(low))[0];
    expect(sp.voices.find((v) => v.id === opening)!.seconds).toBeGreaterThan(sp.voices.find((v) => v.id === chair)!.seconds);
    expect(sp.main()).toBe(chair);
  });

  it("puts a one-off second back with the run around it", () => {
    expect(smooth([0, 0, 1, 0, 0, null, 2, 2])).toEqual([0, 0, 0, 0, 0, null, 2, 2]);
  });
});
