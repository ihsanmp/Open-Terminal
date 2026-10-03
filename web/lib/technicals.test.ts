import { describe, expect, it } from "vitest";
import { ratingOf, technicals } from "./technicals";

const series = (f: (i: number) => number, n = 260) =>
  Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { high: c * 1.01, low: c * 0.99, close: c };
  });

describe("technicals", () => {
  it("rates with TradingView's bands", () => {
    expect([0.8, 0.3, 0, -0.3, -0.8].map(ratingOf)).toEqual(["Strong buy", "Buy", "Neutral", "Sell", "Strong sell"]);
  });

  it("reads a steady rise as buy and a steady fall as sell", () => {
    const up = technicals(series((i) => 100 * 1.004 ** i))!;
    expect(up.movingAverages.rating).toBe("Strong buy");
    expect(up.movingAverages.buy).toBe(12); // SMA and EMA of 10, 20, 30, 50, 100 and 200 days
    expect(["Buy", "Strong buy"]).toContain(up.summary.rating);

    const down = technicals(series((i) => 100 * 0.996 ** i))!;
    expect(down.movingAverages.rating).toBe("Strong sell");
    // A fall that keeps easing lifts MACD and momentum (TradingView's rules call that a buy), so
    // the oscillators pull the summary toward neutral; it is never a buy.
    expect(["Neutral", "Sell", "Strong sell"]).toContain(down.summary.rating);
    expect(down.summary.buy + down.summary.neutral + down.summary.sell).toBe(17);
  });

  it("leaves out averages too long for the data, and needs a month of it", () => {
    expect(technicals(series((i) => 100 + i, 29))).toBeNull();
    const short = technicals(series((i) => 100 + i, 60))!;
    expect(short.movingAverages.buy + short.movingAverages.neutral + short.movingAverages.sell).toBe(8); // 10, 20, 30, 50
  });
});
