import { describe, expect, it } from "vitest";
import { formatReading, fromTradingView } from "./econcalendar.js";

describe("TradingView's economic calendar", () => {
  it("writes readings with their unit and scale, as TradingView shows them", () => {
    expect(formatReading(4.6, "%")).toBe("4.6%");
    expect(formatReading(2.464, "£", "B")).toBe("£2.464B");
    expect(formatReading(54.92, undefined, "K")).toBe("54.92K");
    expect(formatReading(-16.5)).toBe("-16.5");
    expect(formatReading(-102, "$", "B")).toBe("-$102B");
    expect(formatReading(-0.3, "%")).toBe("-0.3%");
    expect(formatReading(0, "%")).toBe("0%");
    expect(formatReading(null, "%")).toBeNull();
  });

  it("lists events under their currency, with Forex Factory's impacts and the euro members named", () => {
    const base = { date: "2026-09-29T08:00:00.000Z", actual: 1.2, forecast: null, previous: 1.1, unit: "%" };
    expect(fromTradingView({ ...base, title: "RBA Interest Rate Decision", country: "AU", currency: "AUD", importance: 1 })).toEqual({
      title: "RBA Interest Rate Decision",
      country: "AUD",
      date: "2026-09-29T08:00:00.000Z",
      impact: "High",
      forecast: null,
      previous: "1.1%",
      actual: "1.2%",
    });
    expect(fromTradingView({ ...base, title: "Ifo Business Climate", country: "DE", currency: "EUR", importance: 0 })).toMatchObject({
      title: "German Ifo Business Climate",
      country: "EUR",
      impact: "Medium",
    });
    expect(fromTradingView({ ...base, title: "3-Month Bill Auction", country: "US", currency: "USD", importance: -1 }).impact).toBe("Low");
    expect(fromTradingView({ ...base, title: "Thanksgiving Day Holiday", country: "US", currency: "USD", importance: -1 }).impact).toBe("Holiday");
  });
});
