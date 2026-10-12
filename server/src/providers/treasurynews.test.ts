import { describe, expect, it } from "vitest";
import { newsTrade, unfiledTrades, type NewsHeadline } from "./treasurynews.js";
import type { TreasuryTrade } from "./treasuries.js";

const h = (title: string, publishedAt = "2026-10-12T05:04:32.000Z", summary = ""): NewsHeadline => ({ title, summary, link: "https://example.com/a", publisher: "Wire", publishedAt });

describe("treasury companies' trades from the news", () => {
  it("reads the company, the coins and the price off a headline", () => {
    expect(newsTrade(h("Strategy buys 250 bitcoin, repurchases $192M preferred stock"))).toMatchObject({
      company: "Strategy", ticker: "MSTR", asset: "BTC", amount: 250, usd: null, time: Date.parse("2026-10-12T05:04:32Z") / 1000,
    });
    expect(newsTrade(h("Michael Saylor's Strategy adds 1,955 BTC for $217.4 million"))).toMatchObject({ amount: 1955, usd: 217_400_000 });
    expect(newsTrade(h("MicroStrategy acquires another 10.1K bitcoin worth $1.1 billion"))).toMatchObject({ amount: 10_100, usd: 1_100_000_000 });
    expect(newsTrade(h("BitMine purchases 40,000 more ETH as ether slides"))).toMatchObject({ ticker: "BMNR", asset: "ETH", amount: 40_000 });
    expect(newsTrade(h("MARA sold 1,500 bitcoin in March"))).toMatchObject({ ticker: "MARA", amount: -1500 });
    // From the summary when the headline doesn't say.
    expect(newsTrade(h("Saylor does it again", undefined, "Strategy bought 487 BTC for about $50 million last week."))).toMatchObject({ amount: 487, usd: 50_000_000 });
  });

  it("leaves headlines that don't report a trade", () => {
    expect(newsTrade(h("Saylor teases Strategy Bitcoin buying after ending September with STRC buybacks"))).toBeNull();
    expect(newsTrade(h("Morgan Stanley's digital asset strategy head buys 5 BTC"))).toBeNull(); // "strategy", not Strategy
    expect(newsTrade(h("Michael Saylor's Strategy Resumes Buying Bitcoin: Spends $370 Million on BTC"))).toBeNull(); // no coins
    expect(newsTrade(h("Whale buys 250 BTC on Binance"))).toBeNull();
  });

  it("keeps the first report of a trade, until an 8-K gives it", () => {
    const news = [
      h("Strategy buys 250 bitcoin", "2026-10-12T05:04:00Z"),
      h("Strategy Beli 250 BTC — Strategy buys 250 BTC for $21 million", "2026-10-12T12:00:00Z"),
      h("Strategy buys 334 BTC", "2026-10-05T12:00:00Z"),
    ];
    const filed: TreasuryTrade[] = [
      { company: "Strategy", ticker: "MSTR", asset: "BTC", time: Date.parse("2026-10-04T00:00:00Z") / 1000, amount: 334, usd: 28.7e6, avgPrice: 85_838, holdings: null, url: "" },
    ];
    const out = unfiledTrades(news, filed);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 250, time: Date.parse("2026-10-12T05:04:00Z") / 1000 });
    // Once filed, it's the 8-K's.
    expect(unfiledTrades(news, [...filed, { ...filed[0], time: Date.parse("2026-10-11T00:00:00Z") / 1000, amount: 250 }])).toEqual([]);
  });
});
