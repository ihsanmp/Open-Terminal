// Geopolitics and event risk, from the news the app already archives (its wires and publishers,
// tier 1–2): headlines sorted into themes (the Middle East, Russia–Ukraine, US–China and Taiwan,
// tariffs and trade, sanctions, elections and politics, energy supply, North Korea, military
// conflict generally), each with how loud it is now against its own usual (the last day and week
// against the four weeks before), how much of it is escalation language, and its latest headlines.
//
// Beside it, how the assets a geopolitical shock usually moves (gold, oil, the dollar, Treasuries,
// stocks, bitcoin, the VIX) have actually moved today and this week, the textbook direction for
// each theme (labelled as theory), and the scheduled high-impact releases ahead: the event map.

import { cached } from "../cache.js";
import * as econcalendar from "./econcalendar.js";
import { headlines } from "./socialfeed.js";
import * as tradingview from "./tradingview.js";

export type Theme = {
  id: string;
  label: string;
  re: RegExp;
  /** The textbook direction for gold, oil, the dollar, 10-year yields, stocks and bitcoin when this theme flares up. */
  usual: Partial<Record<"gold" | "oil" | "dxy" | "us10y" | "spx" | "btc" | "vix", -1 | 0 | 1>>;
};

export const THEMES: Theme[] = [
  { id: "mideast", label: "Timur Tengah", re: /\b(israel\w*|gaza|hamas|hezbollah|iran\w*|houthi\w*|red sea|yemen\w*|syria\w*|lebanon|tehran|west bank|strait of hormuz)\b/i, usual: { gold: 1, oil: 1, dxy: 1, us10y: -1, spx: -1, btc: -1, vix: 1 } },
  { id: "russia", label: "Rusia–Ukraina", re: /\b(russia\w*|ukrain\w*|kremlin|putin|zelensk\w*|moscow|kyiv|nato)\b/i, usual: { gold: 1, oil: 1, dxy: 1, us10y: -1, spx: -1, vix: 1 } },
  { id: "china", label: "AS–Tiongkok & Taiwan", re: /\b(china|chinese|beijing|taiwan\w*|xi jinping|south china sea|pla)\b/i, usual: { gold: 1, dxy: 1, spx: -1, vix: 1 } },
  { id: "trade", label: "Tarif & perang dagang", re: /\b(tariff\w*|trade war|trade deal|trade talks|export control\w*|import dut\w*|customs dut\w*|wto)\b/i, usual: { gold: 1, dxy: 0, spx: -1, us10y: -1, vix: 1 } },
  { id: "sanctions", label: "Sanksi", re: /\bsanction\w*\b/i, usual: { gold: 1, oil: 1, dxy: 1 } },
  { id: "politics", label: "Pemilu & politik", re: /\b(election\w*|ballot|parliament\w*|impeach\w*|government shutdown|shutdown|coup|prime minister resign\w*|snap poll)\b/i, usual: { gold: 1, vix: 1, spx: -1 } },
  { id: "energy", label: "Pasokan energi", re: /\b(opec\+?|pipeline\w*|oil supply|refiner\w*|lng|gas supply|oil output|production cut\w*)\b/i, usual: { oil: 1, gold: 0, spx: -1 } },
  { id: "korea", label: "Korea Utara", re: /\b(north korea\w*|pyongyang|kim jong)\b/i, usual: { gold: 1, dxy: 1, spx: -1, vix: 1 } },
  { id: "conflict", label: "Konflik militer", re: /\b(missile\w*|airstrike\w*|air strike\w*|military|troops|warplane\w*|drone strike\w*|invasion|invade\w*|nuclear|war)\b/i, usual: { gold: 1, oil: 1, dxy: 1, us10y: -1, spx: -1, btc: -1, vix: 1 } },
];

const ESCALATION = /\b(attack\w*|strike\w*|escalat\w*|invad\w*|missile\w*|kill\w*|bomb\w*|retaliat\w*|threat\w*|warn\w*|clash\w*|seize\w*|blockade\w*|mobiliz\w*)\b/i;
const EASING = /\b(ceasefire|truce|peace|talks|deal|agreement|de-escalat\w*|negotiat\w*|eases?|lifts?|pause\w*)\b/i;

export type ThemeHeat = {
  id: string;
  label: string;
  day: number;
  week: number;
  /** The four weeks before this one, per week. */
  usualWeek: number;
  /** This week against the usual week: 1 is normal, 2 is twice as loud. */
  heat: number | null;
  escalation: number;
  easing: number;
  tone: "eskalasi" | "meredam" | "campuran" | null;
  usual: Theme["usual"];
  latest: Array<{ title: string; publisher: string; link: string; time: number }>;
};

export type Headline = { title: string; publisher: string; link: string; time: number };

/** The themes' loudness and latest headlines from a list of headlines (exported for the tests). */
export function heatOf(list: Headline[], now = Date.now()): ThemeHeat[] {
  const day = now - 86_400_000;
  const week = now - 7 * 86_400_000;
  // The usual week: the four weeks before this one, or as much of them as the archive holds
  // (a young archive has days, not weeks, of history before this week).
  const earliest = list.reduce((m, h) => Math.min(m, h.time), now);
  const month = Math.max(now - 35 * 86_400_000, earliest);
  const baseWeeks = (week - month) / (7 * 86_400_000);
  return THEMES.map((t) => {
    const hits = list.filter((h) => t.re.test(h.title)).sort((a, b) => b.time - a.time);
    const inWeek = hits.filter((h) => h.time >= week);
    const before = hits.filter((h) => h.time < week && h.time >= month);
    // Under three days of history before this week is too little to call anything usual.
    const usualWeek = baseWeeks >= 3 / 7 ? before.length / baseWeeks : 0;
    const escalation = inWeek.filter((h) => ESCALATION.test(h.title)).length;
    const easing = inWeek.filter((h) => EASING.test(h.title)).length;
    const tone: ThemeHeat["tone"] = inWeek.length < 3 ? null : escalation >= easing * 2 ? "eskalasi" : easing >= escalation * 2 ? "meredam" : "campuran";
    // A dozen words differ only in their publisher: one of each title.
    const seen = new Set<string>();
    const latest = hits.filter((h) => !seen.has(h.title.toLowerCase()) && seen.add(h.title.toLowerCase())).slice(0, 8);
    return {
      id: t.id,
      label: t.label,
      day: hits.filter((h) => h.time >= day).length,
      week: inWeek.length,
      usualWeek,
      heat: usualWeek > 0 ? inWeek.length / usualWeek : null,
      escalation,
      easing,
      tone,
      usual: t.usual,
      latest: latest.map(({ title, publisher, link, time }) => ({ title, publisher, link, time })),
    };
  }).sort((a, b) => b.week - a.week);
}

const GAUGES: Array<{ key: "gold" | "oil" | "dxy" | "us10y" | "spx" | "btc" | "vix"; label: string; tv: string }> = [
  { key: "gold", label: "Emas", tv: "OANDA:XAUUSD" },
  { key: "oil", label: "Minyak WTI", tv: "NYMEX:CL1!" },
  { key: "dxy", label: "Dolar (DXY)", tv: "TVC:DXY" },
  { key: "us10y", label: "Yield AS 10Y", tv: "TVC:US10Y" },
  { key: "spx", label: "S&P 500", tv: "SP:SPX" },
  { key: "btc", label: "Bitcoin", tv: "BITSTAMP:BTCUSD" },
  { key: "vix", label: "VIX", tv: "TVC:VIX" },
];

export type Gauge = { key: string; label: string; price: number | null; day: number | null; week: number | null };

export type Geopolitics = {
  themes: ThemeHeat[];
  gauges: Gauge[];
  /** A safe-haven read: gold and the VIX up with stocks down today. */
  havenBid: boolean | null;
  events: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null }>;
  headlines: number;
  /** How many days back the archive's headlines go. */
  archiveDays: number;
  asOf: number;
};

export function geopolitics(now = Date.now()): Promise<Geopolitics> {
  return cached("geo:board", 120_000, async () => {
    const list = headlines(now - 35 * 86_400_000).map(({ title, publisher, link, time }) => ({ title, publisher, link, time }));
    const [quotes, events] = await Promise.all([
      tradingview.batchQuotes(GAUGES.map((g) => g.tv), (s) => [s]).catch(() => new Map()),
      econcalendar.rangeEvents(new Date(now), new Date(now + 7 * 86_400_000)).catch(() => [] as econcalendar.EconEvent[]),
    ]);
    const gauges = GAUGES.map((g) => {
      const q = quotes.get(g.tv);
      return { key: g.key, label: g.label, price: q?.price ?? null, day: q?.changePercent ?? null, week: q?.changeWeek ?? null };
    });
    const at = (k: string) => gauges.find((g) => g.key === k)?.day ?? null;
    const gold = at("gold");
    const vix = at("vix");
    const spx = at("spx");
    return {
      themes: heatOf(list, now),
      gauges,
      havenBid: gold == null || vix == null || spx == null ? null : gold > 0.3 && vix > 3 && spx < -0.3,
      events: events
        .filter((e) => e.impact === "High" && Date.parse(e.date) >= now)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 25)
        .map((e) => ({ title: e.title, country: e.country, date: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous })),
      headlines: list.length,
      archiveDays: list.length ? Math.floor((now - Math.min(...list.map((h) => h.time))) / 86_400_000) : 0,
      asOf: now,
    };
  });
}
