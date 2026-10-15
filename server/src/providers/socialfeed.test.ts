import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SocialPost } from "./socialfeed.js";

// A database of its own, not the app's.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ot-social-"));
let sf: typeof import("./socialfeed.js");
beforeAll(async () => {
  sf = await import("./socialfeed.js");
});

const post = (text: string, time: number, extra: Partial<SocialPost> = {}): SocialPost => ({
  id: `t:${text.slice(0, 20)}`,
  sourceId: null,
  platform: "bluesky",
  author: "Watcher Guru",
  handle: "watcher.guru",
  avatar: null,
  text,
  links: [],
  images: [],
  url: "https://bsky.app",
  time,
  trust: "domain",
  via: "feed",
  ...extra,
});

describe("reading the accounts", () => {
  it("reads a Telegram channel's messages, their links, pictures and times", () => {
    const html = `<meta property="og:title" content="Some &amp; Channel"><meta property="og:image" content="https://cdn/a.jpg">
      <div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="SomeChan/101">
      <a class="tgme_widget_message_photo_wrap blur" style="width:800px;background-image:url('https://cdn/p.jpg')"></a>
      <div class="tgme_widget_message_text js-message_text" dir="auto">FED CUTS<br/>See <a href="https://example.com/x">example.com/x</a> &amp; more</div>
      <time datetime="2026-10-15T11:41:49+00:00" class="time">11:41</time></div></div>`;
    const { name, posts } = sf.parseTelegram(html, "SomeChan", "telegram:somechan");
    expect(name).toBe("Some & Channel");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: "telegram:somechan/101", text: "FED CUTS\nSee example.com/x & more", images: ["https://cdn/p.jpg"], url: "https://t.me/SomeChan/101", trust: "unverified" });
    expect(posts[0].links).toEqual([{ text: "example.com/x", url: "https://example.com/x" }]);
    expect(posts[0].time).toBe(Date.parse("2026-10-15T11:41:49Z"));
  });

  it("reads Bluesky links by their UTF-8 byte ranges, skips reposts, and trusts a domain handle", () => {
    const text = "🚨 Read: example.com/abc";
    const start = Buffer.byteLength("🚨 Read: ");
    const posts = sf.parseBluesky(
      [
        {
          post: {
            uri: "at://did:plc:x/app.bsky.feed.post/3abc",
            author: { handle: "whale-alert.io", displayName: "Whale Alert" },
            record: {
              text,
              createdAt: "2026-10-15T10:00:00Z",
              facets: [{ index: { byteStart: start, byteEnd: start + 15 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/abc?full=1" }] }],
            },
            embed: { $type: "app.bsky.embed.images#view", images: [{ fullsize: "https://cdn/full.jpg" }] },
          },
        },
        {
          post: { uri: "at://x/app.bsky.feed.post/2", author: { handle: "other.bsky.social" }, record: { text: "x", createdAt: "2026-10-15T10:00:00Z" } },
          reason: { $type: "app.bsky.feed.defs#reasonRepost" },
        },
      ],
      "bluesky:whale-alert.io",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].links).toEqual([{ text: "example.com/abc", url: "https://example.com/abc?full=1" }]);
    expect(posts[0]).toMatchObject({ images: ["https://cdn/full.jpg"], url: "https://bsky.app/profile/whale-alert.io/post/3abc", trust: "domain" });
    expect(sf.bskyTrust("someone.bsky.social", undefined, null)).toBe("unverified");
    expect(sf.bskyTrust("someone.bsky.social", "valid", null)).toBe("verified");
    // Linked from the owner's own site, or checked by hand for the list.
    expect(sf.bskyTrust("livesquawknews.bsky.social", undefined, "bluesky:livesquawknews.bsky.social")).toBe("site");
    expect(sf.bskyTrust("unusualwhales.bsky.social", undefined, "bluesky:unusualwhales.bsky.social")).toBe("known");
  });

  it("drops Truth Social posts from an id that no longer belongs to the known account", () => {
    const status = (username: string) => ({
      id: "1",
      created_at: "2026-10-15T07:01:43Z",
      url: "https://truthsocial.com/@x/1",
      content: '<p>Hello <a href="https://wsj.com/a">wsj.com/a</a></p><p>Again</p>',
      account: { username, display_name: "D", verified: true },
    });
    expect(sf.parseTruth([status("realDonaldTrump")], "truthsocial:107780257626128497")[0]).toMatchObject({ text: "Hello wsj.com/a\n\nAgain", trust: "verified" });
    expect(sf.parseTruth([status("someoneElse")], "truthsocial:107780257626128497")).toHaveLength(0);
  });

  it("finds an X post's id in its links, writes out its t.co links, and tells a bought check from X's own", () => {
    expect(sf.xPostId("https://x.com/DeItaone/status/1846000000000000000?s=20")).toBe("1846000000000000000");
    expect(sf.xPostId("twitter.com/i/web/status/123456789")).toBe("123456789");
    expect(sf.xPostId("https://x.com/DeItaone")).toBeNull();
    const p = sf.parseX(
      {
        id_str: "99",
        text: "FED HIKES https://t.co/a https://t.co/pic",
        created_at: "2026-10-14T12:30:00.000Z",
        user: { name: "N", screen_name: "n", is_blue_verified: true },
        entities: { urls: [{ url: "https://t.co/a", expanded_url: "https://fed.gov/x", display_url: "fed.gov/x" }], media: [{ url: "https://t.co/pic" }] },
      },
      "manual",
    );
    expect(p).toMatchObject({ text: "FED HIKES fed.gov/x", links: [{ text: "fed.gov/x", url: "https://fed.gov/x" }], trust: "paid", url: "https://x.com/n/status/99" });
    expect(sf.xTrust({ name: "", screen_name: "", verified_type: "Government" })).toBe("verified");
    expect(sf.xTrust({ name: "", screen_name: "" })).toBe("unverified");
  });

  it("takes only accounts it can read, and says why X accounts can't be followed", () => {
    expect(sf.parseSourceInput("https://t.me/s/SomeChannel")).toEqual({ platform: "telegram", ref: "SomeChannel" });
    expect(sf.parseSourceInput("https://bsky.app/profile/Watcher.Guru")).toEqual({ platform: "bluesky", ref: "watcher.guru" });
    expect(sf.parseSourceInput("@nicktimiraos.bsky.social")).toEqual({ platform: "bluesky", ref: "nicktimiraos.bsky.social" });
    expect(sf.parseSourceInput("truth:107780257626128497")).toEqual({ platform: "truthsocial", ref: "107780257626128497" });
    expect(sf.parseSourceInput("https://x.com/DeItaone")).toHaveProperty("error");
  });
});

describe("corroborating a post with the outlets' headlines", () => {
  const t = Date.parse("2026-10-14T12:30:00Z");
  const headline = (title: string, publisher: string, at = t + 600_000) => ({ title, publisher, link: "https://news/x", time: at, words: sf.keywords(title) });
  // A day of headlines, so that common words weigh little and names and figures much.
  const filler = () =>
    Array.from({ length: 300 }, (_, i) => headline(`Stocks market shares fall rise US data report trade ${["Musk", "Tesla", "Fed", "rates", "oil", "China"][i % 6]} update ${i}`, "Filler", t - 3_600_000));
  const news = () => [
    ...filler(),
    headline("US inflation rose to 3.7% in September, figures show", "Guardian"),
    headline("Bank of America fined $1.2bn for money laundering failures", "Guardian"),
    headline("Ukraine accuses Elon Musk's SpaceX of throttling Starlink terminals", "Al Jazeera"),
    headline("Diesel shortages could persist well into 2027, IEA says", "Reuters", t + 40 * 3_600_000),
  ];

  it("confirms posts the outlets reported, even short ones with a figure", () => {
    const a = post("BREAKING: 🇺🇸 US inflation rises to 3.7%, higher than expectations.", t);
    const b = post("JUST IN: Bank of America $BAC crashes 8.3% after being fined $1.2 billion for money laundering violations", t, { id: "b" });
    const m = sf.corroborate([a, b], news());
    expect(m.get(a.id)?.map((c) => c.publisher)).toEqual(["Guardian"]);
    expect(m.get("b")?.[0].title).toContain("Bank of America");
  });

  it("doesn't confirm a post that only shares a name with a story, or one reported too long after", () => {
    const a = post("JUST IN: Elon Musk's Tesla $TSLA and SpaceX may announce plans to merge before December", t);
    const b = post("JUST IN: Global diesel shortages to continue well into 2027, IEA says.", t, { id: "b" });
    expect(sf.corroborate([a, b], news()).size).toBe(0);
  });

  it("leaves Whale Alert's on-chain transfers to the chain", () => {
    const p = post("🚨 1,000 $BTC (80,855,002 USD) transferred from #Kraken to #Binance", t, { handle: "whale-alert.io" });
    expect(sf.onChain(p)).toBe(true);
    expect(sf.onChain({ ...p, text: "🚨 Hex founder Richard Heart detained in Istanbul" })).toBe(false);
  });
});
