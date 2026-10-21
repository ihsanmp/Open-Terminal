import { describe, expect, it } from "vitest";
import { buildCurve, contractMonths, productOf } from "./curves.js";
import { seriesOf, weekOf, COT_MARKETS } from "./cot.js";
import { byFiscalYear, fiscalYear, monthlyBudget } from "./fiscal.js";
import { readingAt, shiftMonth, statOf, riskOf, barsMonthly } from "./regime.js";
import { breadthOf, rotationOf, summariseFlows } from "./etfboard.js";
import { heatOf } from "./geopolitics.js";
import { isList } from "../routes/journal.js";

describe("forward curves", () => {
  it("lists a product's months from this month on, with its listed months only", () => {
    const gc = productOf("gc")!;
    const months = contractMonths(gc, new Date(Date.UTC(2026, 9, 21)));
    expect(months[0]).toEqual({ ticker: "COMEX:GCV2026", month: "2026-10", label: "Okt 26" });
    expect(months.map((m) => m.ticker.slice(-5, -4))).toEqual(["V", "Z", "G", "J", "M", "Q", "V", "Z", "G", "J", "M"]);
    expect(months[2].ticker).toBe("COMEX:GCG2027");
  });

  it("starts at the front contract, reads contango and the yearly carry", () => {
    const cl = { ...productOf("cl")!, count: 3, months: "XZFGH" };
    const months = contractMonths(cl, new Date(Date.UTC(2026, 10, 1))); // Nov 26 … (Nov expired)
    const quotes = new Map<string, { price: number | null; changePercent: number | null; volume: number | null }>([
      ["NYMEX:CL1!", { price: 100, changePercent: 1, volume: 1 }],
      ["NYMEX:CLX2026", { price: 98, changePercent: 0, volume: 0 }],
      ["NYMEX:CLZ2026", { price: 100, changePercent: 1, volume: 5 }],
      ["NYMEX:CLF2027", { price: 101, changePercent: 1, volume: 5 }],
      ["NYMEX:CLG2027", { price: 102, changePercent: 1, volume: 5 }],
    ]);
    const c = buildCurve(cl, months, quotes);
    expect(c.points.map((p) => p.ticker)).toEqual(["NYMEX:CLZ2026", "NYMEX:CLF2027", "NYMEX:CLG2027"]);
    expect(c.shape).toBe("contango");
    expect(c.spread).toBeCloseTo(2);
    expect(c.annualCarry).toBeCloseTo(12); // 2% over two months
  });

  it("turns money-market prices into the rate path and the moves it prices", () => {
    const sr3 = { ...productOf("sr3")!, count: 3 };
    const months = contractMonths(sr3, new Date(Date.UTC(2026, 9, 1)));
    const quotes = new Map(months.slice(0, 3).map((m, i) => [m.ticker, { price: 96 + i * 0.25, changePercent: null, volume: null }]));
    const c = buildCurve(sr3, months, quotes);
    expect(c.points.map((p) => p.value)).toEqual([4, 3.75, 3.5]);
    expect(c.shape).toBe("cuts");
    expect(c.moves25).toBe(-2);
  });
});

describe("positioning (COT)", () => {
  it("reads both reports' groups as net positions", () => {
    const tff = weekOf("tff", { report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", open_interest_all: "1000", lev_money_positions_long: "300", lev_money_positions_short: "100", asset_mgr_positions_long: "50", asset_mgr_positions_short: "70", dealer_positions_long_all: "10", dealer_positions_short_all: "20" });
    expect(tff).toEqual({ date: "2026-10-13", openInterest: 1000, spec: 200, other: -20, hedgers: -10 });
    const dis = weekOf("dis", { report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", open_interest_all: "500", m_money_positions_long_all: "90", m_money_positions_short_all: "40", swap_positions_long_all: "5", swap__positions_short_all: "15", prod_merc_positions_long: "1", prod_merc_positions_short: "9" });
    expect(dis).toEqual({ date: "2026-10-13", openInterest: 500, spec: 50, other: -10, hedgers: -8 });
  });

  it("puts the latest net between its 3-year low and high, and calls the extremes crowded", () => {
    const weeks = Array.from({ length: 30 }, (_, i) => ({ date: `2026-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`, openInterest: 1000, spec: i * 10, other: 0, hedgers: 0 }));
    const s = seriesOf(COT_MARKETS[0], weeks);
    expect(s.cotIndex).toBe(100);
    expect(s.crowding).toBe("crowded-long");
    expect(s.specChange).toBe(10);
    expect(s.specPctOi).toBe(29);
  });
});

describe("fiscal", () => {
  it("takes each statement's own month and sums fiscal years from October", () => {
    // Each report lists last fiscal year's months, then this one's, under "FY …" headings.
    const r = (date: string, line: number, desc: string, rc = "null", out = "null", def = "null") => ({ record_date: date, src_line_nbr: String(line), classification_desc: desc, current_month_gross_rcpt_amt: rc, current_month_gross_outly_amt: out, current_month_dfct_sur_amt: def });
    const rows = [
      r("2026-09-30", 1, "FY 2025"),
      r("2026-09-30", 13, "September", "9", "9", "0"),
      r("2026-09-30", 15, "FY 2026"),
      r("2026-09-30", 26, "August", "1", "1", "0"),
      r("2026-09-30", 27, "September", "100", "150", "50"),
      r("2026-10-31", 1, "FY 2026"),
      r("2026-10-31", 2, "October", "7", "7", "0"),
      r("2026-10-31", 14, "FY 2027"),
      r("2026-10-31", 15, "October", "80", "120", "40"),
    ];
    expect(monthlyBudget(rows)).toEqual([
      { month: "2026-09", receipts: 100, outlays: 150, deficit: 50 },
      { month: "2026-10", receipts: 80, outlays: 120, deficit: 40 },
    ]);
    expect(fiscalYear("2026-09")).toBe(2026);
    expect(fiscalYear("2026-10")).toBe(2027);
    expect(byFiscalYear([{ month: "2026-09", value: 5 }, { month: "2026-10", value: 3 }, { month: "2026-11", value: 2 }])).toEqual([
      { fy: 2026, value: 5, months: 1 },
      { fy: 2027, value: 5, months: 2 },
    ]);
  });
});

describe("macro regime", () => {
  const monthly = (from: string, n: number, f: (i: number) => number) => {
    const m = new Map<string, number>();
    for (let i = 0; i < n; i++) m.set(shiftMonth(from, i), f(i));
    return m;
  };

  it("reads growth up and inflation down as Goldilocks", () => {
    // Production accelerating, prices decelerating, copper beating gold, oil falling.
    const inp = {
      indpro: monthly("2020-01", 40, (i) => 100 * 1.001 ** (i * i)),
      cpi: monthly("2020-01", 40, (i) => 100 + 6 * Math.sqrt(i)),
      copper: monthly("2020-01", 40, (i) => 3 + i * 0.05),
      gold: monthly("2020-01", 40, () => 2000),
      oil: monthly("2020-01", 40, (i) => 100 - i),
    };
    const r = readingAt(inp, "2022-12")!;
    expect(r.growth).toBeGreaterThan(0);
    expect(r.inflation).toBeLessThan(0);
    expect(r.quadrant).toBe("goldilocks");
  });

  it("gives a list's mean, rises and t-statistic", () => {
    const s = statOf([1, 2, 3, -1])!;
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(1.25);
    expect(s.hit).toBe(75);
    expect(statOf([1, 2])).toBeNull();
  });

  it("files a future's monthly bar under its month even when it opens the evening before", () => {
    const m = barsMonthly([{ time: Date.UTC(2026, 8, 30, 22) / 1000, open: 1, high: 1, low: 1, close: 7, volume: null }]);
    expect([...m.keys()]).toEqual(["2026-10"]);
  });

  it("reads stress from the VIX and credit spreads", () => {
    const flat = (v: number, n = 300) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, value: v }));
    const calm = riskOf([...flat(15), { date: "x", value: 12 }], flat(3), flat(0.5), -0.05);
    expect(calm.label).toBe("risk-on");
    const stressed = riskOf([...flat(15), { date: "x", value: 30 }], [...flat(3), { date: "y", value: 4.5 }], flat(-0.2), 0.06);
    expect(stressed.label).toBe("risk-off");
  });
});

describe("ETFs and breadth", () => {
  it("places an ETF on the rotation map", () => {
    expect(rotationOf(6, 3)).toBe("leading");
    expect(rotationOf(6, 0)).toBe("weakening");
    expect(rotationOf(-6, -3)).toBe("lagging");
    expect(rotationOf(-6, 1)).toBe("improving");
    expect(rotationOf(null, 1)).toBeNull();
  });

  it("counts members above their averages, rising, near highs and lows", () => {
    const m = (close: number, sma50: number, sma200: number, change: number, sector = "Tech") => ({ close, sma50, sma200, change, hi52: 110, lo52: 50, sector });
    const b = breadthOf([m(109, 100, 90, 1), m(95, 100, 90, -1), m(51, 60, 70, -2, "Energy"), m(100, 90, 120, 0.5, "Energy")], -3);
    expect(b.members).toBe(4);
    expect(b.above50).toBe(50);
    expect(b.above200).toBe(50);
    expect(b.advancing).toBe(2);
    expect(b.nearHigh).toBe(1);
    expect(b.nearLow).toBe(1);
    expect(b.read).toContain("bobot setara tertinggal");
  });

  it("sums crypto ETF flows per day and finds the run of inflows", () => {
    const s = summariseFlows("BTC", [
      { ticker: "IBIT", date: "2026-10-16", usdMillions: -50 },
      { ticker: "IBIT", date: "2026-10-19", usdMillions: 30 },
      { ticker: "FBTC", date: "2026-10-19", usdMillions: 5 },
      { ticker: "IBIT", date: "2026-10-20", usdMillions: 10 },
    ]);
    expect(s.days.map((d) => d.total)).toEqual([-50, 35, 10]);
    expect(s.streak).toEqual({ direction: "in", days: 2 });
    expect(s.week).toBe(-5);
  });
});

describe("geopolitics", () => {
  it("sorts headlines into themes, against their usual week, with their tone", () => {
    const now = Date.UTC(2026, 9, 21);
    const h = (title: string, daysAgo: number) => ({ title, publisher: "Reuters", link: "x", time: now - daysAgo * 86_400_000 });
    const list = [
      h("Israel strikes targets in Lebanon", 0.5),
      h("Iran warns of retaliation after attack", 1.5),
      h("Houthi missile attack on Red Sea ship", 2),
      h("Gaza ceasefire talks resume", 10),
      h("US imposes new tariffs on steel", 3),
    ];
    // Under three days of history: nothing is called usual yet.
    expect(heatOf(list.slice(0, 3), now).find((t) => t.id === "mideast")!.heat).toBeNull();
    const themes = heatOf(list, now);
    const mideast = themes.find((t) => t.id === "mideast")!;
    expect(mideast.week).toBe(3);
    expect(mideast.day).toBe(1);
    // The archive starts 10 days back: three days before this week, one headline in them.
    expect(mideast.usualWeek).toBeCloseTo(7 / 3);
    expect(mideast.heat).toBeCloseTo(9 / 7);
    expect(mideast.tone).toBe("eskalasi");
    expect(themes.find((t) => t.id === "trade")!.week).toBe(1);
    expect(themes[0].id).toBe("mideast");
  });
});

describe("journal", () => {
  it("takes only arrays of items with an id", () => {
    expect(isList([{ id: "a", x: 1 }])).toBe(true);
    expect(isList([{ x: 1 }])).toBe(false);
    expect(isList({ id: "a" })).toBe(false);
  });
});
