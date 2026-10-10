import { describe, expect, it } from "vitest";
import { nameOf, parseRichList } from "./addresslabels.js";
import { bigTrades, btcRow, insiderRow, isUsTicker } from "./transfers.js";
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
});
