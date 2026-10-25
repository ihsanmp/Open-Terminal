import { describe, expect, it } from "vitest";
import { exchangePairRow, peerIndustries, splitPrefixed, splitSuffixed, yahooSymbolOf } from "./tradingview.js";

describe("tradingview symbols", () => {
  it("splits a suffixed ticker into its TradingView code and exchange", () => {
    expect(splitSuffixed("BBCA.JK")).toEqual(["BBCA", "IDX"]);
    expect(splitSuffixed("7203.t")).toEqual(["7203", "TSE"]);
    expect(splitSuffixed("0700.HK")).toEqual(["700", "HKEX"]);
    expect(splitSuffixed("AAPL")).toBeNull();
    expect(splitSuffixed("BRK.B")).toBeNull();
  });

  it("splits a ticker typed with its exchange (COINBASE:ZEC) and lists that exchange's pairs", () => {
    expect(splitPrefixed("COINBASE:ZEC")).toEqual(["ZEC", "COINBASE"]);
    expect(splitPrefixed("oanda:xauusd")).toEqual(["XAUUSD", "OANDA"]);
    expect(splitPrefixed("ZEC")).toBeNull();
    expect(splitPrefixed("ZEC-USD")).toBeNull();
    expect(exchangePairRow({ symbol: "<em>ZEC</em>USD", description: "Zcash / US Dollar", type: "spot", exchange: "Coinbase", prefix: "COINBASE" })).toEqual({ symbol: "COINBASE:ZECUSD", name: "Zcash / US Dollar", exchange: "Coinbase", type: "crypto" });
    expect(exchangePairRow({ symbol: "AAPL", type: "stock", exchange: "NASDAQ", prefix: "NASDAQ" })).toBeNull();
  });

  it("names a listing the way Yahoo does", () => {
    expect(yahooSymbolOf("IDX", "BBCA")).toBe("BBCA.JK");
    expect(yahooSymbolOf("HKEX", "700")).toBe("0700.HK");
    expect(yahooSymbolOf("NYSE", "BRK.B")).toBe("BRK-B");
  });

  it("draws bank peers from major and regional banks alike", () => {
    expect(peerIndustries("Major Banks")).toContain("Regional Banks");
    expect(peerIndustries("Regional Banks")).toContain("Major Banks");
    expect(peerIndustries("Semiconductors")).toEqual(["Semiconductors"]);
  });
});
