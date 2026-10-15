import { describe, expect, it } from "vitest";
import { buildEvents } from "./events";
import { ASSETS, impactOf, indexByKey, outcomeOf, seriesOf, WALK_FORWARD } from "./impact";

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);
const events = buildEvents(day("1995-01-01"), day("2027-12-31"));
const byKey = indexByKey(events);

describe("the astro verdicts, tested walk-forward", () => {
  it("are right about as often as a coin, as the calendar says (bundled prices, 2018 on)", () => {
    for (const asset of ASSETS) {
      let calls = 0;
      let right = 0;
      for (const e of events) {
        if (e.time < Date.parse("2018-01-01") / 1000) continue;
        const imp = impactOf(e, byKey, asset);
        if (imp.verdict === "Netral") continue;
        const out = outcomeOf(e, imp);
        if (!out?.done || out.right === null) continue;
        calls++;
        if (out.right) right++;
      }
      expect({ calls, right }, asset).toEqual(WALK_FORWARD[asset]);
      expect(right / calls).toBeGreaterThan(0.45);
      expect(right / calls).toBeLessThan(0.58);
    }
  }, 30_000);

  it("reads an event's outcome from the close the day before it, over its horizon", () => {
    const s = seriesOf("GOLD");
    const e = events.find((x) => x.time > Date.parse("2024-03-01") / 1000 && x.kind === "station")!;
    const imp = impactOf(e, byKey, "GOLD");
    const out = outcomeOf(e, imp)!;
    expect(out.done).toBe(true);
    expect(out.days).toBe(e.horizon);
    const i = [...s.days].findLastIndex((d) => d <= Math.floor(e.time / DAY) - 1);
    expect(out.movePct).toBeCloseTo((s.close[i + e.horizon] / s.close[i] - 1) * 100, 6);
    // Not begun: nothing yet.
    const future = events.find((x) => x.time > Date.parse("2027-06-01") / 1000)!;
    expect(outcomeOf(future, impactOf(future, byKey, "GOLD"))).toBeNull();
  });
});
