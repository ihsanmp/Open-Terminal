import { describe, expect, it } from "vitest";
import type { Candle } from "./api";
import { convertCandles, convertDrawing, nativeCurrency, rateAt, rateInterval, usdSource, usdValues } from "./currency";
import type { Drawing } from "./drawings/tools";

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

  it("puts a drawing's points at the rate of their own time, and back", () => {
    const idr = usdValues("IDR", [bar(DAY, 15_000), bar(2 * DAY, 16_000)]);
    const rate = (t: number) => rateAt(null, idr, t + DAY - 1);
    const line: Drawing = { id: "a", tool: "trendLine" as Drawing["tool"], color: "#fff", width: 1, points: [{ time: DAY, price: 10 }, { time: 2 * DAY, price: 11 }] };
    const shown = convertDrawing(line, rate);
    expect(shown.points.map((p) => p.price)).toEqual([150_000, 176_000]);
    const back = convertDrawing({ ...shown, points: [shown.points[0], { time: 2 * DAY, price: 192_000 }] }, rate, true);
    expect(back.points[0].price).toBeCloseTo(10);
    expect(back.points[1].price).toBeCloseTo(12);
    // A Gann square's price per bar goes with it; a drawing on an indicator's pane stays.
    expect(convertDrawing({ ...line, ratio: 0.5 }, rate).ratio).toBe(7500);
    const onPane = { ...line, pane: "rsi-1" };
    expect(convertDrawing(onPane, rate)).toBe(onPane);
  });
});
