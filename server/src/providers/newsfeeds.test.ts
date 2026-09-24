import { describe, expect, it } from "vitest";
import { FEEDS, mergeItems, parseFeed, stripHtml, type FeedDef } from "./newsfeeds.js";

const feed: FeedDef = { id: "t", name: "Test Wire", url: "https://example.com/rss", category: "MARKETS", region: "US", tier: 2 };
const NOW = Date.parse("2026-09-24T12:00:00Z");

describe("news wire parsing", () => {
  it("reads RSS 2.0, including Google News' publisher suffix", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Stocks rally &amp; bonds slip - Reuters</title><link>https://news.google.com/a</link>
        <pubDate>Thu, 24 Sep 2026 11:30:00 GMT</pubDate><source url="https://reuters.com">Reuters</source>
        <description>&lt;p&gt;Markets &lt;b&gt;moved&lt;/b&gt;&lt;/p&gt;</description></item>
      <item><title>No link</title></item>
    </channel></rss>`;
    const [item, ...rest] = parseFeed(xml, feed, NOW);
    expect(rest).toHaveLength(0);
    expect(item.title).toBe("Stocks rally & bonds slip");
    expect(item.publisher).toBe("Reuters");
    expect(item.summary).toBe("Markets moved");
    expect(item.publishedAt).toBe("2026-09-24T11:30:00.000Z");
    expect(item.dated).toBe(true);
    expect(item.category).toBe("MARKETS");
  });

  it("reads Atom entries and RSS 1.0 (RDF) items", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title>
      <link rel="alternate" href="https://example.com/atom"/><updated>2026-09-24T10:00:00Z</updated>
      <summary>Short</summary></entry></feed>`;
    expect(parseFeed(atom, feed, NOW)[0]).toMatchObject({ title: "Atom story", link: "https://example.com/atom", summary: "Short" });

    const rdf = `<rdf:RDF xmlns:rdf="x" xmlns:dc="y"><item><title>RDF story</title><link>https://example.com/rdf</link>
      <dc:date>2026-09-24T09:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(rdf, feed, NOW)[0]).toMatchObject({ title: "RDF story", publishedAt: "2026-09-24T09:00:00.000Z" });
  });

  it("drops stale items and treats far-future dates as undated", () => {
    const xml = (date: string) => `<rss><channel><item><title>T</title><link>https://example.com/x</link><pubDate>${date}</pubDate></item></channel></rss>`;
    expect(parseFeed(xml("Mon, 01 Jan 2024 00:00:00 GMT"), feed, NOW)).toHaveLength(0);
    const future = parseFeed(xml("Mon, 30 Nov 2026 00:00:00 GMT"), feed, NOW)[0];
    expect(future.dated).toBe(false);
    expect(Date.parse(future.publishedAt)).toBe(NOW);
  });

  it("survives feeds with thousands of entities", () => {
    const items = Array.from({ length: 300 }, (_, i) => `<item><title>Q&amp;A ${i} &#8217;s</title><link>https://example.com/${i}</link></item>`).join("");
    const out = parseFeed(`<rss><channel>${items}</channel></rss>`, feed, NOW);
    expect(out).toHaveLength(300);
    expect(out[0].title).toBe("Q&A 0 ’s");
  });

  it("strips tags and decodes entities", () => {
    expect(stripHtml("<p>A&nbsp;<a href='x'>link</a> &#x2014; &lt;tag&gt;</p>")).toBe("A link — <tag>");
  });
});

describe("news wire merging", () => {
  const item = (title: string, tier: number, at: string, publisher = "P") => ({
    id: title + publisher, title, link: "https://x", summary: "", publisher, feedId: publisher, category: "MARKETS" as const, region: "US", tier, publishedAt: at, dated: true,
  });

  it("keeps each story once, from the best tier, newest first", () => {
    const merged = mergeItems([
      [item("Fed holds rates", 2, "2026-09-24T10:00:00Z", "CNBC"), item("Oil jumps", 2, "2026-09-24T11:00:00Z")],
      [item("Fed Holds Rates!", 1, "2026-09-24T10:05:00Z", "Reuters")],
    ]);
    expect(merged.map((i) => i.title)).toEqual(["Oil jumps", "Fed Holds Rates!"]);
    expect(merged[1].publisher).toBe("Reuters");
  });

  it("has unique feed ids", () => {
    expect(new Set(FEEDS.map((f) => f.id)).size).toBe(FEEDS.length);
  });
});
