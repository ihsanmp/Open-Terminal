// "Whale & Institution Alerts" — big money on the chart's own pair, marked on the bar it moved in:
//
//   - Volume whales (every pair): bars whose volume is a multiple of its recent average, the
//     footprint of large orders on the exchange.
//   - On-chain whales (BTC): transactions moving at least 100 BTC to other addresses (change left
//     out), read block by block from mempool.space. The server starts with the last day's blocks,
//     so this history grows from when the indicator is first used.
//   - Institutions, per coin: what treasury companies report buying or selling in their SEC 8-Ks
//     (BTC: Strategy, Strive, MARA; ETH: BitMine, Sharplink; TRX: Tron Inc). On a stock: insiders'
//     and 10 % owners' open-market buys and sells from their Form 4s.
//
// Data via /api/onchain/whales/<coin> (crypto) and /api/insider/<ticker> (stocks).

import * as ta from "../core";
import { type Bars } from "../core";
import {
  b,
  bool,
  colorInput,
  float,
  int,
  n,
  s,
  select,
  type ChartContext,
  type DrawSize,
  type IndicatorDef,
  type IndicatorResult,
  type IndicatorTable,
  type Label,
  type Params,
  type TableCell,
} from "../types";

export type Whale = { txid: string; time: number; height: number; btc: number };
export type TreasuryTrade = {
  company: string;
  ticker: string;
  asset: string;
  time: number;
  from?: number;
  amount: number;
  usd: number | null;
  avgPrice: number | null;
  holdings: number | null;
  url: string;
};
/** The server's /onchain/whales/<coin> response. */
export type CoinData = { asset: string; whales: { height: number; txs: Whale[] } | null; treasuries: TreasuryTrade[] };
/** One row of /insider/<ticker> (SEC Form 4). */
export type InsiderTrade = {
  transactionDate: string;
  ownerName: string;
  isTenPercentOwner: boolean;
  transactionCode: string;
  shares: number | null;
  value: number | null;
};

/** The coin of a crypto chart (BTC-USD → BTC), or null. */
export function coinOf(chart: ChartContext | undefined): string | null {
  return chart?.type === "crypto" ? chart.ticker.replace(/USDT?$/, "") : null;
}

function dataPath(chart: ChartContext | undefined): string | null {
  const coin = coinOf(chart);
  if (coin) return `/api/onchain/whales/${encodeURIComponent(coin)}`;
  if (chart?.type === "stock") return `/api/insider/${encodeURIComponent(chart.ticker)}`;
  return null;
}

export const whaleAlerts: IndicatorDef = {
  id: "whale-alerts",
  name: "Whale & Institution Alerts",
  short: "Whales",
  category: "Community",
  overlay: true,
  aliases: ["Whale Alert", "Strategy", "MicroStrategy", "MSTR", "BitMine", "Institutions", "Treasury", "Insiders", "On-chain", "Volume spike"],
  description:
    "Marks big money on the chart's pair: volume whales on any pair, large on-chain BTC transfers (mempool.space), coins bought or sold by treasury companies such as Strategy and BitMine (SEC 8-Ks), and insider / 10% owner trades on stocks (Form 4).",
  legendInputs: ["volMult"],
  inputs: [
    bool("showVolume", "Volume Whales (every pair)", true),
    float("volMult", "Volume Whale: × Average Volume", 4, 0.5, 1),
    int("volLen", "Volume Whale: Average Length", 50, 2, 500),
    bool("showWhales", "On-chain Whale Transfers (BTC)", true),
    int("minWhale", "On-chain Whale Minimum (BTC)", 1000, 100, 1_000_000),
    bool("showInstitutions", "Institutions (treasury companies, stock insiders)", true),
    float("minInsiderUsd", "Stock Insider Minimum ($M)", 1, 0.1, 0),
    bool("showTable", "Show Latest Alerts Table", true),
    int("tableRows", "Table Rows", 6, 1, 20),
    // Not top right by default: that's where the newest bars and their alerts are.
    select("tablePosition", "Table Position", ["bottom_left", "top_left", "top_right", "bottom_right"], "bottom_left"),
    colorInput("volumeColor", "Volume Whale", "#FFB300"),
    colorInput("whaleColor", "On-chain Whale", "#2196F3"),
    colorInput("buyColor", "Institution Buy", "#00C853"),
    colorInput("sellColor", "Institution Sell", "#FF5252"),
  ],
  plots: [],
  fetches: (_p, chart) => {
    const path = dataPath(chart);
    return path ? [path] : [];
  },
  compute: (bars, p, ext) => {
    const path = dataPath(ext?.chart);
    return whaleAlertsCompute(bars, p, path ? ext?.fetched?.[path] : null, ext?.chart);
  },
};

const fmt = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits });
const compact = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : fmt(v, 2));
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Label size grows with the dollar amount, as on Whale Alert. */
function sizeFor(usd: number): DrawSize {
  return usd >= 1e9 ? "normal" : usd >= 1e8 ? "small" : "tiny";
}

/** The bar a time falls in: the last bar starting at or before it, if the chart reaches that far. */
function barIndex(bars: Bars, t: number, span: number): number {
  const times = bars.time;
  if (!times.length || t < times[0] || t >= times[times.length - 1] + span) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Event = { time: number; what: string; amount: string; value: number | null; color: string; intraday: boolean };

export function whaleAlertsCompute(bars: Bars, p: Params, data: unknown, chart?: ChartContext): IndicatorResult {
  const len = bars.length;
  if (len === 0) return { plots: {} };
  const span = len > 1 ? Math.max(1, bars.time[len - 1] - bars.time[len - 2]) : 86_400;
  const labels: Label[] = [];
  const events: Event[] = [];
  const coin = coinOf(chart);
  const coinData = coin && data && typeof data === "object" && "treasuries" in data ? (data as CoinData) : null;
  const insiders = !coin && Array.isArray(data) ? (data as InsiderTrade[]) : null;

  // Volume whales: volume at least volMult × its average over the previous volLen bars.
  if (b(p, "showVolume")) {
    const avg = ta.sma(bars.volume, n(p, "volLen"));
    const mult = n(p, "volMult");
    for (let i = 1; i < len; i++) {
      const base = avg[i - 1];
      if (!(base > 0) || !(bars.volume[i] >= mult * base)) continue;
      const ratio = bars.volume[i] / base;
      labels.push({ index: i, price: bars.high[i], text: `🐋 ${ratio.toFixed(1)}×`, style: "down", bg: s(p, "volumeColor"), textColor: "#000000", size: "tiny" });
      events.push({
        time: bars.time[i],
        what: `Volume ${ratio.toFixed(1)}× avg`,
        amount: compact(bars.volume[i]),
        value: bars.volume[i] * bars.close[i],
        color: s(p, "volumeColor"),
        intraday: span < 86_400,
      });
    }
  }

  // On-chain whales (BTC): transfers summed per bar.
  if (b(p, "showWhales") && coinData?.whales) {
    const min = n(p, "minWhale");
    const byBar = new Map<number, Whale[]>();
    for (const w of coinData.whales.txs) {
      if (w.btc < min) continue;
      const i = barIndex(bars, w.time, span);
      if (i < 0) continue;
      byBar.set(i, [...(byBar.get(i) ?? []), w]);
      events.push({ time: w.time, what: "🐋 On-chain transfer", amount: `${fmt(w.btc)} ${coin}`, value: w.btc * bars.close[i], color: s(p, "whaleColor"), intraday: true });
    }
    for (const [i, ws] of byBar) {
      const total = ws.reduce((a, w) => a + w.btc, 0);
      labels.push({
        index: i,
        price: bars.high[i],
        text: `🐋 ${ws.length > 1 ? `${ws.length}× ` : ""}${fmt(total)} ${coin}`,
        style: "down",
        bg: s(p, "whaleColor"),
        textColor: "#FFFFFF",
        size: sizeFor(total * bars.close[i]),
      });
    }
  }

  if (b(p, "showInstitutions")) {
    // Treasury companies' reported buys and sells of this coin.
    for (const t of coinData?.treasuries ?? []) {
      const i = barIndex(bars, t.time, span);
      if (i < 0) continue;
      const buy = t.amount > 0;
      const color = s(p, buy ? "buyColor" : "sellColor");
      const value = t.usd ?? Math.abs(t.amount) * bars.close[i];
      labels.push({
        index: i,
        price: buy ? bars.low[i] : bars.high[i],
        text: `${t.ticker} ${buy ? "+" : "−"}${fmt(Math.abs(t.amount))} ${t.asset}`,
        style: buy ? "up" : "down",
        bg: color,
        textColor: "#FFFFFF",
        size: sizeFor(value),
      });
      events.push({ time: t.time, what: `🏦 ${t.company} ${buy ? "bought" : "sold"}`, amount: `${buy ? "" : "−"}${fmt(Math.abs(t.amount))} ${t.asset}`, value, color, intraday: false });
    }
    // Stock insiders and 10 % owners: open-market purchases (P) and sales (S).
    // A Form 4 often splits one day's selling into many lots: one alert per bar, owner and side.
    const lots = new Map<string, { i: number; t: InsiderTrade; shares: number; value: number }>();
    for (const t of insiders ?? []) {
      if ((t.transactionCode !== "P" && t.transactionCode !== "S") || !t.value) continue;
      const i = barIndex(bars, Date.parse(`${t.transactionDate.slice(0, 10)}T00:00:00Z`) / 1000, Math.max(span, 86_400));
      if (i < 0) continue;
      const key = `${i}:${t.ownerName}:${t.transactionCode}`;
      const lot = lots.get(key) ?? { i, t, shares: 0, value: 0 };
      lot.shares += t.shares ?? 0;
      lot.value += t.value;
      lots.set(key, lot);
    }
    const minUsd = n(p, "minInsiderUsd") * 1e6;
    for (const { i, t, shares, value } of lots.values()) {
      if (value < minUsd) continue;
      const buy = t.transactionCode === "P";
      const color = s(p, buy ? "buyColor" : "sellColor");
      const who = t.ownerName.length > 18 ? `${t.ownerName.slice(0, 17)}…` : t.ownerName;
      const icon = t.isTenPercentOwner ? "🏦" : "👤";
      labels.push({
        index: i,
        price: buy ? bars.low[i] : bars.high[i],
        text: `${icon} ${who} ${buy ? "+" : "−"}$${compact(value)}`,
        style: buy ? "up" : "down",
        bg: color,
        textColor: "#FFFFFF",
        size: "tiny",
      });
      events.push({ time: bars.time[i], what: `${icon} ${who} ${buy ? "bought" : "sold"}`, amount: `${fmt(shares)} sh`, value, color, intraday: false });
    }
  }

  // Alerts on one bar stack away from the candle instead of covering each other.
  const ranges = bars.high.map((h, i) => h - bars.low[i]).filter((r) => r > 0);
  const step = ranges.length ? (ranges.reduce((a, r) => a + r, 0) / ranges.length) * 1.5 : 0;
  const seen = new Map<string, number>();
  for (const l of labels) {
    const key = `${l.index}:${l.style}`;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    l.price += (l.style === "up" ? -1 : 1) * k * step;
  }

  const result: IndicatorResult = { plots: {}, labels };
  if (b(p, "showTable")) {
    const latest = events.sort((a, b) => b.time - a.time).slice(0, n(p, "tableRows"));
    const cells: TableCell[] = [{ col: 0, row: 0, colSpan: 4, text: "Whale & Institution Alerts", color: "#FF9800", bold: true, size: "small" }];
    latest.forEach((e, k) => {
      const row = k + 1;
      cells.push(
        { col: 0, row, text: e.intraday ? when(e.time) : date(e.time), color: "#B2B5BE", size: "small" },
        { col: 1, row, text: e.what, color: e.color, size: "small" },
        { col: 2, row, text: e.amount, color: "#FFFFFF", size: "small", align: "right" },
        { col: 3, row, text: e.value !== null ? `$${compact(Math.abs(e.value))}` : "", color: "#B2B5BE", size: "small", align: "right" }
      );
    });
    if (!latest.length) cells.push({ col: 0, row: 1, colSpan: 4, text: "No alerts on this chart yet", color: "#B2B5BE", size: "small" });
    result.table = { position: s(p, "tablePosition") as IndicatorTable["position"], bg: "rgba(0,0,0,0.75)", frame: "#363A45", border: "#363A45", cells };
  }
  return result;
}
