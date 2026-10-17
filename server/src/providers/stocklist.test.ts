import { afterEach, describe, expect, it, vi } from "vitest";
import { etfPage, isEtfClass, isStockMarket, stockPage } from "./stocklist.js";

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

  it("lists ETFs by assets, a class of them, with their category", async () => {
    const calls = scanner(160, [{ s: "NASDAQ:IBIT", d: ["iShares Bitcoin Trust ETF", 61.2, 2.1, 8.1e10, 4e7, "Digital Assets", "USD", "Currency"] }]);
    const page = await etfPage("us", "currency");
    expect(calls[0].url).toContain("/america/scan");
    expect(calls[0].body.filter).toContainEqual({ left: "typespecs", operation: "has", right: ["etf"] });
    expect(calls[0].body.filter).toContainEqual({ left: "asset_class", operation: "equal", right: "1af0389838508d7016a9841eb6273962" });
    expect(calls[0].body.sort).toEqual({ sortBy: "aum", sortOrder: "desc" });
    expect(page.rows[0]).toMatchObject({ symbol: "IBIT", marketCap: 8.1e10, sector: "Digital Assets" });
    expect(isEtfClass("bond")).toBe(true);
    expect(isEtfClass("stamps")).toBe(false);
  });

  it("keeps the exchange of a fund or share whose ticker the app reads as a coin", async () => {
    scanner(2, [{ s: "AMEX:BTC", d: ["Grayscale Bitcoin Mini Trust", 36.9, 1, 4e9, 1e6, "Pair", "USD", "Currency"] }, { s: "NASDAQ:IBIT", d: ["iShares Bitcoin Trust ETF", 46, 1, 6e10, 1e7, "Pair", "USD", "Currency"] }]);
    // Page 2: the first is cached from the test above.
    const page = await etfPage("us", "currency", 2);
    expect(page.rows.map((r) => r.symbol)).toEqual(["AMEX:BTC", "IBIT"]);
    expect(page.rows[0].sector).toBe("Currency");
  });

  it("asks the US market of TradingView's america scanner, a US share as its plain ticker", async () => {
    const calls = scanner(1, [{ s: "NYSE:BRK.B", d: ["Berkshire Hathaway", 480, 0.1, 1e12, 1e6, "Finance", "USD"] }]);
    const page = await stockPage("us");
    expect(calls[0].url).toContain("/america/scan");
    expect(page.rows[0].symbol).toBe("BRK-B");
  });
});
