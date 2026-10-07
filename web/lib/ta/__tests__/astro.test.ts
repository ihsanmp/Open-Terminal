import { describe, expect, it } from "vitest";
import { dailyMotion, longitude, separation } from "../astro";
import { astroCyclesCompute } from "../indicators/astro-cycles";
import { INDICATOR_BY_ID, candlesToBars, defaultParams } from "../index";

const at = (iso: string) => Date.parse(iso) / 1000;
// Angular distance, so 359.9° and 0.1° are 0.2° apart.
const off = (deg: number, target: number) => Math.abs(((deg - target + 540) % 360) - 180);

describe("planet positions", () => {
  it("match known events to a fraction of a degree", () => {
    expect(off(longitude("Sun", at("2024-03-20T03:06:00Z")), 0)).toBeLessThan(0.5); // March equinox
    expect(off(separation("Jupiter", "Saturn", at("2020-12-21T18:00:00Z")), 0)).toBeLessThan(0.5); // great conjunction
    expect(off(longitude("Jupiter", at("2020-12-21T18:00:00Z")), 300.3)).toBeLessThan(0.5);
    expect(off(separation("Mars", "Sun", at("2025-01-16T02:00:00Z")), 180)).toBeLessThan(0.5); // Mars opposition
    expect(off(separation("Venus", "Sun", at("2023-08-13T11:00:00Z")), 0)).toBeLessThan(0.5); // inferior conjunction
    expect(off(separation("Moon", "Sun", at("2024-01-25T17:54:00Z")), 180)).toBeLessThan(1); // full moon
  });

  it("times the slow planets to within hours, not a day", () => {
    // Saturn moves 0.1° a day, Saturn–Neptune close in 0.04° a day: 0.01° is a few hours.
    expect(off(longitude("Saturn", at("2025-05-25T03:35:00Z")), 0)).toBeLessThan(0.01); // enters Aries (was a day early)
    expect(off(separation("Saturn", "Neptune", at("2026-02-20T16:54:00Z")), 0)).toBeLessThan(0.01); // conjunction (was 23 h early)
    expect(off(longitude("Pluto", at("2024-11-19T20:29:00Z")), 300)).toBeLessThan(0.003); // enters Aquarius
    // Saturn stations retrograde 2025-07-13 04:07 UTC: its motion turns within those hours.
    expect(dailyMotion("Saturn", at("2025-07-13T00:00:00Z"))).toBeGreaterThan(0);
    expect(dailyMotion("Saturn", at("2025-07-13T08:00:00Z"))).toBeLessThan(0);
    // Heliocentric (the Astro Cycles' frame): Jupiter–Saturn's 2020 conjunction, 2 Nov 2020.
    expect(off(separation("Jupiter", "Saturn", at("2020-11-02T12:00:00Z"), "heliocentric"), 0)).toBeLessThan(0.05);
  });

  it("has no Sun seen from the Sun nor Earth seen from Earth", () => {
    expect(longitude("Sun", 0, "heliocentric")).toBeNaN();
    expect(longitude("Earth", 0, "geocentric")).toBeNaN();
  });
});

describe("Astro Cycles (BTC)", () => {
  const day = 86_400;
  const start = Date.UTC(2024, 0, 1) / 1000;
  const bars = candlesToBars(
    Array.from({ length: 700 }, (_, i) => {
      const c = 60_000 + 20_000 * Math.sin(i / 60);
      return { time: start + i * day, open: c, high: c + 500, low: c - 500, close: c, volume: 1 };
    })
  );
  const btc = { symbol: "BTC-USD", ticker: "BTCUSDT", type: "crypto" as const, timezone: "Etc/UTC", intervalSeconds: day };
  const params = defaultParams(INDICATOR_BY_ID.get("astro-cycles")!);

  it("draws each cycle inside the trailing price range and projects it ahead", () => {
    const r = astroCyclesCompute(bars, params, btc);
    const last = bars.length - 1;
    for (const k of [1, 2, 3]) {
      const v = r.plots[`c${k}`][last];
      expect(v).toBeGreaterThanOrEqual(Math.min(...bars.low.slice(-730)) - 1e-6);
      expect(v).toBeLessThanOrEqual(Math.max(...bars.high.slice(-730)) + 1e-6);
      expect(r.offsets![`c${k}p`]).toBe(540);
      // The projection starts at the last bar, on the same value as the history.
      const proj = r.plots[`c${k}p`];
      expect(proj.findIndex(Number.isFinite)).toBe(last - 540);
      expect(proj[last - 540]).toBeCloseTo(v, 6);
    }
    // The projection is shaded and its turns are marked past the last bar.
    expect(r.boxes![0].x2).toBe(last + 540);
    for (const l of r.labels!) expect(l.index).toBeGreaterThan(last);
    expect(r.table!.cells.map((c) => c.text).slice(3, 4)).toEqual(["Jupiter–Neptune ×4"]);
  });

  it("is for BTC charts only", () => {
    const r = astroCyclesCompute(bars, params, { ...btc, symbol: "ETH-USD", ticker: "ETHUSDT" });
    expect(r.plots).toEqual({});
    expect(r.table!.cells[0].text).toMatch(/BTC charts only/);
  });
});
