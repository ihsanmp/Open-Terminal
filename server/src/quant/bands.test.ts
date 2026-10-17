import { describe, expect, it } from "vitest";
import { seasons } from "./astrofeatures.js";
import { bandFactor, dayWeight, eventDays, nextTradingDays, scaleBand, winterRatio } from "./bands.js";
import { CPI_REGIME_DAY, macroFeatures } from "./macrofeatures.js";

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const release = (title: string, date: string, actual: number | null = null, forecast: number | null = null) => ({ title, date, ref: date.slice(0, 10), actual, forecast, previous: null });

describe("the seasons", () => {
  it("follows the Sun's ingresses", () => {
    const s = seasons(day("2025-01-01"), day("2025-12-31"));
    expect(s.get(day("2025-03-10"))).toBe("winter");
    expect(s.get(day("2025-03-22"))).toBe("spring");
    expect(s.get(day("2025-07-01"))).toBe("summer");
    expect(s.get(day("2025-09-24"))).toBe("autumn");
    expect(s.get(day("2025-12-23"))).toBe("winter");
  });
});

describe("the calendar-aware bands", () => {
  const events = eventDays([release("Core Inflation Rate MoM", "2026-11-12T13:30:00.000Z"), release("Inflation Rate MoM", "2026-11-12T13:30:00.000Z"), release("Fed Interest Rate Decision", "2026-10-28T18:00:00.000Z")]);

  it("marks the release days, and the FOMC's day and the next", () => {
    expect(events.get(day("2026-11-12"))).toEqual(["cpi"]);
    expect(events.get(day("2026-10-28"))).toContain("fomc");
    expect(events.get(day("2026-10-29"))).toContain("fomc");
    expect(events.get(day("2026-10-30"))).toBeUndefined();
  });

  it("widens a span holding more big days than usual, and narrows one with none", () => {
    const w = dayWeight("dxy", events);
    expect(w(day("2026-10-28"))).toBeCloseTo(1.46 ** 2);
    expect(w(day("2026-10-27"))).toBe(1);
    const look = nextTradingDays(day("2026-06-01"), 60, false).concat([day("2026-10-28")]);
    expect(bandFactor(w, nextTradingDays(day("2026-10-26"), 5, false), look)).toBeGreaterThan(1.1);
    expect(bandFactor(w, nextTradingDays(day("2026-07-01"), 5, false), look)).toBeLessThan(1);
    // CPI calms oil: its day weighs less than an ordinary one.
    expect(dayWeight("oil", events)(day("2026-11-12"))).toBeLessThan(1);
    // A market the research didn't measure reads its nearest one's.
    expect(dayWeight("eurusd", events)(day("2026-10-28"))).toBeCloseTo(1.46 ** 2);
  });

  it("scales the spread around the median", () => {
    expect(scaleBand({ p10: -2, p50: 1, p90: 4 }, 1.5)).toEqual({ p10: -3.5, p50: 1, p90: 5.5 });
  });

  it("counts weekdays only, except for crypto", () => {
    const fri = day("2026-10-16");
    expect(nextTradingDays(fri, 2, false)).toEqual([fri + 3, fri + 4]);
    expect(nextTradingDays(fri, 2, true)).toEqual([fri + 1, fri + 2]);
  });

  it("measures the winter ratio from the past only, and none from too little", () => {
    const from = day("2018-01-01");
    const days = Array.from({ length: 2000 }, (_, i) => from + i);
    const sky = seasons(from, from + 2000);
    // Twice the move in winter.
    const close = [100];
    for (let i = 1; i < days.length; i++) close.push(close[i - 1] * Math.exp((i % 2 ? 1 : -1) * (sky.get(days[i]) === "winter" ? 0.02 : 0.01)));
    const r = winterRatio(days, close, days.length, sky);
    expect(r.winter / r.other).toBeCloseTo(2, 5);
    expect(winterRatio(days, close, 300, sky)).toEqual({ winter: 1, other: 1 });
  });
});

describe("the macro surprises by kind", () => {
  it("scales each release by its own past, reads inflation apart after 2021, and turns claims round", () => {
    const rs = [];
    for (let k = 0; k < 14; k++) {
      const d = new Date(Date.UTC(2020, k, 10)).toISOString();
      rs.push(release("Core Inflation Rate MoM", d, 0.3 + (k % 2 ? 0.1 : -0.1), 0.3));
      rs.push(release("Initial Jobless Claims", d, 210 + (k % 2 ? 10 : -10), 210));
    }
    // The 13th: hotter inflation, more claims (weaker).
    const last = "2021-03-10T13:30:00.000Z";
    rs.push(release("Core Inflation Rate MoM", last, 0.5, 0.3));
    rs.push(release("Initial Jobless Claims", last, 240, 210));
    const d = day("2021-03-10");
    const f = macroFeatures(rs, d, d).get(d)!;
    expect(d).toBeGreaterThan(CPI_REGIME_DAY);
    expect(f[0]).toBeGreaterThan(0); // inflation 7 days
    expect(f[2]).toBe(f[1]); // the regime's copy
    expect(f[3]).toBeLessThan(0); // jobs 7 days: more claims is weaker
  });
});
