import { describe, expect, it } from "vitest";
import { countriesOf, filterEvents } from "./econ-filter";

const ev = (country: string, impact: string) => ({ country, impact, title: `${country} ${impact}` });
const events = [ev("USD", "High"), ev("USD", "Low"), ev("EUR", "Medium"), ev("JPY", "Holiday"), ev("INR", "Non-Economic"), ev("All", "High")];

describe("economic calendar filters", () => {
  it("keeps the chosen impacts from the countries not hidden", () => {
    expect(filterEvents(events, ["High", "Medium"], []).map((e) => e.title)).toEqual(["USD High", "EUR Medium", "All High"]);
    expect(filterEvents(events, ["High"], ["ALL"]).map((e) => e.title)).toEqual(["USD High"]); // the feed's "All" is ALL
    expect(filterEvents(events, ["High", "Medium", "Low", "Holiday"], ["USD", "ALL"]).map((e) => e.title)).toEqual(["EUR Medium", "JPY Holiday", "INR Non-Economic"]);
    expect(filterEvents(events, ["Low"], []).map((e) => e.title)).toEqual(["USD Low", "INR Non-Economic"]); // unknown impact counts as Low
    expect(filterEvents(events, [], [])).toEqual([]);
  });

  it("lists the known currencies, then any new one in the feed", () => {
    const codes = countriesOf(events).map((c) => c.code);
    expect(codes.slice(0, 3)).toEqual(["USD", "EUR", "GBP"]);
    expect(codes.at(-1)).toBe("INR");
    expect(codes.filter((c) => c === "ALL")).toHaveLength(1);
  });
});
