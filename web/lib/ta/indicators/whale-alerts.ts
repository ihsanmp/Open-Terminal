// "Whale & Institution Alerts" — large on-chain BTC transfers and the bitcoin public companies
// report buying or selling, marked on the bar they happened in.
//
// Data (via /api/onchain/btc-whales):
//   - whales: transactions moving at least 100 BTC to other addresses (change left out), read
//     block by block from mempool.space. The server starts with the last day's blocks, so the
//     history grows from when the indicator is first used.
//   - treasuries: purchases and sales from the companies' SEC 8-K filings (Strategy's weekly
//     "BTC Update"), dated at the end of each reported period.

import { type Bars } from "../core";
import { b, bool, colorInput, int, n, s, select, type DrawSize, type IndicatorDef, type IndicatorResult, type IndicatorTable, type Label, type Params, type TableCell } from "../types";

export type Whale = { txid: string; time: number; height: number; btc: number };
export type TreasuryTrade = {
  company: string;
  ticker: string;
  time: number;
  from?: number;
  btc: number;
  usd: number | null;
  avgPrice: number | null;
  holdings: number | null;
  url: string;
};
/** The server's /onchain/btc-whales response. */
export type WhaleData = { whales: { height: number; txs: Whale[] }; treasuries: TreasuryTrade[] };

const PATH = "/api/onchain/btc-whales";

export const whaleAlerts: IndicatorDef = {
  id: "whale-alerts",
  name: "Whale & Institution Alerts",
  short: "Whales",
  category: "Community",
  overlay: true,
  aliases: ["Whale Alert", "Strategy", "MicroStrategy", "MSTR", "Institutions", "Treasury", "On-chain"],
  description: "Marks large on-chain BTC transfers (mempool.space) and bitcoin bought or sold by public companies such as Strategy (SEC 8-K filings).",
  legendInputs: ["minWhale"],
  inputs: [
    bool("showWhales", "Show Whale Transfers", true),
    int("minWhale", "Whale Minimum (BTC)", 1000, 100, 1_000_000),
    bool("showInstitutions", "Show Institution Buys / Sells", true),
    bool("showTable", "Show Latest Alerts Table", true),
    int("tableRows", "Table Rows", 6, 1, 20),
    // Not top right by default: that's where the newest bars and their alerts are.
    select("tablePosition", "Table Position", ["bottom_left", "top_left", "top_right", "bottom_right"], "bottom_left"),
    colorInput("whaleColor", "Whale", "#2196F3"),
    colorInput("buyColor", "Institution Buy", "#00C853"),
    colorInput("sellColor", "Institution Sell", "#FF5252"),
  ],
  plots: [],
  fetches: () => [PATH],
  compute: (bars, p, ext) => whaleAlertsCompute(bars, p, (ext?.fetched?.[PATH] as WhaleData | undefined) ?? null),
};

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`);
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

/** Label size grows with the amount, as on Whale Alert. */
function sizeFor(btc: number): DrawSize {
  const a = Math.abs(btc);
  return a >= 10_000 ? "normal" : a >= 2_000 ? "small" : "tiny";
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

export function whaleAlertsCompute(bars: Bars, p: Params, data: WhaleData | null): IndicatorResult {
  if (!data || bars.length === 0) return { plots: {} };
  const len = bars.length;
  const span = len > 1 ? Math.max(1, bars.time[len - 1] - bars.time[len - 2]) : 86_400;
  const labels: Label[] = [];
  type Event = { time: number; what: string; btc: number; value: number | null; color: string };
  const events: Event[] = [];

  if (b(p, "showWhales")) {
    const min = n(p, "minWhale");
    const byBar = new Map<number, Whale[]>();
    for (const w of data.whales.txs) {
      if (w.btc < min) continue;
      const i = barIndex(bars, w.time, span);
      if (i < 0) continue;
      byBar.set(i, [...(byBar.get(i) ?? []), w]);
      events.push({ time: w.time, what: "🐋 Whale transfer", btc: w.btc, value: w.btc * bars.close[i], color: s(p, "whaleColor") });
    }
    for (const [i, ws] of byBar) {
      const total = ws.reduce((a, w) => a + w.btc, 0);
      labels.push({
        index: i,
        price: bars.high[i],
        text: `🐋 ${ws.length > 1 ? `${ws.length}× ` : ""}${fmt(total)} BTC`,
        style: "down",
        bg: s(p, "whaleColor"),
        textColor: "#FFFFFF",
        size: sizeFor(total),
      });
    }
  }

  if (b(p, "showInstitutions")) {
    for (const t of data.treasuries) {
      const i = barIndex(bars, t.time, span);
      if (i < 0) continue;
      const buy = t.btc > 0;
      const color = s(p, buy ? "buyColor" : "sellColor");
      labels.push({
        index: i,
        price: buy ? bars.low[i] : bars.high[i],
        text: `${t.ticker} ${buy ? "+" : "−"}${fmt(Math.abs(t.btc))} BTC`,
        style: buy ? "up" : "down",
        bg: color,
        textColor: "#FFFFFF",
        size: sizeFor(t.btc),
      });
      events.push({ time: t.time, what: `${t.company} ${buy ? "bought" : "sold"}`, btc: t.btc, value: t.usd, color });
    }
  }

  const result: IndicatorResult = { plots: {}, labels };
  if (b(p, "showTable")) {
    const latest = events.sort((a, b) => b.time - a.time).slice(0, n(p, "tableRows"));
    const cells: TableCell[] = [
      { col: 0, row: 0, colSpan: 4, text: "Whale & Institution Alerts", color: "#FF9800", bold: true, size: "small" },
    ];
    latest.forEach((e, k) => {
      const row = k + 1;
      const daily = e.what.startsWith("🐋") ? when(e.time) + " UTC" : date(e.time);
      cells.push(
        { col: 0, row, text: daily, color: "#B2B5BE", size: "small" },
        { col: 1, row, text: e.what, color: e.color, size: "small" },
        { col: 2, row, text: `${e.btc > 0 ? "" : "−"}${fmt(Math.abs(e.btc))} BTC`, color: "#FFFFFF", size: "small", align: "right" },
        { col: 3, row, text: e.value !== null ? usd(Math.abs(e.value)) : "", color: "#B2B5BE", size: "small", align: "right" }
      );
    });
    if (!latest.length) cells.push({ col: 0, row: 1, colSpan: 4, text: "No alerts on this chart yet", color: "#B2B5BE", size: "small" });
    result.table = { position: s(p, "tablePosition") as IndicatorTable["position"], bg: "rgba(0,0,0,0.75)", frame: "#363A45", border: "#363A45", cells };
  }
  return result;
}
