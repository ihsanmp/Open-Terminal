// The news archive: every headline the wire has carried, kept on disk for a few weeks, so a day's
// or a week's recap still has its news after the feeds have moved on or the app was restarted.
// While the app runs the feeds are read every half hour even with the news tab closed.
import { db } from "../db.js";
import * as newsfeeds from "../providers/newsfeeds.js";
import type { RecapInput } from "./recap.js";

const KEEP_DAYS = 60;
const COLLECT_MS = 30 * 60_000;

db.exec(`
CREATE TABLE IF NOT EXISTS news_archive (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  category TEXT NOT NULL,
  region TEXT NOT NULL,
  tier INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_archive_published ON news_archive (published_at);
`);

const insert = db.prepare(`
  INSERT OR IGNORE INTO news_archive (id, title, link, summary, publisher, feed_id, category, region, tier, published_at, seen_at)
  VALUES (@id, @title, @link, @summary, @publisher, @feedId, @category, @region, @tier, @publishedAt, @seenAt)
`);
const prune = db.prepare("DELETE FROM news_archive WHERE published_at < ?");

/** Keeps the items not seen before; a headline keeps the time it was first given. */
export const store = db.transaction((items: newsfeeds.WireItem[]) => {
  const seenAt = new Date().toISOString();
  for (const i of items) insert.run({ ...i, seenAt });
  prune.run(new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
});

const range = db.prepare(`
  SELECT id, title, link, summary, publisher, feed_id AS feedId, category, region, tier, published_at AS publishedAt
  FROM news_archive WHERE published_at >= ? AND published_at < ? ORDER BY published_at
`);
export function between(from: number, to: number): RecapInput[] {
  return range.all(new Date(from).toISOString(), new Date(to).toISOString()) as RecapInput[];
}

const firstRow = db.prepare("SELECT MIN(seen_at) AS since FROM news_archive");
/** When the archive started collecting: a recap of earlier days can't be complete. */
export function since(): string | null {
  return (firstRow.get() as { since: string | null }).since;
}

let started = false;
export function startArchive(): void {
  if (started) return;
  started = true;
  newsfeeds.onRefresh((items) => store(items));
  const run = () => newsfeeds.collect().catch((err) => console.error("[news archive]", err));
  setTimeout(run, 15_000).unref?.();
  setInterval(run, COLLECT_MS).unref?.();
}

/**
 * Reads the feeds for a recap unless they were read in the last few minutes; waits for that only
 * when the archive has nothing for the period yet.
 */
let lastCollect = 0;
export async function freshen(from: number, to: number): Promise<void> {
  if (Date.now() - lastCollect < 5 * 60_000) return;
  lastCollect = Date.now();
  const reading = newsfeeds.collect().catch((err) => console.error("[news archive]", err));
  if (to > Date.now() - 86_400_000 && between(from, to).length === 0) await reading;
}
