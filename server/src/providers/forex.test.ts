import { describe, expect, it } from "vitest";
import { FOREX_PAIRS, METALS, fxTickers, groupOf } from "./forex.js";

const ALL = Object.values(FOREX_PAIRS).flat();

describe("the forex pairs", () => {
  it("list each pair once, one way round, as the market quotes it", () => {
    expect(new Set(ALL).size).toBe(ALL.length);
    for (const p of ALL) {
      expect(p).toMatch(/^[A-Z]{6}$/);
      expect(ALL).not.toContain(p.slice(3) + p.slice(0, 3));
    }
    for (const p of ["EURUSD", "GBPJPY", "EURGBP", "AUDNZD", "USDIDR", "ZARJPY", "HKDJPY", "SGDIDR"]) expect(ALL).toContain(p);
    for (const p of ["USDEUR", "JPYUSD", "JPYHKD", "IDRUSD"]) expect(ALL).not.toContain(p);
  });

  it("group them: the seven majors, the G10 crosses, the rest, and the metals", () => {
    expect([...FOREX_PAIRS.major].sort()).toEqual(["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"]);
    expect(groupOf("EURGBP")).toBe("minor");
    expect(groupOf("usdsek")).toBe("minor");
    expect(groupOf("USDIDR")).toBe("exotic");
    expect(groupOf("XAUUSD")).toBe("metal");
  });

  it("find each symbol's TradingView listing: FX_IDC, then FX; a metal where it trades", () => {
    expect(fxTickers("EURUSD=X")).toEqual(["FX_IDC:EURUSD", "FX:EURUSD"]);
    expect(fxTickers("JPY=X")).toEqual(["FX_IDC:USDJPY"]);
    expect(fxTickers("XAUUSD=X")).toEqual([METALS.XAUUSD]);
    expect(fxTickers("XAGUSD=X")).toEqual(["TVC:SILVER"]);
    expect(fxTickers("AAPL")).toBeNull();
    expect(fxTickers("GC=F")).toBeNull();
  });
});
