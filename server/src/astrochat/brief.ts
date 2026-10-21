// The data the Astro chat hands Claude, gathered by code before it's asked (Crypto-Analis' first
// principle: a model asked to fetch its own data sometimes doesn't): the markets now, the quant
// forecasts, and the news the app has kept that the question touches. Each part is best effort:
// one that fails says so instead of holding up the answer.

import { cached } from "../cache.js";
import { headlines, keywords } from "../providers/socialfeed.js";
import * as tradingview from "../providers/tradingview.js";
import { forecasts } from "../quant/service.js";

const MARKETS: Array<{ label: string; ticker: string; unit: "%" | "bp"; digits: number }> = [
  { label: "Emas (XAU/USD)", ticker: "OANDA:XAUUSD", unit: "%", digits: 2 },
  { label: "Bitcoin", ticker: "BITSTAMP:BTCUSD", unit: "%", digits: 0 },
  { label: "Ethereum", ticker: "BITSTAMP:ETHUSD", unit: "%", digits: 2 },
  { label: "Indeks dolar (DXY)", ticker: "TVC:DXY", unit: "%", digits: 2 },
  { label: "S&P 500", ticker: "SP:SPX", unit: "%", digits: 2 },
  { label: "Minyak WTI", ticker: "NYMEX:CL1!", unit: "%", digits: 2 },
  { label: "Yield US 10Y", ticker: "TVC:US10Y", unit: "bp", digits: 3 },
  { label: "EUR/USD", ticker: "FX:EURUSD", unit: "%", digits: 4 },
  { label: "USD/JPY", ticker: "FX:USDJPY", unit: "%", digits: 3 },
];

const signed = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

async function snapshot(): Promise<string> {
  const quotes = await cached("astrochat:snapshot", 60_000, () => tradingview.batchQuotes(MARKETS.map((m) => m.ticker), (s) => [s]));
  const lines = MARKETS.map((m) => {
    const q = quotes.get(m.ticker);
    if (!q || q.price === null) return `• ${m.label}: tidak tersedia`;
    return `• ${m.label}: ${q.price.toFixed(m.digits)} (hari ini ${signed(q.changePercent)}, 1 minggu ${signed(q.changeWeek)}, 1 bulan ${signed(q.changeMonth)}; tertinggi 52 minggu ${q.week52High ?? "n/a"}, terendah ${q.week52Low ?? "n/a"})`;
  });
  return `## Pasar saat ini (TradingView)\n${lines.join("\n")}`;
}

const QUANT_LABEL: Record<string, string> = { xau: "Emas", btc: "Bitcoin", eth: "Ethereum", dxy: "DXY", spx: "S&P 500", ndx: "Nasdaq 100", oil: "Minyak", eurusd: "EUR/USD", usdjpy: "USD/JPY", us10y: "Yield 10Y" };
const QUANT_WORDS: Array<[string, RegExp]> = [
  ["xau", /\b(emas|gold|xau)/i],
  ["btc", /\b(btc|bitcoin|kripto|crypto)/i],
  ["eth", /\b(eth|ethereum)/i],
  ["dxy", /\b(dxy|dolar|dollar)/i],
  ["spx", /\b(s&p|spx|saham|stock)/i],
  ["ndx", /\b(nasdaq|ndx|teknologi)/i],
  ["oil", /\b(minyak|oil|wti)/i],
  ["eurusd", /\b(eur|euro)/i],
  ["usdjpy", /\b(jpy|yen)/i],
  ["us10y", /\b(yield|obligasi|bond|treasury)/i],
];

async function quant(question: string): Promise<string> {
  const r = await forecasts();
  const asked = QUANT_WORDS.filter(([, re]) => re.test(question)).map(([k]) => k);
  const keys = asked.length ? asked : ["xau", "btc", "dxy"];
  const lines = r.assets
    .filter((a) => keys.includes(a.key))
    .map((a) => {
      const h = a.horizons;
      const s = h[10].score;
      return `• ${QUANT_LABEL[a.key] ?? a.key}: peluang naik 5/10/20 hari ${(h[5].pUp * 100).toFixed(0)}% / ${(h[10].pUp * 100).toFixed(0)}% / ${(h[20].pUp * 100).toFixed(0)}% (biasanya ${(h[10].baseRate * 100).toFixed(0)}%); vonis 10 hari ${h[10].verdict}; rentang wajar 10 hari ${h[10].band.p10.toFixed(1)}…${h[10].band.p90.toFixed(1)}${a.unit === "bp" ? " bp" : "%"}; rekam jejak walk-forward akurasi ${(s.acc * 100).toFixed(1)}% vs tebakan dasar ${(s.baseAcc * 100).toFixed(1)}% (${s.proven ? "terbukti" : "tidak terbukti"}); pendorong: ${h[10].drivers.slice(0, 3).map((d) => d.name).join(", ")}`;
    });
  return `## Prakiraan quant (data sampai ${new Date(r.asOfDay * 86_400_000).toISOString().slice(0, 10)}, musim ${r.season})\n${lines.join("\n")}`;
}

/** The archive's headlines of the last three days that share the question's rarer words. */
function news(question: string): string {
  const words = keywords(question);
  if (words.size === 0) return "";
  const list = headlines(Date.now() - 3 * 86_400_000);
  const df = new Map<string, number>();
  for (const h of list) for (const w of h.words) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = list
    .map((h) => {
      let score = 0;
      for (const w of words) if (h.words.has(w)) score += Math.log((list.length + 1) / ((df.get(w) ?? 0) + 1));
      return { h, score };
    })
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || b.h.time - a.h.time);
  const seen = new Set<string>();
  const top = scored.filter((x) => !seen.has(x.h.title.toLowerCase()) && seen.add(x.h.title.toLowerCase())).slice(0, 8);
  if (!top.length) return "## Berita terkait (arsip aplikasi, 3 hari)\nTidak ada judul berita yang cocok dengan pertanyaan.";
  return `## Berita terkait (arsip aplikasi, 3 hari terakhir)\n${top.map((x) => `• ${new Date(x.h.time).toISOString().slice(0, 16).replace("T", " ")} UTC · ${x.h.publisher}: ${x.h.title}`).join("\n")}`;
}

/** A part, or a line saying why not: at most PART_MS (the forecasts' first run takes a minute or so). */
const PART_MS = 8_000;
const settle = async (label: string, f: () => Promise<string> | string): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("belum siap, sedang dihitung")), PART_MS)));
    return await Promise.race([Promise.resolve().then(f), late]);
  } catch (err) {
    return `## ${label}\ntidak tersedia (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timer);
  }
};

/** Everything the code gathers for a question, as text, with the client's own (the offline answer and the calendar). */
export async function gather(question: string, client: string): Promise<string> {
  const now = new Date();
  const parts = await Promise.all([settle("Pasar saat ini", snapshot), settle("Prakiraan quant", () => quant(question)), settle("Berita terkait", () => news(question))]);
  return [
    `Waktu sekarang: ${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB (${now.toISOString()}).`,
    ...parts,
    client ? `## Hitungan Astro Calendar (jawaban offline aplikasi untuk pertanyaan ini: posisi planet, uji dampak, data historis)\n${client}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
