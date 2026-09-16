import { afterEach, describe, expect, it, vi } from "vitest";
import { isCryptoSymbol, listRefreshMs, quoteRefreshMs, usSessionActive } from "./refresh";

// New York is UTC-4 in September (EDT).
const ny = (iso: string) => new Date(`${iso}-04:00`);

describe("usSessionActive", () => {
  it("covers pre-market through after-hours on weekdays", () => {
    expect(usSessionActive(ny("2026-09-16T03:59"))).toBe(false);
    expect(usSessionActive(ny("2026-09-16T04:00"))).toBe(true);
    expect(usSessionActive(ny("2026-09-16T12:30"))).toBe(true);
    expect(usSessionActive(ny("2026-09-16T19:59"))).toBe(true);
    expect(usSessionActive(ny("2026-09-16T20:00"))).toBe(false);
  });

  it("is closed all weekend", () => {
    expect(usSessionActive(ny("2026-09-19T12:00"))).toBe(false); // Saturday
    expect(usSessionActive(ny("2026-09-20T12:00"))).toBe(false); // Sunday
  });
});

describe("refresh intervals", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps crypto fast around the clock and slows US stocks outside the session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(ny("2026-09-19T12:00")); // Saturday
    expect(quoteRefreshMs("BTC-USD")).toBe(5_000);
    expect(quoteRefreshMs("AAPL")).toBe(60_000);
    vi.setSystemTime(ny("2026-09-16T10:00")); // Wednesday, session open
    expect(quoteRefreshMs("AAPL")).toBe(3_000);
    expect(quoteRefreshMs("BBCA.JK")).toBe(20_000);
    expect(quoteRefreshMs("^JKSE")).toBe(20_000);
  });

  it("uses the fastest need in a list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(ny("2026-09-19T12:00"));
    expect(listRefreshMs(["AAPL", "ETH-USD"])).toBe(5_000);
    expect(listRefreshMs(["AAPL", "MSFT"])).toBe(60_000);
  });

  it("recognizes crypto symbols", () => {
    expect(isCryptoSymbol("PEPE-USD")).toBe(true);
    expect(isCryptoSymbol("BTC")).toBe(true);
    expect(isCryptoSymbol("BRK-B")).toBe(false);
  });
});
