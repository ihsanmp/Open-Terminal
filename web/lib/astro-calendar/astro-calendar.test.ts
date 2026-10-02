import { describe, expect, it } from "vitest";
import { buildEvents } from "./events";
import { ASSETS, extendSeries, impactOf, indexByKey, MIN_SAMPLES } from "./impact";

const day = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);
// The reference sheet's times are WIB (UTC+7).
const wib = (iso: string) => Date.parse(`${iso}:00+07:00`) / 1000;
const events = buildEvents(day("1990-01-01"), day("2027-12-31"));
const find = (title: string, near: number, days = 3) => events.find((e) => e.title === title && Math.abs(e.time - near) < days * 86_400);

describe("astrology calendar events", () => {
  it("matches the reference sheet's stations to within an hour", () => {
    for (const [title, at] of [
      ["Venus Retrograde", "2026-10-03T14:16"],
      ["Venus Direct", "2026-11-14T07:27"],
      ["Mercury Retrograde", "2026-10-24T12:00"],
      ["Saturn Retrograde", "2026-07-27T12:00"],
      ["Mars Retrograde", "2027-01-10T12:00"],
    ] as const) {
      const e = find(title, wib(at));
      expect(e, title).toBeDefined();
      expect(Math.abs(e!.time - wib(at)) / 3600, title).toBeLessThan(title.startsWith("Venus") ? 1 : 24);
    }
  });

  it("finds the 2026–27 eclipses, equinoxes and lunations", () => {
    for (const d of ["2026-02-17", "2026-03-03", "2026-08-12", "2026-08-28", "2027-02-06", "2027-02-20", "2027-07-18", "2027-08-02", "2027-08-17"])
      expect(events.some((e) => e.kind === "eclipse" && Math.abs(e.time - Date.parse(d) / 1000) < 1.5 * 86_400), d).toBe(true);
    expect(Math.abs(find("Ekuinoks Maret", wib("2026-03-20T21:45"))!.time - wib("2026-03-20T21:45")) / 60).toBeLessThan(20);
    expect(Math.abs(find("Solstis Desember", wib("2026-12-22T03:49"))!.time - wib("2026-12-22T03:49")) / 60).toBeLessThan(20);
    expect(Math.abs(find("New Moon in Libra", wib("2026-10-10T22:50"))!.time - wib("2026-10-10T22:50")) / 60).toBeLessThan(30);
    expect(Math.abs(find("Full Moon in Taurus", wib("2026-10-26T11:11"))!.time - wib("2026-10-26T11:11")) / 60).toBeLessThan(30);
  });
});

describe("market impact", () => {
  const byKey = indexByKey(events);
  const venusRx = find("Venus Retrograde", wib("2026-10-03T14:16"))!;

  it("measures each asset against its own past Venus retrogrades", () => {
    for (const a of ASSETS) {
      const im = impactOf(venusRx, byKey, a);
      expect(im.basis).toBe("rx:Venus");
      expect(im.n).toBeGreaterThanOrEqual(MIN_SAMPLES);
      expect(im.samples.every((s) => s.time < venusRx.time)).toBe(true);
      expect(["Bullish", "Bearish", "Netral"]).toContain(im.verdict);
      // The verdict follows the t statistic.
      if (im.verdict === "Bullish") expect(im.t).toBeGreaterThanOrEqual(1);
      if (im.verdict === "Bearish") expect(im.t).toBeLessThanOrEqual(-1);
    }
  });

  it("falls back to a broader kind when the exact one is rare", () => {
    const rare = events.find((e) => e.keys[0] === "aspect:Saturn-Neptune:Conjunction")!;
    const im = impactOf(rare, byKey, "BTC");
    expect(im.basisLevel).toBeGreaterThan(0);
  });

  it("takes newer closes from the API after the bundled ones", () => {
    const before = impactOf(venusRx, byKey, "GOLD");
    extendSeries("GOLD", [{ time: Date.parse("2000-01-01") / 1000, close: 1 }]); // older than the bundle: ignored
    expect(impactOf(venusRx, byKey, "GOLD").meanPct).toBe(before.meanPct);
  });
});
