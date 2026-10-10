"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";

// Watcher Guru (watcher.guru/news): its latest articles by section or search, newest first, and
// the chosen one to read on the right, as the server cleaned it (server/src/providers/watcherguru.ts).

type Post = {
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
type Page = { posts: Post[]; page: number; totalPages: number };
type Article = Post & { html: string };

/** The site's sections (WordPress category ids), as on the server. */
const SECTIONS: Array<[number | null, string]> = [
  [null, "ALL"],
  [3199, "MARKETS"],
  [3197, "STOCKS"],
  [3195, "BUSINESS"],
  [3198, "POLICY"],
  [4258, "BRICS"],
  [4, "BITCOIN"],
  [5, "ETHEREUM"],
  [5052, "XRP"],
  [2, "CRYPTO"],
  [10, "ALTCOINS"],
];

function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} mnt lalu`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
const when = (iso: string) => new Date(iso).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Reader({ post }: { post: Post }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["watcher-article", post.id],
    queryFn: () => apiGet<Article>(`/api/watcher/posts/${post.id}`),
    staleTime: 3_600_000,
  });
  return (
    <article className="p-3 max-w-[820px]">
      <div className="flex flex-wrap gap-1 mb-1">
        {post.categories.map((c) => (
          <span key={c} className="text-fs-10 amber uppercase tracking-wider">
            {c}
          </span>
        ))}
      </div>
      <h1 className="text-fs-18 font-bold text-[var(--text)] leading-snug mb-1">{post.title}</h1>
      <div className="dim text-fs-10 mb-3">
        {when(post.publishedAt)}
        {post.author ? ` · ${post.author}` : ""} ·{" "}
        <a href={post.link} target="_blank" rel="noreferrer" className="amber hover:underline">
          Buka di watcher.guru →
        </a>
      </div>
      {error && <div className="down">Artikel gagal dimuat: {(error as Error).message}</div>}
      {isLoading && (
        <>
          {post.image && <img src={post.image} alt="" className="w-full max-h-[320px] object-cover mb-3 opacity-60" />}
          <p className="dim">{post.excerpt}</p>
        </>
      )}
      {data && (
        <>
          {/* Cleaned on the server: text markup only, links and pictures over http(s). */}
          <div className="wg-article" dangerouslySetInnerHTML={{ __html: data.html }} />
          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-4">
              {data.tags.map((t) => (
                <span key={t} className="text-fs-10 px-1.5 border border-[var(--border)] dim">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 pt-2 border-t border-[var(--border)] dim text-fs-10">
            Sumber: Watcher Guru ·{" "}
            <a href={post.link} target="_blank" rel="noreferrer" className="amber hover:underline">
              baca artikel aslinya
            </a>
          </div>
        </>
      )}
    </article>
  );
}

export default function WatcherWidget() {
  const [section, setSection] = useWidgetSetting<number | null>("wgSection", null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(id);
  }, [search]);
  const [openId, setOpenId] = useState<number | null>(null);

  const poll = usePoll(120_000);
  const { data, error, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, dataUpdatedAt } = useInfiniteQuery({
    queryKey: ["watcher-posts", section, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam) });
      if (section) params.set("category", String(section));
      if (q) params.set("q", q);
      return apiGet<Page>(`/api/watcher/posts?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < Math.min(last.totalPages, 50) ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
  });
  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
  // The same article may move to the next page while pages load: each once.
  const unique = posts.filter((p, i) => posts.findIndex((x) => x.id === p.id) === i);
  const open = unique.find((p) => p.id === openId) ?? unique[0] ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 text-fs-11">
      <div className="flex flex-wrap gap-1 p-1 items-center border-b border-[var(--border)]">
        {SECTIONS.map(([id, label]) => (
          <button key={label} className={`term-btn ${section === id ? "active" : ""}`} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
        <input className="flex-1 min-w-[120px] ml-1" placeholder="cari artikel…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="dim text-fs-10 ml-1">
          <span className={error ? "down" : "up"}>●</span> watcher.guru{dataUpdatedAt ? ` · ${ago(new Date(dataUpdatedAt).toISOString())}` : ""}
          {isFetching && !isFetchingNextPage ? " · memuat…" : ""}
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-[min(460px,42%)] shrink-0 overflow-auto border-r border-[var(--border)]">
          {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
          {isLoading && <div className="p-2 dim">Memuat artikel Watcher Guru…</div>}
          {!isLoading && unique.length === 0 && !error && <div className="p-2 dim">Tidak ada artikel.</div>}
          {unique.map((p) => (
            <button
              key={p.id}
              onClick={() => setOpenId(p.id)}
              className={`w-full text-left flex gap-2 p-2 border-b border-[#161616] hover:bg-[#161616] ${open?.id === p.id ? "bg-[#1f1a10]" : ""}`}
              style={open?.id === p.id ? { boxShadow: "inset 2px 0 0 var(--amber)" } : undefined}
            >
              {p.image ? <img src={p.image} alt="" loading="lazy" className="w-[88px] h-[54px] object-cover shrink-0 bg-[var(--panel-2)]" /> : <span className="w-[88px] h-[54px] shrink-0 bg-[var(--panel-2)]" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[var(--text)] leading-snug line-clamp-2">{p.title}</span>
                <span className="dim text-fs-10">
                  <span className="amber">{p.categories.slice(0, 2).join(" · ")}</span> · {ago(p.publishedAt)}
                </span>
              </span>
            </button>
          ))}
          {hasNextPage && (
            <button className="w-full p-2 amber hover:bg-[#161616]" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Memuat…" : "Muat artikel sebelumnya"}
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0 overflow-auto">{open ? <Reader key={open.id} post={open} /> : null}</div>
      </div>
    </div>
  );
}
