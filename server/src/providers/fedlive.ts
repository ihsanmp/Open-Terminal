// The Fed on air: whether the Board or a regional Reserve Bank is streaming right now, and what's
// scheduled. Three free sources, each small:
//   - the Board's own calendar as JSON (federalreserve.gov/json/calendar.json): speeches, FOMC
//     meetings and press conferences, testimony, with the YouTube link each will stream on (often
//     another channel's: the IMF's, a university's);
//   - each Fed channel's YouTube feed (a few kB): the videos it has scheduled or just put up;
//   - YouTube's player API for a video (~13 kB): live now, upcoming at a time, or over.

export type FedChannel = { name: string; id: string };

/** The Board and the Reserve Banks on YouTube (Boston streams elsewhere). */
export const FED_CHANNELS: FedChannel[] = [
  { name: "Federal Reserve Board", id: "UCAzhpt9DmG6PnHXjmJTvRGQ" },
  { name: "New York Fed", id: "UC2yBH2gnjeNxSX6ripCFh4A" },
  { name: "Chicago Fed", id: "UCPiLTBJPBw8AUyKDpkol6yQ" },
  { name: "St. Louis Fed", id: "UCEz-5n2ShUnYBQ4SMiwSAaA" },
  { name: "San Francisco Fed", id: "UC3xpIrci6GZoInyYZbWlEKg" },
  { name: "Atlanta Fed", id: "UCRaZvHGHxLMtWDu1XAUuG-w" },
  { name: "Dallas Fed", id: "UCR6rkkl7V4qBkUrvNtZM8Tw" },
  { name: "Cleveland Fed", id: "UCoG03XFD_mWMrn9xNDL8fkg" },
  { name: "Philadelphia Fed", id: "UCq76zaCz3CF3I2zRqvupJZA" },
  { name: "Richmond Fed", id: "UCco3EWMV2NY8iZ7K4JlGNTQ" },
  { name: "Kansas City Fed", id: "UCSZUJbkRxBMOOkR8IAHRKxw" },
  { name: "Minneapolis Fed", id: "UCHGBgY0WVs6a6JQ_d2z9SBw" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export type FedEvent = {
  title: string;
  description: string;
  location: string;
  type: string;
  /** When it starts (ISO), or the day at midnight New York time when no time is given. */
  start: string;
  allDay: boolean;
  /** The YouTube video it streams on, when the calendar names one. */
  videoId: string | null;
  link: string | null;
};

export type FedStream = {
  videoId: string;
  title: string;
  channel: string;
  status: "live" | "upcoming" | "ended";
  /** When it went live, or is due to. */
  start: string | null;
};

/** The video id in a YouTube link (watch?v=, /live/, youtu.be/, /embed/). */
export function videoIdOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /(?:[?&]v=|\/live\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

/** New York's offset from UTC on a day, in minutes (-240 in summer, -300 in winter). */
function newYorkOffset(utcGuess: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(utcGuess);
  const m = /GMT([+-]\d+)/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  return m ? Number(m[1]) * 60 : -300;
}

/** "11:30 p.m." on 2026-10-15 in New York as an instant; null with no usable time. */
export function newYorkTime(day: string, time: string): Date | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i.exec(time.trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hour += 12;
  const minute = Number(m[2] ?? 0);
  const asUtc = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour, minute);
  return new Date(asUtc - newYorkOffset(new Date(asUtc)) * 60_000);
}

/** The calendar's descriptions are escaped HTML ("&lt;p&gt;Two-day meeting…"): plain text. */
export function plainText(html: string): string {
  const unescaped = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#10;/g, " ").replace(/&amp;/g, "&");
  return unescaped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

type RawEvent = { title?: string; description?: string; location?: string; type?: string; time?: string; month?: string; days?: string; live?: string; link?: string };

/** The Board's calendar entries as events (a "14-15" two-day FOMC meeting starts on the 14th). */
export function parseFedCalendar(raw: { events?: RawEvent[] }): FedEvent[] {
  const out: FedEvent[] = [];
  for (const e of raw.events ?? []) {
    if (!e.month || !e.days || !e.title) continue;
    const firstDay = /\d+/.exec(e.days)?.[0];
    if (!firstDay) continue;
    const day = `${e.month}-${firstDay.padStart(2, "0")}`;
    const at = e.time ? newYorkTime(day, e.time) : null;
    const start = at ?? newYorkTime(day, "12:00 a.m.")!;
    const link = e.live || e.link || null;
    out.push({
      title: e.title.trim(),
      description: plainText(e.description ?? ""),
      location: plainText(e.location ?? ""),
      type: (e.type ?? "").trim(),
      start: start.toISOString(),
      allDay: !at,
      videoId: videoIdOf(e.live),
      link,
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export async function fedCalendar(): Promise<FedEvent[]> {
  const res = await fetch("https://www.federalreserve.gov/json/calendar.json", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`federalreserve.gov calendar ${res.status}`);
  // The file starts with a byte-order mark.
  return parseFedCalendar(JSON.parse((await res.text()).replace(/^﻿/, "")));
}

/** A channel's latest videos from its feed: id, title and when each went up. */
export function parseChannelFeed(xml: string): Array<{ videoId: string; title: string; published: string }> {
  const out: Array<{ videoId: string; title: string; published: string }> = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1] ?? "";
    const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1] ?? "";
    if (id) out.push({ videoId: id, title: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'), published });
  }
  return out;
}

async function channelFeed(channel: FedChannel) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`youtube feed ${res.status}`);
  return parseChannelFeed(await res.text());
}

type PlayerReply = {
  videoDetails?: { title?: string; author?: string; isLive?: boolean; isUpcoming?: boolean };
  microformat?: { playerMicroformatRenderer?: { liveBroadcastDetails?: { isLiveNow?: boolean; startTimestamp?: string; endTimestamp?: string } } };
};

/** A video's broadcast state from YouTube's player: live, due to start, or over (null: not a broadcast). */
export function streamState(videoId: string, reply: PlayerReply, fallbackChannel: string): FedStream | null {
  const live = reply.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
  if (!live) return null;
  const status: FedStream["status"] = live.isLiveNow ? "live" : live.endTimestamp ? "ended" : reply.videoDetails?.isUpcoming ? "upcoming" : "ended";
  return { videoId, title: reply.videoDetails?.title ?? "", channel: reply.videoDetails?.author ?? fallbackChannel, status, start: live.startTimestamp ?? null };
}

async function playerState(videoId: string, channel: string): Promise<FedStream | null> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, context: { client: { clientName: "WEB", clientVersion: "2.20241010.00.00", hl: "en" } } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`youtube player ${res.status}`);
  return streamState(videoId, (await res.json()) as PlayerReply, channel);
}

export type FedLive = { checkedAt: number; live: FedStream[]; upcoming: FedStream[]; schedule: FedEvent[] };
// (A press conference's calendar link is federalreserve.gov's broadcast page, not a video: it's found
// on the Board's channel once YouTube has it scheduled.)

/**
 * What the Fed is streaming now and soon, and its calendar for the next two weeks. Candidates are
 * the calendar's streams from six hours ago to two days ahead and each channel's videos from the
 * last two days; each is asked of YouTube's player.
 */
export async function fedLive(now = Date.now()): Promise<FedLive> {
  const [calendar, feeds] = await Promise.all([
    fedCalendar().catch((err) => {
      console.warn("fed calendar:", err instanceof Error ? err.message : err);
      return [] as FedEvent[];
    }),
    Promise.all(FED_CHANNELS.map((c) => channelFeed(c).then((v) => v.map((x) => ({ ...x, channel: c.name }))).catch(() => []))),
  ]);
  const candidates = new Map<string, string>();
  for (const e of calendar) {
    const t = Date.parse(e.start);
    if (e.videoId && t > now - 6 * 3_600_000 && t < now + 2 * 86_400_000) candidates.set(e.videoId, e.title);
  }
  for (const v of feeds.flat()) if (Date.parse(v.published) > now - 2 * 86_400_000) candidates.set(v.videoId, v.channel);
  const states = await Promise.all([...candidates].map(([id, channel]) => playerState(id, channel).catch(() => null)));
  const streams = states.filter((s): s is FedStream => s !== null);
  // Three weeks ahead: the next FOMC meeting is always in it.
  const schedule = calendar.filter((e) => Date.parse(e.start) > now - 12 * 3_600_000 && Date.parse(e.start) < now + 21 * 86_400_000);
  return {
    checkedAt: now,
    live: streams.filter((s) => s.status === "live"),
    upcoming: streams.filter((s) => s.status === "upcoming").sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
    schedule,
  };
}
