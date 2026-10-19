import { describe, expect, it } from "vitest";
import { check, claimsInLines, extractClaims, readNumber, setBars, setReleases, verdictOf, yoy } from "./factcheck.js";

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

describe("the releases, the markets and the Fed's moves", () => {
  const rel = (title: string, ref: string, actual: number, previous: number | null = null, date = `${ref}T12:30:00.000Z`) => ({ title, date, ref, actual, previous });
  setReleases(async () => [
    rel("Inflation Rate MoM", "2026-08-31", 0.4, 0.1, "2026-09-11T12:30:00.000Z"),
    rel("Inflation Rate MoM", "2026-09-30", 0.6, 0.4, "2026-10-14T12:30:00.000Z"),
    rel("Core Inflation Rate MoM", "2026-09-30", 0.3, 0.3, "2026-10-14T12:30:00.000Z"),
    rel("Retail Sales MoM", "2026-09-30", 0.8, 1.3, "2026-10-15T12:30:00.000Z"),
    rel("Initial Jobless Claims", "2026-10-10", 199, 198, "2026-10-15T12:30:00.000Z"),
    rel("ISM Manufacturing PMI", "2026-09-30", 54.5, 54.6, "2026-10-01T14:00:00.000Z"),
    rel("JOLTs Job Openings", "2026-08-31", 7.079, 7.335, "2026-09-29T14:00:00.000Z"),
    rel("Michigan Consumer Sentiment Prel", "2026-10-31", 46.3, 48.1, "2026-10-09T14:00:00.000Z"),
    rel("Unemployment Rate", "2026-09-30", 4.2, 4.1, "2026-10-02T12:30:00.000Z"),
  ]);
  const t0 = Date.parse("2026-10-29T18:00:00Z") / 1000;
  setBars(async (symbols) => Object.fromEntries(symbols.map((s) => [s, [{ time: t0 - 60, close: ({ "TVC:US10Y": 4.12, "SP:SPX": 6745.2, "TVC:USOIL": 61.4, "OANDA:XAUUSD": 4012 } as Record<string, number>)[s] ?? 100 }]])));
  const asOf = new Date("2026-10-29T18:00:00Z");
  const checked = async (text: string) => Promise.all(extractClaims(text, asOf).map((c) => check(c, asOf, async () => [])));

  it("reads a month's change of CPI as the month-on-month release, and checks it against the first print", async () => {
    const [cpi, core] = await checked("Consumer prices rose 0.6 percent in September, and core CPI rose 0.3 percent.");
    expect(cpi).toMatchObject({ indicator: "cpi_mom", month: "2026-09", verdict: "match", official: 0.6, period: "2026-09" });
    expect(core).toMatchObject({ indicator: "core_cpi_mom", month: "2026-09", verdict: "match" });
  });

  it("checks retail sales, jobless claims, ISM, job openings and sentiment", async () => {
    const r = await checked(
      "Retail sales rose 0.8% in September. Initial jobless claims fell to 199,000. The ISM manufacturing index came in at 54.5. Job openings slipped to 7.1 million. Consumer sentiment was 46.3.",
    );
    expect(r.map((x) => [x.indicator, x.value, x.verdict])).toEqual([
      ["retail_sales", 0.8, "match"],
      ["jobless_claims", 199, "match"],
      ["ism_mfg", 54.5, "match"],
      ["job_openings", 7.1, "match"],
      ["michigan", 46.3, "match"],
    ]);
  });

  it("checks the unemployment rate against the first print, not only the revised series", async () => {
    const [u] = await checked("The unemployment rate rose to 4.2 percent in September.");
    expect(u).toMatchObject({ verdict: "match", official: 4.2, series: "Unemployment Rate" });
  });

  it("sets a market level beside its price when it was said", async () => {
    const r = await checked("The 10-year yield is at 4.1 percent, the S&P 500 is at 6,750, oil is trading at $61 a barrel and gold at $4,000 an ounce.");
    expect(r.map((x) => [x.indicator, x.value, x.verdict])).toEqual([
      ["yield_10y", 4.1, "match"],
      ["spx", 6750, "match"],
      ["oil", 61, "match"],
      ["gold", 4000, "match"],
    ]);
  });

  it("leaves out changes, comparisons and forecasts said about them", async () => {
    expect(said("Our securities holdings have declined by more than $2 trillion.")).toEqual([]);
    expect(said("They are waiting for oil to go over $70.")).toEqual([]);
    expect(said("Economists expect retail sales to rise 0.4 percent.")).toEqual([]);
    expect(said("The 10-year average of the unemployment rate is 5.6 percent.")).toEqual([]);
    expect(said("When unemployment was 14 percent, we acted.")).toEqual([]);
  });
});

describe("weekly and market figures", () => {
  it("reads jobless claims as the latest week's, whatever month an earlier clause named", () => {
    expect(said("Retail sales rose 0.8% in September while initial jobless claims fell to 199,000 last week.")).toEqual([
      ["retail_sales", 0.8, "2026-09"],
      ["jobless_claims", 199, null],
    ]);
  });
});
