// A YouTube live stream's tracks, fetched the way YouTube's iOS app does: its player reply lists
// each track's URL without a sign-in (captions as itag 386, audio, video), and each track is read in
// numbered 5-second segments (`&sq=N`; without it, the newest, with the newest's number in the
// `x-head-seqnum` header).

import { Agent, request } from "node:https";

const IOS = { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en" };
const IOS_UA = `com.google.ios.youtube/${IOS.clientVersion} (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)`;

/** Connections kept open between segments: a fresh TLS handshake for each small segment is most of its time. */
const agent = new Agent({ keepAlive: true, maxSockets: 6 });

export type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

/**
 * An HTTPS request over IPv4, following redirects. The media URLs YouTube hands out are bound to
 * the address that asked for them (its `ip=`), and on a network with both IPv6 and IPv4 a request
 * can leave by either: one family for both keeps them matching. googlevideo.com sometimes sends a
 * segment request on to another server with a 302.
 */
export function get4(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}, hops = 0): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method ?? "GET", headers: { "User-Agent": IOS_UA, ...opts.headers }, family: 4, agent, timeout: 15_000 }, (res) => {
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location && hops < 3) {
        res.resume();
        resolve(get4(new URL(location, url).toString(), opts, hops + 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export type LiveTracks = {
  title: string;
  live: boolean;
  captions: string | null;
  /** AAC audio (itag 139, 48 kbps; else 140). */
  audio: string | null;
  /** H.264 video at 360p (itag 134; else 240p, 133). */
  video: string | null;
};

export async function liveTracks(videoId: string): Promise<LiveTracks> {
  const res = await get4("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, context: { client: IOS }, contentCheckOk: true, racyCheckOk: true }),
  });
  if (res.status !== 200) throw new Error(`youtube player ${res.status}`);
  const j = JSON.parse(res.body.toString("utf8")) as {
    videoDetails?: { title?: string; isLive?: boolean };
    playabilityStatus?: { status?: string; reason?: string };
    streamingData?: { adaptiveFormats?: Array<{ itag?: number; url?: string }> };
  };
  if (j.playabilityStatus?.status && j.playabilityStatus.status !== "OK") throw new Error(j.playabilityStatus.reason ?? j.playabilityStatus.status);
  const formats = j.streamingData?.adaptiveFormats ?? [];
  const url = (...itags: number[]) => itags.map((i) => formats.find((f) => f.itag === i)?.url).find(Boolean) ?? null;
  return { title: j.videoDetails?.title ?? "", live: !!j.videoDetails?.isLive, captions: url(386), audio: url(139, 140), video: url(134, 133) };
}

/** A segment of a track (the newest when `seq` is left out), and YouTube's newest segment number. */
export async function segment(url: string, seq?: number): Promise<{ head: number | null; body: Buffer }> {
  const res = await get4(seq === undefined ? url : `${url}&sq=${seq}`);
  if (res.status !== 200) throw Object.assign(new Error(`segment ${res.status}`), { status: res.status });
  const head = Number(res.headers["x-head-seqnum"]);
  return { head: Number.isFinite(head) && head > 0 ? head : null, body: res.body };
}
