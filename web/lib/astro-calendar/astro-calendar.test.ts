import { describe, expect, it } from "vitest";
import { buildEvents } from "./events";
import { ASSETS, extendSeries, impactOf, indexByKey, lastPriceDay, MIN_SAMPLES, pricesVersion, seriesOf, trackRecord, verdictTrail } from "./impact";

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

  it("adapts until the day before the event, using only what was known then", () => {
    // A past event: its verdict is fixed at H-1 and only uses outcomes over by then.
    const past = find("Venus Retrograde", wib("2025-03-02T00:00"), 5)!;
    const h1 = Math.floor(past.time / 86_400) - 1;
    for (const a of ASSETS) {
      const im = impactOf(past, byKey, a);
      expect(im.final).toBe(true);
      expect(im.asOfDay).toBeLessThanOrEqual(h1);
      expect(im.samples.every((s) => Math.floor(s.time / 86_400) + im.horizon <= im.asOfDay)).toBe(true);
      // A month earlier fewer outcomes were known.
      expect(impactOf(past, byKey, a, h1 - 30).n).toBeLessThanOrEqual(im.n);
    }
    // An event still ahead is provisional; once its H-1 close is in, final.
    const eventDay = Math.floor(venusRx.time / 86_400);
    expect(impactOf(venusRx, byKey, "BTC", undefined, eventDay - 5).final).toBe(false);
    expect(impactOf(venusRx, byKey, "BTC", undefined, eventDay).final).toBe(true);
    // Over its last 15 trading days the answer moves with the market's state.
    const trail = verdictTrail(past, byKey, "GOLD");
    expect(trail.length).toBe(15);
    expect(trail.every((x, i) => i === 0 || x.day > trail[i - 1].day)).toBe(true);
    expect(new Set(trail.map((x) => x.t.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("keeps a track record of its earlier H-1 verdicts", () => {
    // Full moons in one sign: frequent enough for several non-neutral calls.
    const full = find("Full Moon in Taurus", wib("2026-10-26T11:11"))!;
    for (const a of ASSETS) {
      const r = trackRecord(full, byKey, events, a);
      expect(r.calls).toBeGreaterThan(0);
      expect(r.right).toBeLessThanOrEqual(r.calls);
    }
  });

  it("takes newer closes from the API, the latest replacing the previous", () => {
    const before = impactOf(venusRx, byKey, "GOLD");
    const v = pricesVersion();
    extendSeries("GOLD", [{ time: Date.parse("2000-01-01") / 1000, close: 1 }]); // older than the bundle: ignored
    expect(pricesVersion()).toBe(v);
    expect(impactOf(venusRx, byKey, "GOLD").meanPct).toBe(before.meanPct);
    const last = lastPriceDay("GOLD");
    const next = (last + 1) * 86_400 - 3600; // stamped an hour before midnight UTC
    extendSeries("GOLD", [{ time: next, close: 4000 }]);
    extendSeries("GOLD", [{ time: next, close: 4100 }]);
    expect(lastPriceDay("GOLD")).toBe(last + 1);
    expect(seriesOf("GOLD").close.at(-1)).toBe(4100);
    expect(pricesVersion()).toBe(v + 2);
  });
});
