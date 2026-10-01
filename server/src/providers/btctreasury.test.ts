import { describe, expect, it } from "vitest";
import { consolidate, filingText, parseTrades, type TreasuryTrade } from "./btctreasury.js";
import { movedBtc } from "./whales.js";

const base = { company: "Strategy", ticker: "MSTR", url: "x" };
const day = (d: string) => Date.parse(`${d} UTC`) / 1000;

describe("company bitcoin trades from 8-K filings", () => {
  it("reads the weekly BTC Update table", () => {
    const html =
      "<p>BTC Update</p><p>During Period September 21, 2026 to September 27, 2026</p><p>As of September 27, 2026</p>" +
      "<td>BTC Purchased (1)</td><td>Aggregate Purchase Price (in millions) (2)</td><td>Average Purchase Price (2)</td>" +
      "<td>Aggregate BTC Holdings</td><td>Aggregate Purchase Price (in billions) (2)</td><td>Average Purchase Price (2)</td>" +
      "<td>1,665</td><td>$&#160;142.7</td><td>$&#160;85,681</td><td>847,666</td><td>$&#160;63.95</td><td>$&#160;75,437</td><p>(1) The bitcoin purchases…</p>";
    expect(parseTrades(filingText(html), base)).toEqual([
      { ...base, from: day("September 21, 2026"), time: day("September 27, 2026"), btc: 1665, usd: 142.7e6, avgPrice: 85681, holdings: 847666 },
    ]);
  });

  it("reads sales, weeks without trades and skips the stock-sale tables", () => {
    const sold =
      "During Period August 3, 2026 to August 9, 2026 BTC Sold (1) Aggregate Sale Price (in millions) (2) Average Sale Price (2) " +
      "Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2) 1,690 $108.6 $64,262 840,447 $63.36 $75,385";
    expect(parseTrades(sold, base)[0]).toMatchObject({ btc: -1690, usd: 108.6e6, avgPrice: 64262, holdings: 840447 });
    const quiet =
      "During Period August 10, 2026 to August 16, 2026 BTC Purchased / (Sold) (1) Aggregate Purchase / (Sale) Price (in millions) (2) " +
      "Average Purchase / (Sale) Price (2) Aggregate BTC Holdings Aggregate Purchase Price (in billions) (2) Average Purchase Price (2) - $ - $ - 840,447 $ 63.36 $ 75,385";
    expect(parseTrades(quiet, base)).toEqual([]);
    const atm = "During Period June 30, 2025 to July 6, 2025 As of July 6, 2025 ATM Program Summary Shares Sold Notional Value 1,000 $ 18,111.0";
    expect(parseTrades(atm, base)).toEqual([]);
  });

  it("reads the earlier prose", () => {
    const text =
      'On November 18, 2024, MicroStrategy Incorporated (the "Company") announced that, during the period between November 11, 2024 and ' +
      "November 17, 2024, the Company acquired approximately 51,780 bitcoins for approximately $4.6 billion in cash, at an average price of " +
      "approximately $ 88,627 per bitcoin, inclusive of fees and expenses. As of November 17, 2024, the Company, together with its subsidiaries, " +
      "held an aggregate of approximately 331,200 bitcoins, which were acquired at an aggregate purchase price of approximately $16.5 billion.";
    expect(parseTrades(text, base)).toEqual([
      { ...base, from: day("November 11, 2024"), time: day("November 17, 2024"), btc: 51780, usd: 4.6e9, avgPrice: 88627, holdings: 331200 },
    ]);
  });

  it("keeps one trade per period and cuts quarter-to-date figures down to the uncovered days", () => {
    const t = (from: string | undefined, to: string, btc: number, usd: number): TreasuryTrade => ({
      ...base,
      from: from ? day(from) : undefined,
      time: day(to),
      btc,
      usd,
      avgPrice: null,
      holdings: null,
    });
    const out = consolidate([
      t("July 1, 2021", "August 23, 2021", 3907, 177e6),
      t("July 1, 2021", "September 12, 2021", 8957, 420e6),
      t("July 1, 2021", "September 12, 2021", 8957, 420e6), // repeated in a later filing
    ]);
    expect(out.map((x) => [x.btc, x.usd, x.from])).toEqual([
      [3907, 177e6, day("July 1, 2021")],
      [5050, 243e6, day("August 24, 2021")],
    ]);
    // A quarter's summary of weeks already reported is dropped.
    const weeks = consolidate([t("January 6, 2025", "January 12, 2025", 100, 1e7), t("January 1, 2025", "March 31, 2025", 80715, 8e9), t("January 13, 2025", "January 19, 2025", 50, 5e6)]);
    expect(weeks.map((x) => x.btc)).toEqual([100, 50]);
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
