// The insiders' posts: what the accounts that move markets first post themselves (Watcher Guru,
// Whale Alert, the Fed's "whisperer" Nick Timiraos, Trump, and the posts pasted from X), not the
// news wires (those are the News tab). Only accounts whose identity can be checked are followed
// from the start, each post says how its author's identity is known (a Bluesky handle that is the
// account's own domain, a platform's verification, an account known by its id) and whether a news
// outlet has reported the same since (corroborate below), so a rumour reads as one. X lets no one read an account's posts without signing in (its
// public timeline answers 429 to everyone), so each account is read where it posts the same thing
// in the open:
//
//  - Telegram: a public channel's web preview, t.me/s/<channel> (the last ~20 messages).
//  - Bluesky: the public AppView API (app.bsky.feed.getAuthorFeed), no key.
//  - Truth Social: its Mastodon-style API by account id (looking an account up by name is behind
//    Cloudflare; its posts aren't).
//  - X: a single post is public by id (the syndication CDN the embedded tweets use), so a link
//    pasted in the app shows the post itself, with its pictures and the post it quotes.
//  - RSS: a feed the account publishes from its own site or label, for those on X alone (Bitcoin
//    Magazine's site, Eric Balchunas's Bloomberg podcast).
//
// Followed accounts are read every 45 s while the tab is open and every 10 minutes otherwise, and
// their posts kept for 30 days (pasted X posts until removed), so the feed survives restarts.

import { createHash } from "node:crypto";
import { get as httpsGet } from "node:https";
import { XMLParser } from "fast-xml-parser";
import { db } from "../db.js";
import { decode } from "./watcherguru.js";

export type Platform = "x" | "telegram" | "bluesky" | "truthsocial" | "rss";
export type Tier = "A1" | "Tokoh" | "KOL";
/**
 * How an account's identity is known: "domain", a Bluesky handle that is its own web domain (only
 * the domain's owner can take it); "verified", the platform's own check (X's for governments and
 * businesses, Truth Social's, Telegram's); "site", an account the owner's own website links to;
 * "known", an account checked by hand for this list;
 * "paid", X's bought blue check; "unverified", nothing.
 */
export type Trust = "domain" | "verified" | "site" | "known" | "paid" | "unverified";
export type SocialSource = { id: string; platform: Platform; ref: string; name: string; tier: Tier; builtIn: boolean };
export type SocialLink = { text: string; url: string };
export type SocialPost = {
  id: string;
  sourceId: string | null;
  platform: Platform;
  author: string;
  handle: string;
  avatar: string | null;
  text: string;
  /** Pieces of the text that link somewhere (shown shortened in it). */
  links: SocialLink[];
  images: string[];
  /** It has a video (shown as a link to the post). */
  video?: boolean;
  url: string;
  /** Milliseconds. */
  time: number;
  quoted?: { author: string; handle: string; text: string; url: string } | null;
  /** A repost of someone else's (Truth Social's ReTruth). */
  repostOf?: string | null;
  /** How the author's identity is known (see Trust). */
  trust: Trust;
  /** Posted by the organisation itself (an X government or business account): the source, not a report of it. */
  official?: boolean;
  /** The text is cut short where it came from (a long X post): the rest is at `url`. */
  truncated?: boolean;
  likes?: number | null;
  replies?: number | null;
  via: "feed" | "manual";
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const KEEP_DAYS = 30;

/** Bloomberg's "Trillions", Eric Balchunas's weekly ETF podcast (Apple Podcasts' feed for it). */
const TRILLIONS_FEED =
  "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/ee08231b-2e0c-40d0-afa9-ae3c0021f0dc/ab3c08b0-6606-450f-a60c-ae3c0021f0e6/podcast.rss";

/** The accounts followed from the start (each can be removed, and others added). */
export const BUILT_IN: Array<Omit<SocialSource, "id" | "builtIn">> = [
  { platform: "bluesky", ref: "watcher.guru", name: "Watcher Guru", tier: "A1" },
  { platform: "bluesky", ref: "whale-alert.io", name: "Whale Alert", tier: "A1" },
  { platform: "bluesky", ref: "nicktimiraos.bsky.social", name: "Nick Timiraos", tier: "A1" },
  { platform: "truthsocial", ref: "107780257626128497", name: "Donald J. Trump", tier: "Tokoh" },
  // From the user's list of market accounts (KOL_Pasar_Crypto_Saham_Forex.xlsx), those that post
  // the same in the open where who they are can be checked; the rest are on X alone.
  { platform: "bluesky", ref: "federalreserve.gov", name: "Federal Reserve", tier: "A1" },
  { platform: "bluesky", ref: "livesquawknews.bsky.social", name: "LiveSquawk", tier: "A1" },
  { platform: "telegram", ref: "wublockchainenglish", name: "Wu Blockchain", tier: "A1" },
  { platform: "telegram", ref: "investigations", name: "ZachXBT", tier: "A1" },
  { platform: "bluesky", ref: "unusualwhales.bsky.social", name: "Unusual Whales", tier: "A1" },
  { platform: "bluesky", ref: "polymarket.com", name: "Polymarket", tier: "KOL" },
  { platform: "bluesky", ref: "vitalik.ca", name: "Vitalik Buterin", tier: "KOL" },
  { platform: "bluesky", ref: "elerianm.bsky.social", name: "Mohamed El-Erian", tier: "KOL" },
  { platform: "bluesky", ref: "weisenthal.bsky.social", name: "Joe Weisenthal", tier: "KOL" },
  // On X alone, read from what they publish themselves (checked 2026-10-18; every Bluesky,
  // Mastodon and Telegram account by their names was a copy, suspended or silent since 2023).
  { platform: "rss", ref: "https://bitcoinmagazine.com/feed", name: "Bitcoin Magazine", tier: "A1" },
  { platform: "rss", ref: TRILLIONS_FEED, name: "Eric Balchunas · Trillions (Bloomberg)", tier: "KOL" },
];
/** Linked from the owner's own website (checked 2026-10-15): livesquawk.com links its Bluesky,
 *  wublockchain.xyz its Telegram channel. */
const LINKED = new Set(["bluesky:livesquawknews.bsky.social", "telegram:wublockchainenglish"]);
/**
 * What an account posts: "official", an institution's own announcements (the source itself, nothing
 * to confirm); "relay", news as it breaks (Watcher Guru, LiveSquawk …: every post a report to
 * confirm); "person", someone's own views and statements, a report only when it reads as one
 * (BREAKING, "reportedly" …). Accounts added by hand are people until their posts say otherwise.
 */
export type SourceKind = "official" | "relay" | "person";
const KIND: Record<string, SourceKind> = {
  "bluesky:federalreserve.gov": "official",
  "bluesky:watcher.guru": "relay",
  "bluesky:whale-alert.io": "relay",
  "bluesky:livesquawknews.bsky.social": "relay",
  "telegram:wublockchainenglish": "relay",
  "bluesky:unusualwhales.bsky.social": "relay",
  "bluesky:polymarket.com": "relay",
  "rss:https://bitcoinmagazine.com/feed": "relay",
};
export const kindOf = (sourceId: string | null): SourceKind => (sourceId ? KIND[sourceId] : undefined) ?? "person";

/** Checked by hand: Nick Timiraos's Bluesky (since 2023, 72k followers, shares his WSJ pieces);
 *  @realDonaldTrump's Truth Social id. (A "Walter Bloomberg" Telegram channel couldn't be confirmed
 *  as his: no verification, a fraction of his following, so it isn't followed.) */
/** Unusual Whales's Bluesky (since 2023, 115k followers, its bio links its own Discord and site);
 *  ZachXBT's "Investigations" channel (109k subscribers; his other channel points to it). */
const KNOWN = new Set(["bluesky:nicktimiraos.bsky.social", "truthsocial:107780257626128497", "bluesky:unusualwhales.bsky.social", "telegram:investigations"]);
/** The username a known account must still have, or its posts are dropped (a changed hands id). */
const KNOWN_USERNAME: Record<string, string> = { "truthsocial:107780257626128497": "realDonaldTrump" };

const sourceId = (platform: Platform, ref: string) => `${platform}:${ref.toLowerCase()}`;

// ---------------------------------------------------------------- storage

db.exec(`
CREATE TABLE IF NOT EXISTS social_sources (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  ref TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  via TEXT NOT NULL,
  time INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS social_posts_time ON social_posts (time);
`);

const addBuiltIn = db.prepare("INSERT OR IGNORE INTO social_sources (id, platform, ref, name, tier, built_in, added_at) VALUES (?, ?, ?, ?, ?, 1, ?)");
for (const s of BUILT_IN) addBuiltIn.run(sourceId(s.platform, s.ref), s.platform, s.ref, s.name, s.tier, new Date().toISOString());

type SourceRow = { id: string; platform: Platform; ref: string; name: string; tier: Tier; built_in: number };
export function sources(): SocialSource[] {
  const rows = db.prepare("SELECT id, platform, ref, name, tier, built_in FROM social_sources WHERE hidden = 0 ORDER BY built_in DESC, added_at").all() as SourceRow[];
  return rows.map((r) => ({ id: r.id, platform: r.platform, ref: r.ref, name: r.name, tier: r.tier, builtIn: r.built_in === 1 }));
}

// A post seen again (a like count that moved) replaces the stored one; a pasted one stays pasted.
const upsert = db.prepare(`
  INSERT INTO social_posts (id, source_id, via, time, json) VALUES (@id, @sourceId, @via, @time, @json)
  ON CONFLICT(id) DO UPDATE SET json = excluded.json, source_id = COALESCE(social_posts.source_id, excluded.source_id)
`);
const prune = db.prepare("DELETE FROM social_posts WHERE via = 'feed' AND time < ?");
export const store = db.transaction((posts: SocialPost[]) => {
  for (const p of posts) upsert.run({ id: p.id, sourceId: p.sourceId, via: p.via, time: p.time, json: JSON.stringify(p) });
  prune.run(Date.now() - KEEP_DAYS * 86_400_000);
});

export function stored(limit = 600): SocialPost[] {
  const rows = db.prepare("SELECT json, via FROM social_posts ORDER BY time DESC LIMIT ?").all(limit) as Array<{ json: string; via: SocialPost["via"] }>;
  return rows.map((r) => ({ ...(JSON.parse(r.json) as SocialPost), via: r.via }));
}

// ---------------------------------------------------------------- text

/** Plain text of a post's HTML, keeping its line breaks, and the links in it. */
export function htmlText(html: string): { text: string; links: SocialLink[] } {
  const links: SocialLink[] = [];
  const marked = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const text = decode(inner.replace(/<[^>]*>/g, "")).trim();
      const url = decode(href);
      if (text && /^https?:\/\//i.test(url)) links.push({ text, url });
      return text;
    });
  const text = decode(marked.replace(/<[^>]*>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, links };
}

async function get(url: string, timeoutMs = 12_000): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/html" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** Over node:https: Cloudflare in front of Truth Social turns away Node's fetch() (403), not this. */
function httpsText(url: string, timeoutMs = 12_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (d: string) => (body += d));
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("waktu habis")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- Telegram

/** A public channel's last messages, from its web preview (t.me/s/<channel>). */
export function parseTelegram(html: string, channel: string, src: string | null): { name: string; posts: SocialPost[] } {
  const name = decode(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? channel);
  const avatar = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1] ?? null;
  const trust: Trust = /tgme_channel_info_header_title[\s\S]{0,400}verified-icon/.test(html) ? "verified" : src && LINKED.has(src) ? "site" : src && KNOWN.has(src) ? "known" : "unverified";
  const posts: SocialPost[] = [];
  const parts = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const part of parts) {
    const post = /data-post="([^"/]+)\/(\d+)"/.exec(part);
    const time = /<time datetime="([^"]+)"/.exec(part)?.[1];
    if (!post || !time) continue;
    const body = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(part)?.[1] ?? "";
    const { text, links } = htmlText(body);
    const images = [...part.matchAll(/tgme_widget_message_photo_wrap[^"]*"[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    const video = /tgme_widget_message_video/.test(part);
    if (!text && !images.length && !video) continue;
    posts.push({
      id: `telegram:${post[1].toLowerCase()}/${post[2]}`,
      sourceId: src,
      platform: "telegram",
      author: name,
      handle: post[1],
      avatar: avatar ? decode(avatar) : null,
      text,
      links,
      images,
      video,
      url: `https://t.me/${post[1]}/${post[2]}`,
      time: Date.parse(time),
      trust,
      via: "feed",
    });
  }
  return { name, posts };
}

async function telegram(channel: string, src: string | null) {
  const html = await (await get(`https://t.me/s/${encodeURIComponent(channel)}`)).text();
  if (!/tgme_channel_info|tgme_widget_message/.test(html)) throw new Error("bukan channel publik");
  return parseTelegram(html, channel, src);
}

// ---------------------------------------------------------------- Bluesky

type BskyPost = {
  uri: string;
  author: { handle: string; displayName?: string; avatar?: string; verification?: { verifiedStatus?: string } };
  record: { text?: string; createdAt?: string; facets?: Array<{ index: { byteStart: number; byteEnd: number }; features: Array<{ $type: string; uri?: string }> }> };
  embed?: any;
  likeCount?: number;
  replyCount?: number;
};

const bskyUrl = (handle: string, uri: string) => `https://bsky.app/profile/${handle}/post/${uri.split("/").pop()}`;

/** The links in a Bluesky post: its facets, whose ranges count UTF-8 bytes. */
function bskyLinks(record: BskyPost["record"]): SocialLink[] {
  const bytes = Buffer.from(record.text ?? "", "utf8");
  const out: SocialLink[] = [];
  for (const f of record.facets ?? []) {
    const link = f.features.find((x) => x.$type === "app.bsky.richtext.facet#link")?.uri;
    if (link) out.push({ text: bytes.subarray(f.index.byteStart, f.index.byteEnd).toString("utf8"), url: link });
  }
  return out;
}

/** A handle that isn't under bsky.social is a domain its owner proved; else Bluesky's own check. */
export function bskyTrust(handle: string, verifiedStatus: string | undefined, src: string | null): Trust {
  if (!/\.bsky\.social$/i.test(handle)) return "domain";
  if (verifiedStatus === "valid") return "verified";
  if (src && LINKED.has(src)) return "site";
  return src && KNOWN.has(src) ? "known" : "unverified";
}

export function parseBluesky(feed: Array<{ post: BskyPost; reason?: { $type: string } }>, src: string | null): SocialPost[] {
  const out: SocialPost[] = [];
  for (const { post, reason } of feed) {
    if (reason) continue; // a repost of someone else's
    const e = post.embed ?? {};
    const media = e.$type === "app.bsky.embed.recordWithMedia#view" ? e.media : e;
    const images: string[] = (media?.images ?? []).map((i: { fullsize?: string; thumb?: string }) => i.fullsize ?? i.thumb).filter(Boolean);
    const links = bskyLinks(post.record);
    const ext = media?.external;
    if (ext?.uri && !links.some((l) => l.url === ext.uri)) links.push({ text: ext.title || ext.uri, url: ext.uri });
    const q = e.$type === "app.bsky.embed.record#view" ? e.record : e.$type === "app.bsky.embed.recordWithMedia#view" ? e.record?.record : null;
    out.push({
      id: `bluesky:${post.uri}`,
      sourceId: src,
      platform: "bluesky",
      author: post.author.displayName || post.author.handle,
      handle: post.author.handle,
      avatar: post.author.avatar ?? null,
      text: post.record.text ?? "",
      links,
      images,
      video: media?.$type === "app.bsky.embed.video#view",
      url: bskyUrl(post.author.handle, post.uri),
      time: Date.parse(post.record.createdAt ?? ""),
      trust: bskyTrust(post.author.handle, post.author.verification?.verifiedStatus, src),
      quoted: q?.author ? { author: q.author.displayName || q.author.handle, handle: q.author.handle, text: q.value?.text ?? "", url: bskyUrl(q.author.handle, q.uri) } : null,
      likes: post.likeCount ?? null,
      replies: post.replyCount ?? null,
      via: "feed",
    });
  }
  return out.filter((p) => Number.isFinite(p.time));
}

async function bluesky(handle: string, src: string | null) {
  const res = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=30&filter=posts_no_replies`);
  const data = (await res.json()) as { feed?: Array<{ post: BskyPost; reason?: { $type: string } }> };
  const posts = parseBluesky(data.feed ?? [], src);
  const author = data.feed?.find((f) => !f.reason)?.post.author;
  return { name: author?.displayName || author?.handle || handle, posts };
}

// ---------------------------------------------------------------- Truth Social

type TruthStatus = {
  id: string;
  created_at: string;
  url: string;
  content: string;
  account: { username: string; display_name: string; avatar?: string; verified?: boolean };
  media_attachments?: Array<{ type: string; url?: string; preview_url?: string }>;
  reblog?: TruthStatus | null;
  card?: { url?: string; title?: string } | null;
  favourites_count?: number;
  replies_count?: number;
};

export function parseTruth(statuses: TruthStatus[], src: string | null): SocialPost[] {
  const expected = src ? KNOWN_USERNAME[src] : undefined;
  return statuses.filter((s) => !expected || s.account.username === expected).map((s) => {
    const shown = s.reblog ?? s;
    const { text, links } = htmlText(shown.content ?? "");
    const media = shown.media_attachments ?? [];
    if (shown.card?.url && !links.some((l) => l.url === shown.card!.url)) links.push({ text: shown.card.title || shown.card.url, url: shown.card.url });
    return {
      id: `truthsocial:${s.id}`,
      sourceId: src,
      platform: "truthsocial" as const,
      author: s.account.display_name || s.account.username,
      handle: s.account.username,
      avatar: s.account.avatar ?? null,
      text,
      links,
      images: media.filter((m) => m.type === "image").map((m) => m.url ?? m.preview_url ?? "").filter(Boolean),
      video: media.some((m) => m.type === "video" || m.type === "gifv"),
      url: s.url,
      time: Date.parse(s.created_at),
      repostOf: s.reblog ? s.reblog.account.username : null,
      trust: (s.account.verified ? "verified" : src && KNOWN.has(src) ? "known" : "unverified") as Trust,
      likes: shown.favourites_count ?? null,
      replies: shown.replies_count ?? null,
      via: "feed" as const,
    };
  });
}

async function truthsocial(accountId: string, src: string | null) {
  const data = JSON.parse(await httpsText(`https://truthsocial.com/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=20&exclude_replies=true`)) as TruthStatus[];
  if (!Array.isArray(data)) throw new Error("jawaban tak dikenali");
  const posts = parseTruth(data, src);
  if (data.length && !posts.length) throw new Error("akun ini bukan lagi pemilik yang dikenal");
  return { name: data[0]?.account.display_name ?? accountId, posts };
}

// ---------------------------------------------------------------- X

/** The token X's embed code sends with a post's id. */
export const xToken = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

/** A post's id from a link to it (x.com/…/status/<id>, twitter.com too) or the bare id. */
export function xPostId(input: string): string | null {
  const s = input.trim();
  const m = /(?:^|\/\/|\.)(?:x|twitter)\.com\/(?:[A-Za-z0-9_]+|i\/web)\/status(?:es)?\/(\d{5,25})/i.exec(s);
  if (m) return m[1];
  return /^\d{5,25}$/.test(s) ? s : null;
}

type XTweet = {
  id_str: string;
  text: string;
  created_at: string;
  user: { name: string; screen_name: string; profile_image_url_https?: string; is_blue_verified?: boolean; verified?: boolean; verified_type?: string };
  entities?: { urls?: Array<{ url: string; expanded_url: string; display_url: string }>; media?: Array<{ url: string }> };
  mediaDetails?: Array<{ type: string; media_url_https: string }>;
  quoted_tweet?: XTweet;
  note_tweet?: unknown;
  favorite_count?: number;
  conversation_count?: number;
};

/** A post's text with its t.co links written out (and those of its pictures taken out). */
function xText(t: XTweet): { text: string; links: SocialLink[] } {
  let text = t.text ?? "";
  const links: SocialLink[] = [];
  for (const m of t.entities?.media ?? []) text = text.split(m.url).join("");
  for (const u of t.entities?.urls ?? []) {
    text = text.split(u.url).join(u.display_url);
    links.push({ text: u.display_url, url: u.expanded_url });
  }
  return { text: decode(text).trim(), links };
}

/** X's check for governments and businesses (and the old verified accounts) counts; a bought
 *  blue check only says someone pays. */
export function xTrust(user: XTweet["user"]): Trust {
  if (user.verified_type === "Government" || user.verified_type === "Business" || user.verified) return "verified";
  return user.is_blue_verified ? "paid" : "unverified";
}

export function parseX(t: XTweet, via: SocialPost["via"], src: string | null = null): SocialPost {
  const { text, links } = xText(t);
  const media = t.mediaDetails ?? [];
  const q = t.quoted_tweet;
  return {
    id: `x:${t.id_str}`,
    sourceId: src,
    platform: "x",
    author: t.user.name,
    handle: t.user.screen_name,
    avatar: t.user.profile_image_url_https?.replace("_normal.", "_bigger.") ?? null,
    text,
    links,
    images: media.map((m) => m.media_url_https).filter(Boolean),
    video: media.some((m) => m.type === "video" || m.type === "animated_gif"),
    url: `https://x.com/${t.user.screen_name}/status/${t.id_str}`,
    time: Date.parse(t.created_at),
    quoted: q?.user ? { author: q.user.name, handle: q.user.screen_name, text: xText(q).text, url: `https://x.com/${q.user.screen_name}/status/${q.id_str}` } : null,
    truncated: Boolean(t.note_tweet),
    trust: xTrust(t.user),
    official: t.user.verified_type === "Government" || t.user.verified_type === "Business",
    likes: t.favorite_count ?? null,
    replies: t.conversation_count ?? null,
    via,
  };
}

/** One X post by its id, as the embedded tweets read it. */
export async function xPost(id: string): Promise<SocialPost> {
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${xToken(id)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("json")) throw new Error(res.status === 404 || !type.includes("json") ? "postingan tidak ditemukan, dihapus, atau akunnya terkunci" : `HTTP ${res.status}`);
  const t = (await res.json()) as XTweet & { __typename?: string };
  if (t.__typename === "TweetTombstone" || !t.user) throw new Error("postingan tidak bisa ditampilkan (dihapus atau dibatasi)");
  return parseX(t, "manual");
}

/** Pastes X posts: each link in `input` (several may be pasted at once). */
export async function addX(input: string): Promise<{ added: SocialPost[]; failed: Array<{ id: string; error: string }> }> {
  const ids = [...new Set(input.split(/[\s,]+/).map(xPostId).filter((x): x is string => Boolean(x)))].slice(0, 20);
  if (!ids.length) throw new Error("tidak ada link postingan X (x.com/…/status/…)");
  const added: SocialPost[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of ids) {
    try {
      added.push(await xPost(id));
    } catch (e) {
      failed.push({ id, error: (e as Error).message });
    }
  }
  store(added);
  return { added, failed };
}

export function removePost(id: string): boolean {
  return db.prepare("DELETE FROM social_posts WHERE id = ? AND via = 'manual'").run(id).changes > 0;
}

// ---------------------------------------------------------------- RSS

const rssXml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", processEntities: false });
const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const textOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? textOf((v as Record<string, unknown>)["#text"]) : String(v));
/** A site's sign-off lines ("This post … first appeared on …", a host's privacy notice). */
const BOILERPLATE = /^(this post .+ first appeared on|see omnystudio\.com|learn more about your ad choices)/i;

/**
 * A feed's latest items as posts: the title, then its summary's first paragraphs. The feed is the
 * site's own (or its label's), so who wrote it is the site: "site" trust.
 */
export function parseRss(xml: string, src: string | null, sourceName?: string): { name: string; posts: SocialPost[] } {
  const channel = (rssXml.parse(xml) as { rss?: { channel?: Record<string, unknown> } }).rss?.channel;
  if (!channel) throw new Error("bukan feed RSS");
  const name = sourceName || decode(textOf(channel.title)) || "RSS";
  const posts: SocialPost[] = [];
  for (const it of asList(channel.item as Record<string, unknown>[] | Record<string, unknown> | undefined).slice(0, 30)) {
    const title = decode(textOf(it.title)).trim();
    const link = decode(textOf(it.link)).trim();
    const time = Date.parse(textOf(it.pubDate));
    if (!title || !/^https?:\/\//.test(link) || !Number.isFinite(time)) continue;
    const html = textOf(it.description) || textOf(it["content:encoded"]);
    const paragraphs = html
      .split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
      .map((part) => htmlText(part).text.replace(/\s+/g, " ").trim())
      .filter((t) => t && !t.includes(title) && t !== name && !BOILERPLATE.test(t));
    let summary = paragraphs.join("\n\n");
    if (summary.length > 420) summary = summary.slice(0, 417).replace(/\s+\S*$/, "") + "…";
    const image = /<img[^>]+src="(https:\/\/[^"]+)"/i.exec(html)?.[1] ?? (it["media:content"] as Record<string, string> | undefined)?.["@url"];
    posts.push({
      id: `rss:${createHash("sha1").update(textOf(it.guid) || link).digest("hex").slice(0, 16)}`,
      sourceId: src,
      platform: "rss",
      author: name,
      handle: new URL(link).hostname.replace(/^www\./, ""),
      avatar: null,
      text: summary ? `${title}\n\n${summary}` : title,
      links: [],
      images: image ? [decode(image)] : [],
      url: link,
      time,
      trust: "site",
      via: "feed",
    });
  }
  return { name, posts };
}

async function rss(url: string, src: string | null) {
  // Some sites turn away a feed request that doesn't look like a browser's (Bitcoin Magazine: 403).
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const named = BUILT_IN.find((b) => b.platform === "rss" && sourceId("rss", b.ref) === src)?.name;
  return parseRss(await res.text(), src, named);
}

// ---------------------------------------------------------------- following

/** An account to follow from what's typed: a t.me link, a Bluesky handle or profile link, a Truth Social id. */
export function parseSourceInput(input: string): { platform: Platform; ref: string } | { error: string } {
  const s = input.trim().replace(/^@/, "");
  let m: RegExpExecArray | null;
  if ((m = /^(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\/(?:s\/)?([A-Za-z0-9_]{4,64})\/?$/i.exec(s)) || (m = /^tg:([A-Za-z0-9_]{4,64})$/i.exec(s))) return { platform: "telegram", ref: m[1] };
  if ((m = /^(?:https?:\/\/)?bsky\.app\/profile\/([A-Za-z0-9.:-]+)\/?$/i.exec(s)) || (m = /^bsky:([A-Za-z0-9.:-]+)$/i.exec(s))) return { platform: "bluesky", ref: m[1].toLowerCase() };
  if ((m = /^rss:(https:\/\/\S+)$/i.exec(s))) return { platform: "rss", ref: m[1] };
  if ((m = /^truth(?:social)?:(\d{6,25})$/i.exec(s)) || (m = /^(?:https?:\/\/)?truthsocial\.com\/api\/v1\/accounts\/(\d{6,25})/i.exec(s))) return { platform: "truthsocial", ref: m[1] };
  if (/truthsocial\.com\/@/i.test(s)) return { error: "Truth Social: masukkan ID akunnya (truth:<angka>), nama akun tidak bisa dicari tanpa login" };
  if (/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(s)) return { error: "akun X tidak bisa diikuti tanpa API berbayar X; tempel link postingannya di kolom X" };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) return { platform: "bluesky", ref: s.toLowerCase() };
  return { error: "tidak dikenali: pakai t.me/<channel>, bsky.app/profile/<handle> (atau handle.bsky.social), atau truth:<id>" };
}

export async function follow(input: string, tier: Tier): Promise<SocialSource> {
  const parsed = parseSourceInput(input);
  if ("error" in parsed) throw new Error(parsed.error);
  const id = sourceId(parsed.platform, parsed.ref);
  const read = await readSource(parsed.platform, parsed.ref, id);
  if (!read.posts.length) throw new Error("akun ditemukan tapi belum ada postingan yang bisa dibaca");
  // Only accounts whose identity can be checked: an impostor channel is how a hoax gets in.
  const trust = read.posts[0].trust;
  if (trust !== "domain" && trust !== "verified" && trust !== "site" && trust !== "known")
    throw new Error("akun ini tidak terverifikasi (bukan handle domain, tanpa centang resmi platform), jadi tidak diikuti agar akun palsu tidak masuk");
  db.prepare(
    `INSERT INTO social_sources (id, platform, ref, name, tier, built_in, hidden, added_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(id) DO UPDATE SET hidden = 0, tier = excluded.tier, name = excluded.name`,
  ).run(id, parsed.platform, parsed.ref, read.name, tier, new Date().toISOString());
  store(read.posts);
  status.set(id, { ok: true, error: null, at: Date.now(), count: read.posts.length });
  return sources().find((s) => s.id === id)!;
}

/** Stops following (a built-in account stays off; its posts go with it). */
export function unfollow(id: string): boolean {
  const changed = db.prepare("UPDATE social_sources SET hidden = 1 WHERE id = ?").run(id).changes > 0;
  db.prepare("DELETE FROM social_posts WHERE source_id = ? AND via = 'feed'").run(id);
  return changed;
}

function readSource(platform: Platform, ref: string, id: string): Promise<{ name: string; posts: SocialPost[] }> {
  switch (platform) {
    case "telegram":
      return telegram(ref, id);
    case "bluesky":
      return bluesky(ref, id);
    case "truthsocial":
      return truthsocial(ref, id);
    case "rss":
      return rss(ref, id);
    default:
      return Promise.reject(new Error("X tidak bisa diikuti"));
  }
}

// ---------------------------------------------------------------- collecting

export type SourceStatus = { ok: boolean; error: string | null; at: number; count: number };
const status = new Map<string, SourceStatus>();
export const statusOf = (id: string) => status.get(id) ?? null;

let lastAsked = 0;
let running: Promise<void> | null = null;
let lastRun = 0;

/** Reads every followed account once (one after another). */
export function collect(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const s of sources()) {
      try {
        // t.me now and then drops a connection outright: once more after a pause before failing.
        const { posts } = await readSource(s.platform, s.ref, s.id).catch(async () => {
          await new Promise((r) => setTimeout(r, 3_000));
          return readSource(s.platform, s.ref, s.id);
        });
        store(posts);
        status.set(s.id, { ok: true, error: null, at: Date.now(), count: posts.length });
      } catch (e) {
        status.set(s.id, { ok: false, error: (e as Error).message, at: Date.now(), count: 0 });
      }
    }
    lastRun = Date.now();
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A post that reads as news about events, not a view: a flash ("BREAKING", "JUST IN", 🚨) or a
 *  report at second hand ("reportedly", "according to", "sources say"). */
export const READS_AS_NEWS = /^\W*(breaking|just in|just:|alert|urgent|developing|flash)\b|^\s*🚨|\b(reportedly|according to|sources? (say|said|tell)|people familiar|per (bloomberg|reuters|wsj|ft|cnbc|axios|the information))\b/i;

/**
 * Where a post stands: on the chain (a Whale Alert transfer), confirmed by an outlet, the official
 * source itself, a report awaiting confirmation (its first six hours) or still unconfirmed, or a
 * statement, someone's own view that no outlet would be expected to report.
 */
export type PostStatus = "onchain" | "confirmed" | "official" | "pending" | "unconfirmed" | "statement" | "article";

export function postStatus(p: SocialPost, confirmed: boolean, now = Date.now()): PostStatus {
  if (onChain(p)) return "onchain";
  if (confirmed) return "confirmed";
  // Published on the account's own site (an article, a podcast episode): not a rumour to confirm.
  if (p.platform === "rss") return "article";
  const kind = kindOf(p.sourceId);
  if (kind === "official" || p.official) return "official";
  const news = kind === "relay" || READS_AS_NEWS.test(`${p.text} ${p.quoted?.text ?? ""}`);
  if (!news) return "statement";
  return now - p.time < 6 * 3600_000 ? "pending" : "unconfirmed";
}

export type FeedPost = SocialPost & { confirmedBy: Confirmation[]; onChain: boolean; status: PostStatus };

/** The feed as asked for by the app: read first when nothing has been yet, then from storage, each
 *  post with the outlets that have reported the same. */
export async function feed(limit = 600): Promise<{ sources: Array<SocialSource & { status: SourceStatus | null }>; posts: FeedPost[] }> {
  lastAsked = Date.now();
  if (!lastRun) await collect();
  else if (Date.now() - lastRun > 40_000) void collect();
  const posts = stored(limit);
  const confirmed = corroborate(posts);
  return {
    sources: sources().map((s) => ({ ...s, status: statusOf(s.id) })),
    posts: posts.map((p) => {
      const confirmedBy = confirmed.get(p.id) ?? [];
      return { ...p, confirmedBy, onChain: onChain(p), status: postStatus(p, confirmedBy.length > 0) };
    }),
  };
}

const ACTIVE_MS = 45_000;
const IDLE_MS = 10 * 60_000;
/** Keeps reading in the background: often while the tab is open, now and then otherwise. */
export function startSocialCollector(): void {
  setInterval(() => {
    const active = Date.now() - lastAsked < 5 * 60_000;
    if (Date.now() - lastRun >= (active ? ACTIVE_MS : IDLE_MS)) void collect();
  }, 15_000).unref();
}

// ---------------------------------------------------------------- corroboration

export type Confirmation = { publisher: string; title: string; link: string; time: number };

const STOP = new Set(
  ("the and for that with this from have has had will would could should into over after before about than then they them their there here what when where which while who whom whose why how " +
    "are was were been being not but all any can its it's our out his her him she you your yours just now new says said say saying report reports reported according breaking update live watch " +
    "more most very also only some such one two per via amid near says week weeks day days today yesterday tomorrow year years time times make made like get got set sets see seen big").split(" "),
);

/** The words a post or headline turns on: names, figures, tickers (a "$" and plurals dropped). */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  const clean = text.replace(/https?:\/\/\S+/g, " ").toLowerCase();
  for (const raw of clean.match(/\$?[a-z][a-z0-9'’-]*|\d[\d,.]*%?/g) ?? []) {
    let w = raw.replace(/^\$/, "").replace(/['’]s$/, "").replace(/[.,]+$/, "").replace(/,/g, "");
    if (/^\d/.test(w)) {
      // Figures count when they say something (not a bare 1 or 2).
      if (w.replace(/[^\d]/g, "").length >= 2 || w.includes("%")) out.add(w);
      continue;
    }
    if (w.length < 3 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

export type Headline = Confirmation & { words: Set<string> };

/** Pages written for search, not news ("PancakeSwap (CAKE) Price Prediction: 2025, 2026, 2030"). */
const EVERGREEN = /price prediction|promo code|coupon|\bhow to\b|^what is\b/i;

/** The outlets' headlines from `from` on (the News tab's archive, wires and papers, not blogs). */
function headlines(from: number): Headline[] {
  let rows: Array<{ title: string; summary: string; link: string; publisher: string; published_at: string }>;
  try {
    rows = db.prepare("SELECT title, summary, link, publisher, published_at FROM news_archive WHERE tier <= 2 AND published_at >= ?").all(new Date(from).toISOString()) as typeof rows;
  } catch {
    return []; // no archive yet
  }
  // Headlines alone: a summary's extra words matched posts about something else.
  return rows
    .filter((r) => !EVERGREEN.test(r.title))
    .map((r) => ({ publisher: r.publisher, title: r.title, link: r.link, time: Date.parse(r.published_at), words: keywords(r.title) }));
}

/** Within this window around a post an outlet's report counts as being about the same thing. */
const BEFORE_MS = 6 * 3600_000;
const AFTER_MS = 36 * 3600_000;

/** A figure that says something: 3.7%, 81000, 1.2, 315 (not a year, which every headline about the
 *  next one shares, nor a bare two-digit number like 25 basis points). */
export const isFigure = (w: string) => /^\d/.test(w) && !/^(19|20)\d\d$/.test(w) && (/[.%]/.test(w) || w.length >= 3);

/**
 * Whether a headline reports what a post says, from the words they share, each weighed by how rare
 * it is among the headlines (a name or a figure counts for more than "market"): four of them
 * covering a good part of the headline, or three covering half of it, or a figure and another word
 * covering two fifths of either. Tuned on a day of Watcher Guru and Whale Alert against the wires:
 * posts that only share a name with a story ("Elon Musk … SpaceX" about something else, Larry Fink
 * on rates against Fink on data centres) don't pass; "US inflation rises to 3.7%" does.
 */
/** How much of a post is matched, and how well a second outlet must match next to the best. */
const HEAD_CHARS = 300;
const RUNNER_UP = 0.6;

export function sameStory(shared: string[], score: number, headlineScore: number, postScore: number, rare = 2): boolean {
  const ofHeadline = headlineScore > 0 ? score / headlineScore : 0;
  const ofPost = postScore > 0 ? score / postScore : 0;
  // Words few headlines use (a name, "laundering", "circuit breaker"), not "White House", "rise",
  // "September", "ahead of the midterms" that any story of the week shares.
  const named = rare >= 2 || (rare >= 1 && shared.length >= 4 && ofHeadline >= 0.4);
  // Four words at least: three were often just who spoke (ECB's Lane on rates, and Lane on AI).
  if (score >= 14 && named && shared.length >= 4 && ofHeadline >= 0.3) return true;
  return score >= 9 && shared.length >= 2 && shared.some(isFigure) && (ofHeadline >= 0.4 || ofPost >= 0.4);
}

/** On-chain transfers (Whale Alert's) are their own proof: the chain shows them. */
export const onChain = (p: SocialPost) => /\b(transferred from|minted at|burned at|unlocked)\b/i.test(p.text) && /whale-alert/i.test(p.handle);

/**
 * The outlets that reported what each post says: headlines from around its time that share enough
 * of its rarer words. A post nothing matches isn't false, only not (yet) confirmed.
 */
export function corroborate(posts: SocialPost[], news?: Headline[]): Map<string, Confirmation[]> {
  const out = new Map<string, Confirmation[]>();
  if (!posts.length) return out;
  const earliest = Math.min(...posts.map((p) => p.time)) - BEFORE_MS;
  const list = news ?? headlines(earliest);
  if (!list.length) return out;
  const df = new Map<string, number>();
  for (const h of list) for (const w of h.words) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((list.length + 1) / ((df.get(w) ?? 0) + 1));
  // A word in at most a handful of the headlines (one in five hundred).
  const rareDf = Math.max(3, Math.ceil(list.length * 0.002));
  for (const p of posts) {
    if (onChain(p)) continue;
    // What a post says up front (a headline, then the story under it): its tail added chance matches.
    const words = keywords(`${p.text.slice(0, HEAD_CHARS)} ${p.quoted?.text.slice(0, HEAD_CHARS) ?? ""}`);
    if (words.size < 2) continue;
    let postScore = 0;
    for (const w of words) postScore += idf(w);
    const found: Array<Confirmation & { score: number; shared: string[] }> = [];
    for (const h of list) {
      if (h.time < p.time - BEFORE_MS || h.time > p.time + AFTER_MS) continue;
      const shared: string[] = [];
      let score = 0;
      let headlineScore = 0;
      for (const w of h.words) {
        const x = idf(w);
        headlineScore += x;
        if (!words.has(w)) continue;
        shared.push(w);
        score += x;
      }
      if (sameStory(shared, score, headlineScore, postScore, shared.filter((w) => (df.get(w) ?? 0) <= rareDf).length)) found.push({ publisher: h.publisher, title: h.title, link: h.link, time: h.time, score, shared });
    }
    found.sort((a, b) => b.score - a.score);
    // Other outlets count when they match about as well as the best one, not on a few shared words.
    // and on the same words: "US CPI 3.7%" and "French inflation rises in September" don't agree.
    const lead = new Set(found[0]?.shared ?? []);
    const strong = found.filter((f, i) => i === 0 || (f.score >= RUNNER_UP * found[0].score && f.shared.filter((w) => lead.has(w)).length * 2 >= f.shared.length));
    // One per outlet, the best match first.
    const seen = new Set<string>();
    const best = strong.filter((f) => !seen.has(f.publisher) && seen.add(f.publisher)).slice(0, 3);
    if (best.length) out.set(p.id, best.map(({ score: _s, shared: _w, ...c }) => c));
  }
  return out;
}
