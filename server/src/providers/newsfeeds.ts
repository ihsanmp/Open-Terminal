import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

// Live news wire: ~58 RSS/Atom feeds merged into one stream. The source list follows
// FinceptTerminal's default feed catalog (wire services, regulators, financial media,
// regional and crypto outlets — the list only, no code: that project is AGPL), with
// Reuters and AP reached through Google News (their own RSS is gone or blocked) and a
// few Indonesian market sources added. WSJ's and MoneyControl's feeds from that catalog
// are left out: they still answer but stopped updating in 2024.
//
// Feeds are polled every 60 s while someone is reading, with ETag / Last-Modified so
// unchanged feeds cost a 304; RSS is as live as its publishers make it, typically a
// headline within a minute or two of posting.

export type NewsCategory = "MARKETS" | "ECONOMIC" | "REGULATORY" | "GEOPOLITICS" | "CRYPTO" | "ENERGY" | "TECH";
export type FeedDef = { id: string; name: string; url: string; category: NewsCategory; region: string; tier: number };

const gnews = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`when:1d ${query}`)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: FeedDef[] = [
  // Tier 1 — wires, central banks and regulators
  { id: "reuters-biz", name: "Reuters", url: gnews("site:reuters.com (markets OR business)"), category: "MARKETS", region: "GLOBAL", tier: 1 },
  { id: "ap-biz", name: "AP", url: gnews("site:apnews.com (business OR economy)"), category: "ECONOMIC", region: "GLOBAL", tier: 1 },
  { id: "sec-press", name: "SEC Press Releases", url: "https://www.sec.gov/news/pressreleases.rss", category: "REGULATORY", region: "US", tier: 1 },
  { id: "fed-press", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "REGULATORY", region: "US", tier: 1 },
  { id: "ecb-press", name: "ECB Press", url: "https://www.ecb.europa.eu/rss/press.html", category: "REGULATORY", region: "EU", tier: 1 },
  { id: "boe-news", name: "Bank of England", url: "https://www.bankofengland.co.uk/rss/news", category: "REGULATORY", region: "UK", tier: 1 },
  { id: "un-news", name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", category: "GEOPOLITICS", region: "GLOBAL", tier: 1 },

  // Tier 2 — major financial and world media
  { id: "bloomberg-mkts", name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "yahoo-top", name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", category: "MARKETS", region: "US", tier: 2 },
  { id: "marketwatch", name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/", category: "MARKETS", region: "US", tier: 2 },
  { id: "cnbc-finance", name: "CNBC Finance", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", category: "MARKETS", region: "US", tier: 2 },
  { id: "cnbc-world", name: "CNBC World", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "cnbc-tech", name: "CNBC Technology", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910", category: "TECH", region: "US", tier: 2 },
  { id: "seekingalpha", name: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml", category: "MARKETS", region: "US", tier: 2 },
  { id: "investing-news", name: "Investing.com", url: "https://www.investing.com/rss/news.rss", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "fxstreet", name: "FXStreet", url: "https://www.fxstreet.com/rss/news", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "benzinga", name: "Benzinga", url: "https://www.benzinga.com/feed", category: "MARKETS", region: "US", tier: 2 },
  { id: "mining-com", name: "Mining.com", url: "https://www.mining.com/feed/", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "economist", name: "The Economist", url: "https://www.economist.com/finance-and-economics/rss.xml", category: "ECONOMIC", region: "GLOBAL", tier: 2 },
  { id: "oilprice", name: "OilPrice.com", url: "https://oilprice.com/rss/main", category: "ENERGY", region: "GLOBAL", tier: 2 },
  { id: "bbc-business", name: "BBC Business", url: "http://feeds.bbci.co.uk/news/business/rss.xml", category: "MARKETS", region: "GLOBAL", tier: 2 },
  { id: "bbc-world", name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", category: "GEOPOLITICS", region: "GLOBAL", tier: 2 },
  { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "GEOPOLITICS", region: "GLOBAL", tier: 2 },
  { id: "nyt-world", name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", category: "GEOPOLITICS", region: "GLOBAL", tier: 2 },
  { id: "guardian-world", name: "Guardian World", url: "https://www.theguardian.com/world/rss", category: "GEOPOLITICS", region: "GLOBAL", tier: 2 },
  { id: "france24", name: "France 24", url: "https://www.france24.com/en/rss", category: "GEOPOLITICS", region: "EU", tier: 2 },
  { id: "dw-world", name: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-en-all", category: "GEOPOLITICS", region: "EU", tier: 2 },
  { id: "foreignpolicy", name: "Foreign Policy", url: "https://foreignpolicy.com/feed/", category: "GEOPOLITICS", region: "GLOBAL", tier: 2 },
  { id: "middle-east-eye", name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", category: "GEOPOLITICS", region: "MENA", tier: 2 },
  { id: "scmp", name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed", category: "GEOPOLITICS", region: "ASIA", tier: 2 },
  { id: "nikkei-asia", name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar", category: "MARKETS", region: "ASIA", tier: 2 },
  { id: "channel-news-asia", name: "CNA", url: "https://www.channelnewsasia.com/rssfeeds/8395986", category: "MARKETS", region: "ASIA", tier: 2 },
  { id: "cnbc-indonesia", name: "CNBC Indonesia", url: "https://www.cnbcindonesia.com/market/rss", category: "MARKETS", region: "INDONESIA", tier: 2 },
  { id: "antara-ekonomi", name: "Antara Ekonomi", url: "https://www.antaranews.com/rss/ekonomi.xml", category: "ECONOMIC", region: "INDONESIA", tier: 2 },
  { id: "hindu-biz", name: "The Hindu Business", url: "https://www.thehindu.com/business/feeder/default.rss", category: "MARKETS", region: "INDIA", tier: 2 },
  { id: "livemint", name: "LiveMint", url: "https://www.livemint.com/rss/markets", category: "MARKETS", region: "INDIA", tier: 2 },
  { id: "et-markets", name: "Economic Times", url: "https://economictimes.indiatimes.com/rssfeedstopstories.cms", category: "MARKETS", region: "INDIA", tier: 2 },
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "CRYPTO", region: "GLOBAL", tier: 2 },
  { id: "cointelegraph", name: "CoinTelegraph", url: "https://cointelegraph.com/rss", category: "CRYPTO", region: "GLOBAL", tier: 2 },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml", category: "CRYPTO", region: "GLOBAL", tier: 2 },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", category: "CRYPTO", region: "GLOBAL", tier: 2 },
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "TECH", region: "GLOBAL", tier: 2 },
  { id: "wired", name: "Wired", url: "https://www.wired.com/feed/rss", category: "TECH", region: "US", tier: 2 },
  { id: "finextra", name: "Finextra", url: "https://www.finextra.com/rss/headlines.aspx", category: "TECH", region: "GLOBAL", tier: 2 },

  // Tier 3–4 — analysis, blogs, aggregators
  { id: "zero-hedge", name: "ZeroHedge", url: "https://feeds.feedburner.com/zerohedge/feed", category: "ECONOMIC", region: "GLOBAL", tier: 3 },
  { id: "calculated-risk", name: "Calculated Risk", url: "https://feeds.feedburner.com/CalculatedRisk", category: "ECONOMIC", region: "US", tier: 3 },
  { id: "wolfstreet", name: "Wolf Street", url: "https://wolfstreet.com/feed/", category: "ECONOMIC", region: "US", tier: 3 },
  { id: "bellingcat", name: "Bellingcat", url: "https://www.bellingcat.com/feed/", category: "GEOPOLITICS", region: "GLOBAL", tier: 3 },
  { id: "arstechnica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "TECH", region: "GLOBAL", tier: 3 },
  { id: "theverge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "TECH", region: "GLOBAL", tier: 3 },
  { id: "mit-tech", name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", category: "TECH", region: "GLOBAL", tier: 3 },
  { id: "carbon-brief", name: "Carbon Brief", url: "https://www.carbonbrief.org/feed/", category: "ENERGY", region: "GLOBAL", tier: 3 },
  { id: "hackernews", name: "Hacker News", url: "https://hnrss.org/frontpage", category: "TECH", region: "GLOBAL", tier: 4 },
  { id: "abnormal-returns", name: "Abnormal Returns", url: "https://abnormalreturns.com/feed/", category: "MARKETS", region: "US", tier: 4 },
  { id: "marginal-rev", name: "Marginal Revolution", url: "https://marginalrevolution.com/feed", category: "ECONOMIC", region: "GLOBAL", tier: 4 },
];

export type WireItem = {
  id: string;
  title: string;
  link: string;
  summary: string;
  /** The outlet; for Google News items, the original publisher. */
  publisher: string;
  feedId: string;
  category: NewsCategory;
  region: string;
  tier: number;
  publishedAt: string;
  /** False when the feed gave no usable date and publishedAt is when the wire first saw it. */
  dated: boolean;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const POLL_MS = 60_000;
const IDLE_MS = 5 * 60_000;
/** Some feeds are frozen (WSJ's stopped in 2024); only recent items make the wire. */
const MAX_AGE_MS = 7 * 86_400_000;
const UNDATED_BACKLOG_MS = 12 * 3_600_000;

// Entities are decoded by stripHtml: the parser's own expansion trips its safety limit on
// long feeds (Guardian, ZeroHedge).
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", processEntities: false });

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"] ?? "");
  return String(v);
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text from an HTML fragment, whitespace collapsed. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function atomLink(link: unknown): string {
  for (const l of asList(link as Array<Record<string, string>> | Record<string, string>)) {
    if (typeof l === "string") return l;
    if (!l["@rel"] || l["@rel"] === "alternate") return l["@href"] ?? "";
  }
  return "";
}

/** Items of an RSS 2.0, RSS 1.0 (RDF) or Atom document. */
export function parseFeed(xml: string, feed: FeedDef, now = Date.now()): WireItem[] {
  const doc = parser.parse(xml);
  const rss = asList(doc?.rss?.channel?.item);
  const rdf = asList(doc?.["rdf:RDF"]?.item);
  const atom = asList(doc?.feed?.entry);
  const raw = [
    ...[...rss, ...rdf].map((i: any) => ({
      title: text(i.title),
      link: text(i.link) || text(i.guid),
      summary: text(i.description) || text(i["content:encoded"]),
      date: text(i.pubDate) || text(i["dc:date"]) || text(i.published),
      source: text(i.source),
    })),
    ...atom.map((e: any) => ({
      title: text(e.title),
      link: atomLink(e.link),
      summary: text(e.summary) || text(e.content),
      date: text(e.published) || text(e.updated),
      source: "",
    })),
  ];

  const out: WireItem[] = [];
  for (const r of raw) {
    let title = stripHtml(r.title);
    const link = r.link.trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    let publisher = feed.name;
    if (r.source) {
      // Google News titles end with " - Publisher".
      publisher = stripHtml(r.source);
      if (title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
    }
    const parsed = Date.parse(r.date);
    // Dates more than an hour ahead are feed bugs (Finextra's), treated as missing.
    const dated = Number.isFinite(parsed) && parsed <= now + 3_600_000;
    const at = dated ? Math.min(parsed, now) : now;
    if (now - at > MAX_AGE_MS) continue;
    let summary = stripHtml(stripHtml(r.summary)); // descriptions are often escaped HTML
    if (summary.length > 280) summary = summary.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    if (summary === title) summary = "";
    out.push({
      id: createHash("sha1").update(link).digest("hex").slice(0, 16),
      title,
      link,
      summary,
      publisher,
      feedId: feed.id,
      category: feed.category,
      region: feed.region,
      tier: feed.tier,
      publishedAt: new Date(at).toISOString(),
      dated,
    });
  }
  return out;
}

type FeedState = { etag?: string; lastModified?: string; items: WireItem[]; ok: boolean; error?: string; fetchedAt: number; failures: number };

const state = new Map<string, FeedState>();
/** First time each item was seen, so undated items keep a stable time. */
const firstSeen = new Map<string, number>();
let lastRefresh = 0;
let lastDemand = 0;
let running: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;

async function fetchFeed(feed: FeedDef): Promise<void> {
  const prev = state.get(feed.id);
  // Back off feeds that keep failing: skip 2^n polls, up to ~16 minutes.
  if (prev && prev.failures > 0 && Date.now() - prev.fetchedAt < POLL_MS * Math.min(16, 2 ** prev.failures)) return;
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  try {
    const res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 304 && prev) {
      state.set(feed.id, { ...prev, ok: true, error: undefined, fetchedAt: Date.now(), failures: 0 });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const now = Date.now();
    const items = parseFeed(await res.text(), feed, now).map((item) => {
      if (item.dated) return item;
      // Undated items take the time the wire first saw them. On a feed's first load that
      // says nothing about when they were published, so they go below the fresh news.
      const seen = firstSeen.get(item.id) ?? (prev ? now : now - UNDATED_BACKLOG_MS);
      firstSeen.set(item.id, seen);
      return { ...item, publishedAt: new Date(seen).toISOString() };
    });
    state.set(feed.id, {
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      items,
      ok: true,
      fetchedAt: now,
      failures: 0,
    });
  } catch (err) {
    state.set(feed.id, {
      ...(prev ?? { items: [] }),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: Date.now(),
      failures: (prev?.failures ?? 0) + 1,
    });
  }
}

async function refreshAll(): Promise<void> {
  const queue = [...FEEDS];
  const worker = async () => {
    for (let feed = queue.shift(); feed; feed = queue.shift()) await fetchFeed(feed);
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  lastRefresh = Date.now();
  // Forget items no feed carries any more.
  const live = new Set([...state.values()].flatMap((s) => s.items.map((i) => i.id)));
  for (const id of firstSeen.keys()) if (!live.has(id)) firstSeen.delete(id);
}

function schedule() {
  if (timer) return;
  timer = setInterval(() => {
    if (Date.now() - lastDemand > IDLE_MS) {
      clearInterval(timer!);
      timer = null;
      return;
    }
    if (!running) running = refreshAll().finally(() => (running = null));
  }, POLL_MS);
  timer.unref?.();
}

/** Waits for the first load only; after that callers get what's in memory while the
 *  poller keeps it fresh. */
async function ensureFresh(): Promise<void> {
  lastDemand = Date.now();
  schedule();
  if (lastRefresh === 0) {
    running ??= refreshAll().finally(() => (running = null));
    await running;
  } else if (Date.now() - lastRefresh > POLL_MS && !running) {
    running = refreshAll().finally(() => (running = null));
  }
}

const normalize = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 90);

/** Newest first; the same story from several outlets is kept once, from the best tier. */
export function mergeItems(lists: WireItem[][]): WireItem[] {
  const byKey = new Map<string, WireItem>();
  for (const item of lists.flat()) {
    const key = normalize(item.title);
    const have = byKey.get(key);
    if (!have || item.tier < have.tier || (item.tier === have.tier && item.publishedAt < have.publishedAt)) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export type WireQuery = { category?: string; region?: string; q?: string; limit?: number };

export async function wire(query: WireQuery = {}) {
  await ensureFresh();
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let items = mergeItems([...state.values()].map((s) => s.items));
  if (query.category) items = items.filter((i) => i.category === query.category);
  if (query.region) items = items.filter((i) => i.region === query.region);
  if (words.length) {
    items = items.filter((i) => {
      const hay = `${i.title} ${i.summary} ${i.publisher}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const states = [...state.values()];
  return {
    updatedAt: new Date(lastRefresh).toISOString(),
    sources: { total: FEEDS.length, live: states.filter((s) => s.ok).length },
    items: items.slice(0, Math.min(500, Math.max(1, query.limit ?? 200))),
  };
}

/** Per-feed health, for the source list in the UI. */
export function feedStatus() {
  return FEEDS.map((f) => {
    const s = state.get(f.id);
    return { id: f.id, name: f.name, category: f.category, region: f.region, tier: f.tier, ok: s?.ok ?? null, error: s?.error ?? null, items: s?.items.length ?? 0, fetchedAt: s ? new Date(s.fetchedAt).toISOString() : null };
  });
}
