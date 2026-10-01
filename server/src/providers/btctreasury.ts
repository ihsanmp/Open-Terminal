import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { SEC_USER_AGENT } from "./secedgar.js";

// Bitcoin bought and sold by public companies, from their own SEC filings — for the chart's
// "Whale & Institution Alerts". Strategy (MSTR) reports every week's purchases in an 8-K: as prose
// until mid-2025 ("acquired approximately 27,200 bitcoins for approximately $2.03 billion …") and
// as a table since. Each 8-K is fetched once and its parsed result kept in data/.

export type TreasuryTrade = {
  company: string;
  ticker: string;
  /** Last day of the reported period, UTC midnight (unix seconds). */
  time: number;
  /** First day of the period, when the filing gives one. */
  from?: number;
  /** Positive for bought, negative for sold. */
  btc: number;
  usd: number | null;
  avgPrice: number | null;
  /** Total held at the end of the period, when given. */
  holdings: number | null;
  url: string;
};

type Filer = { cik: number; company: string; ticker: string };
const FILERS: Filer[] = [{ cik: 1050446, company: "Strategy", ticker: "MSTR" }];

const SINCE = "2020-08-01"; // Strategy's first purchase was announced on Aug 11, 2020
const REFRESH_MS = 3 * 3_600_000;
const RETRY_MS = 10 * 60_000;
const storeFile = join(dataDir, "btc-treasuries.json");

type Store = { checkedAt: number; filings: Record<string, TreasuryTrade[]> };

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": SEC_USER_AGENT } });

// ---- parsing ----

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE = `(?:${MONTHS}) \\d{1,2}, \\d{4}`;

/** An 8-K's HTML as one line of plain text. */
export function filingText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#160;|&nbsp;|&#xa0;/gi, " ")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8212;|&mdash;|&#8211;|&ndash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ");
}

const day = (d: string) => Date.parse(`${d} UTC`) / 1000;
const num = (s: string) => Number(s.replace(/[$,\s]/g, ""));
const money = (amount: string, unit: string) => num(amount) * (/billion/i.test(unit) ? 1e9 : 1e6);

/**
 * The bitcoin trades an 8-K reports, one per period. Handles the table Strategy has used since
 * mid-2025 ("During Period … BTC Acquired | Aggregate Purchase Price | … | Aggregate BTC Holdings")
 * and the earlier prose.
 */
export function parseTrades(text: string, base: Omit<TreasuryTrade, "time" | "from" | "btc" | "usd" | "avgPrice" | "holdings">): TreasuryTrade[] {
  const out: TreasuryTrade[] = [];

  // Tables: one block per "During Period A to B". The figures follow the column headers in a fixed
  // order: BTC, aggregate price ($M), average price, holdings, aggregate cost ($B), average cost.
  const periods = [...text.matchAll(new RegExp(`During Period (${DATE}) to (${DATE})\\*?`, "g"))];
  periods.forEach((m, k) => {
    const end = periods[k + 1]?.index ?? m.index! + 1500;
    let block = text.slice(m.index! + m[0].length, end);
    // Strategy's 8-Ks also have "During Period" tables for its stock sales.
    const head = block.slice(0, 120);
    if (!/BTC (Acquired|Purchased|Sold)/.test(head)) return;
    const sold = /BTC Sold/.test(head) && !/BTC (Acquired|Purchased)/.test(head);
    block = block
      .replace(new RegExp(DATE, "g"), " ")
      .replace(/\(\d\)|\(in (millions|billions)\)|\/ \(Sold\)|\/ \(Sale\)|\d{1,2}:\d{2}/g, " ");
    // "—" or "-" for a week without trades; "(1,638)" for a sale in a "Purchased / (Sold)" column.
    const figures = [...block.matchAll(/(?<![\w.])(\()?\$? ?(\d[\d,]*(?:\.\d+)?|[-—])\)?(?![\w%])/g)]
      .map((x) => (x[2] === "-" || x[2] === "—" ? 0 : x[1] ? -num(x[2]) : num(x[2])))
      .slice(0, 6);
    if (figures.length < 4) return;
    const [btc, usdM, avg, holdings] = figures;
    if (!btc) return;
    out.push({ ...base, from: day(m[1]), time: day(m[2]), btc: sold ? -btc : btc, usd: Math.abs(usdM) * 1e6, avgPrice: Math.abs(avg), holdings });
  });
  if (out.length) return out;

  // Prose, 2020 – mid-2025.
  const held = text.match(new RegExp(`As of (${DATE}),[^.]{0,160}?(?:held|holds) (?:an aggregate of )?(?:approximately )?([\\d,]+) bitcoins`));
  const holdings = held ? num(held[2]) : null;
  const between = new RegExp(
    `period between (${DATE}) and (${DATE})\\)?,[^.]*?(?:purchased|acquired) (?:approximately )?([\\d,]+) (?:additional )?bitcoins? for (?:approximately )?\\$ ?([\\d,.]+) (million|billion)(?:[^.]|\\.\\d)*?average price of (?:approximately )?\\$ ?([\\d,]+)`,
    "g"
  );
  for (const m of text.matchAll(between))
    out.push({ ...base, from: day(m[1]), time: day(m[2]), btc: num(m[3]), usd: money(m[4], m[5]), avgPrice: num(m[6]), holdings: null });
  const single = new RegExp(
    `On (${DATE}),[^.]{0,160}?(?:purchased|acquisition of) (?:approximately )?([\\d,]+) (?:additional )?bitcoins (?:at an aggregate purchase price of|for) (?:approximately )?\\$ ?([\\d,.]+) (million|billion)([^.]*?average price of (?:approximately )?\\$ ?([\\d,]+))?`,
    "g"
  );
  if (!out.length)
    for (const m of text.matchAll(single)) {
      const usd = money(m[3], m[4]);
      out.push({ ...base, time: day(m[1]), btc: num(m[2]), usd, avgPrice: m[6] ? num(m[6]) : Math.round(usd / num(m[2])), holdings: null });
    }
  const sale = new RegExp(`On (${DATE}),[^.]{0,80}? sold (?:approximately )?([\\d,]+) bitcoins for cash proceeds of (?:approximately )?\\$ ?([\\d,.]+) (million|billion)[^.]*?average price of (?:approximately )?\\$ ?([\\d,]+)`, "g");
  for (const m of text.matchAll(sale)) out.push({ ...base, time: day(m[1]), btc: -num(m[2]), usd: money(m[3], m[4]), avgPrice: num(m[5]), holdings: null });

  // The holdings figure belongs to the period ending on its date.
  if (held) for (const t of out) if (t.time === day(held[1])) t.holdings = holdings;
  return out;
}

// ---- fetching ----

function readStore(): Store {
  try {
    if (existsSync(storeFile)) return JSON.parse(readFileSync(storeFile, "utf8")) as Store;
  } catch {
    // start over
  }
  return { checkedAt: 0, filings: {} };
}

type Submissions = { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] };

async function getText(f: Fetch, url: string): Promise<string> {
  const res = await f(url);
  if (!res.ok) throw new Error(`sec edgar ${res.status} for ${url}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the filings not seen yet, saving as it goes. */
export async function refreshTreasuries(f: Fetch = defaultFetch, now = Date.now(), pause = 150): Promise<void> {
  const store = readStore();
  for (const filer of FILERS) {
      const cik = String(filer.cik).padStart(10, "0");
      const subs = JSON.parse(await getText(f, `https://data.sec.gov/submissions/CIK${cik}.json`)) as {
        filings: { recent: Submissions; files: Array<{ name: string; filingTo: string }> };
      };
      const lists = [subs.filings.recent];
      for (const file of subs.filings.files)
        if (file.filingTo >= SINCE) lists.push(JSON.parse(await getText(f, `https://data.sec.gov/submissions/${file.name}`)) as Submissions);
      for (const r of lists)
        for (let i = 0; i < r.form.length; i++) {
          const acc = r.accessionNumber[i];
          if (r.form[i] !== "8-K" || r.filingDate[i] < SINCE || store.filings[acc]) continue;
          const url = `https://www.sec.gov/Archives/edgar/data/${filer.cik}/${acc.replace(/-/g, "")}/${r.primaryDocument[i]}`;
          store.filings[acc] = parseTrades(filingText(await getText(f, url)), { company: filer.company, ticker: filer.ticker, url });
          writeFileSync(storeFile, JSON.stringify(store));
          await sleep(pause); // SEC asks for under 10 requests a second
        }
  }
  store.checkedAt = now;
  writeFileSync(storeFile, JSON.stringify(store));
}

let running: Promise<void> | null = null;
let lastAttempt = 0;

/** Every reported trade, oldest first; new 8-Ks are looked for in the background every few hours. */
export function treasuryTrades(f: Fetch = defaultFetch, now = Date.now()): TreasuryTrade[] {
  const store = readStore();
  if (!running && now - store.checkedAt > REFRESH_MS && now - lastAttempt > RETRY_MS) {
    lastAttempt = now;
    running = refreshTreasuries(f, now)
      .catch((err) => console.warn("treasuries:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = null;
      });
  }
  return consolidate(Object.values(store.filings).flat());
}

const DAY = 86_400;

/**
 * One trade per company and period. A week can be repeated in a later filing, and some filings
 * sum up a longer span: a quarter-to-date figure is cut down to the days the shorter reports
 * don't cover, and a summary of reported weeks is dropped.
 */
export function consolidate(all: TreasuryTrade[]): TreasuryTrade[] {
  const byKey = new Map<string, TreasuryTrade>();
  for (const t of all) {
    const key = `${t.ticker}:${t.from ?? ""}:${t.time}:${Math.sign(t.btc)}`;
    const prev = byKey.get(key);
    if (!prev || (prev.holdings === null && t.holdings !== null)) byKey.set(key, t);
  }
  const trades = [...byKey.values()].sort((a, b) => a.time - b.time || (b.from ?? b.time) - (a.from ?? a.time));
  const out: TreasuryTrade[] = [];
  for (const t of trades) {
    const from = t.from ?? t.time;
    const inside = out.filter((u) => u.ticker === t.ticker && u !== t && (u.from ?? u.time) >= from && u.time <= t.time && Math.sign(u.btc) === Math.sign(t.btc));
    if (!inside.length) {
      out.push({ ...t });
      continue;
    }
    if (!inside.some((u) => (u.from ?? u.time) === from)) continue;
    const btc = t.btc - inside.reduce((a, u) => a + u.btc, 0);
    const usd = t.usd !== null ? t.usd - inside.reduce((a, u) => a + (u.usd ?? 0), 0) : null;
    if (Math.sign(btc) !== Math.sign(t.btc) || Math.abs(btc) < 1) continue;
    const rest = Math.max(...inside.map((u) => u.time)) + DAY;
    out.push({ ...t, from: rest, btc, usd, avgPrice: usd !== null ? Math.round(Math.abs(usd / btc)) : null });
  }
  return out.sort((a, b) => a.time - b.time);
}
