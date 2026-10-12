// Treasury companies' buys and sales as the news reports them, before (or without) their 8-K:
// Strategy announces its week's bitcoin on Monday morning and the wires carry "Strategy buys 250
// bitcoin" within minutes, while the 8-K can come hours later. Read off the archived headlines
// (news/archive.ts); a trade a later 8-K reports is shown from the 8-K instead.
import type { TreasuryTrade } from "./treasuries.js";

export type NewsHeadline = { title: string; summary?: string; link: string; publisher: string; publishedAt: string };
export type NewsTrade = {
  company: string;
  ticker: string;
  asset: string;
  /** Coins; positive for bought, negative for sold. */
  amount: number;
  usd: number | null;
  /** When the news was published (unix seconds). */
  time: number;
  title: string;
  link: string;
  publisher: string;
};

const COMPANIES: Array<{ re: RegExp; company: string; ticker: string }> = [
  // Capitalized: "strategy" alone is any plan.
  { re: /\b(?:Micro)?Strategy\b|\bSaylor\b/, company: "Strategy", ticker: "MSTR" },
  { re: /\bStrive\b/, company: "Strive", ticker: "ASST" },
  { re: /\bMARA\b|\bMarathon Digital\b/i, company: "MARA", ticker: "MARA" },
  { re: /\bBitMine\b/i, company: "BitMine", ticker: "BMNR" },
  { re: /\bSharpLink\b/i, company: "Sharplink", ticker: "SBET" },
  { re: /\bMetaplanet\b/i, company: "Metaplanet", ticker: "3350.T" },
];

const VERB = "(buys|bought|acquires|acquired|purchases|purchased|adds|added|scoops up|snaps up|picks up|sells|sold|offloads|dumps)";
const AMOUNT = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*(k|thousand)?";
const COIN = "(BTC|bitcoins?|ETH|ether(?:eum)?)\\b";
const TRADE = new RegExp(`\\b${VERB}\\s+(?:another\\s+|nearly\\s+|about\\s+|approximately\\s+|over\\s+|roughly\\s+)?${AMOUNT}\\s+(?:more\\s+|additional\\s+|new\\s+)?${COIN}((?:[^.;]|\\.\\d){0,60})`, "i");
const PRICE = /^(?:[^.;]|\.\d)*?\b(?:for|worth|valued at|totaling|totalling)\s+(?:about\s+|approximately\s+|nearly\s+|roughly\s+)?\$\s?(\d+(?:\.\d+)?)\s*(million|mln|m|billion|bn|b)?\b/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

/** The trade a headline reports, if it names a treasury company buying or selling coins. */
export function newsTrade(h: NewsHeadline): NewsTrade | null {
  const time = Math.floor(Date.parse(h.publishedAt) / 1000);
  if (!Number.isFinite(time)) return null;
  for (const text of [h.title, h.summary ?? ""]) {
    const m = TRADE.exec(text);
    if (!m) continue;
    // The company is the one named before the verb ("Strategy buys …", "Saylor's Strategy adds …").
    const who = COMPANIES.find((c) => c.re.test(text.slice(0, m.index)));
    if (!who) continue;
    const coins = num(m[2]) * (m[3] ? 1000 : 1);
    if (!(coins > 0)) continue;
    const asset = /^(btc|bitcoin)/i.test(m[4]) ? "BTC" : "ETH";
    const sold = /^(sell|sold|offload|dump)/i.test(m[1]);
    const p = PRICE.exec(m[5]);
    const usd = p ? num(p[1]) * (/^b/i.test(p[2] ?? "") ? 1e9 : /^m/i.test(p[2] ?? "") ? 1e6 : 1) : null;
    return { ...who, asset, amount: sold ? -coins : coins, usd: usd && usd > 1000 ? usd : null, time, title: h.title, link: h.link, publisher: h.publisher };
  }
  return null;
}

const DAY = 86_400;

/**
 * The trades the news reports and no 8-K does yet: one per company, coin and amount within a week
 * (the first report), dropped once a filing gives the same amount for a period around it.
 */
export function unfiledTrades(headlines: NewsHeadline[], filed: TreasuryTrade[]): NewsTrade[] {
  const found = headlines
    .map(newsTrade)
    .filter((t): t is NewsTrade => t !== null)
    .sort((a, b) => a.time - b.time);
  const out: NewsTrade[] = [];
  const same = (a: { ticker: string; asset: string; amount: number }, b: { ticker: string; asset: string; amount: number }) =>
    a.ticker === b.ticker && a.asset === b.asset && Math.abs(a.amount - b.amount) <= Math.abs(b.amount) * 0.02;
  for (const t of found) {
    if (out.some((o) => same(o, t) && t.time - o.time < 7 * DAY)) continue;
    // An 8-K's period ends the day before the announcement, or a few days before.
    if (filed.some((f) => same(f, t) && f.time >= t.time - 12 * DAY && f.time <= t.time + 4 * DAY)) continue;
    out.push(t);
  }
  return out;
}
