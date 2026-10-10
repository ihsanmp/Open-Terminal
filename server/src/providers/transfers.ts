// The transactions behind an asset, each with who it went from and to, as an on-chain explorer's
// feed shows them:
//
//  - Bitcoin: transfers of 100 BTC or more on the chain (providers/whales.ts), the addresses named
//    where the rich list knows them (providers/addresslabels.ts: "Binance (cold wallet)"), valued
//    at the price of their hour.
//  - Another coin on Binance: its biggest trades there, buys and sells, collected while asked for.
//  - A US stock: its insiders' trades, from their SEC Form 4 filings.

import * as binance from "./binance.js";
import { btcLabels } from "./addresslabels.js";
import * as secedgar from "./secedgar.js";
import * as whales from "./whales.js";

export type Party = { name: string | null; address: string | null; role?: string | null };
export type TransferRow = {
  id: string;
  time: number;
  from: Party;
  to: Party;
  amount: number;
  unit: string;
  usd: number | null;
  side?: "buy" | "sell";
  price?: number | null;
  /** What kind of transaction (an insider's "Open market sale"). */
  note?: string;
  link?: string;
};
export type Transfers = { kind: "onchain" | "exchange" | "insider" | "none"; source: string; rows: TransferRow[]; note?: string };

// ---------------------------------------------------------------- bitcoin

/** A transfer's sides: the first sending address the rich list names (else the first), and its
 *  biggest receiver. */
export function btcRow(w: whales.Whale, labels: Record<string, string>, priceAt: (t: number) => number | null): TransferRow {
  const from = w.from ?? [];
  const sender = from.find((a) => labels[a]) ?? from[0] ?? null;
  const receiver = w.to?.[0]?.address ?? null;
  const price = priceAt(w.time);
  return {
    id: w.txid,
    time: w.time,
    from: { name: sender ? labels[sender] ?? null : null, address: sender },
    to: { name: receiver ? labels[receiver] ?? null : null, address: receiver },
    amount: w.btc,
    unit: "BTC",
    usd: price === null ? null : w.btc * price,
    link: `https://mempool.space/tx/${w.txid}`,
  };
}

/** Senders and receivers looked up for transfers stored before they were kept. */
const parties = new Map<string, { from: string[]; to: Array<{ address: string; btc: number }> }>();

let hourly: { at: number; bars: Array<{ time: number; close: number }> } | null = null;
async function btcPriceAt(): Promise<(t: number) => number | null> {
  if (!hourly || Date.now() - hourly.at > 10 * 60_000) {
    try {
      const bars = await binance.historyInterval("BTC", "1h", null, 2000);
      hourly = { at: Date.now(), bars: bars.map((b) => ({ time: b.time, close: b.close })) };
    } catch {
      hourly ??= { at: 0, bars: [] };
    }
  }
  const bars = hourly.bars;
  return (t) => {
    if (!bars.length) return null;
    // The hour it was in (or the oldest kept, for one older than that).
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return bars[lo].close;
  };
}

async function btcTransfers(limit = 80): Promise<Transfers> {
  const recent = whales.btcWhales().txs.slice(-limit).reverse();
  // Fill in who sent and received, a few at a time, for the ones stored without.
  const missing = recent.filter((w) => !w.from && !parties.has(w.txid)).slice(0, 30);
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(
      missing.slice(i, i + 4).map(async (w) => {
        try {
          parties.set(w.txid, await whales.txParties(w.txid));
        } catch {
          // shown without its addresses this time
        }
      })
    );
  }
  const labels = btcLabels();
  const priceAt = await btcPriceAt();
  return {
    kind: "onchain",
    source: "mempool.space · label: bitinfocharts",
    rows: recent.map((w) => btcRow(w.from ? w : { ...w, ...parties.get(w.txid) }, labels, priceAt)),
    note: "Transfer on-chain ≥ 100 BTC (kembalian ke pengirim tidak dihitung). Nama alamat dari daftar alamat terkaya bitinfocharts; yang tak dikenal ditampilkan alamatnya.",
  };
}

// ---------------------------------------------------------------- big trades on Binance

/** The trades worth keeping from a batch: the top 2% by value, and at least $10,000. */
export function bigTrades(trades: binance.AggTrade[]): binance.AggTrade[] {
  if (!trades.length) return [];
  const values = trades.map((t) => t.price * t.qty).sort((a, b) => a - b);
  const floor = Math.max(10_000, values[Math.floor(values.length * 0.98)] ?? 0);
  return trades.filter((t) => t.price * t.qty >= floor);
}

const KEEP_TRADES_S = 24 * 3600;
const buffers = new Map<string, binance.AggTrade[]>();

async function exchangeTransfers(base: string): Promise<Transfers> {
  const latest = await binance.aggTrades(base);
  const kept = buffers.get(base) ?? [];
  const seen = new Set(kept.map((t) => t.id));
  const now = Math.floor(Date.now() / 1000);
  const merged = [...kept, ...bigTrades(latest).filter((t) => !seen.has(t.id))].filter((t) => t.time > now - KEEP_TRADES_S).slice(-400);
  buffers.set(base, merged);
  return {
    kind: "exchange",
    source: "Binance spot",
    rows: [...merged].reverse().map((t) => {
      const side = t.buyerMaker ? "sell" : "buy";
      return {
        id: String(t.id),
        time: t.time,
        from: { name: side === "buy" ? "Pembeli" : "Penjual", address: null, role: "taker" },
        to: { name: "Binance", address: null, role: `${base}/USDT` },
        amount: t.qty,
        unit: base,
        usd: t.price * t.qty,
        side,
        price: t.price,
      };
    }),
    note: "Transaksi terbesar di Binance (2% teratas, minimal $10.000), terkumpul selama halaman ini terbuka. Beli/jual menurut pihak yang mengambil order (taker).",
  };
}

// ---------------------------------------------------------------- US insiders

const CODE_LABEL: Record<string, string> = {
  P: "Beli di pasar",
  S: "Jual di pasar",
  A: "Hibah/award",
  M: "Eksekusi opsi",
  G: "Hadiah",
  F: "Potong pajak",
  C: "Konversi",
  D: "Kembali ke emiten",
};

/** Where shares an insider let go of went, by its code (the company's own codes aside). */
const DISPOSED_TO: Record<string, string> = { S: "Pasar", G: "Penerima hadiah" };

export function insiderRow(t: secedgar.InsiderTransaction, symbol: string, i: number): TransferRow {
  const side = t.transactionCode === "P" ? "buy" : t.transactionCode === "S" || t.acquiredDisposed === "D" ? "sell" : t.acquiredDisposed === "A" ? "buy" : undefined;
  const role = t.ownerTitle ?? (t.isDirector ? "Director" : t.isTenPercentOwner ? "10% owner" : t.isOfficer ? "Officer" : null);
  const insider = { name: t.ownerName, address: null, role };
  const company = { name: symbol, address: null };
  return {
    id: `${t.transactionDate}-${t.ownerName}-${i}`,
    time: Math.floor(Date.parse(t.transactionDate) / 1000),
    // Shares sold go from the insider (to the market, the company for tax or back, or whoever got
    // a gift); shares bought or granted come to them.
    from: side === "sell" ? insider : company,
    to: side === "sell" ? { name: DISPOSED_TO[t.transactionCode] ?? (t.transactionCode === "F" || t.transactionCode === "D" ? symbol : "Pasar"), address: null } : insider,
    amount: t.shares ?? 0,
    unit: "saham",
    usd: t.value,
    side,
    price: t.pricePerShare,
    note: CODE_LABEL[t.transactionCode] ?? t.transactionCode,
  };
}

async function insiderTransfers(symbol: string): Promise<Transfers> {
  const list = await secedgar.insiderTransactions(symbol);
  return {
    kind: "insider",
    source: "SEC EDGAR (Form 4)",
    rows: list.map((t, i) => insiderRow(t, symbol, i)).sort((a, b) => b.time - a.time),
    note: "Transaksi orang dalam (direksi, komisaris, pemegang ≥10%) yang dilaporkan ke SEC lewat Form 4.",
  };
}

// ---------------------------------------------------------------- the asset's

/** A US-listed stock or ETF: a bare ticker (no exchange suffix, index or FX mark). */
export const isUsTicker = (symbol: string) => /^[A-Z][A-Z.]{0,5}$/.test(symbol) && !/\.[A-Z]{1,3}$/.test(symbol.replace(/^BRK\.|^BF\./, ""));

export async function transfersOf(symbol: string, base: string | null, onBinance: (base: string) => Promise<boolean>): Promise<Transfers> {
  if (base === "BTC") return btcTransfers();
  if (base && (await onBinance(base))) return exchangeTransfers(base);
  if (!base && isUsTicker(symbol)) return insiderTransfers(symbol);
  return {
    kind: "none",
    source: "",
    rows: [],
    note: base
      ? "Koin ini tidak diperdagangkan di Binance, jadi riwayat transaksinya belum tersedia."
      : "Riwayat transaksi tersedia untuk Bitcoin (on-chain), koin di Binance, dan saham AS (insider). Data transaksi per saham bursa lain (misalnya IDX) tidak tersedia gratis.",
  };
}
