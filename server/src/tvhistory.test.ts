import { describe, expect, it } from "vitest";
import { TV_DEPTH, TV_RESOLUTION, pickLongest, tvCandidates, tvHistory } from "./tvhistory.js";
import type { TvBar } from "./providers/tvchart.js";

const bar = (time: number, volume: number | null = 10): TvBar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume });

describe("TradingView chart history", () => {
  it("maps our symbols to TradingView tickers", () => {
    expect(tvCandidates("AAPL")).toEqual(["NASDAQ:AAPL", "NYSE:AAPL", "AMEX:AAPL"]);
    expect(tvCandidates("BRK-B")).toEqual(["NASDAQ:BRK.B", "NYSE:BRK.B", "AMEX:BRK.B"]);
    expect(tvCandidates("BBCA.JK")).toEqual(["IDX:BBCA"]);
    expect(tvCandidates("0700.HK")).toEqual(["HKEX:700"]);
    expect(tvCandidates("^GSPC")).toEqual(["SP:SPX", "TVC:SPX"]);
    expect(tvCandidates("EURUSD=X")).toEqual(["FX_IDC:EURUSD", "FX:EURUSD"]);
    expect(tvCandidates("GC=F")).toEqual(["COMEX:GC1!"]);
    const coin = tvCandidates("SUI-USD");
    expect(coin[0]).toBe("BINANCE:SUIUSDT");
    expect(coin).toContain("COINBASE:SUIUSD");
    expect(coin.at(-1)).toBe("CRYPTO:SUIUSD");
    expect(tvCandidates("BTC")[0]).toBe("BINANCE:BTCUSDT"); // legacy bare coin ticker
  });

  it("asks for all of TradingView's daily history", () => {
    expect(TV_RESOLUTION["1D"]).toBe("1D");
    expect(TV_RESOLUTION["4h"]).toBe("240");
    expect(TV_DEPTH["1D"]).toBeGreaterThanOrEqual(11_600); // AAPL daily since 1980
  });

  it("keeps the listing with the longest history, the earlier one on a tie", () => {
    const found = { "A:X": [bar(1), bar(2)], "B:X": [bar(0), bar(1), bar(2)], "C:X": null, "D:X": [bar(0), bar(1), bar(2)] };
    expect(pickLongest(["A:X", "B:X", "C:X", "D:X"], found)).toBe(found["B:X"]);
    expect(pickLongest(["C:X"], found)).toBeNull();
  });

  it("prefers a coin listing with volume over TradingView's volume-less CRYPTO index", () => {
    const found = { "BINANCE:BTCUSDT": [bar(2), bar(3)], "BITSTAMP:BTCUSD": [bar(1), bar(2), bar(3)], "CRYPTO:BTCUSD": [bar(0, null), bar(1, null), bar(2, null), bar(3, null)] };
    const order = Object.keys(found);
    expect(pickLongest(order, found, true)).toBe(found["BITSTAMP:BTCUSD"]);
    expect(pickLongest(order, found)).toBe(found["CRYPTO:BTCUSD"]);
    expect(pickLongest(["CRYPTO:BTCUSD"], found, true)).toBe(found["CRYPTO:BTCUSD"]);
  });

  it("returns candles with missing volume as 0, and fails when no listing answers", async () => {
    const fake = async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, s === "COINBASE:ABCUSD" ? [bar(100, null), bar(200, 5)] : null]));
    expect(await tvHistory("ABC-USD", "1D", fake)).toEqual([
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
      { time: 200, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
    ]);
    await expect(tvHistory("ZZZ-USD", "1D", async (s) => Object.fromEntries(s.map((x) => [x, null])))).rejects.toThrow(/no bars/);
  });
});
