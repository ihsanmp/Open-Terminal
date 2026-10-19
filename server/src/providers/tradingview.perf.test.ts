import { afterEach, describe, expect, it, vi } from "vitest";
import { batchQuotes, perfOf } from "./tradingview.js";

afterEach(() => vi.unstubAllGlobals());

/** The global scanner's answer, and the requests it was asked. */
function scanner(data: Array<{ s: string; d: unknown[] }>) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ totalCount: data.length, data }), { status: 200 });
  });
  return calls;
}

describe("the change over a week and a month", () => {
  it("asks for any mix of symbols at once, keyed by the caller's symbol, from the first listing that has it", async () => {
    const calls = scanner([
      { s: "IDX:BBCA", d: [-20.3, -23.8] },
      { s: "CRYPTO:BTCUSD", d: [-1.4, 2.1] },
      { s: "BINANCE:BTCUSDT", d: [null, null] },
    ]);
    const tickers: Record<string, string[]> = { "BBCA.JK": ["IDX:BBCA"], "BTC-USD": ["BINANCE:BTCUSDT", "CRYPTO:BTCUSD"], NOPE: [] };
    const perf = await perfOf(Object.keys(tickers), (s) => tickers[s]);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.columns).toEqual(["Perf.W", "Perf.1M"]);
    expect(perf.get("BBCA.JK")).toEqual({ week: -20.3, month: -23.8 });
    expect(perf.get("BTC-USD")).toEqual({ week: -1.4, month: 2.1 });
    expect(perf.has("NOPE")).toBe(false);
  });

  it("comes with a scanner quote (futures and forex boards)", async () => {
    scanner([{ s: "COMEX:GC1!", d: ["Gold", 4185.8, 0.11, 4.6, 4180, 4200, 4170, 1e5, "USD", "COMEX", 4400, 2600, -0.83, -4.47] }]);
    const q = await batchQuotes(["GC=F"], () => ["COMEX:GC1!"]);
    expect(q.get("GC=F")).toMatchObject({ price: 4185.8, changePercent: 0.11, changeWeek: -0.83, changeMonth: -4.47 });
  });
});
