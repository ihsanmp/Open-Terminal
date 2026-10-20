import { describe, expect, it } from "vitest";
import { apparentLongitude, retrogradePeriods } from "./retrograde";

const MIN = 60_000;
/** A US Eastern time, as the almanacs publish it ("2026-02-26 01:47", EST is UTC−5, EDT UTC−4). */
const et = (s: string, offsetHours: number) => Date.parse(`${s.replace(" ", "T")}:00Z`) + offsetHours * 3_600_000;

describe("retrograde periods", () => {
  it("finds 2026's three Mercury retrogrades to within minutes of the published times and degrees", () => {
    const p = retrogradePeriods("Mercury", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(p).toHaveLength(3);
    // Published: Rx Feb 26 01:47 EST at 22°34′ Pisces, D Mar 20 15:33 EDT at 8°29′ Pisces;
    // Rx Jun 29 13:36 EDT at 26°16′ Cancer, D Jul 23 18:56 EDT at 16°19′ Cancer;
    // Rx Oct 24 03:15 EDT at 20°59′ Scorpio, D Nov 13 10:52 EST at 5°02′ Scorpio.
    const published: Array<[number, number, number, number]> = [
      [et("2026-02-26 01:47", 5), 330 + 22 + 34 / 60, et("2026-03-20 15:33", 4), 330 + 8 + 29 / 60],
      [et("2026-06-29 13:36", 4), 90 + 26 + 16 / 60, et("2026-07-23 18:56", 4), 90 + 16 + 19 / 60],
      [et("2026-10-24 03:15", 4), 210 + 20 + 59 / 60, et("2026-11-13 10:52", 5), 210 + 5 + 2 / 60],
    ];
    p.forEach((x, k) => {
      const [rx, rxLon, d, dLon] = published[k];
      expect(Math.abs(x.start.time - rx)).toBeLessThan(5 * MIN);
      expect(Math.abs(x.end.time - d)).toBeLessThan(5 * MIN);
      expect(Math.abs(x.start.lon - rxLon)).toBeLessThan(0.05);
      expect(Math.abs(x.end.lon - dLon)).toBeLessThan(0.05);
    });
  });

  it("gives the shadow: the planet at its direct degree before, back at its retrograde degree after", () => {
    const [x] = retrogradePeriods("Mercury", Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1));
    expect(x.shadowStart).not.toBeNull();
    expect(x.shadowEnd).not.toBeNull();
    expect(x.shadowStart!).toBeLessThan(x.start.time);
    expect(x.shadowEnd!).toBeGreaterThan(x.end.time);
    expect(Math.abs(apparentLongitude("Mercury", x.shadowStart!) - x.end.lon)).toBeLessThan(0.01);
    expect(Math.abs(apparentLongitude("Mercury", x.shadowEnd!) - x.start.lon)).toBeLessThan(0.01);
  });

  it("includes a period already running at the start of the span, and none for a planet without one", () => {
    // Jupiter turned retrograde on 11 Nov 2025 and direct on 10 Mar 2026.
    const j = retrogradePeriods("Jupiter", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(new Date(j[0].start.time).toISOString().slice(0, 10)).toBe("2025-11-11");
    expect(new Date(j[0].end.time).toISOString().slice(0, 10)).toBe("2026-03-11");
    // Mars has no retrograde in 2026 (its next begins in January 2027).
    expect(retrogradePeriods("Mars", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1))).toEqual([]);
    expect(retrogradePeriods("Mars", Date.UTC(2027, 0, 1), Date.UTC(2028, 0, 1))).toHaveLength(1);
  });
});

describe("the Sun's signs", () => {
  it("gives 2026's ingresses to the minute (UTC), the equinoxes and solstices marked", async () => {
    const { sunIngresses } = await import("./retrograde");
    const list = sunIngresses(2026);
    // Published (UTC): Aquarius Jan 20 01:45 … Capricorn Dec 21 20:50.
    const published = [
      ["2026-01-20T01:45", 10], ["2026-02-18T15:52", 11], ["2026-03-20T14:46", 0], ["2026-04-20T01:39", 1],
      ["2026-05-21T00:37", 2], ["2026-06-21T08:25", 3], ["2026-07-22T19:13", 4], ["2026-08-23T02:19", 5],
      ["2026-09-23T00:05", 6], ["2026-10-23T09:38", 7], ["2026-11-22T07:24", 8], ["2026-12-21T20:50", 9],
    ] as const;
    expect(list).toHaveLength(12);
    list.forEach((x, k) => {
      expect(x.sign).toBe(published[k][1]);
      expect(Math.abs(x.time - Date.parse(`${published[k][0]}:00Z`))).toBeLessThan(MIN);
    });
    expect(list.filter((x) => x.season).map((x) => x.season)).toEqual(["spring", "summer", "autumn", "winter"]);
  });
});
