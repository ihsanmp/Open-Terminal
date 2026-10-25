import { describe, expect, it } from "vitest";
import type { TransferRow } from "./transfers.js";
import { alertAssets, isAlert, pickAlerts } from "./whalealerts.js";

const NOW = Date.UTC(2026, 9, 25);
const row = (p: Partial<TransferRow>): TransferRow => ({
  id: "x",
  category: "institution",
  time: NOW / 1000 - 3600,
  from: { name: "BlackRock IBIT", address: null, tag: "etf" },
  to: { name: "Pasar", address: null },
  amount: 100,
  unit: "BTC",
  usd: 8_000_000,
  side: "sell",
  ...p,
});

describe("whale alerts", () => {
  it("reads a pair as the assets it concerns", () => {
    expect(alertAssets("BTC-USD")).toEqual(["BTC-USD"]);
    expect(alertAssets("BINANCE:SOLBTC")).toEqual(["SOL-USD", "BTC-USD"]);
    expect(alertAssets("BINANCE:ETHUSDT")).toEqual(["ETH-USD"]);
    expect(alertAssets("COINBASE:ZEC")).toEqual(["ZEC-USD"]);
    expect(alertAssets("AAPL")).toEqual(["AAPL"]);
    expect(alertAssets("NASDAQ:AAPL")).toEqual(["AAPL"]);
  });

  it("keeps the buys and sells big enough to matter", () => {
    expect(isAlert(row({}))).toBe(true);
    // An institution's always does; a trade on an exchange from a million dollars up.
    expect(isAlert(row({ usd: 4_000_000 / 1000 }))).toBe(true);
    expect(isAlert(row({ category: "exchange", usd: 13_000 }))).toBe(false);
    expect(isAlert(row({ category: "exchange", usd: 2_500_000 }))).toBe(true);
    expect(isAlert(row({ category: "insider", usd: 50_000 }))).toBe(false);
    expect(isAlert(row({ category: "insider", usd: 800_000 }))).toBe(true);
    // A transfer whose direction isn't known isn't a buy or a sell.
    expect(isAlert(row({ category: "onchain", side: undefined, usd: 90_000_000 }))).toBe(false);
  });

  it("lists the last two weeks' newest first, each once, times in seconds", () => {
    const fresh = row({ id: "a", time: NOW - 60_000 });
    const old = row({ id: "b", time: NOW / 1000 - 30 * 86_400 });
    const out = pickAlerts(
      [
        { asset: "SOL", rows: [row({ id: "c", category: "exchange", usd: 5_000_000, side: "buy" }), old] },
        { asset: "BTC", rows: [fresh, fresh] },
      ],
      NOW
    );
    expect(out.map((a) => [a.asset, a.id])).toEqual([
      ["BTC", "a"],
      ["SOL", "c"],
    ]);
    expect(out[0].time).toBe(NOW / 1000 - 60);
  });
});
