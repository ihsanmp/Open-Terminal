import { describe, expect, it } from "vitest";
import { btcMvrv, mergeSupply, supplySeries, type Fetch } from "./supplypl.js";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe("BTC supply in profit/loss and MVRV", () => {
  it("merges each fetch into the stored days, so history outlives the 4-year free window", () => {
    const stored = { "100": [1, 3] as [number, number] };
    const rows = mergeSupply(
      stored,
      [
        { unixTs: 200, supplyProfitBtc: 3 },
        { unixTs: 300, supplyProfitBtc: 9 },
      ],
      [{ unixTs: 200, supplyLossBtc: 1 }]
    );
    expect(rows).toEqual({ "100": [1, 3], "200": [3, 1] }); // day 300 has no loss figure yet
    expect(supplySeries(rows)).toEqual({ time: [100, 200], inProfit: [0.25, 0.75] });
  });

  it("follows Coin Metrics' pages for MVRV", async () => {
    const pages: Record<string, unknown> = {
      first: { data: [{ time: "2026-09-27T00:00:00.000000000Z", CapMVRVCur: "1.57" }], next_page_url: "https://x.test/second" },
      second: { data: [{ time: "2026-09-28T00:00:00.000000000Z", CapMVRVCur: "1.55" }] },
    };
    const f: Fetch = async (url) => reply(url.includes("second") ? pages.second : pages.first);
    expect(await btcMvrv(f)).toEqual({ time: [Date.UTC(2026, 8, 27) / 1000, Date.UTC(2026, 8, 28) / 1000], value: [1.57, 1.55] });
  });

  it("fails loudly when Coin Metrics returns nothing", async () => {
    await expect(btcMvrv(async () => reply({ data: [] }))).rejects.toThrow(/no MVRV/);
    await expect(btcMvrv(async () => reply({}, 429))).rejects.toThrow(/429/);
  });
});
