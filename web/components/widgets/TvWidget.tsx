"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { useWidgetSetting } from "../../store/terminal";
import NowcastPanel from "./NowcastPanel";

// Live business-news channels as HLS straight from each broadcaster's own CDN (no YouTube, so
// no embed or consent walls). Each was checked live — the playlist advancing and its segment
// timestamps within seconds of now — and playable from the browser (CORS open), on 2026-09-30.
const CHANNELS = [
  { id: "bloomberg-us", label: "Bloomberg US", url: "https://www.bloomberg.com/media-manifest/streams/us.m3u8" },
  { id: "bloomberg-eu", label: "Bloomberg Europe", url: "https://www.bloomberg.com/media-manifest/streams/eu.m3u8" },
  { id: "bloomberg-asia", label: "Bloomberg Asia", url: "https://www.bloomberg.com/media-manifest/streams/asia.m3u8" },
  { id: "schwab", label: "Schwab Network", url: "https://content.uplynk.com/channel/f9aafa1f132e40af9b9e7238bc18d128.m3u8" },
  { id: "cnbctv18", label: "CNBC-TV18", url: "https://n18syndication.akamaized.net/bpk-tv/CNBC_TV18_NW18_MOB/output01/index.m3u8" },
  { id: "ndtv", label: "NDTV Profit", url: "https://ndtvprofit.akamaized.net/hls/live/2107404/ndtvprofit/master_1.m3u8" },
  { id: "ausbiz", label: "ausbiz", url: "https://d9quh89lh7dtw.cloudfront.net/public-output/index.m3u8" },
  { id: "cna", label: "CNA", url: "https://d2e1asnsl7br7b.cloudfront.net/7782e205e72f43aeb4a48ec97f66ebbe/index.m3u8" },
  { id: "euronews", label: "Euronews", url: "https://cdn-euronews.akamaized.net/live/eds/euronews-en/25002/index.m3u8" },
  { id: "cgtn", label: "CGTN Global Biz", url: "https://fastlive.cctvplus.com/out/v1/2b3d8a0c805d437f9dc85b764c2ac599/index.m3u8" },
] as const;

type Channel = (typeof CHANNELS)[number];

/** How far behind real time the picture is: from the stream's own clock (EXT-X-PROGRAM-DATE-TIME)
 *  when it has one, else from the live edge. */
type Lag = { seconds: number; fromClock: boolean } | null;

function lagLabel(lag: Lag): string {
  if (!lag) return "LIVE";
  const s = Math.max(0, Math.round(lag.seconds));
  if (s < 90) return `LIVE · ${s}s behind`;
  return `DELAYED · ${Math.round(s / 60)} min behind`;
}

// ---------------------------------------------------------------- the Fed on air

type FedStream = { videoId: string; title: string; channel: string; status: "live" | "upcoming" | "ended"; start: string | null };
type FedEvent = { title: string; description: string; location: string; type: string; start: string; allDay: boolean; videoId: string | null; link: string | null };
type FedLive = { checkedAt: number; live: FedStream[]; upcoming: FedStream[]; schedule: FedEvent[] };

/** The Fed's state, read every minute while the TV is open (the server checks YouTube each minute). */
function useFedLive() {
  return useQuery({ queryKey: ["fed-live"], queryFn: () => apiGet<FedLive>("/api/fed/live"), refetchInterval: 60_000, staleTime: 30_000 });
}

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/** "2 hari 4 jam", "6 jam 05 mnt", "12 mnt 30 dtk" until a moment; "sekarang" once it's here. */
function countdown(to: number, now: number): string {
  const s = Math.round((to - now) / 1000);
  if (s <= 0) return "sekarang";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${String(m).padStart(2, "0")} mnt`;
  return `${m} mnt ${String(s % 60).padStart(2, "0")} dtk`;
}

const TYPE_LABEL: Record<string, string> = { Speeches: "PIDATO", FOMC: "FOMC", Testimony: "TESTIMONY", Beige: "BEIGE BOOK", Stat: "RILIS DATA", Board: "BOARD", Conferences: "KONFERENSI", Other: "LAINNYA", events: "ACARA" };

function FedPanel() {
  const { data, isLoading, error } = useFedLive();
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const [showStats, setShowStats] = useWidgetSetting("fedShowStats", false);
  const [side, setSide] = useWidgetSetting<"schedule" | "nowcast">("fedSide", "schedule");
  const live = data?.live ?? [];
  const playing = live.find((l) => l.videoId === picked) ?? (picked ? data?.upcoming.find((u) => u.videoId === picked) : undefined) ?? live[0];
  const next = data?.upcoming[0];
  const schedule = (data?.schedule ?? []).filter((e) => showStats || e.type !== "Stat");

  return (
    <div className="flex flex-col lg:flex-row flex-1 min-h-0">
      <div className="relative flex-1 min-h-[240px] bg-black flex flex-col">
        {playing ? (
          <>
            <div className="flex items-center gap-2 px-2 py-1 text-fs-11 bg-[#111] border-b border-[var(--border)]">
              <span className={playing.status === "live" ? "down font-bold" : "amber font-bold"}>{playing.status === "live" ? "● LIVE" : "◷ SEGERA"}</span>
              <span className="text-[var(--text)] truncate">{playing.title}</span>
              <span className="dim shrink-0">· {playing.channel}</span>
              <a className="ml-auto term-btn shrink-0" href={`https://www.youtube.com/watch?v=${playing.videoId}`} target="_blank" rel="noreferrer" title="Buka di YouTube">
                ↗ YouTube
              </a>
            </div>
            <iframe
              key={playing.videoId}
              className="flex-1 w-full"
              src={`https://www.youtube-nocookie.com/embed/${playing.videoId}?autoplay=1&rel=0`}
              title={playing.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <div className="text-fs-15 text-[var(--text)]">🏛 Tidak ada siaran The Fed saat ini</div>
            {isLoading && <div className="dim">Memeriksa channel The Fed…</div>}
            {error && <div className="down">Gagal memeriksa: {(error as Error).message}</div>}
            {next && (
              <>
                <div className="dim">Siaran berikutnya</div>
                <div className="text-[var(--text)] max-w-[520px]">{next.title}</div>
                <div className="dim text-fs-11">{next.channel}</div>
                {next.start && (
                  <div className="amber text-fs-18 font-bold tabular-nums">
                    {countdown(Date.parse(next.start), now)} <span className="dim text-fs-11 font-normal">· {new Date(next.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}
                <button className="term-btn" onClick={() => setPicked(next.videoId)}>
                  Buka ruang tunggu siaran
                </button>
              </>
            )}
            <div className="dim text-fs-10 max-w-[520px]">
              Dicek setiap menit: channel YouTube The Fed (Board dan 11 Fed regional) serta siaran yang dicantumkan kalender resmi federalreserve.gov. Saat ada yang live, siarannya langsung diputar di sini.
            </div>
          </div>
        )}
      </div>
      <div className="lg:w-[440px] shrink-0 border-l border-[var(--border)] flex flex-col min-h-0 max-h-[50vh] lg:max-h-none">
        <div className="flex items-center gap-3 px-2 py-1.5 border-b border-[var(--border)] text-fs-11">
          <button className={side === "schedule" ? "font-bold text-[#ef5350]" : "dim hover:text-[var(--text)]"} onClick={() => setSide("schedule")}>
            Jadwal The Fed
          </button>
          <button className={side === "nowcast" ? "font-bold text-[#ef5350]" : "dim hover:text-[var(--text)]"} onClick={() => setSide("nowcast")} title="Nowcast CPI/PCE dan GDP dibandingkan konsensus">
            Nowcast
          </button>
          {side === "schedule" && (
            <label className="ml-auto flex items-center gap-1 dim cursor-pointer">
              <input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} /> rilis data
            </label>
          )}
        </div>
        {side === "nowcast" ? (
          <div className="overflow-auto flex-1 min-h-0">
            <NowcastPanel />
          </div>
        ) : (
        <div className="overflow-auto flex-1 min-h-0">
          {live.length > 1 && (
            <div className="p-2 border-b border-[var(--border)] flex flex-col gap-1">
              <div className="down text-fs-10 font-bold">● {live.length} SIARAN LIVE</div>
              {live.map((l) => (
                <button key={l.videoId} className={`term-btn text-left ${playing?.videoId === l.videoId ? "active" : ""}`} onClick={() => setPicked(l.videoId)}>
                  {l.channel}: {l.title}
                </button>
              ))}
            </div>
          )}
          {schedule.map((e) => {
            const t = Date.parse(e.start);
            const stream = e.videoId ? [...live, ...(data?.upcoming ?? [])].find((s) => s.videoId === e.videoId) : undefined;
            const past = t < now - 2 * 3_600_000;
            return (
              <div key={`${e.start}|${e.title}`} className={`px-2 py-1.5 border-b border-[#1c1c1c] text-fs-11 ${past ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-fs-9 px-1 border ${e.type === "FOMC" ? "border-[#ef5350] text-[#ef5350]" : "border-[#444] dim"}`}>{TYPE_LABEL[e.type] ?? e.type.toUpperCase()}</span>
                  <span className="dim tabular-nums">{e.allDay ? new Date(t).toLocaleDateString([], { day: "numeric", month: "short" }) : new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {stream?.status === "live" && <span className="down font-bold">● LIVE</span>}
                  {!past && t > now && !e.allDay && <span className="ml-auto amber tabular-nums">{countdown(t, now)}</span>}
                </div>
                <div className="text-[var(--text)] mt-0.5">{e.title}</div>
                {e.description && <div className="dim text-fs-10">{e.description}</div>}
                {e.location && <div className="dim text-fs-10 italic">{e.location}</div>}
                {(e.videoId || e.link) && (
                  <div className="mt-0.5">
                    {e.videoId ? (
                      <button className="text-fs-10 amber hover:underline" onClick={() => setPicked(e.videoId)}>
                        ▶ Putar di sini
                      </button>
                    ) : (
                      <a className="text-fs-10 amber hover:underline" href={e.link!} target="_blank" rel="noreferrer">
                        ↗ Siaran di federalreserve.gov
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {data && schedule.length === 0 && <div className="dim p-2">Tidak ada acara terjadwal.</div>}
        </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the TV

export default function TvWidget() {
  const [channelId, setChannelId] = useWidgetSetting<string>("channel", CHANNELS[0].id);
  const fed = useFedLive();
  const fedLiveNow = (fed.data?.live.length ?? 0) > 0;
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0 items-center">
        <button
          className={`term-btn ${channelId === "fed" ? "active" : ""} ${fedLiveNow ? "!border-[#ef5350]" : ""}`}
          onClick={() => setChannelId("fed")}
          title="Siaran The Fed (Board dan Fed regional) dan jadwalnya"
        >
          🏛 THE FED {fedLiveNow && <span className="down font-bold">● LIVE</span>}
        </button>
        {CHANNELS.map((c) => (
          <button key={c.id} className={`term-btn ${channelId === c.id ? "active" : ""}`} onClick={() => setChannelId(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {channelId === "fed" ? <FedPanel /> : <HlsChannel channel={CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0]} />}
    </div>
  );
}

function HlsChannel({ channel }: { channel: Channel }) {
  const [error, setError] = useState<string | null>(null);
  const [lag, setLag] = useState<Lag>(null);
  const [awayFromEdge, setAwayFromEdge] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setLag(null);
    setAwayFromEdge(false);

    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 3 });
      hlsRef.current = hls;
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(`Stream unavailable right now (${data.details}). Try another channel.`);
      });
      const measure = () => {
        const edge = hls.liveSyncPosition;
        const behindEdge = edge !== null ? edge - video.currentTime : 0;
        setAwayFromEdge(behindEdge > 30);
        const date = hls.playingDate;
        setLag(date ? { seconds: (Date.now() - date.getTime()) / 1000, fromClock: true } : { seconds: behindEdge, fromClock: false });
      };
      const timer = setInterval(measure, 1000);
      return () => {
        clearInterval(timer);
        hlsRef.current = null;
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.play().catch(() => {});
    } else {
      setError("Your browser doesn't support HLS playback.");
    }
  }, [channel]);

  const goLive = () => {
    const video = videoRef.current;
    const edge = hlsRef.current?.liveSyncPosition;
    if (video && edge !== null && edge !== undefined) {
      video.currentTime = edge;
      video.play().catch(() => {});
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-1 px-1 pb-1 shrink-0 items-center">
        <span className="ml-auto flex items-center gap-2 text-fs-11">
          {!error && (
            <span className={lag && lag.seconds >= 90 ? "amber" : "down"} title={lag?.fromClock ? "From the broadcast's own clock" : "Behind the stream's live edge"}>
              ● {lagLabel(lag)}
            </span>
          )}
          {awayFromEdge && (
            <button className="term-btn" onClick={goLive} title="Jump to the live edge">
              GO LIVE
            </button>
          )}
        </span>
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        <video ref={videoRef} className="w-full h-full" autoPlay muted controls playsInline />
        {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center dim bg-black">{error}</div>}
      </div>
    </div>
  );
}
