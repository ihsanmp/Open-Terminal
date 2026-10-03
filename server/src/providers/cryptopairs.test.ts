import { describe, expect, it } from "vitest";
import { bestPair, parsePair } from "./tradingview.js";

const row = (s: string, quote: string, vol: number | null, type = "spot", base = "GOAT") => ({ s, d: [base, "Goatseus Maximus", quote, s.split(":")[0], 0.0183, 1.2, 0.019, 0.017, vol, type] });

describe("a token's best pair", () => {
  it("reads a scanner row, and drops ones without a usable ticker or price", () => {
    const p = parsePair(row("RAYDIUM:GOATSOL_9TB2OH.USD", "USD", null))!;
    expect(p).toMatchObject({ base: "GOAT", quote: "USD", exchange: "RAYDIUM", dex: true, spot: true, volumeUsd: null });
    expect(parsePair({ s: "X:Y", d: ["BAD TOKEN", "", "USD", "X", 1] })).toBeNull();
    expect(parsePair({ s: "X:Y", d: ["OK", "", "USD", "X", null] })).toBeNull();
  });

  it("prefers dollars, an exchange over a DEX, spot over perpetual, then volume", () => {
    const pairs = [
      row("RAYDIUM:GOATSOL_9TB2OH", "SOL", null),
      row("RAYDIUM:GOATSOL_9TB2OH.USD", "USD", null),
      row("BYBIT:GOATUSDT.P", "USDT", 9_000_000, "swap"),
      row("MEXC:GOATUSDT", "USDT", 1_000_000),
      row("GATEIO:GOATUSDT", "USDT", 2_000_000),
    ].map((r) => parsePair(r)!);
    expect(bestPair(pairs)!.ticker).toBe("GATEIO:GOATUSDT");
    // Only DEX pairs: the one already in dollars.
    expect(bestPair(pairs.slice(0, 2))!.ticker).toBe("RAYDIUM:GOATSOL_9TB2OH.USD");
    expect(bestPair([])).toBeNull();
  });
});

describe("a stable choice among DEX pairs", () => {
  it("ranks pairs without a USD volume by bar volume × price, then by ticker, in any order", () => {
    const dexRow = (s: string, barVolume: number) => ({ s, d: ["SBC", "SoftBank Chain", "USDT", s.split(":")[0], 2, 0, 2, 2, null, "spot", barVolume] });
    const a = parsePair(dexRow("PANCAKESWAP:SBCUSDT_4C0D3D", 5000))!;
    const b = parsePair(dexRow("UNISWAP:SBCUSDT_AAAAAA", 100))!;
    const c = parsePair(dexRow("UNISWAP:SBCUSDT_BBBBBB", 100))!;
    expect(a.activity).toBe(10_000);
    expect(bestPair([b, c, a])!.ticker).toBe(a.ticker);
    expect(bestPair([a, c, b])!.ticker).toBe(a.ticker);
    expect(bestPair([c, b])!.ticker).toBe(b.ticker);
    expect(bestPair([b, c])!.ticker).toBe(b.ticker);
  });
});
