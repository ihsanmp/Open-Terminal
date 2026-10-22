// Daily / Weekly / Monthly / Yearly opens, labelled, with the London and New York session opens:
// an independent implementation, written for OpenTerminal, of the behaviour of the TradingView
// script "Daily Weekly Monthly Yearly Opens Labelled - 30 mins or less" (sbtnc's original,
// edited by GreatestUsername; Mozilla Public License 2.0).
//
// Each open is a level from the bar its period starts on, at that period's opening price, run
// out to the right of the last bar and labelled there (Monday, 20/10, October, 2026 …); the last
// few of each kind are kept. The day, week, month and year opens are the higher time frame's own
// (daily bars of the same symbol, as request.security would give), or with "Discover Prices" the
// chart's first bar of each period. The London (08:00 London time) and New York (09:30 New York
// time) opens are read on charts of 30 minutes or less, following each city's summer time on
// their own; the original's fixed UTC hours with its DST checkboxes stay available.

import type { Bars } from "../core";
import { colorNew, timeParts } from "../pine";
import { bool, colorInput, int, n, s, b, select, type ChartContext, type DrawSize, type IndicatorDef, type IndicatorResult, type Label, type Line, type Params } from "../types";

export type OpenKind = "daily" | "weekly" | "monthly" | "yearly" | "london" | "ny";
export type OpenEvent = { kind: OpenKind; time: number; price: number; date: string };
type DailyBar = { time: number; open: number };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HTF: OpenKind[] = ["daily", "weekly", "monthly", "yearly"];

/** A trading day as a date: a daily bar's or an intraday bar's session date (a session opening the evening before, as forex and futures do, belongs to the next day). */
export const tradeDate = (sec: number) => new Date(sec * 1000 + 9 * 3_600_000).toISOString().slice(0, 10);

/** An intraday bar's session date on the chart's market: forex days start at 17:00 New York,
 *  others at midnight in the exchange's zone (crypto: UTC). */
export function chartDate(sec: number, chart: ChartContext | undefined): string {
  const forex = chart?.type === "forex";
  const p = timeParts(forex ? sec + 7 * 3600 : sec, forex ? "America/New_York" : (chart?.timezone ?? "Etc/UTC"));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** ISO week (Monday first) of a date, as a sortable key. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

const periodKey = (kind: OpenKind, date: string) => (kind === "daily" ? date : kind === "weekly" ? isoWeek(date) : kind === "monthly" ? date.slice(0, 7) : date.slice(0, 4));

/** The opens of the day, week, month and year from a list of bars (each bar's time and open), the first bar of each period. */
export function htfOpens(rows: Array<{ time: number; open: number }>, date: (t: number) => string = tradeDate): OpenEvent[] {
  const out: OpenEvent[] = [];
  const last: Partial<Record<OpenKind, string>> = {};
  for (const r of rows) {
    if (!Number.isFinite(r.open)) continue;
    const d = date(r.time);
    for (const kind of HTF) {
      const key = periodKey(kind, d);
      if (last[kind] !== key) {
        last[kind] = key;
        out.push({ kind, time: r.time, price: r.open, date: d });
      }
    }
  }
  return out;
}

/** The London and New York opens on the chart's bars: at 08:00 London / 09:30 New York local time (or fixed UTC hours), weekdays only. */
export function sessionOpens(bars: Bars, opts: { auto: boolean; londonDst: boolean; nyDst: boolean }): OpenEvent[] {
  const out: OpenEvent[] = [];
  for (let i = 0; i < bars.length; i++) {
    const t = bars.time[i];
    let london: boolean;
    let ny: boolean;
    if (opts.auto) {
      const l = timeParts(t, "Europe/London");
      const y = timeParts(t, "America/New_York");
      london = l.hour === 8 && l.minute === 0 && l.dayofweek >= 2 && l.dayofweek <= 6;
      ny = y.hour === 9 && y.minute === 30 && y.dayofweek >= 2 && y.dayofweek <= 6;
    } else {
      const u = new Date(t * 1000);
      const weekday = u.getUTCDay() >= 1 && u.getUTCDay() <= 5;
      london = weekday && u.getUTCHours() === (opts.londonDst ? 7 : 8) && u.getUTCMinutes() === 0;
      ny = weekday && u.getUTCHours() === (opts.nyDst ? 14 : 13) && u.getUTCMinutes() === 30;
    }
    const date = new Date(t * 1000).toISOString().slice(0, 10);
    if (london) out.push({ kind: "london", time: t, price: bars.open[i], date });
    if (ny) out.push({ kind: "ny", time: t, price: bars.open[i], date });
  }
  return out;
}

/** The first chart bar at or after a time (bars sorted by time); -1 when it's past the last bar. */
export function barAt(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t > times[hi]) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** A label's text: the day's name, the week's date, the month's name, the year (or a date in the chosen format). */
export function labelText(kind: OpenKind, date: string, format: string): string {
  if (kind === "london") return "London Open";
  if (kind === "ny") return "NY Open";
  const [y, m, d] = date.split("-").map(Number);
  if (format !== "Names") return format === "MM/DD/YY" ? `${m}/${d}/${y % 100}` : `${d}/${m}/${y % 100}`;
  if (kind === "daily") return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (kind === "weekly") return `${d}/${m}`;
  if (kind === "monthly") return MONTH_NAMES[m - 1];
  return String(y);
}

const SIZES: DrawSize[] = ["small", "normal", "huge"];
const PAD = 4;
const OLDER_PAD = -2;

/** Which kinds the chart's time frame shows: no day opens on a daily chart, no month opens on a monthly one, sessions only at 30 minutes or less. */
export function shownKinds(intervalSeconds: number, p: Params): OpenKind[] {
  const intraday = intervalSeconds < 86_400;
  const daily = intervalSeconds >= 86_400 && intervalSeconds < 7 * 86_400;
  const monthly = intervalSeconds >= 28 * 86_400;
  const out: OpenKind[] = [];
  if (b(p, "london") && intervalSeconds <= 1800) out.push("london");
  if (b(p, "ny") && intervalSeconds <= 1800) out.push("ny");
  if (b(p, "daily") && intraday) out.push("daily");
  if (b(p, "weekly") && (intraday || daily)) out.push("weekly");
  if (b(p, "monthly") && !monthly) out.push("monthly");
  if (b(p, "yearly") && intervalSeconds < 365 * 86_400) out.push("yearly");
  return out;
}

export function periodOpens(bars: Bars, p: Params, chart: ChartContext | undefined, daily: DailyBar[] | undefined): IndicatorResult {
  const len = bars.length;
  if (len === 0) return { plots: {} };
  const last = len - 1;
  const interval = chart?.intervalSeconds ?? 86_400;
  const kinds = shownKinds(interval, p);
  const colors: Record<OpenKind, string> = {
    daily: s(p, "dailyColor"), weekly: s(p, "weeklyColor"), monthly: s(p, "monthlyColor"), yearly: s(p, "yearlyColor"), london: s(p, "londonColor"), ny: s(p, "nyColor"),
  };
  const lookback: Record<OpenKind, number> = {
    daily: n(p, "dailyBack"), weekly: n(p, "weeklyBack"), monthly: n(p, "monthlyBack"), yearly: n(p, "yearlyBack"), london: n(p, "londonBack"), ny: n(p, "nyBack"),
  };

  // The higher time frames' opens: the daily bars' own, or the chart's first bar of each period.
  const fromChart = b(p, "discover") || !daily?.length;
  const htf = fromChart ? htfOpens(bars.time.map((t, i) => ({ time: t, open: bars.open[i] })), (t) => chartDate(t, chart)) : htfOpens(daily!);
  const events = [...htf, ...sessionOpens(bars, { auto: b(p, "autoDst"), londonDst: b(p, "londonDst"), nyDst: b(p, "nyDst") })];

  const width = Math.max(1, Math.min(4, n(p, "width"))) as 1 | 2 | 3 | 4;
  const size = SIZES[Math.max(1, Math.min(3, n(p, "labelSize"))) - 1];
  const right = last + Math.max(1, n(p, "offset"));
  const format = s(p, "dateFormat");
  const lines: Line[] = [];
  const labels: Label[] = [];
  const plots: Record<string, number[]> = {};
  const latest: Partial<Record<OpenKind, number>> = {};

  const eventsOf = (kind: OpenKind) => events.filter((e) => e.kind === kind && e.time <= bars.time[last]);
  for (const kind of kinds) {
    const all = eventsOf(kind);
    if (!all.length) continue;
    latest[kind] = all[all.length - 1].price;

    // The latest value at every bar, for the legend.
    const series = new Array<number>(len).fill(NaN);
    let k = 0;
    let value = NaN;
    for (let i = 0; i < len; i++) {
      while (k < all.length && all[k].time <= bars.time[i]) value = all[k++].price;
      series[i] = value;
    }
    plots[kind] = series;
  }

  // Where opens share a price, the higher time frame's label steps right of the lower one's.
  const order: OpenKind[] = ["daily", "weekly", "monthly", "yearly"];
  const padding = (kind: OpenKind) => {
    if (kind === "london" || kind === "ny") return 0;
    const at = order.indexOf(kind);
    return order.slice(0, at).filter((o) => latest[o] != null && latest[o] === latest[kind]).length;
  };

  for (const kind of kinds) {
    // The open's line runs from its bar; one older than the loaded bars starts at the first.
    const kept = eventsOf(kind)
      .slice(-Math.max(1, lookback[kind]))
      .map((e) => ({ ...e, x: Math.max(0, barAt(bars.time, e.time)) }));
    const color = colors[kind];
    kept.forEach((e, j) => {
      const newest = j === kept.length - 1;
      const text = labelText(kind, e.date, format);
      if (newest) {
        const end = right + padding(kind) * PAD;
        lines.push({ x1: e.x, y1: e.price, x2: end, y2: e.price, color, width });
        labels.push({ index: end, price: e.price, text, style: "left", valign: "above", textColor: color, size, pinRight: true });
        if (b(p, "tails") && e.x > 0) lines.push({ x1: e.x - 1, y1: e.price, x2: e.x, y2: e.price, color, width, style: "dotted", extend: "left" });
      } else {
        // An older open: its body up to the next open, then its head on to the right, fainter when the newest are highlighted.
        const next = kept[j + 1].x;
        const end = right + OLDER_PAD * PAD;
        lines.push({ x1: e.x, y1: e.price, x2: next, y2: e.price, color, width });
        const sharesNewest = Object.values(latest).includes(e.price);
        if (!sharesNewest && end > next) lines.push({ x1: next, y1: e.price, x2: end, y2: e.price, color: b(p, "highlight") ? colorNew(color, 60) : color, width });
        labels.push({ index: end, price: e.price, text, style: "left", valign: "above", textColor: b(p, "highlight") ? colorNew(color, 40) : color, size, pinRight: true });
      }
    });
  }

  return { plots, lines, labels };
}

const GREEN = "#4CAF50";
const ORANGE = "#FF9800";
const RED = "#F44336";
const BLUE = "#2196F3";
const YELLOW = "#FFEB3B";
const PURPLE = "#9C27B0";

export const periodOpensIndicator: IndicatorDef = {
  id: "dwmy-opens-labelled",
  name: "Daily Weekly Monthly Yearly Opens Labelled",
  short: "DWMY Labelled",
  category: "Support & Resistance",
  overlay: true,
  autoscale: false,
  aliases: ["DWMY", "Daily Open", "Weekly Open", "Monthly Open", "Yearly Open", "London Open", "NY Open", "Opens Labelled", "30 mins or less"],
  legendInputs: [],
  description: "Garis harga pembukaan harian, mingguan, bulanan dan tahunan berlabel, plus pembukaan sesi London dan New York (chart 30 menit atau kurang).",
  inputs: [
    bool("ny", "NY Open", true),
    colorInput("nyColor", "NY Open color", PURPLE),
    int("nyBack", "NY Open lookback", 2, 1, 50),
    bool("london", "London Open", true),
    colorInput("londonColor", "London Open color", YELLOW),
    int("londonBack", "London Open lookback", 2, 1, 50),
    bool("autoDst", "Session times follow London/NY summer time", true),
    bool("nyDst", "NY DST (fixed times: 14:30 UTC instead of 13:30)", false),
    bool("londonDst", "London DST (fixed times: 07:00 UTC instead of 08:00)", false),
    bool("daily", "Daily", true),
    colorInput("dailyColor", "Daily color", GREEN),
    int("dailyBack", "Daily lookback", 2, 1, 50),
    bool("weekly", "Weekly", true),
    colorInput("weeklyColor", "Weekly color", ORANGE),
    int("weeklyBack", "Weekly lookback", 2, 1, 50),
    bool("monthly", "Monthly", true),
    colorInput("monthlyColor", "Monthly color", RED),
    int("monthlyBack", "Monthly lookback", 2, 1, 50),
    bool("yearly", "Yearly", true),
    colorInput("yearlyColor", "Yearly color", BLUE),
    int("yearlyBack", "Yearly lookback", 2, 1, 50),
    int("width", "Line Width", 1, 1, 4),
    int("labelSize", "Label Size", 1, 1, 3),
    select("dateFormat", "Date Display Format", ["Names", "MM/DD/YY", "DD/MM/YY"], "Names"),
    int("offset", "Offset", 20, 1, 500),
    bool("tails", "Show Tails", false),
    bool("highlight", "Highlight Most Recent Opens", false),
    bool("discover", "Discover Prices (from the chart's own bars)", false),
  ],
  plots: [
    { key: "daily", title: "D", color: GREEN, display: "legend" },
    { key: "weekly", title: "W", color: ORANGE, display: "legend" },
    { key: "monthly", title: "M", color: RED, display: "legend" },
    { key: "yearly", title: "Y", color: BLUE, display: "legend" },
    { key: "london", title: "LO", color: YELLOW, display: "legend" },
    { key: "ny", title: "NYO", color: PURPLE, display: "legend" },
  ],
  // The higher time frames' own opens: five years of the symbol's daily bars.
  fetches: (_p, chart) => [dailyPath(chart)],
  compute: (bars, p, ext) => {
    const chart = ext?.chart;
    const daily = chart ? (ext?.fetched?.[dailyPath(chart)] as DailyBar[] | undefined) : undefined;
    return periodOpens(bars, p, chart, Array.isArray(daily) ? daily : undefined);
  },
};

export const dailyPath = (chart: ChartContext) => `/api/history/${encodeURIComponent(chart.symbol)}?range=5Y&interval=1D`;
