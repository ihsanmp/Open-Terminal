import { describe, expect, it } from "vitest";
import { badgeOf, displaySymbol, groupBySection, marketOpen, performance, sectionOf } from "./watchlist";

const day = (iso: string) => Date.parse(iso) / 1000;

describe("watchlist panel", () => {
  it("groups symbols by kind, in TradingView's section order, keeping the list's order", () => {
    expect(["AAPL", "BTC-USD", "^GSPC", "EURUSD=X", "GC=F", "MSFT", "ETH-USD"].map(sectionOf)).toEqual(["stocks", "crypto", "indices", "forex", "futures", "stocks", "crypto"]);
    expect(groupBySection(["AAPL", "BTC-USD", "^GSPC", "MSFT", "ETH-USD"]).map((g) => [g.label, g.symbols])).toEqual([
      ["INDICES", ["^GSPC"]],
      ["STOCKS", ["AAPL", "MSFT"]],
      ["CRYPTO", ["BTC-USD", "ETH-USD"]],
    ]);
  });

  it("writes symbols as TradingView does, with a steady badge", () => {
    expect(["BTC-USD", "EURUSD=X", "GC=F", "^GSPC", "^NDX", "DX-Y.NYB", "CL=F", "ZC=F", "^FTSE", "BRK.B"].map(displaySymbol)).toEqual([
      "BTCUSD", "EURUSD", "GOLD", "SPX", "NDQ", "DXY", "USOIL", "ZC", "FTSE", "BRK.B",
    ]);
    expect(sectionOf("DX-Y.NYB")).toBe("indices");
    expect(badgeOf("BTC-USD")).toEqual(badgeOf("BTC-USD"));
    expect(badgeOf("BTC-USD").text).toBe("B");
    expect(badgeOf("AAPL").text).toBe("AA");
  });

  it("measures performance against the last close before each period", () => {
    // A close every day of 2026 up to Oct 3: day n closes at 100 + n.
    const start = day("2025-09-01T00:00Z");
    const candles = Array.from({ length: 398 }, (_, n) => ({ time: start + n * 86_400, close: 100 + n }));
    const now = candles.at(-1)!.time + 3600;
    const perf = performance(candles, now);
    const last = candles.at(-1)!.close;
    const before = (iso: string) => candles.filter((c) => c.time < day(iso)).at(-1)!.close;
    expect(perf["1W"]).toBeCloseTo((last / candles.at(-8)!.close - 1) * 100, 6);
    expect(perf.YTD).toBeCloseTo((last / before("2026-01-01T00:00Z") - 1) * 100, 6);
    expect(perf["1Y"]).toBeCloseTo((last / before("2025-10-03T00:00Z") - 1) * 100, 6);
    // Data that doesn't reach back a year has no 1Y figure.
    expect(performance(candles.slice(-100), now)["1Y"]).toBeNull();
    expect(performance([], now)["1W"]).toBeNull();
  });

  it("knows when each market trades", () => {
    const saturday = new Date("2026-10-03T15:00Z");
    const tuesdayNoonNY = new Date("2026-10-06T16:00Z");
    expect(marketOpen("BTC-USD", null, saturday)).toBe(true);
    expect(marketOpen("EURUSD=X", null, saturday)).toBe(false);
    expect(marketOpen("EURUSD=X", null, tuesdayNoonNY)).toBe(true);
    expect(marketOpen("AAPL", null, saturday)).toBe(false);
    expect(marketOpen("AAPL", null, tuesdayNoonNY)).toBe(true);
    expect(marketOpen("AAPL", "CLOSED", tuesdayNoonNY)).toBe(false);
  });
});

describe("watchlist prices", () => {
  it("shows price and change to the same places, forex to the pip", async () => {
    const { priceDigits } = await import("./watchlist");
    expect(priceDigits("AAPL", 333.54)).toBe(2);
    expect(priceDigits("EURUSD=X", 1.1312)).toBe(4);
    expect(priceDigits("USDJPY=X", 149.8)).toBe(3);
    expect(priceDigits("SHIB-USD", 0.0000123)).toBe(8);
    expect(priceDigits("XRP-USD", 0.52)).toBe(4);
  });
});

describe("the watchlist follows the chart's market", () => {
  it("lists the chart's kind of market", async () => {
    const { marketOf, sectionsFor, MARKET_DEFAULTS } = await import("./watchlist");
    expect(["SOL-USD", "BTC-USD", "AAPL", "^GSPC", "GC=F", "EURUSD=X"].map(marketOf)).toEqual(["crypto", "crypto", "stocks", "stocks", "commodities", "commodities"]);
    expect(sectionsFor("crypto")).toEqual(["crypto"]);
    expect(sectionsFor("stocks")).toEqual(["indices", "stocks"]);
    expect(sectionsFor("commodities")).toEqual(["futures", "forex"]);
    expect(sectionsFor("all")).toHaveLength(5);
    // Each kind's starting list is of that kind.
    for (const [kind, list] of Object.entries(MARKET_DEFAULTS)) for (const s of list) expect(marketOf(s), s).toBe(kind);
  });
});

describe("tokens named by their TradingView pair", () => {
  it("are crypto, shown without the pool id", async () => {
    const { displaySymbol, sectionOf, marketOf } = await import("./watchlist");
    const { chartContext } = await import("./chart-context");
    for (const s of ["PANCAKESWAP:SBCUSDT_4C0D3D", "RAYDIUM:GOATSOL_9TB2OH.USD"]) {
      expect(sectionOf(s)).toBe("crypto");
      expect(marketOf(s)).toBe("crypto");
      expect(chartContext(s, 86_400).type).toBe("crypto");
    }
    expect(displaySymbol("PANCAKESWAP:SBCUSDT_4C0D3D")).toBe("SBCUSDT");
    expect(displaySymbol("RAYDIUM:GOATSOL_9TB2OH.USD")).toBe("GOATSOL");
    expect(chartContext("PANCAKESWAP:SBCUSDT_4C0D3D", 86_400).ticker).toBe("SBCUSDT_4C0D3D");
  });
});

describe("the details follow the chart's market", () => {
  it("shows the market's benchmark: BTC, the S&P 500 (or the local index), gold", async () => {
    const { benchmarkOf } = await import("./watchlist");
    expect(["SOL-USD", "PANCAKESWAP:SBCUSDT_4C0D3D.USD", "NVDA", "^NDX", "BBCA.JK", "7203.T", "BRK.B", "EURUSD=X", "CL=F"].map((s) => benchmarkOf(s).symbol)).toEqual([
      "BTC-USD", "BTC-USD", "^GSPC", "^GSPC", "^JKSE", "^N225", "^GSPC", "GC=F", "GC=F",
    ]);
  });
});
