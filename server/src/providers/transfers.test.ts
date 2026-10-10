import { describe, expect, it } from "vitest";
import { nameOf, parseRichList } from "./addresslabels.js";
import { amountOf, mergeFlows, parseFarside } from "./etfflows.js";
import { bigTrades, btcRow, etfRow, insiderRow, isUsTicker, treasuryRow } from "./transfers.js";
import { partiesOf } from "./whales.js";

describe("transaction history", () => {
  it("reads the rich list's wallet names", () => {
    expect(nameOf("Binance-coldwallet")).toBe("Binance (cold wallet)");
    expect(nameOf("UK-Gov-Confiscated")).toBe("UK Gov Confiscated");
    expect(nameOf("Binance-wallet")).toBe("Binance");
    expect(nameOf("967")).toBeNull();
    const html = `<tr><td>1</td><td><a href="https://bitinfocharts.com/bitcoin/address/34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo">34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo</a><br><small><a href="/bitcoin/wallet/Binance-coldwallet">wallet: Binance-coldwallet</a></small></td></tr>
<tr><td>2</td><td><a href="https://bitinfocharts.com/bitcoin/address/bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt">bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt</a></td></tr>
<tr><td>3</td><td><a href="https://bitinfocharts.com/bitcoin/address/3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb">3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb</a><br><small><a href="/bitcoin/wallet/967">wallet: 967</a></small></td></tr>`;
    expect(parseRichList(html)).toEqual({ "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo": "Binance (cold wallet)" });
  });

  it("finds who sent a transfer and where it went, change left out", () => {
    const tx = {
      vin: [{ prevout: { scriptpubkey_address: "A" } }, { prevout: { scriptpubkey_address: "B" } }, { prevout: { scriptpubkey_address: "A" } }],
      vout: [
        { scriptpubkey_address: "X", value: 100e8 },
        { scriptpubkey_address: "A", value: 50e8 }, // change
        { scriptpubkey_address: "Y", value: 300e8 },
        { scriptpubkey_address: "X", value: 20e8 },
      ],
    };
    expect(partiesOf(tx)).toEqual({ from: ["A", "B"], to: [{ address: "Y", btc: 300 }, { address: "X", btc: 120 }] });
  });

  it("names a transfer's sides and values it at its hour's price", () => {
    const labels = { B: "Coinbase Prime", Y: "BlackRock IBIT" };
    const row = btcRow({ txid: "t1", time: 1000, height: 1, btc: 300, from: ["A", "B"], to: [{ address: "Y", btc: 300 }] }, labels, () => 83_000);
    expect(row).toMatchObject({ from: { name: "Coinbase Prime", address: "B" }, to: { name: "BlackRock IBIT", address: "Y" }, amount: 300, unit: "BTC", usd: 24_900_000 });
    expect(row.link).toBe("https://mempool.space/tx/t1");
    const bare = btcRow({ txid: "t2", time: 1000, height: 1, btc: 150 }, labels, () => null);
    expect(bare).toMatchObject({ from: { name: null, address: null }, to: { name: null, address: null }, usd: null });
  });

  it("keeps a batch's biggest trades", () => {
    const trades = Array.from({ length: 100 }, (_, i) => ({ id: i, time: i, price: 100, qty: i === 99 ? 500 : 1, buyerMaker: false }));
    expect(bigTrades(trades).map((t) => t.id)).toEqual([99]); // $50,000; the rest are $100
    expect(bigTrades(trades.slice(0, 50))).toEqual([]); // nothing reaches $10,000
  });

  it("reads an insider's trade", () => {
    const sale = insiderRow(
      { filingDate: "2026-10-02", transactionDate: "2026-10-01", ownerName: "Jane Doe", ownerTitle: "CFO", isDirector: false, isOfficer: true, isTenPercentOwner: false, transactionCode: "S", acquiredDisposed: "D", shares: 1000, pricePerShare: 200, value: 200_000, sharesOwnedAfter: 5000 },
      "AAPL",
      0
    );
    expect(sale).toMatchObject({ side: "sell", from: { name: "Jane Doe", role: "CFO" }, to: { name: "Pasar" }, amount: 1000, usd: 200_000, note: "Jual di pasar" });
    const base = { filingDate: "2026-10-02", transactionDate: "2026-10-01", ownerName: "Jane Doe", ownerTitle: null, isDirector: true, isOfficer: false, isTenPercentOwner: false, acquiredDisposed: "D" as const, shares: 10, pricePerShare: 0, value: 0, sharesOwnedAfter: 0 };
    expect(insiderRow({ ...base, transactionCode: "G" }, "AAPL", 1).to.name).toBe("Penerima hadiah");
    expect(insiderRow({ ...base, transactionCode: "F" }, "AAPL", 2).to.name).toBe("AAPL");
    expect(insiderRow({ ...base, transactionCode: "M", acquiredDisposed: "A" }, "AAPL", 3)).toMatchObject({ side: "buy", from: { name: "AAPL" }, to: { name: "Jane Doe", role: "Director" } });
    expect(isUsTicker("AAPL")).toBe(true);
    expect(isUsTicker("BRK.B")).toBe(true);
    expect(isUsTicker("BBCA.JK")).toBe(false);
    expect(isUsTicker("^GSPC")).toBe(false);
    expect(isUsTicker("EURUSD=X")).toBe(false);
  });
  it("reads Farside's ETF flows", () => {
    expect(amountOf("(207.7)")).toBe(-207.7);
    expect(amountOf("1,119.9")).toBe(1119.9);
    expect(amountOf("-")).toBeNull();
    const html = `<table><tr><th></th><th>IBIT</th><th>FBTC</th><th>XYZ</th><th>Total</th></tr>
<tr><td>Fee</td><td>0.25%</td><td>0.25%</td><td>0.9%</td><td></td></tr>
<tr><td>07 Oct 2026</td><td>(207.7)</td><td>0.0</td><td>5.0</td><td>(202.7)</td></tr>
<tr><td>8 Oct 2026</td><td><span>22.4</span></td><td>-</td><td>0.0</td><td>22.4</td></tr>
<tr><td>Total</td><td>65,733</td><td>10,525</td><td>1</td><td>76,259</td></tr></table>`;
    expect(parseFarside(html)).toEqual([
      { ticker: "IBIT", issuer: "BlackRock", date: "2026-10-07", usdMillions: -207.7 },
      { ticker: "XYZ", issuer: "XYZ", date: "2026-10-07", usdMillions: 5 },
      { ticker: "IBIT", issuer: "BlackRock", date: "2026-10-08", usdMillions: 22.4 },
    ]);
  });

  it("keeps the ETF days the page no longer shows", () => {
    const f = (date: string, v: number) => ({ ticker: "IBIT", issuer: "BlackRock", date, usdMillions: v });
    expect(mergeFlows([f("2026-09-01", 1)], [f("2026-10-01", 2)]).map((x) => x.date)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(mergeFlows([f("2024-01-01", 1)], [f("2026-10-01", 2)], 400).map((x) => x.date)).toEqual(["2026-10-01"]);
  });

  it("shows an institution's buy coming from the market and its sale going to it", () => {
    const inflow = etfRow({ ticker: "IBIT", issuer: "BlackRock", date: "2026-10-09", usdMillions: 83 }, "BTC", () => 83_000);
    expect(inflow).toMatchObject({ category: "institution", from: { name: "Pasar" }, to: { name: "BlackRock IBIT", tag: "etf" }, amount: 1000, usd: 83_000_000, side: "buy" });
    expect(inflow.time).toBe(Date.UTC(2026, 9, 9, 21) / 1000);
    const outflow = etfRow({ ticker: "GBTC", issuer: "Grayscale", date: "2026-10-09", usdMillions: -41.5 }, "BTC", () => 83_000);
    expect(outflow).toMatchObject({ from: { name: "Grayscale GBTC" }, to: { name: "Pasar" }, amount: 500, side: "sell", note: "ETF outflow" });
    const strategy = treasuryRow({ company: "Strategy", ticker: "MSTR", asset: "BTC", time: 1_790_000_000, amount: 1200, usd: 99_600_000, avgPrice: 83_000, holdings: 850_000, url: "https://www.sec.gov/x" });
    expect(strategy).toMatchObject({ from: { name: "Pasar" }, to: { name: "Strategy", role: "MSTR", tag: "treasury" }, amount: 1200, side: "buy", link: "https://www.sec.gov/x" });
    const sale = treasuryRow({ company: "MARA", ticker: "MARA", asset: "BTC", time: 1_790_000_000, amount: -50, usd: null, avgPrice: null, holdings: null, url: "u" });
    expect(sale).toMatchObject({ from: { name: "MARA", tag: "treasury" }, to: { name: "Pasar" }, amount: 50, side: "sell" });
  });
});
