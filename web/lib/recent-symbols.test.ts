import { describe, expect, it } from "vitest";
import { kindOf, withRecent, type RecentSymbol } from "./recent-symbols";

describe("the symbols opened last", () => {
  it("puts the latest first, once, keeping what was known of it", () => {
    let list: RecentSymbol[] = [];
    list = withRecent(list, { symbol: "btc-usd", name: "Bitcoin", exchange: "CRYPTO", type: "crypto" });
    list = withRecent(list, { symbol: "AAPL" });
    list = withRecent(list, { symbol: "BTC-USD" }); // opened again from the watchlist
    expect(list).toEqual([
      { symbol: "BTC-USD", name: "Bitcoin", exchange: "CRYPTO", type: "crypto" },
      { symbol: "AAPL" },
    ]);
    for (let i = 0; i < 30; i++) list = withRecent(list, { symbol: `S${i}` });
    for (let i = 30; i < 80; i++) list = withRecent(list, { symbol: `S${i}` });
    expect(list).toHaveLength(50);
    expect(list[0].symbol).toBe("S79");
  });

  it("tells a symbol's kind from how it's written", () => {
    expect(["BTC-USD", "EURUSD=X", "^GSPC", "GC=F", "NVDA", "BBCA.JK"].map(kindOf)).toEqual(["crypto", "forex", "index", "futures", "stock", "stock"]);
    expect(["OANDA:EURUSD", "BINANCE:BTCUSDT", "PANCAKESWAP:SBCUSDT_4C0D3D", "NASDAQ:AAPL"].map(kindOf)).toEqual(["forex", "crypto", "crypto", "stock"]);
  });
});
