import { describe, expect, it } from "vitest";
import { dayMove, moveIn } from "./reactions.js";
import type { TvBar } from "./tvchart.js";

const bar = (time: number, close: number): TvBar => ({ time, open: close, high: close, low: close, close, volume: null });

/** The plain scan moveIn replaced: the last bar ending by the start, the first ending at or after the end. */
function slowMoveIn(series: TvBar[], res: number, startMs: number, minutes: number): number | null {
  const R = res * 60_000;
  const end = startMs + minutes * 60_000;
  let pre: TvBar | undefined;
  let post: TvBar | undefined;
  for (const b of series) {
    const close = b.time * 1000 + R;
    if (close <= startMs) pre = b;
    else if (close >= end && !post) post = b;
  }
  if (!pre || !post) return null;
  if (startMs - (pre.time * 1000 + R) > R || post.time * 1000 + R - end > R) return null;
  return Math.round(((post.close - pre.close) / pre.close) * 10000) / 100;
}

describe("market moves around a release", () => {
  // 30-minute bars over two days with a gap (a market close) in the middle.
  const t0 = Date.UTC(2026, 9, 14, 0, 0) / 1000;
  const series = Array.from({ length: 96 }, (_, i) => i)
    .filter((i) => i < 40 || i > 50)
    .map((i) => bar(t0 + i * 1800, 100 + i));

  it("finds the bars around a window by binary search, as the plain scan did", () => {
    for (let m = 0; m < 48 * 60; m += 7) {
      const start = t0 * 1000 + m * 60_000;
      expect(moveIn(series, 30, start, 30, "%")).toBe(slowMoveIn(series, 30, start, 30));
      expect(moveIn(series, 30, start, 60, "%")).toBe(slowMoveIn(series, 30, start, 60));
    }
  });

  it("reads 30 minutes after a 12:30 release from the 12:00 bar's close to the 12:30 bar's", () => {
    const at = Date.UTC(2026, 9, 14, 12, 30);
    // The 12:00 bar is index 24 (close 124), the 12:30 bar index 25 (close 125).
    expect(moveIn(series, 30, at, 30, "%")).toBeCloseTo(((125 - 124) / 124) * 100, 2);
    // Inside the gap: no reading.
    expect(moveIn(series, 30, Date.UTC(2026, 9, 14, 21, 0), 30, "%")).toBeNull();
  });

  it("takes a release day's close against the day before's", () => {
    const daily = [bar(Date.UTC(2026, 9, 12) / 1000, 100), bar(Date.UTC(2026, 9, 13) / 1000, 102), bar(Date.UTC(2026, 9, 14) / 1000, 101)];
    expect(dayMove(daily, Date.UTC(2026, 9, 14, 12, 30), "%")).toBeCloseTo(((101 - 102) / 102) * 100, 2);
    expect(dayMove(daily, Date.UTC(2026, 9, 20, 12, 30), "%")).toBeNull();
  });
});
