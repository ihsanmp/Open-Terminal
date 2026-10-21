import { describe, expect, it } from "vitest";
import { emptyPlan, liveState, nodesDone, positionSize, rewardRisk, riskPerUnit } from "./plan";

const long = { ...emptyPlan("a", "XAUUSD", 0), direction: "long" as const, entry: 100, stop: 95, targets: [110, 120, null] };
const short = { ...emptyPlan("b", "BTC", 0), direction: "short" as const, entry: 100, stop: 104, targets: [92, null, null] };

describe("trade plan arithmetic", () => {
  it("risk per unit only when the stop is on the losing side", () => {
    expect(riskPerUnit(long)).toBe(5);
    expect(riskPerUnit(short)).toBe(4);
    expect(riskPerUnit({ ...long, stop: 105 })).toBeNull();
  });

  it("reward to risk for each target, either direction", () => {
    expect(rewardRisk(long, 110)).toBe(2);
    expect(rewardRisk(long, 120)).toBe(4);
    expect(rewardRisk(short, 92)).toBe(2);
  });

  it("sizes the position so a stop loses the chosen share of the account", () => {
    const s = positionSize({ ...long, account: 10_000, riskPct: 1 })!;
    expect(s.riskAmount).toBe(100);
    expect(s.units).toBe(20);
    expect(s.notional).toBe(2000);
  });

  it("reads the live price against the plan", () => {
    expect(liveState(long, 97)!.where).toBe("sebelum-entry");
    expect(liveState(long, 100.2)!.where).toBe("di-zona-entry");
    expect(liveState(long, 105)!.where).toBe("berjalan");
    expect(liveState(long, 105)!.r).toBe(1);
    expect(liveState(long, 94)!.where).toBe("kena-stop");
    expect(liveState(long, 111)!.where).toBe("kena-target");
    expect(liveState(short, 91)!.where).toBe("kena-target");
    expect(liveState(short, 105)!.where).toBe("kena-stop");
  });

  it("counts the filled nodes", () => {
    expect(nodesDone({ ...long, thesis: "x" })).toEqual([true, false, false, true, false, false]);
  });
});
