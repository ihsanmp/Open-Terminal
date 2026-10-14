import { describe, expect, it } from "vitest";
import { rows, runEngine, TARGETS, type Inputs, type Release } from "./macroengine.js";

const cpi = TARGETS.find((t) => t.key === "cpi_mom")!;
const month = (i: number) => new Date(Date.UTC(2016, i, 1)).toISOString().slice(0, 7);
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Ten years of made-up CPI prints: the consensus always 0.2, the print 0.4 in the months gasoline
 * jumped (every third) and 0.2 otherwise; PPI out the day before CPI, 0.1 over its consensus.
 */
function inputs(): Inputs {
  const releases: Release[] = [];
  const gas: Array<{ date: string; value: number }> = [];
  let price = 3;
  for (let i = 0; i < 120; i++) {
    const m = month(i);
    const jump = i % 3 === 0;
    price *= jump ? 1.1 : 0.97;
    for (const d of ["05", "12", "19", "26"]) gas.push({ date: `${m}-${d}`, value: price });
    const out = new Date(Date.UTC(2016, i + 1, 14, 12, 30)).toISOString();
    const ppiOut = new Date(Date.UTC(2016, i + 1, 13, 12, 30)).toISOString();
    const last = i === 119;
    releases.push({ title: "PPI MoM", date: ppiOut, ref: lastDay(m), actual: 0.3, forecast: 0.2, previous: 0.2 });
    releases.push({ title: "Inflation Rate MoM", date: out, ref: lastDay(m), actual: last ? null : jump ? 0.4 : 0.2, forecast: 0.2, previous: 0.2 });
  }
  return { releases: releases.sort((a, b) => a.date.localeCompare(b.date)), markets: { GASREGW: gas }, cleveland: [] };
}

describe("the macro engine", () => {
  it("reads each release's inputs as they stood before it", () => {
    const data = rows(cpi, inputs());
    // [Cleveland gap, PPI surprise, gasoline Δ%]: PPI came out the day before, so it's in.
    expect(data[5].x[1]).toBeCloseTo(0.1, 6);
    expect(data[3].x[2]).toBeCloseTo(10, 6);
    expect(Number.isNaN(data[3].x[0])).toBe(true);
  });

  it("learns the surprise from the data and calls the side, with a band and a track record", () => {
    const i = inputs();
    const lastCpi = i.releases.filter((e) => e.title === "Inflation Rate MoM").at(-1)!;
    const now = Date.parse(lastCpi.date) - 3 * 86_400_000;
    const e = runEngine(i, { index: 1, at: new Date(now).toISOString(), title: "test" }, now);
    const row = e.rows.find((r) => r.key === "cpi_mom")!;
    expect(row.p10).toBeLessThanOrEqual(row.p50);
    expect(row.p50).toBeLessThanOrEqual(row.p90);
    // Month 119 isn't a gasoline jump: the engine expects the consensus.
    expect(row.p50).toBeCloseTo(0.2, 2);
    expect(row.bias).toBe("neutral");
    // Out of sample it learned the jump months: it misses by less than the consensus does.
    expect(row.backtest.maeEngine).toBeLessThan(row.backtest.maeConsensus);
    expect(row.backtest.hits).toBe(row.backtest.calls);
    expect(row.sentiment?.index).toBe(1);
    expect(row.h30).toBeNull();
  });
});
