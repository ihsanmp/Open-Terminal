import { describe, expect, it } from "vitest";
import { cmcListings, gateListings, isLeveraged, isStockToken, mergeListings, namesAgree, okxListings } from "./newcoins.js";

const since = Date.parse("2026-10-01T00:00:00Z");

describe("new altcoins", () => {
  it("reads CoinMarketCap's newest coins, without stocks or coins that stopped trading", () => {
    const body = {
      data: {
        cryptoCurrencyList: [
          { symbol: "WOON", name: "Woon", dateAdded: "2026-10-23T05:00:00.000Z", platform: { name: "Solana" }, quotes: [{ marketCap: 1e6, volume24h: 17118 }] },
          { symbol: "AMGN", name: "Amgen Inc (Derivatives)", dateAdded: "2026-10-23T05:00:00.000Z", quotes: [{ volume24h: 5 }] },
          { symbol: "VSTB", name: "Vistra Corp Tokenized", dateAdded: "2026-10-19T05:00:00.000Z", quotes: [{ volume24h: 44917 }] },
          { symbol: "DEAD", name: "Dead Coin", dateAdded: "2026-10-20T05:00:00.000Z", quotes: [{ volume24h: 0 }] },
          { symbol: "OLD", name: "Old Coin", dateAdded: "2026-08-01T05:00:00.000Z", quotes: [{ volume24h: 100 }] },
        ],
      },
    };
    const list = cmcListings(body, since);
    expect(list.map((c) => c.symbol)).toEqual(["WOON"]);
    expect(list[0]).toMatchObject({ name: "Woon", chain: "Solana", marketCap: 1e6, source: "CoinMarketCap" });
  });

  it("reads OKX's crypto listings only, not its tokenized stocks", () => {
    const body = {
      data: [
        { baseCcy: "XJPM", quoteCcy: "USDT", state: "live", instCategory: "3", listTime: String(Date.parse("2026-10-23")) },
        { baseCcy: "NEWC", quoteCcy: "USDT", state: "live", instCategory: "1", listTime: String(Date.parse("2026-10-20")) },
        { baseCcy: "SOL", quoteCcy: "USDT", state: "live", instCategory: "1", listTime: "1611907686000" },
      ],
    };
    expect(okxListings(body, since).map((c) => c.symbol)).toEqual(["NEWC"]);
  });

  it("reads Gate's listings without its leveraged tokens", () => {
    expect(isLeveraged("AAVE3S")).toBe(true);
    expect(isLeveraged("BTC5L")).toBe(true);
    expect(isLeveraged("PEARL")).toBe(false);
    expect(isLeveraged("Q")).toBe(false);
    const body = [
      { base: "PEARL", quote: "USDT", trade_status: "tradable", buy_start: Date.parse("2026-10-23") / 1000 },
      { base: "WLD3S", quote: "USDT", trade_status: "tradable", buy_start: Date.parse("2026-10-14") / 1000 },
      { base: "OLDX", quote: "USDT", trade_status: "untradable", buy_start: Date.parse("2026-10-14") / 1000 },
    ];
    expect(gateListings(body, since).map((c) => c.symbol)).toEqual(["PEARL"]);
  });

  it("tells a stock or fund token from a coin", () => {
    expect(isStockToken("Berkshire Hathaway Tokenized")).toBe(true);
    expect(isStockToken("Amgen Inc (Derivatives)")).toBe(true);
    expect(isStockToken("Some Name", ["tokenized-stock"])).toBe(true);
    expect(isStockToken("Predict.fun")).toBe(false);
  });

  it("merges a coin's listings: the earliest date, every source, CoinMarketCap's name", () => {
    const merged = mergeListings([
      [{ symbol: "PEARL", name: "Pearl Protocol", listedAt: 200, source: "CoinMarketCap", chain: "BNB" }],
      [{ symbol: "PEARL", name: "PEARL", listedAt: 100, source: "Gate" }],
    ]);
    expect(merged.get("PEARL")).toEqual({ symbol: "PEARL", name: "Pearl Protocol", listedAt: 100, sources: ["CoinMarketCap", "Gate"], chain: "BNB", marketCap: null });
  });

  it("checks that a pair names the same coin", () => {
    expect(namesAgree("Infinite Money Glitch (glitchonsol.com)", "Infinite Money Glitch")).toBe(true);
    expect(namesAgree("Predict.fun", "Predict")).toBe(true);
    expect(namesAgree("Aura Final Boss", "Kimchi Token")).toBe(false);
  });
});
