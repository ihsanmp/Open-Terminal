"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";

// Watcher Guru: its Telegram channel's breaking lines (t.me/WatcherGuru, every "JUST IN", by
// default), or the site's articles (watcher.guru/news) by section or search with the chosen one to
// read on the right, as the server cleaned it (server/src/providers/watcherguru.ts).

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
    <article className="px-5 py-3 w-full">
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
          {post.image && <img src={post.image} alt="" className="w-full max-h-[60vh] object-cover mb-3 opacity-60" />}
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

type Flash = { id: number; text: string; images: string[]; video: boolean; time: number; url: string; links: Array<{ text: string; url: string }> };
type FlashPage = { posts: Flash[]; oldest: number | null };

const wib = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "" : `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} `}${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB`;
};

/** A message's text: its "JUST IN:" (or "BREAKING:") lead in bold, its links clickable. */
function FlashText({ f }: { f: Flash }) {
  const lead = /^([A-Z][A-Z0-9 '’&-]{2,30}:)\s*/.exec(f.text);
  const rest = lead ? f.text.slice(lead[0].length) : f.text;
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const l of f.links) {
    const at = rest.indexOf(l.text, i);
    if (at < 0) continue;
    parts.push(rest.slice(i, at));
    parts.push(
      <a key={`${l.url}-${at}`} href={l.url} target="_blank" rel="noreferrer" className="amber hover:underline break-all">
        {l.text}
      </a>,
    );
    i = at + l.text.length;
  }
  parts.push(rest.slice(i));
  return (
    <div className="whitespace-pre-wrap leading-relaxed text-[var(--text)]">
      {lead && <b className={/BREAKING|ALERT/.test(lead[1]) ? "down" : "amber"}>{lead[1]} </b>}
      {parts}
    </div>
  );
}

/** The channel's breaking lines, newest first, refreshed every half minute; older pages on demand. */
function TelegramFeed({ filter }: { filter: string }) {
  const poll = usePoll(30_000);
  const { data, error, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, dataUpdatedAt } = useInfiniteQuery({
    queryKey: ["watcher-telegram"],
    queryFn: ({ pageParam }) => apiGet<FlashPage>(`/api/watcher/telegram${pageParam ? `?before=${pageParam}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.oldest && last.oldest > 1 ? last.oldest : undefined),
    refetchInterval: poll,
  });
  const all = data?.pages.flatMap((p) => p.posts) ?? [];
  const unique = all.filter((p, i) => all.findIndex((x) => x.id === p.id) === i).sort((a, b) => b.id - a.id);
  const f = filter.toLowerCase();
  const shown = f ? unique.filter((p) => p.text.toLowerCase().includes(f)) : unique;
  const now = Date.now();
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="px-3 py-1 dim text-fs-10 border-b border-[#161616]">
        <span className={error ? "down" : "up"}>●</span> t.me/WatcherGuru · {unique.length} pesan dimuat
        {dataUpdatedAt ? ` · diperbarui ${ago(new Date(dataUpdatedAt).toISOString())}` : ""}
        {isFetching && !isFetchingNextPage ? " · memuat…" : ""}
      </div>
      {error && <div className="p-2 down">Kanal Telegram tidak terbaca: {(error as Error).message}</div>}
      {isLoading && <div className="p-2 dim">Memuat kanal Telegram Watcher Guru…</div>}
      {!isLoading && shown.length === 0 && !error && <div className="p-2 dim">{f ? `Tidak ada pesan yang memuat “${filter}” di yang sudah dimuat.` : "Belum ada pesan."}</div>}
      <div>
        {shown.map((p) => {
          const fresh = now - p.time < 15 * 60_000;
          return (
            <div key={p.id} className="flex gap-3 px-3 py-2 border-b border-[#161616] hover:bg-[#121212]" style={fresh ? { boxShadow: "inset 2px 0 0 var(--amber)" } : undefined}>
              <div className="w-[78px] shrink-0 text-fs-10 tabular-nums dim pt-0.5" title={new Date(p.time).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}>
                {wib(p.time)}
                <div className={fresh ? "amber" : ""}>{ago(new Date(p.time).toISOString(), now)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <FlashText f={p} />
                {(p.images.length > 0 || p.video) && (
                  <div className="flex gap-1.5 mt-1.5">
                    {p.images.slice(0, 3).map((src) => (
                      <a key={src} href={p.url} target="_blank" rel="noreferrer">
                        <img src={src} alt="" loading="lazy" className="h-[120px] max-w-[220px] object-cover rounded-sm bg-[var(--panel-2)]" />
                      </a>
                    ))}
                    {p.video && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="h-[24px] px-2 flex items-center rounded-sm border border-[var(--border)] dim hover:text-[var(--text)] text-fs-10">
                        ▶ video
                      </a>
                    )}
                  </div>
                )}
                <a href={p.url} target="_blank" rel="noreferrer" className="dim text-fs-9 hover:text-[var(--text)]">
                  buka di Telegram ↗
                </a>
              </div>
            </div>
          );
        })}
      </div>
      {hasNextPage && (
        <button className="w-full p-2 amber hover:bg-[#161616]" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Memuat…" : "Muat pesan sebelumnya"}
        </button>
      )}
    </div>
  );
}

export default function WatcherWidget() {
  const [mode, setMode] = useWidgetSetting<"telegram" | "articles">("wgMode", "telegram");
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
    enabled: mode === "articles",
  });
  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
  // The same article may move to the next page while pages load: each once.
  const unique = posts.filter((p, i) => posts.findIndex((x) => x.id === p.id) === i);
  const open = unique.find((p) => p.id === openId) ?? unique[0] ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 text-fs-11">
      <div className="flex flex-wrap gap-1 p-1 items-center border-b border-[var(--border)]">
        <button className={`term-btn ${mode === "telegram" ? "active" : ""}`} onClick={() => setMode("telegram")} title="Semua berita kilat kanal Telegram @WatcherGuru">
          ✈ TELEGRAM
        </button>
        <button className={`term-btn ${mode === "articles" ? "active" : ""}`} onClick={() => setMode("articles")} title="Artikel lengkap di watcher.guru">
          ARTIKEL
        </button>
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {mode === "telegram" ? (
          <input className="flex-1 min-w-[120px]" placeholder="saring pesan (mis. bitcoin, trump, fed)…" value={search} onChange={(e) => setSearch(e.target.value)} />
        ) : (
        <>
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
        </>
        )}
      </div>
      {mode === "telegram" ? (
        <TelegramFeed filter={q} />
      ) : (
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
      )}
    </div>
  );
}
