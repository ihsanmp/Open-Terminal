import { describe, expect, it } from "vitest";
import { forecastFor, horizonFor, verdictOf, type AssetForecast, type HorizonForecast, type QuantHistory } from "./quant";

const score = (proven: boolean) => ({ n: 2000, acc: 0.55, baseAcc: 0.52, bss: proven ? 0.01 : -0.01, z: proven ? 2 : 0.5, proven });
const horizon = (pUp: number, proven: boolean): HorizonForecast => ({
  pUp,
  baseRate: 0.52,
  verdict: "Netral",
  score: score(proven),
  without: { astro: score(false), macro: score(false) },
  drivers: [],
  band: { p10: -3, p50: 0.2, p90: 3.5 },
});
const live: AssetForecast = {
  key: "xau", label: "Emas", symbol: "XAUUSD=X", group: "Komoditas", unit: "%", price: 4100, asOfDay: 20_740,
  horizons: { 5: horizon(0.6, false), 10: horizon(0.61, false), 20: horizon(0.4, false) },
};
const hist: QuantHistory = { asOfDay: 20_740, history: { 5: [[20_700, 0.51], [20_703, 0.58], [20_704, 0.49]], 10: [[20_703, 0.6]], 20: [] } };

describe("the quant forecasts on the calendar", () => {
  it("take the horizon nearest an event's span", () => {
    expect(horizonFor(5)).toBe(5);
    expect(horizonFor(10)).toBe(10);
    expect(horizonFor(20)).toBe(20);
    expect(horizonFor(14)).toBe(10);
  });

  it("read a past event's forecast from the day before it, and today's for one ahead", () => {
    // Event on day 20 705: the last forecast on or before 20 704.
    expect(forecastFor(20_705, 5, hist, live)).toEqual({ pUp: 0.49, asOfDay: 20_704, live: false });
    // A weekend between: the Friday's.
    expect(forecastFor(20_704, 5, hist, live)).toEqual({ pUp: 0.58, asOfDay: 20_703, live: false });
    // None within a week before it: nothing.
    expect(forecastFor(20_720, 5, hist, live)).toBeNull();
    // Ahead of the latest close: today's.
    expect(forecastFor(20_745, 10, hist, live)).toEqual({ pUp: 0.61, asOfDay: 20_740, live: true });
  });

  it("call a side only with a tested signal and a lean off the usual", () => {
    expect(verdictOf(0.7, horizon(0.7, false))).toBe("Netral");
    expect(verdictOf(0.6, horizon(0.6, true))).toBe("Bullish");
    expect(verdictOf(0.53, horizon(0.53, true))).toBe("Netral");
    expect(verdictOf(0.4, horizon(0.4, true))).toBe("Bearish");
  });
});
