import { describe, expect, it } from "vitest";
import { namedAssets } from "./brief.js";

const board = [
  { symbol: "BTC", name: "Bitcoin", rank: 1 },
  { symbol: "ETH", name: "Ethereum", rank: 2 },
  { symbol: "SOL", name: "Solana", rank: 7 },
  { symbol: "ADA", name: "Cardano", rank: 10 },
  { symbol: "LINK", name: "Chainlink", rank: 13 },
  { symbol: "PEPE", name: "Pepe", rank: 30 },
  { symbol: "ZEC", name: "Zcash", rank: 60 },
  { symbol: "OBSCURE", name: "Obscure Token", rank: 900 },
];
const coinsOf = (q: string) => namedAssets(q, board).coins.map((c) => c.symbol);

describe("the assets a question names", () => {
  it("finds a coin by its ticker or its name", () => {
    expect(coinsOf("aduh aku baru rugi 20% di SOL, panik nih")).toEqual(["SOL"]);
    expect(coinsOf("gimana solana minggu ini?")).toEqual(["SOL"]);
    expect(coinsOf("zec lagi naik?")).toEqual(["ZEC"]);
    expect(coinsOf("bandingkan $PEPE sama chainlink")).toEqual(expect.arrayContaining(["PEPE", "LINK"]));
  });

  it("doesn't take everyday words for coins", () => {
    // "ada" is "there is", "link" a link; in capitals they're the coins.
    expect(coinsOf("ada link berita soal emas?")).toEqual([]);
    expect(coinsOf("ADA kuat nggak?")).toEqual(["ADA"]);
    // A small coin in lower case isn't guessed at.
    expect(coinsOf("obscure itu apa")).toEqual([]);
  });

  it("leaves bitcoin and ether to the snapshot", () => {
    expect(coinsOf("BTC dan ethereum gimana?")).toEqual([]);
  });

  it("takes pairs and capital tickers as symbols, not terms", () => {
    const r = namedAssets("lihat BINANCE:SOLBTC, AAPL dan BBCA.JK sebelum FOMC, CPI, ETF", board);
    expect(r.symbols).toEqual(["BINANCE:SOLBTC", "AAPL", "BBCA.JK"]);
  });
});
