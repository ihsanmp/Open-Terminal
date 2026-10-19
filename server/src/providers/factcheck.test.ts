import { describe, expect, it } from "vitest";
import { check, claimsInLines, extractClaims, readNumber, verdictOf, yoy } from "./factcheck.js";

const asOf = new Date("2026-10-29T18:30:00Z");
const said = (text: string) => extractClaims(text, asOf).map((c) => [c.indicator, c.value, c.month]);

describe("reading the claims", () => {
  it("reads the figures said about the US data, with the month they name", () => {
    expect(said("Total PCE prices rose 2.7 percent over the 12 months ending in September; excluding the volatile food and energy categories, core PCE prices rose 2.9 percent.")).toEqual([
      ["pce", 2.7, "2026-09"],
      ["core_pce", 2.9, "2026-09"],
    ]);
    expect(said("The unemployment rate edged up to 4.3% in August.")).toEqual([["unemployment", 4.3, "2026-08"]]);
    expect(said("In the labor market, job gains averaged 29,000 per month.")).toEqual([["payrolls_avg", 29, null]]);
    expect(said("We decided to lower the target range for the federal funds rate to 3-3/4 to 4 percent.")).toEqual([["fed_funds", 3.75, null]]);
    expect(said("Real GDP rose at an annual rate of 3.8 percent in the second quarter.")).toEqual([["gdp", 3.8, "2026-04"]]);
  });

  it("leaves out goals, forecasts, comparisons, other times and other places", () => {
    expect(said("Inflation remains above our 2 percent objective.")).toEqual([]);
    expect(said("We want inflation to return to 2 percent over time.")).toEqual([]);
    expect(said("Participants project the unemployment rate at 4.5 percent at the end of next year.")).toEqual([]);
    expect(said("Inflation has been running below 2 percent.")).toEqual([]);
    expect(said("Last December, the unemployment rate was 4.1 percent.")).toEqual([]);
    expect(said("Lots of countries are looking at inflation of 10 percent.")).toEqual([]);
    expect(said("Why does unemployment remain at 3.5 percent?")).toEqual([]);
    expect(said("On a three-month basis, core PCE has been running at 1.5 percent.")).toEqual([]);
    expect(said("Personal consumption expenditures were almost 3 percent in this quarter.")).toEqual([]);
  });

  it("reads the numbers as speakers say them", () => {
    expect(readNumber("4-1/4 percent")?.value).toBe(4.25);
    expect(readNumber("4 and a quarter")?.value).toBe(4.25);
    expect(readNumber("two point seven percent")?.value).toBe(2.7);
    expect(said("the target range is 1¾ to 2 percent for the federal funds rate")).toEqual([["fed_funds", 1.75, null]]);
    expect(said("the target range for the federal funds rate is now 1¾ to 2 percent")).toEqual([["fed_funds", 1.75, null]]);
  });

  it("finds a claim cut across caption lines, on the line its figure was said in", () => {
    const lines = ["over the 12 months ending in", "september total pce prices rose", "2.7 percent and the", "unemployment rate was 4.3 percent"];
    const c = claimsInLines(lines, asOf);
    expect(c.map((x) => [x.indicator, x.value, x.line])).toEqual([
      ["pce", 2.7, 2],
      ["unemployment", 4.3, 3],
    ]);
  });
});

describe("checking them", () => {
  it("calls a rounding a match, a revision close, and anything more a different figure", () => {
    expect(verdictOf(2.7, 2.74, "pct")).toBe("match");
    expect(verdictOf(2.7, 2.85, "pct")).toBe("close");
    expect(verdictOf(2.7, 3.2, "pct")).toBe("differs");
    expect(verdictOf(2, 2.12, "pct", true)).toBe("match");
    expect(verdictOf(29, 22, "jobs")).toBe("close");
  });

  it("sets a claim beside the official figure for the month it names, and says where it's from", async () => {
    // An index rising 2.7% a year, then 3.0% in its last month.
    const months: Array<{ date: string; value: number }> = [];
    for (let k = 0; k < 30; k++) months.push({ date: `${2024 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`, value: 100 * 1.027 ** (k / 12) });
    months[29].value = months[17].value * 1.03;
    const fake = async () => months;
    expect(yoy(months).get("2026-06")).toBeCloseTo(3.0, 5);
    const [claim] = extractClaims("Total PCE prices rose 2.7 percent over the 12 months ending in May.", asOf);
    const r = await check(claim, asOf, fake);
    expect(r).toMatchObject({ verdict: "match", period: "2026-05", series: "PCEPI", url: "https://fred.stlouisfed.org/series/PCEPI" });
    const [later] = extractClaims("Total PCE prices rose 2.7 percent over the 12 months ending in June.", asOf);
    expect((await check(later, asOf, fake)).verdict).toBe("differs");
  });
});

describe("the figures that go together", () => {
  it("reads a pace per month over three months as the three months' average, and core inflation with the total's month", () => {
    expect(said("The unemployment rate edged up to 4.3% in August, and payroll job gains have slowed to a pace of just 29,000 per month over the last three months.")).toEqual([
      ["unemployment", 4.3, "2026-08"],
      ["payrolls_avg", 29, null],
    ]);
    expect(said("Total PCE prices rose 2.7% over the 12 months ending in July. Excluding the volatile food and energy categories, core PCE prices rose 2.9%.")).toEqual([
      ["pce", 2.7, "2026-07"],
      ["core_pce", 2.9, "2026-07"],
    ]);
  });
});
