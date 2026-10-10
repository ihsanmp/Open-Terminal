// What the US spot ETFs (BlackRock's IBIT, Fidelity's FBTC, Grayscale's GBTC …) took in or paid
// out each day, in US$ millions per fund, from Farside Investors' tables (farside.co.uk) for
// Bitcoin, Ether and Solana. Read at most every three hours and kept on disk.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { dataDir } from "../db.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const REFRESH_MS = 3 * 3_600_000;
const RETRY_MS = 20 * 60_000;

/** The coins Farside covers, by base asset, and the page for each. */
export const ETF_PAGES: Record<string, string> = { BTC: "btc", ETH: "eth", SOL: "sol" };

/** Each fund's issuer, by ticker. */
export const ETF_ISSUERS: Record<string, string> = {
  IBIT: "BlackRock", FBTC: "Fidelity", BITB: "Bitwise", ARKB: "ARK 21Shares", BTCO: "Invesco Galaxy", EZBC: "Franklin Templeton",
  BRRR: "CoinShares Valkyrie", HODL: "VanEck", BTCW: "WisdomTree", MSBT: "Morgan Stanley", GBTC: "Grayscale", BTC: "Grayscale Mini",
  ETHA: "BlackRock", ETHB: "BlackRock", FETH: "Fidelity", ETHW: "Bitwise", TETH: "21Shares", ETHV: "VanEck", QETH: "Invesco Galaxy",
  EZET: "Franklin Templeton", MSSE: "Morgan Stanley", ETHE: "Grayscale", ETH: "Grayscale Mini",
  BSOL: "Bitwise", VSOL: "VanEck", FSOL: "Fidelity", TSOL: "21Shares", SOEZ: "Franklin Templeton", MSOL: "Morgan Stanley", GSOL: "Grayscale",
};

export type EtfFlow = { ticker: string; issuer: string; date: string; usdMillions: number };

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "(207.7)" → -207.7, "1,119.9" → 1119.9, "" or "-" → null. */
export function amountOf(cell: string): number | null {
  const t = cell.replace(/,/g, "").trim();
  if (!t || t === "-") return null;
  const neg = /^\(.*\)$/.test(t);
  const v = Number(t.replace(/[()]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

/** Every fund's flow on every day of a Farside table, the days with none left out. */
export function parseFarside(html: string): EtfFlow[] {
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
    [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
  );
  // The header row is the one naming the funds (IBIT, FBTC …).
  const header = rows.find((r) => r.some((c) => ETF_ISSUERS[c]));
  if (!header) return [];
  const out: EtfFlow[] = [];
  for (const r of rows) {
    const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(r[0] ?? "");
    if (!m || !MONTHS[m[2]]) continue;
    const date = `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
    header.forEach((ticker, i) => {
      if (i === 0 || !ticker || ticker === "Total") return;
      const v = amountOf(r[i] ?? "");
      if (v !== null && v !== 0) out.push({ ticker, issuer: ETF_ISSUERS[ticker] ?? ticker, date, usdMillions: v });
    });
  }
  return out;
}

/** Earlier days and the latest table together, by date, the last 400 days only. */
export function mergeFlows(earlier: EtfFlow[], latest: EtfFlow[], keepDays = 400): EtfFlow[] {
  const all = [...earlier, ...latest].sort((a, b) => a.date.localeCompare(b.date));
  const last = all[all.length - 1]?.date;
  if (!last) return [];
  const cutoff = new Date(Date.parse(`${last}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10);
  return all.filter((f) => f.date >= cutoff);
}

type Store = Record<string, { fetchedAt: number; flows: EtfFlow[] }>;
const storeFile = join(dataDir, "etf-flows.json");
let store: Store | null = null;
const running = new Map<string, Promise<void>>();
const lastTry = new Map<string, number>();

function read(): Store {
  try {
    if (existsSync(storeFile)) return JSON.parse(readFileSync(storeFile, "utf8")) as Store;
  } catch {
    // start over
  }
  return {};
}

/**
 * A page through Node's own https client: Farside's Cloudflare turns fetch() away (403) by how
 * its connection looks, while a plain request with a browser's User-Agent goes through.
 */
function page(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, timeout: 25_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`farside ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (d: string) => (body += d));
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("farside: timed out")));
    req.on("error", reject);
  });
}

async function refresh(base: string): Promise<void> {
  const flows = parseFarside(await page(`https://farside.co.uk/${ETF_PAGES[base]}/`));
  if (!flows.length) throw new Error("farside: no flows in the table");
  // The page shows the last few weeks: the days it no longer shows are kept from before.
  const now = store ?? read();
  const shownDays = new Set(flows.map((f) => f.date));
  const kept = (now[base]?.flows ?? []).filter((f) => !shownDays.has(f.date));
  const merged = mergeFlows(kept, flows);
  store = { ...now, [base]: { fetchedAt: Date.now(), flows: merged } };
  writeFileSync(storeFile, JSON.stringify(store));
}

/** The ETF flows known for a coin; read again when due (waited for only the first time). */
export async function etfFlows(base: string, now = Date.now()): Promise<EtfFlow[]> {
  if (!ETF_PAGES[base]) return [];
  store ??= read();
  const have = store[base];
  if ((!have || now - have.fetchedAt > REFRESH_MS) && !running.has(base) && now - (lastTry.get(base) ?? 0) > RETRY_MS) {
    lastTry.set(base, now);
    const p = refresh(base)
      .catch((err) => console.warn("etf flows:", err instanceof Error ? err.message : err))
      .finally(() => running.delete(base));
    running.set(base, p);
    if (!have) await p;
  }
  return store[base]?.flows ?? [];
}
