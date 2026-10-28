import { describe, expect, it } from "vitest";
import { bucketOf, scenarioSpan, type FomcMeeting } from "./fomcscenarios.js";

const meeting = (y2: number, gold: number, btc: number): FomcMeeting => ({ date: "2024-01-31T19:00:00.000Z", at: 0, first: { us2y: y2, xau: gold, btc }, day: { us2y: y2 * 2, xau: gold * 2, btc } });

describe("the Fed's decision as scenarios", () => {
  it("sorts a meeting by how the 2-year yield read it", () => {
    expect(bucketOf(-6, "first")).toBe("dovish kuat");
    expect(bucketOf(-2, "first")).toBe("dovish");
    expect(bucketOf(1, "first")).toBe("netral");
    expect(bucketOf(3, "first")).toBe("hawkish");
    expect(bucketOf(9, "day")).toBe("hawkish kuat");
    expect(bucketOf(5, "day")).toBe("hawkish");
  });

  it("gives each bucket's medians, and how often a market went the 2-year's usual way", () => {
    // Hawkish meetings: gold down three times out of four; dovish: gold up.
    const ms = [meeting(5, -0.4, -1), meeting(6, -0.3, -2), meeting(5, 0.1, -1), meeting(7, -0.2, 1), meeting(-5, 0.5, 2), meeting(-6, 0.4, 1), meeting(-5, 0.3, 1), meeting(0.5, 0, 0)];
    const s = scenarioSpan(ms, "first");
    const hk = s.buckets.find((b) => b.name === "hawkish kuat")!;
    expect(hk.n).toBe(4);
    expect(hk.cells.xau!.p50).toBeLessThan(0);
    const dk = s.buckets.find((b) => b.name === "dovish kuat")!;
    expect(dk.cells.xau!.p50).toBeGreaterThan(0);
    // Gold (hawk −1) agrees when it moves against the 2-year: 3 of 4 hawkish, 3 of 3 dovish.
    expect(s.follow.xau).toEqual({ n: 7, agree: 6 });
    // A bucket with fewer than three meetings shows no cell rather than one meeting's move.
    expect(s.buckets.find((b) => b.name === "netral")!.cells.xau).toBeUndefined();
  });
});
