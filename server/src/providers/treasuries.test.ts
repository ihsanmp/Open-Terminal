import { describe, expect, it } from "vitest";
import { consolidate, filingText, holdingChanges, parseHolding, parseTrades, type TreasuryTrade } from "./treasuries.js";
import { movedBtc } from "./whales.js";

const base = { company: "Strategy", ticker: "MSTR", url: "x" };
const filing = { ...base, filed: "2026-09-28" };
const day = (d: string) => Date.parse(`${d} UTC`) / 1000;

describe("company bitcoin trades from 8-K filings", () => {
  it("reads the weekly BTC Update table", () => {
    const html =
      "<p>BTC Update</p><p>During Period September 21, 2026 to September 27, 2026</p><p>As of September 27, 2026</p>" +
      "<td>BTC Purchased (1)</td><td>Aggregate Purchase Price (in millions) (2)</td><td>Average Purchase Price (2)</td>" +
      "<td>Aggregate BTC Holdings</td><td>Aggregate Purchase Price (in billions) (2)</td><td>Average Purchase Price (2)</td>" +
      "<td>1,665</td><td>$&#160;142.7</td><td>$&#160;85,681</td><td>847,666</td><td>$&#160;63.95</td><td>$&#160;75,437</td><p>(1) The bitcoin purchases…</p>";
    expect(parseTrades(filingText(html), filing)).toEqual([
      { ...base, asset: "BTC", from: day("September 21, 2026"), time: day("September 27, 2026"), amount: 1665, usd: 142.7e6, avgPrice: 85681, holdings: 847666 },
    ]);
  });

  it("reads sales, weeks without trades and skips the stock-sale tables", () => {
    const sold =
      "During Period August 3, 2026 to August 9, 2026 BTC Sold (1) Aggregate Sale Price (in millions) (2) Average Sale Price (2) " +
      "Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2) 1,690 $108.6 $64,262 840,447 $63.36 $75,385";
    expect(parseTrades(sold, filing)[0]).toMatchObject({ amount: -1690, usd: 108.6e6, avgPrice: 64262, holdings: 840447 });
    const quiet =
      "During Period August 10, 2026 to August 16, 2026 BTC Purchased / (Sold) (1) Aggregate Purchase / (Sale) Price (in millions) (2) " +
      "Average Purchase / (Sale) Price (2) Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2) - $ - $ - 840,447 $ 63.36 $ 75,385";
    expect(parseTrades(quiet, filing)).toEqual([]);
    const atm = "During Period June 30, 2025 to July 6, 2025 As of July 6, 2025 ATM Program Summary Shares Sold Notional Value 1,000 $ 18,111.0";
    expect(parseTrades(atm, filing)).toEqual([]);
  });

  it("reads the earlier prose", () => {
    const text =
      'On November 18, 2024, MicroStrategy Incorporated (the "Company") announced that, during the period between November 11, 2024 and ' +
      "November 17, 2024, the Company acquired approximately 51,780 bitcoins for approximately $4.6 billion in cash, at an average price of " +
      "approximately $ 88,627 per bitcoin, inclusive of fees and expenses. As of November 17, 2024, the Company, together with its subsidiaries, " +
      "held an aggregate of approximately 331,200 bitcoins, which were acquired at an aggregate purchase price of approximately $16.5 billion.";
    expect(parseTrades(text, filing)).toEqual([
      { ...base, asset: "BTC", from: day("November 11, 2024"), time: day("November 17, 2024"), amount: 51780, usd: 4.6e9, avgPrice: 88627, holdings: 331200 },
    ]);
  });

  it("keeps one trade per period and cuts quarter-to-date figures down to the uncovered days", () => {
    const t = (from: string | undefined, to: string, amount: number, usd: number): TreasuryTrade => ({
      ...base,
      from: from ? day(from) : undefined,
      time: day(to),
      amount,
      usd,
      avgPrice: null,
      holdings: null,
    });
    const out = consolidate([
      t("July 1, 2021", "August 23, 2021", 3907, 177e6),
      t("July 1, 2021", "September 12, 2021", 8957, 420e6),
      t("July 1, 2021", "September 12, 2021", 8957, 420e6), // repeated in a later filing
    ]);
    expect(out.map((x) => [x.amount, x.usd, x.from])).toEqual([
      [3907, 177e6, day("July 1, 2021")],
      [5050, 243e6, day("August 24, 2021")],
    ]);
    // A quarter's summary of weeks already reported is dropped.
    const weeks = consolidate([t("January 6, 2025", "January 12, 2025", 100, 1e7), t("January 1, 2025", "March 31, 2025", 80715, 8e9), t("January 13, 2025", "January 19, 2025", 50, 5e6)]);
    expect(weeks.map((x) => x.amount)).toEqual([100, 50]);
  });
});

describe("trades from weekly holdings reports", () => {
  it("reads BitMine's holdings, with or without a year, and takes the weekly changes", () => {
    const a = parseHolding("As of January 19th at 5:00pm ET, the Company's crypto holdings are comprised of 4,203,036 ETH at $3,211 per ETH", "ETH", "2026-01-20");
    const b = parseHolding("As of December 28th at 4:00pm ET, the Company's crypto holdings are comprised of 4,110,525 ETH", "ETH", "2026-01-02");
    const c = parseHolding("As of January 25, 2026 at 3:00pm ET, the Company's crypto holdings are comprised of 5, 815,164 ETH", "ETH", "2026-01-26");
    expect(a).toEqual({ asset: "ETH", time: day("January 19, 2026"), amount: 4_203_036 });
    expect(b!.time).toBe(day("December 28, 2025"));
    expect(c!.amount).toBe(5_815_164);
    expect(parseHolding("As of January 19th, it held 193 Bitcoin (BTC)", "ETH", "2026-01-20")).toBeUndefined();
    const trades = holdingChanges("BitMine", "BMNR", [
      { ...b!, url: "b" },
      { ...a!, url: "a" },
      { ...a!, time: a!.time + 3_600, amount: a!.amount + 300, url: "a2" }, // rounding, not a trade
    ]);
    expect(trades.map((t) => [t.amount, t.from, t.time, t.holdings])).toEqual([[92_511, day("December 29, 2025"), day("January 19, 2026"), 4_203_036]]);
  });
});

describe("whale transfers", () => {
  it("leaves out change paid back to the sending addresses", () => {
    const tx = {
      vin: [{ prevout: { scriptpubkey_address: "bc1from" } }],
      vout: [
        { scriptpubkey_address: "bc1to", value: 1_200e8 },
        { scriptpubkey_address: "bc1from", value: 800e8 },
      ],
    };
    expect(movedBtc(tx)).toBe(1200);
  });
});
