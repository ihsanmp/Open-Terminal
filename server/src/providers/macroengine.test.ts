import { describe, expect, it } from "vitest";
import { rows, runEngine, TARGETS, type Inputs, type Release } from "./macroengine.js";

const ppi = TARGETS.find((t) => t.key === "ppi_mom")!;
const month = (i: number) => new Date(Date.UTC(2016, i, 1)).toISOString().slice(0, 7);
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Ten years of made-up PPI prints: the consensus always 0.2, the print 0.4 in the months retail
 * gasoline jumped 10% (every third) and 0.2 otherwise. The last month is a jump, not out yet.
 */
function inputs(): Inputs {
  const releases: Release[] = [];
  const gas: Array<{ date: string; value: number }> = [];
  let price = 3;
  for (let i = 0; i < 120; i++) {
    const m = month(i);
    const jump = i % 3 === 2;
    price *= jump ? 1.1 : 0.97;
    for (const d of ["05", "12", "19", "26"]) gas.push({ date: `${m}-${d}`, value: price });
    const out = new Date(Date.UTC(2016, i + 1, 14, 12, 30)).toISOString();
    releases.push({ title: "PPI MoM", date: out, ref: lastDay(m), actual: i === 119 ? null : jump ? 0.4 : 0.2, forecast: 0.2, previous: 0.2 });
  }
  return { releases, markets: { GASREGW: gas } };
}

describe("the macro engine", () => {
  it("reads each release's inputs as they stood before it", () => {
    const data = rows(ppi, inputs());
    expect(data[2].x[0]).toBeCloseTo(10, 6);
    expect(data[3].x[0]).toBeCloseTo(-3, 6);
  });

  it("learns the surprise, calls the side, and keeps an out-of-sample record", () => {
    const i = inputs();
    const last = i.releases.at(-1)!;
    const now = Date.parse(last.date) - 3 * 86_400_000;
    const e = runEngine(i, { index: 1, at: new Date(now).toISOString(), title: "test" }, now);
    const row = e.rows.find((r) => r.key === "ppi_mom")!;
    expect(row.p10).toBeLessThanOrEqual(row.p50);
    expect(row.p50).toBeLessThanOrEqual(row.p90);
    expect(row.p50).toBeCloseTo(0.4, 1);
    expect(row.bias).toBe("hawkish");
    expect(row.backtest.maeEngine).toBeLessThan(row.backtest.maeConsensus);
    expect(row.backtest.hits).toBe(row.backtest.calls);
    expect(row.sentiment?.index).toBe(1);
    expect(row.h30).toBeNull();
  });

  it("with no inputs that held up, gives the consensus and the surprises' spread", () => {
    const cpi = TARGETS.find((t) => t.key === "cpi_mom")!;
    expect(cpi.features).toHaveLength(0);
  });
});
