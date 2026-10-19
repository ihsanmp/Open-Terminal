import { describe, expect, it } from "vitest";
import { eventPart, findReports, indexNews, isEventClaim, spokenNumbers, statements } from "./evidence.js";
import { keywords, type Headline } from "./socialfeed.js";

const T = Date.parse("2026-10-18T15:00:00Z");
const headline = (publisher: string, title: string, hoursAgo = 5): Headline => ({ publisher, title, link: `https://example.com/${encodeURIComponent(title)}`, time: T - hoursAgo * 3_600_000, words: keywords(title) });

// A week's archive in small: the stories, and enough others that common words are common.
const filler = [
  "Stocks rise as investors weigh earnings and the economy",
  "Oil prices fall on supply worries ahead of the weekend",
  "Heavy traffic expected as holiday weekend begins",
  "Officials say talks will continue next week",
  "Shares in Asia mixed as earnings season gets under way",
  "Central bank holds rates steady, says inflation is easing",
  "Government says new rules will take effect next month",
  "Markets wait for data as the week ends",
  "Police arrest two people after protest in the capital",
  "Heavy rain expected across the region this weekend",
  "Company reports higher profit as sales rise",
  "Officials warn of heavy rain and strong winds",
];
const news = indexNews([
  headline("AP News", "Heavy rain and flooding in Istanbul forces closure of schools"),
  headline("Reuters", "Rubio says Trump to take up to 60 days to weigh Russia sanctions"),
  headline("BBC World", "Netflix to lay off 1,000 staff in steepest cuts since 2022"),
  headline("Reuters", "Netflix cuts about 6% of jobs in biggest layoff since 2022"),
  headline("AP News", "Taiwan plans to buy liquefied natural gas from Alaska pipeline project"),
  headline("Old Wire", "Netflix to lay off 1,000 staff in steepest cuts since 2022", 24 * 9),
  ...filler.flatMap((t, k) => [headline("Wire", t, k), headline("Wire", `${t} again`, k + 1)]),
]);

describe("looking up what's said in the news archive", () => {
  it("finds a story said in other words, spelled-out numbers and all", () => {
    const r = findReports("secretary of state rubio said the president would take up to sixty days to weigh those russia sanctions", T, news);
    expect(r.map((x) => x.publisher)).toEqual(["Reuters"]);
    const n = findReports("netflix announced it will lay off about one thousand employees its deepest job cuts since 2022", T, news);
    expect(n[0]?.title).toMatch(/Netflix/);
  });

  it("keeps to the last week", () => {
    const n = findReports("netflix announced it will lay off about one thousand employees its deepest job cuts since 2022", T, news);
    expect(n.some((x) => x.publisher === "Old Wire")).toBe(false);
  });

  it("finds nothing for the same words about another place or subject", () => {
    expect(findReports("heavy rain and flooding closed schools across northern italy", T, news)).toEqual([]);
    expect(findReports("rubio said india agreed to buy more american liquefied natural gas next year", T, news)).toEqual([]);
    expect(findReports("the governor of montana announced a ban on electric scooters across the state", T, news)).toEqual([]);
  });
});

describe("what's looked up", () => {
  it("events said, not views, plans or questions", () => {
    expect(isEventClaim("president trump has waived the new sanctions on russia arguing it was in the national interest")).toBe(true);
    expect(isEventClaim("netflix announced it will lay off about one thousand employees")).toBe(true);
    expect(isEventClaim("at least seventeen people died in a crush at a hindu festival in india")).toBe(true);
    expect(isEventClaim("i think the economy is in a pretty good place and the labor market is solid")).toBe(false);
    expect(isEventClaim("we will continue to monitor the incoming data and adjust policy as appropriate")).toBe(false);
    expect(isEventClaim("what does that mean for the path of rates going forward?")).toBe(false);
    expect(isEventClaim("if inflation were to move up we would respond to that")).toBe(false);
  });

  it("of a stretch of unpunctuated captions, what comes before a view begins", () => {
    expect(eventPart("european diplomats were attacked by israeli settlers in the west bank belgium said on saturday meanwhile i think the market")).toBe(
      "european diplomats were attacked by israeli settlers in the west bank belgium said on saturday meanwhile",
    );
    expect(eventPart("inflation expectations remain well anchored and we expect inflation to move down")).toBeNull();
  });

  it("numbers as captions spell them", () => {
    expect(spokenNumbers("up to sixty days")).toBe("up to 60 days");
    expect(spokenNumbers("about one thousand employees")).toBe("about 1000 employees");
    expect(spokenNumbers("one hundred thirty nine migrants")).toBe("139 migrants");
    expect(spokenNumbers("one of the reasons")).toBe("one of the reasons");
  });

  it("splits lines into sentences, with the lines each runs over", () => {
    const st = statements(["the unemployment rate rose to 4.3 percent.", "netflix announced it will lay off", "about one thousand employees. ok"]);
    expect(st.map((x) => [x.line, x.lastLine])).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });
});
