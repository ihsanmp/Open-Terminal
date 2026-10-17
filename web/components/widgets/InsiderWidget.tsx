"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { apiDelete, apiGet, apiPost, fmt, fmtBig } from "../../lib/api";
import { KOL_ACCOUNTS, kolOf, type KolAccount } from "../../lib/kol-list";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

// The insiders: what the accounts that move markets post first (server: providers/socialfeed.ts),
// each post with how its author's identity is known and whether a news outlet has reported the
// same since, so a rumour reads as one; and, on its own tab, the company insiders' trades from
// their SEC Form 4 filings.

// ---------------------------------------------------------------- the posts

type Platform = "x" | "telegram" | "bluesky" | "truthsocial";
type Trust = "domain" | "verified" | "site" | "known" | "paid" | "unverified";
type Link = { text: string; url: string };
type Confirmation = { publisher: string; title: string; link: string; time: number };
type Post = {
  id: string;
  sourceId: string | null;
  platform: Platform;
  author: string;
  handle: string;
  avatar: string | null;
  text: string;
  links: Link[];
  images: string[];
  video?: boolean;
  url: string;
  time: number;
  quoted?: { author: string; handle: string; text: string; url: string } | null;
  repostOf?: string | null;
  trust: Trust;
  truncated?: boolean;
  likes?: number | null;
  replies?: number | null;
  via: "feed" | "manual";
  confirmedBy: Confirmation[];
  onChain: boolean;
  /** Where it stands (server: socialfeed.ts postStatus). */
  status: "onchain" | "confirmed" | "official" | "pending" | "unconfirmed" | "statement";
};
type Source = { id: string; platform: Platform; ref: string; name: string; builtIn: boolean; status: { ok: boolean; error: string | null; at: number; count: number } | null };
type Feed = { sources: Source[]; posts: Post[] };

const PLATFORM: Record<Platform, string> = { x: "X", telegram: "Telegram", bluesky: "Bluesky", truthsocial: "Truth Social" };

const TRUST: Record<Trust, { text: string; cls: string; title: string }> = {
  domain: { text: "✓ akun asli", cls: "up", title: "Handle Bluesky-nya adalah domain milik akun ini sendiri: hanya pemilik domain yang bisa memakainya" },
  verified: { text: "✓ terverifikasi", cls: "up", title: "Diverifikasi platformnya sendiri (X: akun pemerintah/bisnis; Truth Social; Telegram)" },
  site: { text: "✓ akun resmi", cls: "up", title: "Ditautkan dari situs web resmi pemiliknya sendiri" },
  known: { text: "✓ akun dikenal", cls: "up", title: "Keaslian akun diperiksa manual untuk daftar ini" },
  paid: { text: "centang berbayar", cls: "amber", title: "Centang biru X yang dibeli: bukan bukti identitas" },
  unverified: { text: "tak terverifikasi", cls: "down", title: "Identitas akun ini tidak bisa dipastikan" },
};

function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} hari lalu`;
  return new Date(ms).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
const when = (ms: number) => new Date(ms).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The text with its links (as the post shows them) and any bare address made clickable. */
function richText(text: string, links: Link[]): ReactNode[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const known = links.filter((l) => l.text && text.includes(l.text));
  const parts = [...known.map((l) => esc(l.text)), "https?://[^\\s]+"];
  const re = new RegExp(`(${parts.join("|")})`, "g");
  return text.split(re).map((piece, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{piece}</Fragment>;
    const url = known.find((l) => l.text === piece)?.url ?? piece;
    return (
      <a key={i} href={url} target="_blank" rel="noreferrer" className="text-[#5aa9ff] hover:underline break-all">
        {piece}
      </a>
    );
  });
}

function Confirm({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  if (post.onChain)
    return (
      <span className="up" title="Transfer ini tercatat di blockchain: buka tautannya untuk memeriksa transaksinya">
        ⛓ data on-chain
      </span>
    );
  if (post.confirmedBy.length)
    return (
      <span>
        <button className="up hover:underline" onClick={() => setOpen((o) => !o)} title="Media resmi yang memberitakan hal yang sama (klik untuk melihat beritanya)">
          ✓ dikonfirmasi: {post.confirmedBy.map((c) => c.publisher).join(", ")}
        </button>
        {open && (
          <span className="block mt-0.5 pl-2 border-l border-[var(--border)]">
            {post.confirmedBy.map((c) => (
              <a key={c.link + c.publisher} href={c.link} target="_blank" rel="noreferrer" className="block dim hover:text-[var(--text)]">
                {c.publisher}: {c.title} <span className="text-fs-10">({ago(c.time)})</span>
              </a>
            ))}
          </span>
        )}
      </span>
    );
  if (post.status === "official")
    return (
      <span className="up" title="Akun resmi lembaga atau perusahaan itu sendiri: inilah sumber primernya, tak perlu dikonfirmasi media">
        ✓ sumber resmi
      </span>
    );
  // Someone's own view or statement: no outlet is expected to report it, so it isn't flagged.
  if (post.status === "statement")
    return (
      <span className="dim" title="Opini atau pernyataan pemilik akun sendiri, bukan kabar tentang suatu peristiwa: tidak dicocokkan dengan media. Isinya tetap belum tentu benar.">
        pernyataan langsung
      </span>
    );
  return post.status === "pending" ? (
    <span className="dim" title="Kabar ini belum diberitakan media resmi: diperiksa ulang tiap kali feed diperbarui">
      … menunggu konfirmasi media
    </span>
  ) : (
    <span className="amber" title="Kabar tentang suatu peristiwa yang tidak diberitakan media resmi mana pun. Belum tentu hoaks, tapi perlakukan sebagai kabar yang belum terbukti.">
      ⚠ belum dikonfirmasi media resmi
    </span>
  );
}

/** The listed accounts by the source that follows them, for their notes on posts read elsewhere. */
const KOL_BY_SOURCE = new Map(KOL_ACCOUNTS.filter((a) => a.followedVia).map((a) => [a.followedVia!, a]));

function PostCard({ post, onRemove }: { post: Post; onRemove?: () => void }) {
  const trust = TRUST[post.trust];
  const kol = post.platform === "x" ? kolOf(post.handle) : post.sourceId ? KOL_BY_SOURCE.get(post.sourceId) : undefined;
  return (
    <article className="flex gap-2 px-2 py-2 border-b border-[var(--border)]">
      <div className="w-7 h-7 shrink-0 rounded-full bg-[var(--panel-2)] overflow-hidden flex items-center justify-center dim text-fs-10">
        {post.avatar ? <img src={post.avatar} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} /> : post.author.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="font-bold text-[var(--text)]">{post.author}</span>
          <span className="dim">@{post.handle}</span>
          {kol?.note && post.via !== "manual" && (
            <span className="text-[#c9a227] cursor-help" title={`Catatan dari daftar akun Anda: ${kol.note}`}>
              ⓘ
            </span>
          )}
          <span className={`text-fs-10 ${trust.cls}`} title={trust.title}>
            {trust.text}
          </span>
          <span className="dim text-fs-10" title={when(post.time)}>
            · {PLATFORM[post.platform]} · {ago(post.time)}
          </span>
        </div>
        {/* A pasted post is judged one at a time: its account's note in full. */}
        {kol?.note && post.via === "manual" && (
          <div className="text-fs-10 text-[#c9a227]" title="Catatan dari daftar akun Anda">
            Catatan: {kol.note}
          </div>
        )}
        {post.repostOf && <div className="dim text-fs-10">membagikan ulang @{post.repostOf}</div>}
        {post.text ? (
          <p className="whitespace-pre-wrap break-words leading-snug mt-0.5">
            {richText(post.text, post.links)}
            {post.truncated && <span className="dim"> … (lanjutan di postingan aslinya)</span>}
          </p>
        ) : (
          <p className="dim mt-0.5">{post.video ? "[video]" : post.images.length ? "" : "[tanpa teks]"}</p>
        )}
        {post.images.length > 0 && (
          <div className={`grid gap-1 mt-1 ${post.images.length > 1 ? "grid-cols-2" : "grid-cols-1"} max-w-[520px]`}>
            {post.images.slice(0, 4).map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full max-h-64 object-cover border border-[var(--border)]" />
              </a>
            ))}
          </div>
        )}
        {post.video && post.text && <div className="dim text-fs-10 mt-0.5">[berisi video: buka postingannya]</div>}
        {post.quoted && (
          <a href={post.quoted.url} target="_blank" rel="noreferrer" className="block mt-1 p-1.5 border border-[var(--border)] hover:border-[var(--amber)]">
            <span className="font-bold">{post.quoted.author}</span> <span className="dim">@{post.quoted.handle}</span>
            <span className="block whitespace-pre-wrap break-words dim">{post.quoted.text}</span>
          </a>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1 text-fs-10">
          <Confirm post={post} />
          <a href={post.url} target="_blank" rel="noreferrer" className="amber hover:underline">
            Buka di {PLATFORM[post.platform]} ↗
          </a>
          {post.likes != null && <span className="dim">♥ {fmtBig(post.likes)}</span>}
          {onRemove && (
            <button className="dim hover:text-[var(--down)]" onClick={onRemove} title="Hapus postingan yang ditempel ini">
              hapus
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** The symbol's ticker and, for the big coins, their names, to find posts that mention it. */
function mentionsOf(symbol: string): RegExp | null {
  const base = symbol.replace(/^\^/, "").replace(/-USDT?$|=X$|=F$|\.[A-Z]+$/i, "").toUpperCase();
  if (base.length < 2) return null;
  const names: Record<string, string[]> = { BTC: ["bitcoin"], ETH: ["ethereum", "ether"], SOL: ["solana"], XRP: ["ripple"], GC: ["gold", "emas"], SI: ["silver"], CL: ["oil", "crude"], SPX: ["s&p 500"], GSPC: ["s&p 500"] };
  const words = [base, ...(names[base] ?? [])].map((w) => w.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&"));
  return new RegExp(`(^|[^A-Za-z0-9])\\$?(${words.join("|")})(?![A-Za-z0-9])`, "i");
}

function Posts({ symbol }: { symbol: string }) {
  const qc = useQueryClient();
  const poll = usePoll(30_000);
  const { data, error, isLoading } = useQuery({ queryKey: ["social"], queryFn: () => apiGet<Feed>("/api/social"), refetchInterval: poll });
  const [filter, setFilter] = useWidgetSetting<string>("insiderSource", "all");
  const [onlyConfirmed, setOnlyConfirmed] = useWidgetSetting<boolean>("insiderConfirmed", false);
  const [onlySymbol, setOnlySymbol] = useWidgetSetting<boolean>("insiderSymbol", false);
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [follow, setFollow] = useState("");
  const [followMsg, setFollowMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shown, setShown] = useState(80);
  const [listing, setListing] = useWidgetSetting<boolean>("insiderList", false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["social"] });
  const submitPaste = async () => {
    if (!paste.trim()) return;
    setBusy(true);
    setPasteMsg(null);
    try {
      const r = await apiPost<{ added: Post[]; failed: Array<{ id: string; error: string }> }>("/api/social/x", { input: paste });
      setPasteMsg({ ok: r.added.length > 0, text: [r.added.length ? `${r.added.length} postingan ditambahkan` : "", ...r.failed.map((f) => `${f.id}: ${f.error}`)].filter(Boolean).join(" · ") });
      if (r.added.length) {
        setPaste("");
        setFilter("all");
      }
      refresh();
    } catch (e) {
      setPasteMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const submitFollow = async () => {
    if (!follow.trim()) return;
    setBusy(true);
    setFollowMsg(null);
    try {
      const s = await apiPost<Source>("/api/social/sources", { input: follow });
      setFollowMsg({ ok: true, text: `${s.name} diikuti` });
      setFollow("");
      refresh();
    } catch (e) {
      setFollowMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const sources = data?.sources ?? [];
  const mention = onlySymbol ? mentionsOf(symbol) : null;
  const posts = (data?.posts ?? []).filter((p) => {
    if (filter === "x" ? p.via !== "manual" : filter !== "all" && p.sourceId !== filter) return false;
    if (onlyConfirmed && !["onchain", "confirmed", "official"].includes(p.status)) return false;
    if (mention && !mention.test(`${p.text} ${p.quoted?.text ?? ""}`)) return false;
    return true;
  });
  const manualCount = (data?.posts ?? []).filter((p) => p.via === "manual").length;

  return (
    <div className="flex flex-col h-full min-h-0 text-fs-11">
      <div className="p-1 border-b border-[var(--border)] flex flex-col gap-1">
        <div className="flex flex-wrap gap-1 [&>button]:whitespace-nowrap">
          <input
            className="flex-1 min-w-[200px]"
            placeholder="Tempel link postingan X (x.com/…/status/…), bisa beberapa sekaligus"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPaste()}
          />
          <button className="term-btn" disabled={busy || !paste.trim()} onClick={submitPaste}>
            Tampilkan
          </button>
          <button className={`term-btn ${adding ? "active" : ""}`} onClick={() => setAdding((a) => !a)} title="Ikuti akun lain (Telegram, Bluesky, Truth Social)">
            + Akun
          </button>
          <button className={`term-btn ${listing ? "active" : ""}`} onClick={() => setListing((l) => !l)} title="Daftar akun pasar Anda: cara tiap akun dipantau, link X-nya, dan catatannya">
            Daftar akun ({KOL_ACCOUNTS.length})
          </button>
        </div>
        {pasteMsg && <div className={`text-fs-10 ${pasteMsg.ok ? "up" : "down"}`}>{pasteMsg.text}</div>}
        {adding && (
          <div className="flex flex-col gap-1 p-1 border border-[var(--border)]">
            <div className="flex flex-wrap gap-1">
              <input
                className="flex-1 min-w-[200px]"
                placeholder="t.me/<channel>, bsky.app/profile/<handle>, atau truth:<id akun>"
                value={follow}
                onChange={(e) => setFollow(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitFollow()}
              />
              <button className="term-btn" disabled={busy || !follow.trim()} onClick={submitFollow}>
                Ikuti
              </button>
            </div>
            <div className="dim text-fs-10">
              Hanya akun yang identitasnya bisa dipastikan yang diterima: handle domain di Bluesky, atau tanda verifikasi resmi platformnya, supaya akun palsu tidak masuk. Akun X tidak bisa diikuti otomatis tanpa API berbayar X; tempel link postingannya di atas.
            </div>
            {followMsg && <div className={`text-fs-10 ${followMsg.ok ? "up" : "down"}`}>{followMsg.text}</div>}
          </div>
        )}
        <div className="flex flex-wrap gap-1 items-center">
          <button className={`term-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
            Semua
          </button>
          {sources.map((s) => (
            <span key={s.id} className="inline-flex items-center">
              <button
                className={`term-btn ${filter === s.id ? "active" : ""}`}
                onClick={() => setFilter(s.id)}
                title={`${PLATFORM[s.platform]} · ${s.ref}${s.status ? (s.status.ok ? ` · dibaca ${ago(s.status.at)}` : ` · gagal: ${s.status.error}`) : ""}`}
              >
                <span className={s.status ? (s.status.ok ? "up" : "down") : "dim"}>●</span> {s.name}
              </button>
              <button
                className="dim hover:text-[var(--down)] px-0.5"
                title={`Berhenti mengikuti ${s.name}`}
                onClick={async () => {
                  if (!window.confirm(`Berhenti mengikuti ${s.name}? Postingannya ikut dihapus dari daftar.`)) return;
                  await apiDelete(`/api/social/sources/${encodeURIComponent(s.id)}`);
                  if (filter === s.id) setFilter("all");
                  refresh();
                }}
              >
                ×
              </button>
            </span>
          ))}
          {manualCount > 0 && (
            <button className={`term-btn ${filter === "x" ? "active" : ""}`} onClick={() => setFilter("x")}>
              X (tempel) {manualCount}
            </button>
          )}
          <label className="flex items-center gap-1 ml-auto cursor-pointer" title="Hanya postingan yang terbukti: dikonfirmasi media resmi, dari sumber resminya sendiri, atau transfer on-chain">
            <input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} /> Hanya terkonfirmasi
          </label>
          <label className="flex items-center gap-1 cursor-pointer" title={`Hanya postingan yang menyebut ${symbol}`}>
            <input type="checkbox" checked={onlySymbol} onChange={(e) => setOnlySymbol(e.target.checked)} /> Sebut {symbol}
          </label>
        </div>
      </div>
      {listing ? (
        <KolList sources={data ? sources : null} />
      ) : (
      <div className="flex-1 min-h-0 overflow-auto">
        {error && <div className="p-2 down">Gagal memuat: {(error as Error).message}</div>}
        {isLoading && <div className="p-2 dim">Membaca akun-akun…</div>}
        {data && posts.length === 0 && <div className="p-3 dim">Belum ada postingan{onlyConfirmed || onlySymbol ? " yang cocok dengan filter" : ""}.</div>}
        {posts.slice(0, shown).map((p) => (
          <PostCard
            key={p.id}
            post={p}
            onRemove={
              p.via === "manual"
                ? async () => {
                    await apiDelete(`/api/social/posts/${encodeURIComponent(p.id)}`);
                    refresh();
                  }
                : undefined
            }
          />
        ))}
        {posts.length > shown && (
          <button className="term-btn m-2" onClick={() => setShown((n) => n + 80)}>
            Tampilkan lebih banyak ({posts.length - shown} lagi)
          </button>
        )}
        <div className="p-2 dim text-fs-10 border-t border-[var(--border)]">
          Postingan langsung dari akunnya, bukan dari media berita (itu ada di tab News). ✓ dikonfirmasi = media resmi memberitakan hal yang sama sejak itu;
          ✓ sumber resmi = akun lembaga/perusahaan itu sendiri; pernyataan langsung = opini atau pernyataan pemilik akun, tidak dicocokkan dengan media;
          ⚠ belum dikonfirmasi = kabar tentang suatu peristiwa yang belum diberitakan media resmi: belum tentu hoaks, tapi belum terbukti. Tidak ada
          saringan yang bisa menjamin 100% bebas hoaks.
        </div>
      </div>
      )}
    </div>
  );
}

const MARKETS = ["Lintas pasar", "Crypto / Web3", "Saham (US)", "Forex / Makro", "Indonesia", "OG Crypto"];

/** How a listed account is read here: followed (and where), a news outlet, or on X alone. */
function followedBy(a: KolAccount, sources: Source[] | null): ReactNode {
  if (a.followedVia) {
    if (!sources) return <span className="dim">…</span>;
    const s = sources.find((x) => x.id === a.followedVia);
    if (s) return <span className="up">✓ otomatis via {PLATFORM[s.platform]}</span>;
    return <span className="dim">dihapus dari feed</span>;
  }
  if (a.media) return <span className="dim" title="Media berita: beritanya ada di tab News">media → News</span>;
  return (
    <span className="dim" title="X tidak bisa dibaca otomatis tanpa login: buka akunnya, lalu tempel link postingannya di kolom atas">
      hanya di X
    </span>
  );
}

function KolList({ sources }: { sources: Source[] | null }) {
  const [market, setMarket] = useWidgetSetting<string>("insiderListMarket", "all");
  // OG Crypto: the OG sheet's people, also those listed under a market (CZ, Vitalik, Hayes).
  const rows = KOL_ACCOUNTS.filter((a) => market === "all" || (market === "OG Crypto" ? Boolean(a.og) : a.market === market));
  const auto = sources ? KOL_ACCOUNTS.filter((a) => a.followedVia && sources.some((s) => s.id === a.followedVia)).length : null;
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="flex flex-wrap gap-1 p-1 items-center">
        {["all", ...MARKETS].map((m) => (
          <button key={m} className={`term-btn ${market === m ? "active" : ""}`} onClick={() => setMarket(m)}>
            {m === "all" ? "Semua" : m}
          </button>
        ))}
        <span className="dim text-fs-10 ml-auto">
          {auto === null ? "memuat…" : `${auto} dari ${KOL_ACCOUNTS.length} dipantau otomatis`}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Akun</th>
            <th className="!text-left">Pasar · jenis</th>
            <th className="!text-left">Dipantau</th>
            <th className="!text-left">Catatan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={`${a.name}-${a.handle}`}>
              <td className="!text-left whitespace-nowrap">
                <span className="text-[var(--text)]">{a.name}</span>{" "}
                {a.handle ? (
                  <a href={`https://x.com/${a.handle}`} target="_blank" rel="noreferrer" className="amber hover:underline">
                    @{a.handle}
                  </a>
                ) : (
                  <span className="down">handle belum ada</span>
                )}
                {a.handleCheck !== "ok" && a.handle && (
                  <span className="down" title="Handle ini belum dipastikan di daftar Anda: periksa profilnya sebelum mempercayai postingannya">
                    {" "}
                    ⚠
                  </span>
                )}
              </td>
              <td className="!text-left dim">
                {a.og ? (
                  <span title={`Peran sekarang: ${a.og.role}`}>
                    <span className="amber">OG</span> sejak {a.og.since} · {a.og.group}
                    {a.market !== "OG Crypto" ? ` · ${a.market}` : ""}
                    <span className="block text-fs-10">{a.og.role}</span>
                  </span>
                ) : (
                  <>
                    {a.market} · {a.category}
                  </>
                )}
              </td>
              <td className="!text-left whitespace-nowrap">{followedBy(a, sources)}</td>
              <td className="!text-left dim min-w-[240px] !whitespace-normal">{a.note ?? a.info}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- SEC Form 4

type InsiderTransaction = {
  filingDate: string;
  transactionDate: string;
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionCode: string;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
};

// SEC's single-letter transaction codes, the ones that actually show up in practice.
const CODE_LABEL: Record<string, string> = {
  P: "Open market buy",
  S: "Open market sale",
  A: "Grant/award",
  M: "Option exercise",
  G: "Gift",
  F: "Tax withholding",
  C: "Conversion",
  D: "Disposition to issuer",
};

function Form4({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["insider", symbol],
    queryFn: () => apiGet<InsiderTransaction[]>(`/api/insider/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">Loading insider transactions for {symbol}…</div>;

  return (
    <div className="overflow-auto h-full">
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Insider</th>
            <th>Title</th>
            <th>Type</th>
            <th>Shares</th>
            <th>Price</th>
            <th>Value</th>
            <th>Owned After</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={`${t.ownerName}-${t.transactionDate}-${i}`}>
              <td className="!text-left dim whitespace-nowrap">{t.transactionDate}</td>
              <td className="!text-left">{t.ownerName}</td>
              <td className="!text-left dim truncate max-w-[140px]" title={t.ownerTitle ?? ""}>
                {t.ownerTitle ?? (t.isDirector ? "Director" : t.isTenPercentOwner ? "10%+ Owner" : "—")}
              </td>
              <td className={t.acquiredDisposed === "A" ? "up" : t.acquiredDisposed === "D" ? "down" : "dim"}>{CODE_LABEL[t.transactionCode] ?? t.transactionCode}</td>
              <td>{fmtBig(t.shares)}</td>
              <td>{fmt(t.pricePerShare)}</td>
              <td>{fmtBig(t.value)}</td>
              <td className="dim">{fmtBig(t.sharesOwnedAfter)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={8} className="dim p-3">
                No recent open-market insider transactions for {symbol}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function InsiderWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [view, setView] = useWidgetSetting<"posts" | "form4">("insiderView", "posts");
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 px-1 pt-1 text-fs-11">
        <button className={`term-btn ${view === "posts" ? "active" : ""}`} onClick={() => setView("posts")}>
          Postingan
        </button>
        <button className={`term-btn ${view === "form4" ? "active" : ""}`} onClick={() => setView("form4")}>
          Form 4 (SEC) · {symbol}
        </button>
      </div>
      <div className="flex-1 min-h-0">{view === "posts" ? <Posts symbol={symbol} /> : <Form4 symbol={symbol} />}</div>
    </div>
  );
}
