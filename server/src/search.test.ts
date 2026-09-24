import { describe, expect, it } from "vitest";
import { cryptoTerm, matchCoins, rankResults, type Coin, type SearchResult } from "./search.js";

const COINS: Coin[] = [
  { symbol: "BTC", name: "Bitcoin", rank: 1 },
  { symbol: "ETH", name: "Ethereum", rank: 2 },
  { symbol: "WBTC", name: "Wrapped Bitcoin", rank: 15 },
  { symbol: "PEPE", name: "Pepe", rank: 30 },
  { symbol: "BITCOIN", name: "HarryPotterObamaSonic10Inu", rank: 400 },
  { symbol: "BTCST", name: "BTCST", rank: null },
];

// What TradingView's symbol search returns for "BTC-USD": bitcoin funds, no coin.
const BTC_STOCKS: SearchResult[] = [
  { symbol: "GBTC", name: "Grayscale Bitcoin Trust ETF", exchange: "NYSE Arca", type: "fund" },
  { symbol: "BTCT", name: "BTC Digital Ltd.", exchange: "NASDAQ", type: "stock" },
  { symbol: "BTC", name: "Grayscale Bitcoin Mini Trust ETF", exchange: "NYSE Arca", type: "fund" },
  { symbol: "BDCI", name: "BTC Development Corp.", exchange: "NASDAQ", type: "stock" },
];

const search = (q: string, stocks: SearchResult[] = [], indices: SearchResult[] = []) =>
  rankResults([indices, stocks, matchCoins(COINS, q)], q);

describe("cryptoTerm", () => {
  it("strips a USD/USDT quote from pair-style queries", () => {
    for (const q of ["BTC-USD", "btc-usd", " BTC/USD ", "BTC-USDT", "BTCUSDT", "btc / usdt"]) {
      expect(cryptoTerm(q)).toEqual({ term: "btc", pair: true });
    }
  });

  it("leaves plain tickers and names alone", () => {
    expect(cryptoTerm("BTC")).toEqual({ term: "btc", pair: false });
    expect(cryptoTerm("bitcoin")).toEqual({ term: "bitcoin", pair: false });
    expect(cryptoTerm("SUSD")).toEqual({ term: "susd", pair: false }); // no separator: not a pair
  });
});

describe("matchCoins", () => {
  it("finds coins by pair, ticker or name as BASE-USD crypto results", () => {
    for (const q of ["BTC-USD", "btc", "bitcoin", "BTCUSDT"]) {
      expect(matchCoins(COINS, q)[0]).toEqual({ symbol: "BTC-USD", name: "Bitcoin", exchange: "Crypto #1", type: "crypto" });
    }
    expect(matchCoins(COINS, "PEPE-USD")[0].symbol).toBe("PEPE-USD");
    expect(matchCoins(COINS, "eth")[0]).toMatchObject({ symbol: "ETH-USD", name: "Ethereum" });
  });

  it("prefers the exact name over a token whose ticker merely contains it", () => {
    expect(matchCoins(COINS, "bitcoin").map((r) => r.symbol)).toEqual(["BTC-USD", "BITCOIN-USD", "WBTC-USD"]);
  });

  it("labels unranked (Binance-only) coins plainly", () => {
    expect(matchCoins(COINS, "btcst")[0]).toMatchObject({ symbol: "BTCST-USD", exchange: "Crypto" });
  });

  it("returns nothing for an empty query", () => {
    expect(matchCoins(COINS, "  ")).toEqual([]);
  });
});

describe("rankResults", () => {
  it("puts the typed pair first, ahead of bitcoin funds, so Enter loads it", () => {
    const out = search("BTC-USD", BTC_STOCKS);
    expect(out[0]).toMatchObject({ symbol: "BTC-USD", name: "Bitcoin", type: "crypto" });
    // Stock/ETF results are kept.
    expect(out.map((r) => r.symbol)).toEqual(expect.arrayContaining(["GBTC", "BTCT", "BTC", "BDCI"]));
  });

  it("treats BTCUSDT and btc/usd as the same pair", () => {
    expect(search("BTCUSDT", BTC_STOCKS)[0].symbol).toBe("BTC-USD");
    expect(search("btc/usd", BTC_STOCKS)[0].symbol).toBe("BTC-USD");
  });

  it("ranks an exact symbol match first, case-insensitively", () => {
    const out = search("btc", BTC_STOCKS);
    expect(out[0].symbol).toBe("BTC");
    expect(out[1].symbol).toBe("BTC-USD"); // the coin the ticker names comes right after
  });

  it("surfaces the coin for a bare coin ticker or name", () => {
    expect(search("ETH")[0].symbol).toBe("ETH-USD");
    expect(search("bitcoin", BTC_STOCKS)[0].symbol).toBe("BTC-USD");
    expect(search("PEPE-USD")[0].symbol).toBe("PEPE-USD");
  });

  it("keeps stock results first for stock queries", () => {
    const stocks: SearchResult[] = [
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "stock" },
      { symbol: "AAPU", name: "Direxion Daily AAPL Bull 2X", exchange: "NASDAQ", type: "fund" },
    ];
    expect(search("AAPL", stocks).map((r) => r.symbol)).toEqual(["AAPL", "AAPU"]);
  });

  it("dedupes symbols case-insensitively and caps the list", () => {
    const dupes: SearchResult[] = [
      { symbol: "btc-usd", name: "dup", exchange: "", type: "crypto" },
      ...Array.from({ length: 40 }, (_, i) => ({ symbol: `X${i}`, name: "x", exchange: "", type: "stock" })),
    ];
    const out = search("BTC-USD", dupes);
    expect(out.filter((r) => r.symbol.toUpperCase() === "BTC-USD")).toHaveLength(1);
    expect(out).toHaveLength(25);
  });
});
