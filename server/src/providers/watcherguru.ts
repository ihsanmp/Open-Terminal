// Watcher Guru (watcher.guru/news): its articles — markets, stocks, crypto, policy — from the site's
// public WordPress API, a page at a time, by category or search, and each article's text to read
// in the app. The article HTML is cut down to plain text markup (paragraphs, headings, lists,
// links, images) before it leaves the server.

const API = "https://watcher.guru/news/wp-json/wp/v2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** The site's main sections, as WordPress category ids. */
export const WG_CATEGORIES: Array<{ id: number; name: string }> = [
  { id: 3199, name: "Markets" },
  { id: 3197, name: "Stocks" },
  { id: 3195, name: "Business" },
  { id: 3198, name: "Policy" },
  { id: 4258, name: "BRICS" },
  { id: 4, name: "Bitcoin" },
  { id: 5, name: "Ethereum" },
  { id: 5052, name: "XRP" },
  { id: 2, name: "General Crypto" },
  { id: 10, name: "Altcoins" },
];

export type WGPost = {
  id: number;
  title: string;
  link: string;
  publishedAt: string;
  excerpt: string;
  image: string | null;
  categories: string[];
  tags: string[];
  author: string | null;
};
export type WGPage = { posts: WGPost[]; page: number; totalPages: number };
export type WGArticle = WGPost & { html: string };

// ---------------------------------------------------------------- text and HTML

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML fragment. */
export const textOf = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (s: string) => s.replace(/&(?!(#x?[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tags kept, and the attributes each may keep. */
const ALLOWED: Record<string, string[]> = {
  p: [], br: [], h2: [], h3: [], h4: [], ul: [], ol: [], li: [], strong: [], b: [], em: [], i: [], blockquote: [],
  figure: [], figcaption: [], table: [], thead: [], tbody: [], tr: [], th: [], td: [], hr: [],
  a: ["href"],
  img: ["src", "alt"],
};
const VOID = new Set(["br", "img", "hr"]);
/** Dropped with everything inside them. */
const DROP = /<(script|style|iframe|noscript|object|embed|svg|math|form|template|video|audio|button|select|textarea)\b[\s\S]*?<\/\1\s*>/gi;

function attrsOf(tag: string, raw: string): string {
  const keep = ALLOWED[tag];
  const out: string[] = [];
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = m[1].toLowerCase();
    if (!keep.includes(name)) continue;
    const value = decode(m[3] ?? m[4] ?? m[5] ?? "").trim();
    // Links and pictures only over http(s): no javascript:, data: or the like.
    if ((name === "href" || name === "src") && !/^https?:\/\//i.test(value)) continue;
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  if (tag === "a") out.push('target="_blank"', 'rel="noreferrer noopener"');
  if (tag === "img") out.push('loading="lazy"');
  return out.length ? " " + out.join(" ") : "";
}

/**
 * The article's markup with only text tags left: every other tag and every attribute but a
 * link's address and a picture's source and caption go, and so do scripts, frames and forms with
 * their insides. What isn't a tag is escaped, so nothing can open one.
 */
export function sanitize(html: string): string {
  const src = html.replace(/<!--[\s\S]*?-->/g, "").replace(DROP, "");
  let out = "";
  let at = 0;
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const m of src.matchAll(tagRe)) {
    out += escapeText(src.slice(at, m.index));
    at = m.index! + m[0].length;
    const tag = m[2].toLowerCase();
    if (!(tag in ALLOWED)) continue;
    if (m[1]) out += VOID.has(tag) ? "" : `</${tag}>`;
    else out += `<${tag}${attrsOf(tag, m[3])}>`;
  }
  out += escapeText(src.slice(at));
  // Paragraphs left empty by what was taken out.
  return out.replace(/<p>\s*<\/p>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- the API

type Raw = {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt?: { rendered: string };
  content?: { rendered: string };
  _embedded?: {
    author?: Array<{ name?: string }>;
    "wp:featuredmedia"?: Array<{ source_url?: string; media_details?: { sizes?: Record<string, { source_url: string; width: number }> } }>;
    "wp:term"?: Array<Array<{ taxonomy: string; name: string }>>;
  };
};

export function toPost(r: Raw): WGPost {
  const media = r._embedded?.["wp:featuredmedia"]?.[0];
  const sizes = media?.media_details?.sizes ?? {};
  const image = sizes.medium_large?.source_url ?? sizes.large?.source_url ?? sizes.medium?.source_url ?? media?.source_url ?? null;
  const terms = (r._embedded?.["wp:term"] ?? []).flat();
  return {
    id: r.id,
    title: textOf(r.title.rendered),
    link: r.link,
    publishedAt: new Date(`${r.date_gmt}Z`).toISOString(),
    excerpt: textOf(r.excerpt?.rendered ?? "").replace(/\s*\[?…\]?$/, "…"),
    image: image && /^https:\/\//.test(image) ? image : null,
    categories: terms.filter((t) => t.taxonomy === "category").map((t) => decode(t.name)),
    tags: terms.filter((t) => t.taxonomy === "post_tag").map((t) => decode(t.name)),
    author: r._embedded?.author?.[0]?.name ?? null,
  };
}

const FIELDS = "id,date_gmt,link,title,excerpt,_links,_embedded";
const EMBED = "author,wp:featuredmedia,wp:term";

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`watcher.guru ${res.status}`);
  return res;
}

export async function posts(opts: { page?: number; category?: number; search?: string } = {}): Promise<WGPage> {
  const page = Math.max(1, Math.min(50, opts.page ?? 1));
  const q = new URLSearchParams({ per_page: "20", page: String(page), _embed: EMBED, _fields: FIELDS });
  if (opts.category) q.set("categories", String(opts.category));
  if (opts.search) q.set("search", opts.search);
  const res = await get(`${API}/posts?${q}`);
  const body = (await res.json()) as Raw[];
  if (!Array.isArray(body)) throw new Error("watcher.guru: unexpected reply");
  return { posts: body.map(toPost), page, totalPages: Number(res.headers.get("x-wp-totalpages")) || page };
}

export async function article(id: number): Promise<WGArticle> {
  const q = new URLSearchParams({ _embed: EMBED, _fields: `${FIELDS},content` });
  const res = await get(`${API}/posts/${id}?${q}`);
  const raw = (await res.json()) as Raw;
  return { ...toPost(raw), html: sanitize(raw.content?.rendered ?? "") };
}
