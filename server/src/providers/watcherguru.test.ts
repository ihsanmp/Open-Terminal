import { describe, expect, it } from "vitest";
import { decode, sanitize, toPost } from "./watcherguru.js";

describe("Watcher Guru", () => {
  it("keeps an article's text markup", () => {
    const html = `<p class="wp-block-paragraph">The <strong>SpaceX</strong> target is now <em>$230</em>.</p>
<h2 id="h-x" class="wp-block-heading">Forecast</h2>
<ul><li>One</li><li>Two</li></ul>
<figure class="aligncenter"><img src="https://watcher.guru/a.jpg" alt="A &quot;chart&quot;" srcset="x 1w" onerror="alert(1)"><figcaption>Source</figcaption></figure>
<p><a href="https://watcher.guru/news/other" style="color:red">Also read</a></p>`;
    expect(sanitize(html)).toBe(
      `<p>The <strong>SpaceX</strong> target is now <em>$230</em>.</p>
<h2>Forecast</h2>
<ul><li>One</li><li>Two</li></ul>
<figure><img src="https://watcher.guru/a.jpg" alt="A &quot;chart&quot;" loading="lazy"><figcaption>Source</figcaption></figure>
<p><a href="https://watcher.guru/news/other" target="_blank" rel="noreferrer noopener">Also read</a></p>`
    );
  });

  it("leaves nothing that runs", () => {
    const evil = [
      `<script>alert(1)</script>`,
      `<SCRIPT >alert(1)</script >`,
      `<iframe src="https://x"></iframe>`,
      `<img src=x onerror=alert(1)>`,
      `<img src="javascript:alert(1)">`,
      `<a href="javascript:alert(1)">x</a>`,
      `<a href=" JaVaScRiPt:alert(1)">x</a>`,
      `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
      `<svg onload=alert(1)><circle/></svg>`,
      `<div onclick="alert(1)">x</div>`,
      `<p style="background:url(javascript:alert(1))">x</p>`,
      `<!-- <script>alert(1)</script> -->`,
      `<a href="https://ok" onmouseover="alert(1)">x</a>`,
      `<img src="https://ok" alt='"><script>alert(1)</script>'>`,
      `<<script>script>alert(1)<</script>/script>`,
      `<blockquote class="twitter-tweet"><p>tweet</p><script async src="https://platform.twitter.com/widgets.js"></script></blockquote>`,
    ];
    for (const e of evil) {
      const out = sanitize(e);
      expect(out).not.toMatch(/<script|<iframe|<svg|onerror|onload|onclick|onmouseover|javascript:|data:|style=/i);
    }
    expect(sanitize(`<a href="javascript:alert(1)">x</a>`)).toBe(`<a target="_blank" rel="noreferrer noopener">x</a>`);
    expect(sanitize(`1 < 2 and 3 > 2 & so on`)).toBe(`1 &lt; 2 and 3 &gt; 2 &amp; so on`);
  });

  it("reads a post's fields", () => {
    const post = toPost({
      id: 1,
      date_gmt: "2026-10-09T14:03:15",
      link: "https://watcher.guru/news/x",
      title: { rendered: "Cramer&#8217;s view &amp; more" },
      excerpt: { rendered: "<p>The target is now $230 per share, up from $220, after the&#8230;</p>" },
      _embedded: {
        author: [{ name: "Loredana" }],
        "wp:featuredmedia": [{ source_url: "https://watcher.guru/full.jpg", media_details: { sizes: { medium_large: { source_url: "https://watcher.guru/768.jpg", width: 768 } } } }],
        "wp:term": [[{ taxonomy: "category", name: "Stocks" }], [{ taxonomy: "post_tag", name: "spaceX" }]],
      },
    });
    expect(post).toEqual({
      id: 1,
      title: "Cramer’s view & more",
      link: "https://watcher.guru/news/x",
      publishedAt: "2026-10-09T14:03:15.000Z",
      excerpt: "The target is now $230 per share, up from $220, after the…",
      image: "https://watcher.guru/768.jpg",
      categories: ["Stocks"],
      tags: ["spaceX"],
      author: "Loredana",
    });
    expect(decode("&#x1F600;&hellip;")).toBe("😀…");
  });
});
