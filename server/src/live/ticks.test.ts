import { describe, expect, it } from "vitest";
import { applyUpdate, classify, emptyState, type QuoteState } from "./ticks.js";

describe("trades read off the quote stream", () => {
  it("names the side by the quote and the move", () => {
    const s: QuoteState = { ...emptyState(), price: 100, volume: 1000, bid: 99.9, ask: 100.1 };
    expect(classify(100.1, s)).toBe("buy"); // at the ask
    expect(classify(99.9, s)).toBe("sell"); // at the bid
    expect(classify(100.05, s)).toBe("buy"); // inside, up from the last
    expect(classify(99.95, s)).toBe("sell"); // inside, down
    expect(classify(100, { ...s, side: "sell" })).toBe("sell"); // unchanged: the side before
    expect(classify(100, { ...emptyState(), price: null })).toBe("buy");
  });

  it("makes a trade of each rise in the day's volume, at the last price", () => {
    let s = emptyState();
    let r = applyUpdate(s, { lp: 100, volume: 1000, bid: 99.9, ask: 100.1 }, 1);
    expect(r.tick).toBeNull(); // where counting starts
    s = r.state;
    r = applyUpdate(s, { lp: 100.1, volume: 1300 }, 2);
    expect(r.tick).toEqual({ time: 2, price: 100.1, size: 300, value: 30_030, side: "buy" });
    s = r.state;
    r = applyUpdate(s, { bid: 100, ask: 100.2 }, 3); // the quote alone: no trade
    expect(r.tick).toBeNull();
    s = r.state;
    r = applyUpdate(s, { lp: 100, volume: 1350 }, 4);
    expect(r.tick).toMatchObject({ size: 50, side: "sell" }); // at the new bid
    s = r.state;
    r = applyUpdate(s, { volume: 1360 }, 5);
    expect(r.tick).toMatchObject({ price: 100, size: 10, side: "sell" }); // no new price: the last, same side
    s = r.state;
    r = applyUpdate(s, { lp: 101, volume: 20 }, 6); // a new day's volume
    expect(r.tick).toBeNull();
    expect(r.state.volume).toBe(20);
  });

  it("lists extended-hours trades by their time, without a size", () => {
    let r = applyUpdate(emptyState(), { lp: 100, volume: 5000, rtc: 101, rtc_time: 10, bid: 100.9, ask: 101.2 }, 1);
    expect(r.tick).toBeNull();
    r = applyUpdate(r.state, { rtc: 101.2, rtc_time: 12 }, 2);
    expect(r.tick).toEqual({ time: 2, price: 101.2, size: 0, value: 0, side: "buy", extended: true });
    r = applyUpdate(r.state, { rtc_time: 12 }, 3); // the same time: nothing new
    expect(r.tick).toBeNull();
    r = applyUpdate(r.state, { rtc: 100.9, rtc_time: 15 }, 4);
    expect(r.tick).toMatchObject({ price: 100.9, side: "sell", size: 0 });
  });
});
