import { describe, expect, it } from "vitest";
import type { Candle } from "./api";
import { convertCandles, nativeCurrency, rateInterval, usdSource, usdValues } from "./currency";

const DAY = 86_400;
const bar = (time: number, close: number, open = close): Candle => ({ time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 5 });

describe("chart currency", () => {
  it("reads each currency's dollar value from the chart that prices it", () => {
    expect(usdSource("USD")).toBeNull();
    expect(usdSource("USDT")).toBeNull();
    expect(usdSource("IDR")).toEqual({ symbol: "FX_IDC:USDIDR", invert: true });
    expect(usdSource("BTC")).toEqual({ symbol: "BTC-USD", invert: false });
    expect(usdValues("IDR", [bar(0, 16_000)])).toEqual([{ time: 0, value: 1 / 16_000 }]);
    expect(usdValues("GBX", [bar(0, 0.8)])![0].value).toBeCloseTo(1 / 80);
    expect(nativeCurrency("GBp")).toBe("GBX");
    expect(nativeCurrency("USDT")).toBe("USD");
    expect(nativeCurrency(null)).toBe("USD");
    expect(rateInterval(3600)).toBe("1h");
    expect(rateInterval(DAY)).toBe("1D");
  });

  it("converts each bar at the rate of its own day, not today's", () => {
    // Rupiah per dollar: 15,000 on day 1, 16,000 from day 2.
    const idr = usdValues("IDR", [bar(DAY, 15_000), bar(2 * DAY, 16_000)]);
    const out = convertCandles([bar(DAY, 10, 9), bar(2 * DAY, 11), bar(3 * DAY, 12)], null, idr, DAY);
    expect(out.map((b) => b.close)).toEqual([150_000, 176_000, 192_000]);
    expect(out[0].open).toBe(135_000);
    expect(out[0].high).toBe(165_000);
    expect(out[0].volume).toBe(5);
  });

  it("converts between two currencies through the dollar, and before the first rate uses it", () => {
    // A stock in rupiah shown in euros: rupiah's dollar value over the euro's.
    const idr = usdValues("IDR", [bar(5 * DAY, 16_000)]);
    const eur = usdValues("EUR", [bar(5 * DAY, 0.8)]);
    const out = convertCandles([bar(DAY, 8000)], idr, eur, DAY);
    expect(out[0].close).toBeCloseTo((8000 / 16_000) / 1.25);
    // A coin pair quoted in bitcoin, shown in dollars.
    const btc = usdValues("BTC", [bar(DAY, 100_000)]);
    expect(convertCandles([bar(DAY, 0.03)], btc, null, DAY)[0].close).toBeCloseTo(3000);
  });

  it("leaves the bars alone when a rate series came back empty", () => {
    const bars = [bar(DAY, 10)];
    expect(convertCandles(bars, null, [], DAY)).toBe(bars);
  });
});
