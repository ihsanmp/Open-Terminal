import { describe, expect, it } from "vitest";
import { bucketLabel, fedwatchOdds, zqSymbol } from "./fedwatch.js";

describe("FOMC odds from fed funds futures (CME's method)", () => {
  it("names the contracts and the ranges as CME does", () => {
    expect(zqSymbol("2026-10")).toBe("CBOT:ZQV2026");
    expect(zqSymbol("2027-01")).toBe("CBOT:ZQF2027");
    expect(bucketLabel(3.75)).toBe("375-400");
  });

  it("reads a meeting followed by a month without one from that month's price", () => {
    // EFFR 3.88; November (no meeting) averages 3.93: +0.05 = a 20% chance of +25bp at October's.
    const [oct] = fedwatchOdds(["2026-10-28"], { "2026-10": 96.115, "2026-11": 96.07 }, 3.88, 3.75);
    expect(oct.probs["375-400"]).toBeCloseTo(0.8, 6);
    expect(oct.probs["400-425"]).toBeCloseTo(0.2, 6);
  });

  it("backs a meeting's end rate out of its own month when the next month has one too, and chains the meetings", () => {
    // December 9th: 9 days at the old rate (4.13), 22 at the new; the month averages 4.13 + 0.25 × 22/31.
    const decAvg = 4.13 + 0.25 * (22 / 31);
    const prices = { "2026-11": 100 - 4.13, "2026-12": 100 - decAvg, "2027-01": 100 - 4.38, "2027-02": 100 - 4.38 };
    const odds = fedwatchOdds(["2026-12-09", "2027-01-27"], prices, 4.13, 4.0);
    expect(odds[0].probs["425-450"]).toBeCloseTo(1, 6); // a sure hike
    expect(odds[1].probs["425-450"]).toBeCloseTo(1, 6); // and nothing more in January
  });
});
