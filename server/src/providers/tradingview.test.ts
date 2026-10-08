import { describe, expect, it } from "vitest";
import { peerIndustries, splitSuffixed, yahooSymbolOf } from "./tradingview.js";

describe("tradingview symbols", () => {
  it("splits a suffixed ticker into its TradingView code and exchange", () => {
    expect(splitSuffixed("BBCA.JK")).toEqual(["BBCA", "IDX"]);
    expect(splitSuffixed("7203.t")).toEqual(["7203", "TSE"]);
    expect(splitSuffixed("0700.HK")).toEqual(["700", "HKEX"]);
    expect(splitSuffixed("AAPL")).toBeNull();
    expect(splitSuffixed("BRK.B")).toBeNull();
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
