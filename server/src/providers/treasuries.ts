import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { SEC_USER_AGENT } from "./secedgar.js";

// Crypto bought and sold by public "treasury" companies, from their own SEC 8-K filings — the
// institution alerts of the chart's "Whale & Institution Alerts", per coin:
//   BTC  Strategy (weekly; prose until mid-2025, a table since), Strive (weekly), MARA (sales)
//   ETH  BitMine (weekly holdings, so a week's trade is the change), Sharplink
//   TRX  Tron Inc
// Each 8-K (with its press-release exhibits) is fetched once and its parsed result kept in data/.

export type TreasuryTrade = {
  company: string;
  ticker: string;
  /** The coin: BTC, ETH, SOL, … */
  asset: string;
  /** Last day of the reported period, UTC midnight (unix seconds). */
  time: number;
  /** First day of the period, when the filing gives one. */
  from?: number;
  /** Coins; positive for bought, negative for sold. */
  amount: number;
  usd: number | null;
  avgPrice: number | null;
  /** Total held at the end of the period, when given. */
  holdings: number | null;
  url: string;
};

type Filer = {
  cik: number;
  company: string;
  ticker: string;
  since: string;
  /** Read the press releases (EX-99) too, not only the 8-K itself. */
  exhibits: boolean;
  /** Reports only its holdings each week: trades are the changes between reports. */
  holdingsOf?: string;
};

const FILERS: Filer[] = [
  { cik: 1050446, company: "Strategy", ticker: "MSTR", since: "2020-08-01", exhibits: false },
  { cik: 1920406, company: "Strive", ticker: "ASST", since: "2025-05-01", exhibits: true },
  { cik: 1507605, company: "MARA", ticker: "MARA", since: "2025-01-01", exhibits: true },
  { cik: 1829311, company: "BitMine", ticker: "BMNR", since: "2025-06-01", exhibits: true, holdingsOf: "ETH" },
  { cik: 1981535, company: "Sharplink", ticker: "SBET", since: "2025-05-01", exhibits: true },
  { cik: 1956744, company: "Tron Inc", ticker: "TRON", since: "2025-06-01", exhibits: true },
];

const VERSION = 3;
const DAY = 86_400;
const REFRESH_MS = 3 * 3_600_000;
const RETRY_MS = 10 * 60_000;
const storeFile = join(dataDir, "crypto-treasuries.json");

type Parsed = { trades: TreasuryTrade[]; holding?: { asset: string; time: number; amount: number } };
type Store = { version: number; checkedAt: number; filings: Record<string, Parsed & { ticker: string; url: string }> };

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": SEC_USER_AGENT } });

// ---- parsing ----

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE = `(?:${MONTHS}) \\d{1,2}, \\d{4}`;
// "1,107", "1800", "2.3", and BitMine's occasional "5, 815,164".
const NUM = "\\d{1,3}(?:, ?\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const ASSET = "(bitcoins?|BTC|ETH|ether|SOL|TRX|LTC|HYPE|BNB)(?: tokens)?\\b";

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
const scale = (n: number, unit?: string) => n * (unit === "million" ? 1e6 : unit === "thousand" ? 1e3 : 1);
const assetOf = (word: string) => (/^(bitcoin|btc)/i.test(word) ? "BTC" : /^(eth|ether)$/i.test(word) ? "ETH" : word.toUpperCase());

/** The dollar total and average price in the rest of a sentence about a trade. */
function terms(tail: string, amount: number): { usd: number | null; avgPrice: number | null } {
  const total = tail.match(/(?:for|proceeds of|aggregate (?:purchase |sale )?price of) (?:approximately )?\$ ?([\d,.]+) (million|billion)/);
  const avg = tail.match(/average (?:purchase |sale )?price of (?:approximately )?\$ ?([\d,]+(?:\.\d+)?)/);
  const usd = total ? money(total[1], total[2]) : avg ? Math.abs(amount) * num(avg[1]) : null;
  const avgPrice = avg ? num(avg[1]) : usd !== null ? Math.round(usd / Math.abs(amount)) : null;
  return { usd, avgPrice };
}

type Base = { company: string; ticker: string; url: string; /** Filing date, YYYY-MM-DD. */ filed: string };

/**
 * The trades an 8-K reports, one per period: Strategy's "During Period … BTC Acquired | …" table,
 * and prose such as "during the period between A and B, … acquired approximately N bitcoins for
 * approximately $X million …, at an average price of approximately $P", "Between A and B, the
 * Company sold N bitcoin …", "On A, … purchased N bitcoins …" or "Bought N ETH at an average price
 * of …" (dated by the filing).
 */
export function parseTrades(text: string, base: Base): TreasuryTrade[] {
  const { filed, ...who } = base;
  const out: TreasuryTrade[] = [];

  // Strategy's tables: one block per "During Period A to B". The figures follow the column headers
  // in a fixed order: BTC, aggregate price ($M), average price, holdings, aggregate cost ($B), average cost.
  const periods = [...text.matchAll(new RegExp(`During Period (${DATE}) to (${DATE})\\*?`, "g"))];
  periods.forEach((m, k) => {
    const end = periods[k + 1]?.index ?? m.index! + 1500;
    let block = text.slice(m.index! + m[0].length, end);
    // The 8-Ks also have "During Period" tables for stock sales.
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
    const amount = sold ? -btc : btc;
    out.push({ ...who, asset: "BTC", from: day(m[1]), time: day(m[2]), amount, usd: Math.abs(usdM) * 1e6, avgPrice: Math.abs(avg), holdings });
  });
  if (out.length) return out;

  // A sentence's verb, amount and coin, and the rest of the sentence (decimals don't end it).
  const trade = `\\b(purchased|acquired|bought|sold|acquisition of) (?:approximately )?(${NUM})(?: (million|thousand))? (?:additional )?${ASSET}((?:[^.]|\\.\\d)*)`;
  const push = (verb: string, n: string, unit: string | undefined, word: string, tail: string, time: number, from?: number) => {
    const amount = scale(num(n), unit) * (/sold/i.test(verb) ? -1 : 1);
    out.push({ ...who, asset: assetOf(word), from, time, amount, ...terms(tail, amount), holdings: null });
  };

  const period = new RegExp(`(?:period (?:between|from) |\\b[Bb]etween |\\b[Ff]rom )((?:${MONTHS}) \\d{1,2}(?:, \\d{4})?) (?:and|through|to) (${DATE})\\)?,[^.]*?${trade}`, "g");
  // MARA's "Between March 4 and March 25, 2026" gives the year once.
  const start = (a: string, b: string) => day(/\d{4}$/.test(a) ? a : `${a}, ${b.slice(-4)}`);
  for (const m of text.matchAll(period)) push(m[3], m[4], m[5], m[6], m[7], day(m[2]), start(m[1], m[2]));

  if (!out.length) {
    // 2020-style "On December 4, 2020, … purchased approximately 2,574 bitcoins for …"
    for (const m of text.matchAll(new RegExp(`On (${DATE}),[^.]{0,160}?${trade}`, "g"))) push(m[2], m[3], m[4], m[5], m[6], day(m[1]));
    // Tron's "acquired approximately 181,346 TRX tokens on February 11 at an average price …"
    const onDay = new RegExp(`\\b(purchased|acquired|bought|sold) (?:approximately )?(${NUM})(?: (million|thousand))? ${ASSET} on ((?:${MONTHS}) \\d{1,2})(?:, (\\d{4}))?((?:[^.]|\\.\\d)*)`, "g");
    for (const m of text.matchAll(onDay)) push(m[1], m[2], m[3], m[4], m[7], day(`${m[5]}, ${m[6] ?? filed.slice(0, 4)}`));
  }
  if (!out.length) {
    // Sharplink's "Bought 10,000 ETH at an average price of approximately $1,611 per ETH".
    // Only the first: a filing's highlights repeat it.
    const m = text.match(new RegExp(`\\b(purchased|acquired|bought|sold) (?:approximately )?(${NUM})(?: (million|thousand))? ${ASSET}( at an average (?:[^.]|\\.\\d)*)`, "i"));
    if (m) push(m[1], m[2], m[3], m[4], m[5], Date.parse(`${filed}T00:00:00Z`) / 1000);
  }

  // A holdings figure belongs to the period ending on its date.
  const held = text.match(new RegExp(`As of (${DATE}),[^.]{0,160}?(?:held|holds) (?:an aggregate of )?(?:approximately )?([\\d,]+) bitcoins`));
  if (held) for (const t of out) if (t.time === day(held[1])) t.holdings = num(held[2]);
  return out;
}

/** "As of September 27, 2026 at 3:00pm ET, the Company's crypto holdings are comprised of 6,001,302 ETH …" */
export function parseHolding(text: string, asset: string, filed: string): Parsed["holding"] {
  // Also "As of January 19th at 5:00pm ET": no year, so the filing's (or the one before, in early January).
  const re = new RegExp(
    `As of ((?:${MONTHS}) \\d{1,2})(?:st|nd|rd|th)?(?:, (\\d{4}))?(?: at [^,]{1,24})?,[^.]{0,160}?(?:comprised of|held|holds|totaled|totaling)(?: approximately)? (${NUM})(?: (million))? ${ASSET}`,
    "g"
  );
  const filedAt = Date.parse(`${filed}T00:00:00Z`) / 1000;
  for (const m of text.matchAll(re)) {
    if (assetOf(m[5]) !== asset) continue;
    const year = Number(m[2] ?? filed.slice(0, 4));
    let time = day(`${m[1]}, ${year}`);
    if (!m[2] && time > filedAt + 7 * DAY) time = day(`${m[1]}, ${year - 1}`);
    return { asset, time, amount: scale(num(m[3]), m[4]) };
  }
  return undefined;
}


/** Trades from a company's successive holdings reports: each report's change since the last. */
export function holdingChanges(company: string, ticker: string, reports: Array<NonNullable<Parsed["holding"]> & { url: string }>): TreasuryTrade[] {
  const sorted = [...new Map(reports.map((r) => [r.time, r])).values()].sort((a, b) => a.time - b.time);
  const out: TreasuryTrade[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const [prev, cur] = [sorted[i - 1], sorted[i]];
    const amount = cur.amount - prev.amount;
    // Two reports in one week differ only by rounding.
    if (Math.abs(amount) < cur.amount * 2e-4) continue;
    out.push({ company, ticker, asset: cur.asset, from: prev.time + DAY, time: cur.time, amount, usd: null, avgPrice: null, holdings: cur.amount, url: cur.url });
  }
  return out;
}

/**
 * One trade per company, coin and period. A week can be repeated in a later filing, and some
 * filings sum up a longer span: a quarter-to-date figure is cut down to the days the shorter
 * reports don't cover, and a summary of reported weeks is dropped.
 */
export function consolidate(all: TreasuryTrade[]): TreasuryTrade[] {
  const byKey = new Map<string, TreasuryTrade>();
  for (const t of all) {
    const key = `${t.ticker}:${t.asset}:${t.from ?? ""}:${t.time}:${Math.sign(t.amount)}`;
    const prev = byKey.get(key);
    if (!prev || (prev.holdings === null && t.holdings !== null)) byKey.set(key, t);
  }
  const trades = [...byKey.values()].sort((a, b) => a.time - b.time || (b.from ?? b.time) - (a.from ?? a.time));
  const out: TreasuryTrade[] = [];
  for (const t of trades) {
    const from = t.from ?? t.time;
    const inside = out.filter(
      (u) => u.ticker === t.ticker && u.asset === t.asset && (u.from ?? u.time) >= from && u.time <= t.time && Math.sign(u.amount) === Math.sign(t.amount)
    );
    if (!inside.length) {
      out.push({ ...t });
      continue;
    }
    if (!inside.some((u) => (u.from ?? u.time) === from)) continue;
    const amount = t.amount - inside.reduce((a, u) => a + u.amount, 0);
    const usd = t.usd !== null ? t.usd - inside.reduce((a, u) => a + (u.usd ?? 0), 0) : null;
    if (Math.sign(amount) !== Math.sign(t.amount) || Math.abs(amount) < 1) continue;
    const rest = Math.max(...inside.map((u) => u.time)) + DAY;
    out.push({ ...t, from: rest, amount, usd, avgPrice: usd !== null ? Math.round(Math.abs(usd / amount)) : null });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---- fetching ----

function readStore(): Store {
  try {
    if (existsSync(storeFile)) {
      const store = JSON.parse(readFileSync(storeFile, "utf8")) as Store;
      if (store.version === VERSION) return store;
    }
  } catch {
    // start over
  }
  return { version: VERSION, checkedAt: 0, filings: {} };
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
  const get = async (url: string) => {
    const text = await getText(f, url);
    await sleep(pause); // SEC asks for under 10 requests a second
    return text;
  };
  for (const filer of FILERS) {
    const cik = String(filer.cik).padStart(10, "0");
    const subs = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`)) as {
      filings: { recent: Submissions; files: Array<{ name: string; filingTo: string }> };
    };
    const lists = [subs.filings.recent];
    for (const file of subs.filings.files)
      if (file.filingTo >= filer.since) lists.push(JSON.parse(await get(`https://data.sec.gov/submissions/${file.name}`)) as Submissions);
    for (const r of lists)
      for (let i = 0; i < r.form.length; i++) {
        const acc = r.accessionNumber[i];
        if (r.form[i] !== "8-K" || r.filingDate[i] < filer.since || store.filings[acc]) continue;
        const folder = `https://www.sec.gov/Archives/edgar/data/${filer.cik}/${acc.replace(/-/g, "")}/`;
        const docs = [r.primaryDocument[i]];
        if (filer.exhibits) {
          const index = JSON.parse(await get(`${folder}index.json`)) as { directory: { item: Array<{ name: string }> } };
          for (const it of index.directory.item) if (/\.htm$/i.test(it.name) && /ex-?99|dex99/i.test(it.name)) docs.push(it.name);
        }
        let text = "";
        for (const doc of docs) text += " " + filingText(await get(folder + doc));
        const url = folder + r.primaryDocument[i];
        store.filings[acc] = {
          ticker: filer.ticker,
          url,
          trades: filer.holdingsOf ? [] : parseTrades(text, { company: filer.company, ticker: filer.ticker, url, filed: r.filingDate[i] }),
          holding: filer.holdingsOf ? parseHolding(text, filer.holdingsOf, r.filingDate[i]) : undefined,
        };
        writeFileSync(storeFile, JSON.stringify(store));
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
  const filings = Object.entries(store.filings);
  const trades = filings.flatMap(([, p]) => p.trades);
  for (const filer of FILERS.filter((x) => x.holdingsOf)) {
    const reports = filings.flatMap(([, p]) => (p.ticker === filer.ticker && p.holding ? [{ ...p.holding, url: p.url }] : []));
    trades.push(...holdingChanges(filer.company, filer.ticker, reports));
  }
  return consolidate(trades);
}
