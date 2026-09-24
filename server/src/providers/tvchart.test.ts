import { describe, expect, it } from "vitest";
import { RESOLUTION_RE, SYMBOL_RE, parseFrames } from "./tvchart.js";

describe("TradingView chart feed", () => {
  it("splits a message into its framed payloads", () => {
    const a = JSON.stringify({ m: "series_completed", p: ["cs_0"] });
    expect(parseFrames(`~m~${a.length}~m~${a}~m~4~m~~h~7`)).toEqual([a, "~h~7"]);
  });

  it("counts payload length in characters, so ~m~ inside a payload is safe", () => {
    const a = JSON.stringify({ m: "x", p: ["~m~3~m~abc"] });
    expect(parseFrames(`~m~${a.length}~m~${a}`)).toEqual([a]);
  });

  it("accepts exchange-qualified tickers and chart resolutions only", () => {
    for (const ok of ["BINANCE:BTCUSDT", "OANDA:EURUSD", "CME_MINI:ES1!", "NASDAQ:BRK.B"]) expect(SYMBOL_RE.test(ok)).toBe(true);
    for (const bad of ["BTCUSDT", "BINANCE:", "A:B C", "X:Y\"}"]) expect(SYMBOL_RE.test(bad)).toBe(false);
    for (const ok of ["1", "5", "60", "240", "1D", "D", "1W", "1M"]) expect(RESOLUTION_RE.test(ok)).toBe(true);
    for (const bad of ["", "1H", "abc", "12345"]) expect(RESOLUTION_RE.test(bad)).toBe(false);
  });
});
