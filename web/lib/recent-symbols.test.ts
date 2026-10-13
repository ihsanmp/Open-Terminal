import { describe, expect, it } from "vitest";
import { addRecent, kindOf, type RecentSymbol } from "./recent-symbols";

describe("the symbols opened last", () => {
  it("puts the latest first, once, keeping what was known of it", () => {
    let list: RecentSymbol[] = [];
    list = addRecent({ symbol: "btc-usd", name: "Bitcoin", exchange: "CRYPTO", type: "crypto" }, list);
    list = addRecent({ symbol: "AAPL" }, list);
    list = addRecent({ symbol: "BTC-USD" }, list); // opened again from the watchlist
    expect(list).toEqual([
      { symbol: "BTC-USD", name: "Bitcoin", exchange: "CRYPTO", type: "crypto" },
      { symbol: "AAPL" },
    ]);
    for (let i = 0; i < 30; i++) list = addRecent({ symbol: `S${i}` }, list);
    expect(list).toHaveLength(20);
    expect(list[0].symbol).toBe("S29");
  });

  it("tells a symbol's kind from how it's written", () => {
    expect(["BTC-USD", "EURUSD=X", "^GSPC", "GC=F", "NVDA", "BBCA.JK"].map(kindOf)).toEqual(["crypto", "forex", "index", "futures", "stock", "stock"]);
  });
});
