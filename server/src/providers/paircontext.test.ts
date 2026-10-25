import { describe, expect, it } from "vitest";
import { classify, companyName, coreOf, mentions } from "./paircontext.js";

describe("the chart's pair in the desk's tools", () => {
  it("reads the core of every way the app writes a symbol", () => {
    expect(coreOf("OANDA:XAUUSD").core).toBe("XAUUSD");
    expect(coreOf("GC=F").core).toBe("GC");
    expect(coreOf("XAUUSD=X").core).toBe("XAUUSD");
    expect(coreOf("NYMEX:CL1!").core).toBe("CL");
    expect(coreOf("NYMEX:CLZ2026").core).toBe("CL");
    expect(coreOf("BTC-USD").crypto).toBe("BTC");
    expect(coreOf("BINANCE:ETHUSDT").crypto).toBe("ETH");
    expect(coreOf("BBCA.JK")).toMatchObject({ core: "BBCA.JK", suffix: "JK" });
  });

  it("places gold, oil and bitcoin in every tool", () => {
    const gold = classify("OANDA:XAUUSD");
    expect(gold).toMatchObject({ kind: "metal", regimeKey: "gold", curveId: "gc", cotId: "gc", quantKey: "xau", geo: { key: "gold", sign: 1 } });
    expect(classify("CL=F")).toMatchObject({ kind: "energy", curveId: "cl", cotId: "cl", quantKey: "oil" });
    const btc = classify("BINANCE:BTCUSDT");
    expect(btc).toMatchObject({ kind: "crypto", regimeKey: "btc", regimeProxy: false, curveId: "btc", cotId: "btc" });
    expect(classify("SOL-USD")).toMatchObject({ kind: "crypto", regimeKey: "btc", regimeProxy: true, curveId: null });
  });

  it("reads a currency pair: both currencies, the non-dollar country, against the dollar", () => {
    const eur = classify("EURUSD");
    expect(eur).toMatchObject({ kind: "fx", currencies: ["EUR", "USD"], country: "EU", regimeKey: "eurusd", curveId: "6e", cotId: "6e", geo: { key: "dxy", sign: -1 } });
    const jpy = classify("FX:USDJPY");
    expect(jpy).toMatchObject({ country: "JP", regimeKey: "usdjpy", curveId: "6j", geo: { key: "dxy", sign: 1 } });
    expect(classify("GBPUSD")).toMatchObject({ regimeKey: "dxy", regimeProxy: true, cotId: "6b" });
    expect(classify("USDIDR")).toMatchObject({ country: "ID", cotId: "dx" });
  });

  it("reads a stock through its sector, or abroad through its country", () => {
    expect(classify("AAPL", "Electronic Technology", "Apple Inc.")).toMatchObject({ kind: "stock", regimeKey: "xlk", regimeProxy: true, curveId: "nq", etfs: ["XLK"], keywords: ["aapl", "apple"] });
    expect(classify("JPM", "Finance")).toMatchObject({ regimeKey: "xlf", curveId: "es", etfs: ["XLF"] });
    expect(classify("KO", "Health Technology")).toMatchObject({ regimeKey: "spx", etfs: ["XLV"] });
    expect(classify("BBCA.JK")).toMatchObject({ kind: "stock", country: "ID", currencies: ["IDR"], regimeKey: "eem", etfs: ["EIDO"] });
  });

  it("names a company as headlines do", () => {
    expect(companyName("PT Bank Central Asia Tbk")).toBe("bank central asia");
    expect(companyName("Apple Inc.")).toBe("apple");
    expect(companyName("NVIDIA Corporation")).toBe("nvidia");
    expect(companyName("Alphabet Inc. Class A")).toBe("alphabet");
    expect(classify("BBCA.JK", "Finance", "PT Bank Central Asia Tbk").keywords).toEqual(["bbca", "bank central asia"]);
  });

  it("finds the pair's name in a headline, short words as whole words only", () => {
    expect(mentions("JUST IN: Gold hits a record high", ["gold", "xau"])).toBe(true);
    expect(mentions("Ethereum ETFs see outflows", ["eth"])).toBe(false);
    expect(mentions("$ETH breaks $3,000", ["eth"])).toBe(true);
    expect(mentions("Apple unveils new iPhone", ["aapl", "apple"])).toBe(true);
    // Whole words only, and a $-keyword only with its $.
    expect(mentions("Golden week ahead", ["gold"])).toBe(false);
    expect(mentions("Link in bio", ["$link", "chainlink"])).toBe(false);
    expect(mentions("$LINK up 10% as Chainlink ships CCIP v2", ["$link"])).toBe(true);
    expect(mentions("Bitcoin's dominance climbs", ["bitcoin"])).toBe(true);
  });

  it("reads a coin against another coin as both, and names the coins as posts do", async () => {
    const { coinKeywords } = await import("./paircontext.js");
    expect(coreOf("BINANCE:SOLBTC")).toMatchObject({ crypto: "SOL", cryptoQuote: "BTC" });
    expect(coreOf("COINBASE:ZEC")).toMatchObject({ crypto: "ZEC", cryptoQuote: null });
    expect(coreOf("BINANCE:ETHUSDT")).toMatchObject({ crypto: "ETH", cryptoQuote: "USDT" });
    expect(coreOf("BINANCE:BTCIDR")).toMatchObject({ crypto: "BTC", cryptoQuote: "IDR" });
    const solbtc = classify("BINANCE:SOLBTC");
    expect(solbtc.label).toBe("SOL/BTC");
    expect(solbtc.keywords).toEqual(expect.arrayContaining(["sol", "solana", "btc", "bitcoin"]));
    expect(classify("COINBASE:ZEC").keywords).toEqual(expect.arrayContaining(["zec", "zcash"]));
    // Against a currency or a stablecoin, only the coin.
    expect(classify("BINANCE:BTCIDR").keywords).not.toContain("idr");
    expect(coinKeywords("LINK")).toEqual(["chainlink", "$link"]);
  });
});
