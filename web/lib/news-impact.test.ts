import { describe, expect, it } from "vitest";
import { newsImpact } from "./news-impact";

const level = (t: string) => newsImpact(t)?.level ?? null;
const markets = (t: string) => newsImpact(t)?.markets ?? [];

describe("headlines that move markets", () => {
  it("marks the big ones, with the markets they move", () => {
    expect(level("Fed cuts interest rates by 50 basis points in surprise move")).toBe("high");
    expect(markets("Fed cuts interest rates by 50 basis points in surprise move")).toEqual(["crypto", "stocks", "forex"]);
    expect(level("US CPI rises 0.6%, hotter than expected")).toBe("high");
    expect(level("Bybit hacked: $1.5 billion in ether stolen")).toBe("high");
    expect(markets("Bybit hacked: $1.5 billion in ether stolen")).toEqual(["crypto"]);
    expect(level("SEC approves spot ether ETFs")).toBe("high");
    expect(level("Spot bitcoin ETFs approved by SEC")).toBe("high");
    expect(level("Nasdaq plunges 4% as tech rout deepens")).toBe("high");
    expect(markets("Nasdaq plunges 4% as tech rout deepens")).toEqual(["stocks"]);
    expect(level("Yen plunges to record low, Japan warns of intervention")).toBe("high");
    expect(markets("Yen plunges to record low, Japan warns of intervention")).toEqual(["forex"]);
    expect(level("Trump imposes 25% tariffs on imports from Mexico and Canada")).toBe("high");
    expect(level("Bank of Japan raises rates to highest since 2008")).toBe("high");
  });

  it("notes the notable ones", () => {
    expect(level("Nvidia shares jump after earnings beat")).toBe("medium");
    expect(level("Houthi missiles hit tanker in Red Sea")).toBe("medium");
    expect(level("Strategy buys 250 bitcoin")).toBe("medium");
  });

  it("leaves routine, speculative and unrelated headlines alone", () => {
    expect(level("Stocks making the biggest moves premarket: JPMorgan, Micron & more")).toBe(null);
    expect(level("Jim Cramer's top 10 things to watch in the stock market Tuesday")).toBe(null);
    expect(level("Could bitcoin crash to $50,000? Analysts weigh in")).toBe(null);
    expect(level("British Pound: Firmer ground with BoE hike risk – ING")).toBe(null);
    expect(level("US Nuclear's low-hanging fruit is being gobbled up")).toBe(null);
    expect(level("Apple unveils new iPhone colors")).toBe(null);
  });
});
