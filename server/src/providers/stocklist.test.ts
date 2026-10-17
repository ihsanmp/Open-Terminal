import { afterEach, describe, expect, it, vi } from "vitest";
import { isStockMarket, stockPage } from "./stocklist.js";

afterEach(() => vi.unstubAllGlobals());

/** The scanner's answer to one request, and the request it was asked. */
function scanner(totalCount: number, data: Array<{ s: string; d: unknown[] }>) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ totalCount, data }), { status: 200 });
  });
  return calls;
}

describe("a market's stocks", () => {
  it("knows the markets the scanners cover", () => {
    expect(isStockMarket("indonesia")).toBe(true);
    expect(isStockMarket("us")).toBe(true);
    expect(isStockMarket("mars")).toBe(false);
  });

  it("lists them biggest first, as the app's symbols, a page at a time", async () => {
    const calls = scanner(844, [{ s: "IDX:BBCA", d: ["PT Bank Central Asia Tbk", 5175, 1.2, 7.49e14, 1e8, "Finance", "IDR"] }]);
    const page = await stockPage("indonesia", 2);
    expect(calls[0].url).toContain("/indonesia/scan");
    expect(calls[0].body.range).toEqual([100, 200]);
    expect(calls[0].body.sort).toEqual({ sortBy: "market_cap_basic", sortOrder: "desc" });
    expect(page).toMatchObject({ total: 844, page: 2, perPage: 100 });
    expect(page.rows[0]).toEqual({ symbol: "BBCA.JK", code: "BBCA", name: "PT Bank Central Asia Tbk", price: 5175, changePercent: 1.2, marketCap: 7.49e14, volume: 1e8, sector: "Finance", currency: "IDR" });
  });

  it("searches by ticker or name, and writes a Paris listing as .PA", async () => {
    const calls = scanner(1, [{ s: "EURONEXT:MC", d: ["LVMH", 600, -0.5, 3e11, 1e6, "Consumer Non-Durables", "EUR"] }]);
    const page = await stockPage("france", 1, " lvmh ");
    expect(calls[0].body.filter).toContainEqual({ left: "name,description", operation: "match", right: "lvmh" });
    expect(page.rows[0].symbol).toBe("MC.PA");
  });

  it("asks the US market of TradingView's america scanner, a US share as its plain ticker", async () => {
    const calls = scanner(1, [{ s: "NYSE:BRK.B", d: ["Berkshire Hathaway", 480, 0.1, 1e12, 1e6, "Finance", "USD"] }]);
    const page = await stockPage("us");
    expect(calls[0].url).toContain("/america/scan");
    expect(page.rows[0].symbol).toBe("BRK-B");
  });
});
