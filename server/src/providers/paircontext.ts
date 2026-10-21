// The pair open on the chart, read for the desk's tools: what kind of market it is, its
// currencies and country, and which row of each tool belongs to it — the macro regime's asset
// (or the nearest proxy: a US tech stock is read through the tech sector ETF), its futures curve,
// its COT market, its quant forecast, the safe-haven gauge it moves with, the ETFs that hold it,
// and the words that name it in the news. With it, a brief of all of that for the pair.

import { cached } from "../cache.js";
import { cryptoBase, isTvPair } from "../symbols.js";
import { tvCandidates } from "../tvhistory.js";
import * as cot from "./cot.js";
import * as curves from "./curves.js";
import * as econcalendar from "./econcalendar.js";
import * as etfboard from "./etfboard.js";
import * as geopolitics from "./geopolitics.js";
import * as regime from "./regime.js";
import * as tradingview from "./tradingview.js";
import * as watcherguru from "./watcherguru.js";
import { forecasts } from "../quant/service.js";

export type PairKind = "crypto" | "fx" | "metal" | "energy" | "agri" | "index" | "stock" | "etf" | "rate" | "volatility" | "dollar" | "other";
export type GeoKey = "gold" | "oil" | "dxy" | "us10y" | "spx" | "btc" | "vix";

export type PairContext = {
  symbol: string;
  label: string;
  kind: PairKind;
  /** The currencies it's priced in or made of (EURUSD: EUR, USD). */
  currencies: string[];
  /** The economy whose releases matter most to it (calendar country code: US, EU, JP, ID …). */
  country: string | null;
  sector: string | null;
  regimeKey: string | null;
  /** True when the regime's row is a stand-in (a sector, an index, bitcoin for other coins). */
  regimeProxy: boolean;
  curveId: string | null;
  cotId: string | null;
  quantKey: string | null;
  /** The safe-haven gauge it moves with; −1 when it moves against it (EURUSD against the dollar). */
  geo: { key: GeoKey; sign: 1 | -1 } | null;
  /** ETFs that hold it or track it (to mark on the ETF board). */
  etfs: string[];
  /** Words that name it in headlines (lower case). */
  keywords: string[];
};

const CURRENCY_COUNTRY: Record<string, string> = { USD: "US", EUR: "EU", JPY: "JP", GBP: "GB", AUD: "AU", CAD: "CA", CHF: "CH", NZD: "NZ", CNY: "CN", CNH: "CN", IDR: "ID", SGD: "SG", HKD: "HK", KRW: "KR", INR: "IN", MXN: "MX" };
const CURRENCY_WORDS: Record<string, string[]> = {
  USD: ["dollar", "fed", "fomc", "powell"], EUR: ["euro", "ecb", "lagarde", "eurozone"], JPY: ["yen", "boj", "japan"], GBP: ["pound", "sterling", "boe", "britain", "uk"],
  AUD: ["aussie", "rba", "australia"], CAD: ["loonie", "canada", "boc"], CHF: ["franc", "snb", "swiss"], NZD: ["kiwi", "rbnz", "zealand"], CNY: ["yuan", "pboc", "china"], CNH: ["yuan", "pboc", "china"], IDR: ["rupiah", "indonesia", "bank indonesia"],
};
const FIAT = Object.keys(CURRENCY_COUNTRY);

/** A US sector (TradingView's names) as its SPDR sector ETF, and as the regime's row when it has one. */
const SECTOR_ETF: Record<string, string> = {
  "Electronic Technology": "XLK", "Technology Services": "XLK", Finance: "XLF", "Energy Minerals": "XLE", Utilities: "XLU",
  "Consumer Non-Durables": "XLP", "Health Technology": "XLV", "Health Services": "XLV", "Producer Manufacturing": "XLI", Industrial: "XLI",
  Transportation: "XLI", "Consumer Durables": "XLY", "Retail Trade": "XLY", "Consumer Services": "XLY", "Non-Energy Minerals": "XLB",
  "Process Industries": "XLB", Communications: "XLC", "Commercial Services": "XLI", "Distribution Services": "XLI", "Miscellaneous": "SPY",
};
const REGIME_ETFS = new Set(["XLK", "XLF", "XLE", "XLU", "XLP"]);

/** A listing's country from its Yahoo suffix (BBCA.JK → ID), with the country ETF to read it by. */
const SUFFIX: Record<string, { country: string; currency: string; etf: string }> = {
  JK: { country: "ID", currency: "IDR", etf: "EIDO" }, T: { country: "JP", currency: "JPY", etf: "EWJ" }, HK: { country: "HK", currency: "HKD", etf: "FXI" },
  SS: { country: "CN", currency: "CNY", etf: "FXI" }, SZ: { country: "CN", currency: "CNY", etf: "FXI" }, NS: { country: "IN", currency: "INR", etf: "INDA" },
  BO: { country: "IN", currency: "INR", etf: "INDA" }, KS: { country: "KR", currency: "KRW", etf: "EWY" }, TW: { country: "TW", currency: "TWD", etf: "EWT" },
  L: { country: "GB", currency: "GBP", etf: "EFA" }, DE: { country: "DE", currency: "EUR", etf: "EWG" }, F: { country: "DE", currency: "EUR", etf: "EWG" },
  PA: { country: "FR", currency: "EUR", etf: "EFA" }, SA: { country: "BR", currency: "BRL", etf: "EWZ" }, SI: { country: "SG", currency: "SGD", etf: "EFA" }, TO: { country: "CA", currency: "CAD", etf: "EFA" },
};

type Base = Omit<PairContext, "symbol" | "label" | "sector"> & { label?: string };
const base = (b: Partial<Base> & Pick<Base, "kind">): Base => ({
  currencies: ["USD"], country: "US", regimeKey: null, regimeProxy: false, curveId: null, cotId: null, quantKey: null, geo: null, etfs: [], keywords: [], ...b,
});

/** Known markets by their core code (whatever exchange prefix or suffix the app writes them with). */
const KNOWN: Record<string, Base> = {
  XAUUSD: base({ kind: "metal", label: "Emas", regimeKey: "gold", curveId: "gc", cotId: "gc", quantKey: "xau", geo: { key: "gold", sign: 1 }, etfs: ["GLD", "GDX"], keywords: ["gold", "xau", "bullion"] }),
  GC: base({ kind: "metal", label: "Emas (futures)", regimeKey: "gold", curveId: "gc", cotId: "gc", quantKey: "xau", geo: { key: "gold", sign: 1 }, etfs: ["GLD", "GDX"], keywords: ["gold", "bullion"] }),
  GOLD: base({ kind: "metal", label: "Emas", regimeKey: "gold", curveId: "gc", cotId: "gc", quantKey: "xau", geo: { key: "gold", sign: 1 }, etfs: ["GLD", "GDX"], keywords: ["gold", "bullion"] }),
  GLD: base({ kind: "etf", label: "Emas (GLD)", regimeKey: "gold", curveId: "gc", cotId: "gc", quantKey: "xau", geo: { key: "gold", sign: 1 }, etfs: ["GLD", "GDX"], keywords: ["gold"] }),
  XAGUSD: base({ kind: "metal", label: "Perak", regimeKey: "silver", curveId: "si", cotId: "si", geo: { key: "gold", sign: 1 }, etfs: ["SLV"], keywords: ["silver"] }),
  SI: base({ kind: "metal", label: "Perak (futures)", regimeKey: "silver", curveId: "si", cotId: "si", geo: { key: "gold", sign: 1 }, etfs: ["SLV"], keywords: ["silver"] }),
  SLV: base({ kind: "etf", label: "Perak (SLV)", regimeKey: "silver", curveId: "si", cotId: "si", etfs: ["SLV"], keywords: ["silver"] }),
  HG: base({ kind: "metal", label: "Tembaga", regimeKey: "copper", curveId: "hg", cotId: "hg", etfs: ["COPX"], keywords: ["copper"] }),
  XCUUSD: base({ kind: "metal", label: "Tembaga", regimeKey: "copper", curveId: "hg", cotId: "hg", etfs: ["COPX"], keywords: ["copper"] }),
  PL: base({ kind: "metal", label: "Platinum", regimeKey: "gold", regimeProxy: true, cotId: "pl", keywords: ["platinum"] }),
  XPTUSD: base({ kind: "metal", label: "Platinum", regimeKey: "gold", regimeProxy: true, cotId: "pl", keywords: ["platinum"] }),
  USOIL: base({ kind: "energy", label: "Minyak WTI", regimeKey: "oil", curveId: "cl", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO", "XLE"], keywords: ["oil", "crude", "wti", "opec"] }),
  WTI: base({ kind: "energy", label: "Minyak WTI", regimeKey: "oil", curveId: "cl", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO", "XLE"], keywords: ["oil", "crude", "wti", "opec"] }),
  CL: base({ kind: "energy", label: "Minyak WTI (futures)", regimeKey: "oil", curveId: "cl", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO", "XLE"], keywords: ["oil", "crude", "wti", "opec"] }),
  UKOIL: base({ kind: "energy", label: "Minyak Brent", regimeKey: "oil", curveId: "bz", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO", "XLE"], keywords: ["oil", "crude", "brent", "opec"] }),
  BZ: base({ kind: "energy", label: "Minyak Brent (futures)", regimeKey: "oil", curveId: "bz", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO", "XLE"], keywords: ["oil", "crude", "brent", "opec"] }),
  USO: base({ kind: "etf", label: "Minyak (USO)", regimeKey: "oil", curveId: "cl", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["USO"], keywords: ["oil", "crude"] }),
  NG: base({ kind: "energy", label: "Gas alam", regimeKey: "oil", regimeProxy: true, curveId: "ng", cotId: "ng", etfs: ["UNG"], keywords: ["natural gas", "lng"] }),
  NATGAS: base({ kind: "energy", label: "Gas alam", regimeKey: "oil", regimeProxy: true, curveId: "ng", cotId: "ng", etfs: ["UNG"], keywords: ["natural gas", "lng"] }),
  ZC: base({ kind: "agri", label: "Jagung", curveId: "zc", cotId: "zc", etfs: ["DBA"], keywords: ["corn", "grain"] }),
  ZS: base({ kind: "agri", label: "Kedelai", curveId: "zs", cotId: "zs", etfs: ["DBA"], keywords: ["soybean", "soy"] }),
  ZW: base({ kind: "agri", label: "Gandum", curveId: "zw", cotId: "zw", etfs: ["DBA"], keywords: ["wheat", "grain"] }),
  KC: base({ kind: "agri", label: "Kopi", curveId: "kc", cotId: "kc", etfs: ["DBA"], keywords: ["coffee"] }),
  CC: base({ kind: "agri", label: "Kakao", cotId: "cc", etfs: ["DBA"], keywords: ["cocoa"] }),
  SB: base({ kind: "agri", label: "Gula", cotId: "sb", etfs: ["DBA"], keywords: ["sugar"] }),
  DXY: base({ kind: "dollar", label: "Indeks dolar", regimeKey: "dxy", cotId: "dx", quantKey: "dxy", geo: { key: "dxy", sign: 1 }, keywords: ["dollar", "fed", "fomc"] }),
  "DX-Y.NYB": base({ kind: "dollar", label: "Indeks dolar", regimeKey: "dxy", cotId: "dx", quantKey: "dxy", geo: { key: "dxy", sign: 1 }, keywords: ["dollar", "fed", "fomc"] }),
  DX: base({ kind: "dollar", label: "Indeks dolar (futures)", regimeKey: "dxy", cotId: "dx", quantKey: "dxy", geo: { key: "dxy", sign: 1 }, keywords: ["dollar", "fed"] }),
  "^GSPC": base({ kind: "index", label: "S&P 500", regimeKey: "spx", curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["SPY", "RSP"], keywords: ["s&p", "stocks", "wall street"] }),
  SPX: base({ kind: "index", label: "S&P 500", regimeKey: "spx", curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["SPY", "RSP"], keywords: ["s&p", "stocks", "wall street"] }),
  ES: base({ kind: "index", label: "S&P 500 (futures)", regimeKey: "spx", curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["SPY"], keywords: ["s&p", "stocks"] }),
  SPY: base({ kind: "etf", label: "S&P 500 (SPY)", regimeKey: "spx", curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["SPY", "RSP"], keywords: ["s&p", "stocks"] }),
  "^DJI": base({ kind: "index", label: "Dow Jones", regimeKey: "spx", regimeProxy: true, curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["DIA"], keywords: ["dow", "stocks"] }),
  "^NDX": base({ kind: "index", label: "Nasdaq 100", regimeKey: "ndx", curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["QQQ", "SMH"], keywords: ["nasdaq", "tech"] }),
  "^IXIC": base({ kind: "index", label: "Nasdaq Composite", regimeKey: "ndx", regimeProxy: true, curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["QQQ"], keywords: ["nasdaq", "tech"] }),
  NDX: base({ kind: "index", label: "Nasdaq 100", regimeKey: "ndx", curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["QQQ"], keywords: ["nasdaq", "tech"] }),
  NQ: base({ kind: "index", label: "Nasdaq 100 (futures)", regimeKey: "ndx", curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["QQQ"], keywords: ["nasdaq", "tech"] }),
  QQQ: base({ kind: "etf", label: "Nasdaq 100 (QQQ)", regimeKey: "ndx", curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["QQQ"], keywords: ["nasdaq", "tech"] }),
  "^RUT": base({ kind: "index", label: "Russell 2000", regimeKey: "rut", curveId: "es", cotId: "rty", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["IWM"], keywords: ["russell", "small cap"] }),
  RTY: base({ kind: "index", label: "Russell 2000 (futures)", regimeKey: "rut", cotId: "rty", geo: { key: "spx", sign: 1 }, etfs: ["IWM"], keywords: ["russell", "small cap"] }),
  IWM: base({ kind: "etf", label: "Russell 2000 (IWM)", regimeKey: "rut", cotId: "rty", geo: { key: "spx", sign: 1 }, etfs: ["IWM"], keywords: ["russell", "small cap"] }),
  "^VIX": base({ kind: "volatility", label: "VIX", curveId: "vx", cotId: "vx", geo: { key: "vix", sign: 1 }, keywords: ["vix", "volatility"] }),
  VIX: base({ kind: "volatility", label: "VIX", curveId: "vx", cotId: "vx", geo: { key: "vix", sign: 1 }, keywords: ["vix", "volatility"] }),
  VX: base({ kind: "volatility", label: "VIX (futures)", curveId: "vx", cotId: "vx", geo: { key: "vix", sign: 1 }, keywords: ["vix", "volatility"] }),
  US10Y: base({ kind: "rate", label: "Yield AS 10 tahun", regimeKey: "tlt", regimeProxy: true, curveId: "zn", cotId: "zn", quantKey: "us10y", geo: { key: "us10y", sign: 1 }, etfs: ["TLT", "IEF"], keywords: ["treasury", "yield", "bond", "fed"] }),
  "^TNX": base({ kind: "rate", label: "Yield AS 10 tahun", regimeKey: "tlt", regimeProxy: true, curveId: "zn", cotId: "zn", quantKey: "us10y", geo: { key: "us10y", sign: 1 }, etfs: ["TLT", "IEF"], keywords: ["treasury", "yield", "bond"] }),
  US02Y: base({ kind: "rate", label: "Yield AS 2 tahun", regimeKey: "tlt", regimeProxy: true, curveId: "sr3", cotId: "zt", quantKey: "us10y", geo: { key: "us10y", sign: 1 }, etfs: ["SHY"], keywords: ["treasury", "yield", "fed"] }),
  ZN: base({ kind: "rate", label: "Obligasi AS 10 tahun (futures)", regimeKey: "tlt", regimeProxy: true, curveId: "zn", cotId: "zn", quantKey: "us10y", geo: { key: "us10y", sign: -1 }, etfs: ["IEF", "TLT"], keywords: ["treasury", "bond"] }),
  TLT: base({ kind: "etf", label: "Obligasi AS 20 th+ (TLT)", regimeKey: "tlt", curveId: "zn", cotId: "zn", quantKey: "us10y", geo: { key: "us10y", sign: -1 }, etfs: ["TLT"], keywords: ["treasury", "bond"] }),
  "^JKSE": base({ kind: "index", label: "IHSG", currencies: ["IDR"], country: "ID", regimeKey: "eem", regimeProxy: true, etfs: ["EIDO"], keywords: ["indonesia", "ihsg", "jakarta"] }),
  "^N225": base({ kind: "index", label: "Nikkei 225", currencies: ["JPY"], country: "JP", regimeKey: "eem", regimeProxy: true, etfs: ["EWJ"], keywords: ["nikkei", "japan"] }),
  "^HSI": base({ kind: "index", label: "Hang Seng", currencies: ["HKD"], country: "HK", regimeKey: "eem", regimeProxy: true, etfs: ["FXI"], keywords: ["hang seng", "hong kong", "china"] }),
  EEM: base({ kind: "etf", label: "Pasar berkembang (EEM)", regimeKey: "eem", etfs: ["EEM"], keywords: ["emerging"] }),
  XLK: base({ kind: "etf", label: "Sektor teknologi (XLK)", regimeKey: "xlk", curveId: "nq", cotId: "nq", quantKey: "ndx", geo: { key: "spx", sign: 1 }, etfs: ["XLK"], keywords: ["tech"] }),
  XLF: base({ kind: "etf", label: "Sektor keuangan (XLF)", regimeKey: "xlf", curveId: "es", cotId: "es", quantKey: "spx", geo: { key: "spx", sign: 1 }, etfs: ["XLF", "KRE"], keywords: ["bank"] }),
  XLE: base({ kind: "etf", label: "Sektor energi (XLE)", regimeKey: "xle", curveId: "cl", cotId: "cl", quantKey: "oil", geo: { key: "oil", sign: 1 }, etfs: ["XLE"], keywords: ["oil", "energy"] }),
  XLU: base({ kind: "etf", label: "Utilitas (XLU)", regimeKey: "xlu", etfs: ["XLU"], keywords: ["utilities"] }),
  XLP: base({ kind: "etf", label: "Barang pokok (XLP)", regimeKey: "xlp", etfs: ["XLP"], keywords: ["consumer staples"] }),
};

const COIN: Record<string, Partial<Base>> = {
  BTC: { label: "Bitcoin", regimeKey: "btc", curveId: "btc", cotId: "btc", quantKey: "btc", etfs: ["IBIT", "FBTC", "GBTC", "MSTR"], keywords: ["bitcoin", "btc", "crypto"] },
  ETH: { label: "Ethereum", regimeKey: "btc", regimeProxy: true, curveId: "eth", cotId: "eth", quantKey: "eth", etfs: ["ETHA"], keywords: ["ethereum", "ether", "eth", "crypto"] },
};

/** The core code of a symbol as the app writes it: OANDA:XAUUSD → XAUUSD, GC=F → GC, BTC-USD → BTC (crypto), XAUUSD=X → XAUUSD, CL1! → CL. */
export function coreOf(symbol: string): { core: string; suffix: string | null; crypto: string | null } {
  const s = symbol.toUpperCase().trim();
  const crypto = cryptoBase(s) ?? (/^(BINANCE|BYBIT|OKX|COINBASE|BITSTAMP|KRAKEN|BITFINEX|MEXC|GATEIO|KUCOIN|BITGET|CRYPTO|CRYPTOCAP):([A-Z0-9]+?)(USDT|USDC|USD|BUSD|PERP)?(\.P)?$/.exec(s)?.[2] ?? null);
  let core = isTvPair(s) ? s.split(":")[1] : s;
  core = core.replace(/=F$/, "").replace(/=X$/, "").replace(/\d*!$/, "");
  // Futures contract months (CLZ2026, GCG27) as their root.
  const month = /^([A-Z]{1,3})[FGHJKMNQUVXZ]\d{2,4}$/.exec(core);
  if (month && isTvPair(s)) core = month[1];
  const suffix = /^[A-Z0-9-]+\.([A-Z]{1,2})$/.exec(core)?.[1] ?? null;
  return { core, suffix, crypto };
}

/** A company's name as headlines write it: "PT Bank Central Asia Tbk" → "bank central asia", "Apple Inc." → "apple". */
export function companyName(name: string): string | null {
  const n = name
    .toLowerCase()
    .replace(/[.,()]/g, " ")
    .replace(/^pt\s+/, "")
    .replace(/\s+(tbk|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|sa|ag|nv|se|class [a-z]|common stock|the)(\s|$)/g, " ")
    .replace(/\s+(tbk|inc|corp|ltd|plc|holdings?|group|co)(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n.length >= 4 ? n : null;
}

/** What the pair is and where it belongs in each tool, from its symbol alone (the stock's sector comes from a lookup). */
export function classify(symbol: string, sector: string | null = null, name: string | null = null): PairContext {
  const { core, suffix, crypto } = coreOf(symbol);
  const out = (b: Base, label: string): PairContext => ({ ...b, symbol, label: b.label ?? label, sector });

  if (crypto && !KNOWN[core]) {
    const c = COIN[crypto] ?? { label: crypto, regimeKey: "btc", regimeProxy: true, keywords: [crypto.toLowerCase(), "crypto"] };
    return out(base({ kind: "crypto", geo: { key: "btc", sign: 1 }, ...c, keywords: [...new Set([...(c.keywords ?? []), crypto.toLowerCase()])] }), crypto);
  }
  if (KNOWN[core]) return out(KNOWN[core], core);

  // A currency pair: two known currencies, six letters.
  const fx = /^([A-Z]{3})([A-Z]{3})$/.exec(core);
  if (fx && FIAT.includes(fx[1]) && FIAT.includes(fx[2])) {
    const [b, q] = [fx[1], fx[2]];
    const other = b === "USD" ? q : b;
    const regimeKey = core === "EURUSD" ? "eurusd" : core === "USDJPY" ? "usdjpy" : "dxy";
    const curveId = b === "EUR" || q === "EUR" ? "6e" : b === "JPY" || q === "JPY" ? "6j" : null;
    const cotId = other === "EUR" ? "6e" : other === "JPY" ? "6j" : other === "GBP" ? "6b" : "dx";
    const usd = b === "USD" ? 1 : q === "USD" ? -1 : null;
    return out(
      base({
        kind: "fx",
        currencies: [b, q],
        country: CURRENCY_COUNTRY[other] ?? null,
        regimeKey,
        regimeProxy: regimeKey === "dxy",
        curveId,
        cotId,
        quantKey: core === "EURUSD" ? "eurusd" : core === "USDJPY" ? "usdjpy" : "dxy",
        geo: usd ? { key: "dxy", sign: usd as 1 | -1 } : null,
        keywords: [...new Set([...(CURRENCY_WORDS[b] ?? []), ...(CURRENCY_WORDS[q] ?? []), b.toLowerCase(), q.toLowerCase()])],
      }),
      `${b}/${q}`,
    );
  }

  // A stock: abroad by its suffix, in the US by its sector.
  const words = [core.replace(/\..*$/, "").toLowerCase(), ...(name ? [companyName(name)] : [])].filter((w): w is string => Boolean(w && w.length >= 2));
  if (suffix && SUFFIX[suffix]) {
    const f = SUFFIX[suffix];
    return out(base({ kind: "stock", currencies: [f.currency], country: f.country, regimeKey: "eem", regimeProxy: true, etfs: [f.etf], keywords: words }), name ?? core);
  }
  const etf = sector ? SECTOR_ETF[sector] ?? null : null;
  const regimeKey = etf && REGIME_ETFS.has(etf) ? etf.toLowerCase() : "spx";
  const tech = etf === "XLK" || etf === "XLC";
  return out(
    base({
      kind: "stock",
      regimeKey,
      regimeProxy: true,
      curveId: tech ? "nq" : "es",
      cotId: tech ? "nq" : "es",
      quantKey: tech ? "ndx" : "spx",
      geo: { key: "spx", sign: 1 },
      etfs: etf ? [etf] : ["SPY"],
      keywords: words,
    }),
    name ?? core,
  );
}

/** The pair's context, with a stock's sector and name looked up on TradingView; an hour in the cache. */
export function pairContext(symbol: string): Promise<PairContext> {
  const s = symbol.toUpperCase();
  return cached(`pair:ctx:${s}`, 3_600_000, async () => {
    const first = classify(s);
    if (first.kind !== "stock") return first;
    try {
      const tickers = tvCandidates(s);
      const rows = tickers.length ? await tradingview.scanAt("global", { symbols: { tickers }, columns: ["description", "sector"] }) : [];
      const row = tickers.map((t) => rows.find((r) => r.s === t)).find(Boolean);
      return classify(s, row?.d[1] ? String(row.d[1]) : null, row?.d[0] ? String(row.d[0]) : null);
    } catch {
      return first;
    }
  });
}

/** A part of the brief, or null if it fails or is slow (the rest still comes). */
async function part<T>(f: () => Promise<T>, ms = 10_000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([f(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a headline names the pair. */
export function mentions(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => (k.length <= 3 ? new RegExp(`(^|[^a-z0-9$])\\$?${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t) : t.includes(k)));
}

export type PairBrief = {
  context: PairContext;
  quote: { price: number | null; day: number | null; week: number | null; month: number | null } | null;
  regime: { quadrant: string; label: string; row: regime.AssetRow | null } | null;
  curve: curves.Curve | null;
  cot: Pick<cot.CotSeries, "id" | "label" | "names" | "latest" | "specChange" | "specPctOi" | "cotIndex" | "crowding"> | null;
  quant: { label: string; unit: string; horizons: Record<string, { pUp: number; baseRate: number; verdict: string; band: { p10: number; p50: number; p90: number }; proven: boolean }> } | null;
  events: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null }>;
  flashes: Array<{ id: number; text: string; time: number; url: string }>;
  geo: Array<{ id: string; label: string; week: number; heat: number | null; tone: string | null; direction: -1 | 0 | 1 }>;
  etfs: etfboard.EtfRow[];
  asOf: number;
};

/** Everything the desk knows about the pair, in one piece; half a minute in the cache. */
export function pairBrief(symbol: string, now = Date.now()): Promise<PairBrief> {
  const s = symbol.toUpperCase();
  return cached(`pair:brief:${s}`, 30_000, async () => {
    const context = await pairContext(s);
    // A pair written bare (EURUSD, XAUUSD) is quoted as the forex feeds write it.
    const core = coreOf(s).core;
    const tickers = [...tvCandidates(s), ...(/^[A-Z]{6}$/.test(core) && (context.kind === "fx" || context.kind === "metal") ? [`FX:${core}`, `OANDA:${core}`] : [])];
    const [quotes, reg, cotList, curveList, quant, events, flashes, geo, etfs] = await Promise.all([
      part(() => (tickers.length ? tradingview.batchQuotes([s], () => tickers) : Promise.resolve(new Map()))),
      context.regimeKey ? part(() => regime.regime(), 20_000) : Promise.resolve(null),
      context.cotId ? part(() => cot.cotBoard(), 20_000) : Promise.resolve(null),
      context.curveId ? part(() => curves.allCurves()) : Promise.resolve(null),
      context.quantKey ? part(() => forecasts(), 8_000) : Promise.resolve(null),
      part(() => econcalendar.rangeEvents(new Date(now - 3 * 3_600_000), new Date(now + 7 * 86_400_000))),
      part(() => watcherguru.flashes()),
      context.geo ? part(() => geopolitics.geopolitics()) : Promise.resolve(null),
      context.etfs.length ? part(() => etfboard.etfBoard()) : Promise.resolve(null),
    ]);
    const q = quotes?.get(s);
    // The calendar names an event by its currency (EUR for Germany's too) and its country as region.
    const currencies = new Set(context.currencies);
    const qa = quant?.assets.find((a) => a.key === context.quantKey);
    const c = cotList?.find((x) => x.id === context.cotId) ?? null;
    return {
      context,
      quote: q ? { price: q.price, day: q.changePercent, week: q.changeWeek ?? null, month: q.changeMonth ?? null } : null,
      regime: reg ? { quadrant: reg.current.quadrant, label: regime.QUADRANTS[reg.current.quadrant].label, row: reg.assets.find((a) => a.key === context.regimeKey) ?? null } : null,
      curve: curveList?.find((x) => x.id === context.curveId) ?? null,
      cot: c && { id: c.id, label: c.label, names: c.names, latest: c.latest, specChange: c.specChange, specPctOi: c.specPctOi, cotIndex: c.cotIndex, crowding: c.crowding },
      quant: qa
        ? {
            label: qa.label,
            unit: qa.unit,
            horizons: Object.fromEntries(
              Object.entries(qa.horizons).map(([h, f]) => [h, { pUp: f.pUp, baseRate: f.baseRate, verdict: f.verdict, band: { p10: f.band.p10, p50: f.band.p50, p90: f.band.p90 }, proven: f.score.proven }]),
            ),
          }
        : null,
      events: (events ?? [])
        .filter((e) => (e.impact === "High" || e.impact === "Medium") && currencies.has(e.country))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 12)
        .map((e) => ({ title: e.title, country: e.region ?? e.country, date: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous })),
      flashes: (flashes?.posts ?? []).filter((p) => mentions(p.text, context.keywords)).slice(0, 8).map((p) => ({ id: p.id, text: p.text, time: p.time, url: p.url })),
      geo: context.geo
        ? (geo?.themes ?? [])
            .map((t) => ({ id: t.id, label: t.label, week: t.week, heat: t.heat, tone: t.tone, direction: ((t.usual[context.geo!.key] ?? 0) * context.geo!.sign) as -1 | 0 | 1 }))
            .filter((t) => t.direction !== 0 && t.week > 0)
            .slice(0, 5)
        : [],
      etfs: (etfs ?? []).filter((e) => context.etfs.includes(e.symbol)),
      asOf: now,
    };
  });
}
