// A US stock's big holders' buys and sales, from their Schedule 13G / 13D filings to the SEC: who
// holds 5% or more (BlackRock, Vanguard, State Street, an activist …), how many shares, and how
// that changed from the holder's filing before. Each filing is read once and kept in data/.
//   - Since 2025 the schedules are XML ("SCHEDULE 13G/A": primary_doc.xml), with the holder, the
//     shares and the percent as fields.
//   - Before, an HTML or text document: the figures follow "Aggregate amount beneficially owned"
//     and "Percent of class"; the holder's name is the filing's "FILED BY" company.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { dataDir } from "../db.js";
import { SEC_USER_AGENT, resolveCik } from "./secedgar.js";

export type HolderFiling = {
  accession: string;
  holder: string;
  shares: number | null;
  percent: number | null;
  /** The event the filing reports (or, failing that, its filing date), unix seconds. */
  time: number;
  form: string;
  url: string;
  /** Not a sale or a buy: a holder's shares counted under other entities from now on. */
  realignment: boolean;
};

const FORMS = /^(SC 13[GD]|SCHEDULE 13[GD])(\/A)?$/;
const YEARS = 4;
const MAX_FILINGS = 40;
const storeFile = join(dataDir, "holders13g.json");
const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

type Store = { version: number; filings: Record<string, HolderFiling | null> };
const VERSION = 2;

function readStore(): Store {
  try {
    if (existsSync(storeFile)) {
      const s = JSON.parse(readFileSync(storeFile, "utf8")) as Store;
      if (s.version === VERSION) return s;
    }
  } catch {
    // start over
  }
  return { version: VERSION, filings: {} };
}

const num = (s: string | number | undefined | null) => {
  if (s === undefined || s === null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const day = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);

/** "03/13/2026" → unix seconds. */
function usDate(s: string | undefined): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) / 1000 : null;
}

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The holder, shares and percent of a Schedule 13G/13D in the XML format. */
export function parseXml13g(doc: string): Pick<HolderFiling, "holder" | "shares" | "percent" | "realignment"> & { event: number | null; issuer: number | null } {
  const root = xml.parse(doc)?.edgarSubmission?.formData ?? {};
  const issuer = num(root.coverPageHeader?.issuerInfo?.issuerCik);
  // Several reporting persons (a parent and its funds): the biggest holding is the parent's.
  const persons = asList(root.coverPageHeaderReportingPersonDetails) as any[];
  const top = persons.sort((a, b) => (num(b?.reportingPersonBeneficiallyOwnedAggregateNumberOfShares) ?? 0) - (num(a?.reportingPersonBeneficiallyOwnedAggregateNumberOfShares) ?? 0))[0] ?? {};
  const comments = persons.map((p) => String(p?.comments ?? "")).join(" ");
  return {
    holder: String(top.reportingPersonName ?? root.items?.item2?.filingPersonName ?? "").trim(),
    shares: num(top.reportingPersonBeneficiallyOwnedAggregateNumberOfShares ?? root.items?.item4?.amountBeneficiallyOwned),
    percent: num(top.classPercent ?? root.items?.item4?.classPercent),
    realignment: /realignment|disaggregated/i.test(comments),
    event: usDate(root.coverPageHeader?.eventDateRequiresFilingThisStatement),
    issuer,
  };
}

/** The shares and percent of an older, HTML or text Schedule 13G/13D. */
export function parseText13g(text: string): { shares: number | null; percent: number | null } {
  const flat = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  // "Aggregate amount beneficially owned by each reporting person … 1,043,713,019", "(a) Amount
  // Beneficially Owned: 998,190,803"; the row numbers in between ("Row 9") are passed over.
  const shares = /Amount Beneficially Owned[\s\S]{0,250}?(\d{1,3}(?:,\d{3})+|\d{5,})/i.exec(flat);
  const percent = /Percent of Class[\s\S]{0,200}?(\d{1,3}(?:\.\d+)?)\s*%/i.exec(flat);
  return { shares: shares ? num(shares[1]) : null, percent: percent ? num(percent[1]) : null };
}

/** The "FILED BY" company of a filing's header. */
export function filerOf(headers: string): string | null {
  const m = /FILED BY:[\s\S]*?COMPANY CONFORMED NAME:\s*([^\n<]+)/i.exec(headers);
  return m ? m[1].trim() : null;
}

/** The CIK of the company a filing is about ("SUBJECT COMPANY"). */
export function subjectOf(headers: string): number | null {
  const m = /SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*(\d+)/i.exec(headers);
  return m ? Number(m[1]) : null;
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": SEC_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`sec edgar ${res.status} for ${url}`);
  await new Promise((r) => setTimeout(r, 120)); // SEC asks for under 10 requests a second
  return res.text();
}

async function readFiling(cik: number, acc: string, form: string, filed: string, primary: string): Promise<HolderFiling | null> {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/`;
  const url = `${folder}${acc}-index.htm`;
  if (/primary_doc\.xml$/.test(primary)) {
    const p = parseXml13g(await get(`${folder}primary_doc.xml`));
    // The company's own filings about another's shares (NVIDIA holding 5% of one) aren't its holders'.
    if (!p.holder || (p.issuer !== null && p.issuer !== cik)) return null;
    return { accession: acc, holder: p.holder, shares: p.shares, percent: p.percent, time: p.event ?? day(filed), form, url, realignment: p.realignment };
  }
  const [doc, headers] = await Promise.all([get(folder + primary), get(`${folder}${acc}-index-headers.html`)]);
  const holder = filerOf(headers);
  const subject = subjectOf(headers);
  if (!holder || (subject !== null && subject !== cik)) return null;
  const p = parseText13g(doc);
  return { accession: acc, holder, ...p, time: day(filed), form, url, realignment: false };
}

const running = new Map<string, Promise<void>>();

/** The stock's 13G/13D filings of the last years, oldest first (reading the new ones, kept after). */
export async function holderFilings(symbol: string, now = Date.now()): Promise<HolderFiling[]> {
  const cik = await resolveCik(symbol);
  if (!cik) return [];
  const subs = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`));
  const r = subs?.filings?.recent;
  if (!r) return [];
  const since = new Date(now - YEARS * 365 * 86_400_000).toISOString().slice(0, 10);
  const refs: Array<{ acc: string; form: string; filed: string; primary: string }> = [];
  for (let i = 0; i < r.form.length && refs.length < MAX_FILINGS; i++) {
    if (FORMS.test(r.form[i]) && r.filingDate[i] >= since) refs.push({ acc: r.accessionNumber[i], form: r.form[i], filed: r.filingDate[i], primary: r.primaryDocument[i] });
  }
  const store = readStore();
  const missing = refs.filter((f) => !(f.acc in store.filings));
  if (missing.length) {
    // One reader per stock at a time; the filings it reads are kept for everyone after.
    const key = cik;
    let job = running.get(key);
    if (!job) {
      job = (async () => {
        for (const f of missing) {
          try {
            const parsed = await readFiling(Number(cik), f.acc, f.form, f.filed, f.primary);
            const s = readStore();
            s.filings[f.acc] = parsed;
            writeFileSync(storeFile, JSON.stringify(s));
          } catch (err) {
            console.warn("13g:", err instanceof Error ? err.message : err);
          }
        }
      })().finally(() => running.delete(key));
      running.set(key, job);
    }
    // A first look waits a little for them; after that the list fills in as they're read.
    await Promise.race([job, new Promise((r) => setTimeout(r, 6000))]);
  }
  const done = readStore();
  return refs
    .map((f) => done.filings[f.acc])
    .filter((f): f is HolderFiling => Boolean(f))
    .sort((a, b) => a.time - b.time);
}

/** A holder as one name across its filings ("BlackRock Inc." and "BlackRock, Inc."). */
export const holderKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|plc|co|group|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type HolderChange = HolderFiling & {
  /** Shares more (positive) or fewer than the holder's filing before; null for its first here. */
  change: number | null;
};

/**
 * Each filing with the change from the same holder's filing before it. Counted from the percent of
 * the company held when both filings give it (a stock split multiplies the shares, not the
 * percent): the earlier stake in today's shares is today's shares × earlier % ÷ today's %. From the
 * shares alone only when they can't have been split (less than double or half).
 */
export function holderChanges(filings: HolderFiling[]): HolderChange[] {
  const last = new Map<string, HolderFiling>();
  return filings.map((f) => {
    const key = holderKey(f.holder);
    const before = last.get(key);
    last.set(key, f);
    let change: number | null = null;
    if (before && f.shares !== null && before.shares !== null) {
      if (f.percent && before.percent !== null) change = Math.round(f.shares * (1 - before.percent / f.percent));
      else if (f.shares === 0 || f.percent === 0) change = -before.shares;
      else if (before.shares > 0 && f.shares / before.shares < 2 && f.shares / before.shares > 0.5) change = f.shares - before.shares;
    }
    return { ...f, change };
  });
}
