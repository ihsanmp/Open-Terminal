"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { useWidgetSetting } from "../../store/terminal";

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

export default function TvWidget() {
  const [channelId, setChannelId] = useWidgetSetting<string>("channel", CHANNELS[0].id);
  const channel: Channel = CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0];
  const setChannel = (c: Channel) => setChannelId(c.id);
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
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0 items-center">
        {CHANNELS.map((c) => (
          <button key={c.id} className={`term-btn ${channel.id === c.id ? "active" : ""}`} onClick={() => setChannel(c)}>
            {c.label}
          </button>
        ))}
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
