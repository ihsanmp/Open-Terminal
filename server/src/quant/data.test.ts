import { describe, expect, it } from "vitest";
import { sessionDay } from "./data.js";

const day = (iso: string) => Date.parse(iso) / 86_400_000;
const t = (iso: string) => Date.parse(iso) / 1000;

describe("a daily bar's day", () => {
  it("is the day its session closes, whenever the feed stamps it", () => {
    // Gold and forex open the evening before; oil and yields at 22:00–23:00.
    expect(sessionDay(t("2026-10-01T21:00:00Z"))).toBe(day("2026-10-02"));
    expect(sessionDay(t("2026-10-01T23:00:00Z"))).toBe(day("2026-10-02"));
    // Crypto at midnight, US stocks and the VIX during the day: the same day.
    expect(sessionDay(t("2026-10-02T00:00:00Z"))).toBe(day("2026-10-02"));
    expect(sessionDay(t("2026-10-02T13:30:00Z"))).toBe(day("2026-10-02"));
    expect(sessionDay(t("2026-10-02T07:00:00Z"))).toBe(day("2026-10-02"));
  });
});
