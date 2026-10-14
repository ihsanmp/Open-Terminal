// A live transcript of a Fed broadcast on YouTube, and how hawkish or dovish it sounds.
//
// YouTube carries a live stream's captions (its own speech recognition, or the broadcaster's
// captioner) as a text track beside the audio and video: itag 386, one ~1 kB timed-text document
// per 5-second segment, numbered like the media segments and fetched the same way. The iOS
// client's player reply lists the track's URL without a sign-in; the URL lasts hours and is asked
// for again when it stops working. A cue that runs across a segment boundary is repeated at the
// start of the next one, and is read once.
//
// A transcript is followed while someone is looking at it (polled within the last 90 s), from up to
// an hour back on first open, and kept on disk so it can be read again after the broadcast.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { findHits, indexOf, normalize, stanceOf, type Side, type Stance } from "./fedsentiment.js";
import { liveTracks, segment, type LiveTracks } from "./youtubelive.js";
import { MediaAnalyzer, type MediaReport } from "./fedmedia.js";

/** On first open, read back this many 5-second segments (an hour). */
const BACKFILL = 720;
const IDLE_MS = 90_000;
const MAX_SESSIONS = 4;
const MAX_LINES = 20_000;

const dir = join(dataDir, "fed-transcripts");

export type Cue = { t: number; d: number; text: string };
export type CaptionSegment = { seq: number | null; wallMs: number | null; cues: Cue[] };

/** One caption line: when it was said, and the speaker turn it's in (a ">>" in the captions starts a new one). */
export type Line = { seq: number; at: number; text: string; turn: number };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** A caption segment (fragmented MP4 holding a timed-text document) as its cues. */
export function parseCaptionSegment(body: string): CaptionSegment {
  const seq = /Sequence-Number: (\d+)/.exec(body)?.[1];
  const wall = /Ingestion-Walltime-Us: (\d+)/.exec(body)?.[1];
  const doc = body.slice(Math.max(0, body.indexOf("<timedtext")));
  const cues: Cue[] = [];
  for (const m of doc.matchAll(/<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text) cues.push({ t: Number(m[1]), d: Number(m[2] ?? 0), text });
  }
  return { seq: seq ? Number(seq) : null, wallMs: wall ? Math.round(Number(wall) / 1000) : null, cues };
}

/** The transcript so far, as it's built from segments in order. */
export type Transcript = { lines: Line[]; lastSeq: number | null; lastCue: string; turn: number };

export const emptyTranscript = (): Transcript => ({ lines: [], lastSeq: null, lastCue: "", turn: 0 });

/** Adds a segment's cues, skipping the cue repeated from the segment before and splitting turns at ">>". */
export function appendSegment(tr: Transcript, seg: CaptionSegment, seq: number): void {
  if (tr.lastSeq !== null && seq <= tr.lastSeq) return;
  const base = seg.wallMs ?? Date.now();
  seg.cues.forEach((cue, i) => {
    if (i === 0 && cue.t === 0 && cue.text === tr.lastCue) return;
    const parts = cue.text.split(/\s*>>\s*/);
    parts.forEach((part, j) => {
      if (j > 0) tr.turn++;
      if (part) tr.lines.push({ seq, at: base + cue.t, text: part, turn: tr.turn });
    });
  });
  if (seg.cues.length) tr.lastCue = seg.cues.at(-1)!.text;
  tr.lastSeq = seq;
  if (tr.lines.length > MAX_LINES) tr.lines.splice(0, tr.lines.length - MAX_LINES);
}

// ---------------------------------------------------------------- scoring

export type ScoredLine = Line & {
  score: number;
  phrases: Array<{ phrase: string; side: Side }>;
  question: boolean;
  /** The voice it was said in (layer 2), and whether that's the main speaker; null when not heard. */
  speaker: number | null;
  main: boolean | null;
  /** Left out of the index: a question from the floor, or another voice than the main speaker's. */
  excluded: boolean;
};

/** Who said what, from the voices (fedmedia.ts): left out of the index when it isn't the main speaker. */
export type Voices = { speakerAt(at: number): { id: number; main: boolean } | null; diarized: boolean };
export type Sentiment = {
  index: number;
  stance: Stance;
  hawkish: number;
  dovish: number;
  /** The last five minutes of speech. */
  recent: { index: number; stance: Stance; hawkish: number; dovish: number };
  /** The index as it stood at the end of each minute. */
  timeline: Array<{ at: number; index: number }>;
  top: Array<{ phrase: string; side: Side; count: number }>;
  /** Speaker turns read as questions (from the floor) and left out of the index. */
  questionTurns: number[];
  /** Lines in another voice than the main speaker's, left out of the index. */
  othersLeftOut: number;
};

/**
 * Scores a transcript: every phrase the lexicon knows, by line. When the captions mark speaker
 * turns, a turn that ends on a question is someone asking (a reporter, a moderator), not the Fed
 * speaker, and counts for nothing; the turn still being spoken isn't judged yet.
 */
export function scoreTranscript(lines: Line[], voices?: Voices): { lines: ScoredLine[]; sentiment: Sentiment } {
  const turnText = new Map<number, string>();
  for (const l of lines) turnText.set(l.turn, `${turnText.get(l.turn) ?? ""} ${l.text}`);
  const lastTurn = lines.at(-1)?.turn ?? 0;
  const questions = new Set<number>();
  if (turnText.size > 1) for (const [turn, text] of turnText) if (turn !== lastTurn && /\?["')\]]?\s*$/.test(text.trim())) questions.add(turn);

  // One text for the whole transcript (phrases run across lines), with each line's offset in it.
  const offsets: number[] = [];
  let text = "";
  for (const l of lines) {
    offsets.push(text.length);
    text += `${normalize(l.text)} `;
  }
  const scored: ScoredLine[] = lines.map((l) => {
    const who = voices?.speakerAt(l.at) ?? null;
    return { ...l, score: 0, phrases: [], question: questions.has(l.turn), speaker: who?.id ?? null, main: who?.main ?? null, excluded: false };
  });
  const other = (l: ScoredLine) => !!voices?.diarized && l.main === false;
  for (const l of scored) l.excluded = l.question || other(l);
  const counts = new Map<string, { phrase: string; side: Side; count: number }>();
  const kept: Array<{ at: number; side: Side }> = [];
  for (const h of findHits(text)) {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= h.at) lo = mid;
      else hi = mid - 1;
    }
    const line = scored[lo];
    if (!line || line.question || other(line)) continue;
    line.score += h.side;
    line.phrases.push({ phrase: h.phrase, side: h.side });
    kept.push({ at: line.at, side: h.side });
    const key = `${h.side}|${h.phrase}`;
    counts.set(key, { phrase: h.phrase, side: h.side, count: (counts.get(key)?.count ?? 0) + 1 });
  }

  const tally = (hits: typeof kept) => {
    const hawkish = hits.filter((h) => h.side === 1).length;
    const dovish = hits.length - hawkish;
    const index = indexOf(hawkish, dovish);
    return { index, stance: stanceOf(index), hawkish, dovish };
  };
  const end = lines.at(-1)?.at ?? 0;
  const timeline: Sentiment["timeline"] = [];
  if (lines.length) {
    let h = 0;
    let d = 0;
    let k = 0;
    for (let minute = Math.floor(lines[0].at / 60_000) * 60_000; minute <= end; minute += 60_000) {
      for (; k < kept.length && kept[k].at < minute + 60_000; k++) kept[k].side === 1 ? h++ : d++;
      timeline.push({ at: minute + 60_000, index: indexOf(h, d) });
    }
  }
  return {
    lines: scored,
    sentiment: {
      ...tally(kept),
      recent: tally(kept.filter((h) => h.at >= end - 5 * 60_000)),
      timeline: timeline.slice(-240),
      top: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
      questionTurns: [...questions],
      othersLeftOut: scored.filter(other).length,
    },
  };
}

// ---------------------------------------------------------------- following a broadcast

type Status = "starting" | "live" | "offline" | "no-captions" | "error";

type Session = {
  videoId: string;
  title: string;
  status: Status;
  error: string | null;
  url: string | null;
  tr: Transcript;
  /** The newest segment YouTube has, and when it last moved. */
  head: number | null;
  headMovedAt: number;
  /** Reading back older segments: where it began, how far it's got, up to where. */
  catchUp: { start: number; from: number; to: number } | null;
  lastAsked: number;
  running: boolean;
  /** Segments YouTube kept refusing, skipped. */
  missed: number;
  /** Layers 2 and 3: the voices and faces. */
  media: MediaAnalyzer;
  /** When following last stopped (an ended or upcoming broadcast is asked about again a minute on). */
  stoppedAt: number;
  dirty: boolean;
  savedAt: number;
  scored: { key: string; result: ReturnType<typeof scoreTranscript> } | null;
};

const sessions = new Map<string, Session>();

async function captionTrack(videoId: string): Promise<{ title: string; live: boolean; url: string | null; tracks: LiveTracks }> {
  const tracks = await liveTracks(videoId);
  return { title: tracks.title, live: tracks.live, url: tracks.captions, tracks };
}

/** A caption segment (the newest when `seq` is left out), and YouTube's newest segment number. */
async function fetchSegment(url: string, seq?: number): Promise<{ head: number | null; seg: CaptionSegment }> {
  const r = await segment(url, seq);
  return { head: r.head, seg: parseCaptionSegment(r.body.toString("utf8")) };
}

const fileOf = (videoId: string) => join(dir, `${videoId}.json`);

function load(videoId: string): { title: string; tr: Transcript } | null {
  try {
    if (!existsSync(fileOf(videoId))) return null;
    const saved = JSON.parse(readFileSync(fileOf(videoId), "utf8")) as { title: string } & Transcript;
    return { title: saved.title, tr: { lines: saved.lines ?? [], lastSeq: saved.lastSeq ?? null, lastCue: saved.lastCue ?? "", turn: saved.turn ?? 0 } };
  } catch {
    return null;
  }
}

function save(s: Session): void {
  if (!s.dirty) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fileOf(s.videoId), JSON.stringify({ videoId: s.videoId, title: s.title, ...s.tr, savedAt: Date.now() }));
    s.dirty = false;
    s.savedAt = Date.now();
  } catch (err) {
    console.warn("fed transcript save:", err instanceof Error ? err.message : err);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One segment, tried three times: a refusal (403, now and then for a run of segments) is asked again
 * with a fresh URL from the player. A segment still refused is skipped (5 seconds of captions)
 * rather than holding the transcript up.
 */
async function readSegment(s: Session, q: number): Promise<CaptionSegment | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await fetchSegment(s.url!, q)).seg;
    } catch (err) {
      if (attempt >= 2) {
        s.missed++;
        return null;
      }
      await sleep(500 * (attempt + 1));
      if ((err as { status?: number }).status) {
        const track = await captionTrack(s.videoId);
        if (!track.url) throw err;
        s.url = track.url;
        s.media.setTracks(track.tracks.audio, track.tracks.video);
      }
    }
  }
}

/**
 * Reads segments `from`..`to`, one after another: YouTube answers a burst of parallel requests with
 * 401s from about the hundredth on (and then refuses the URL), while one at a time reads an hour
 * back in ~20 s.
 */
async function readRange(s: Session, from: number, to: number): Promise<void> {
  for (let q = from; q <= to; q++) {
    const seg = await readSegment(s, q);
    if (seg) appendSegment(s.tr, seg, q);
    else s.tr.lastSeq = q;
    s.dirty = true;
    if (s.catchUp) s.catchUp.from = q + 1;
    if (Date.now() - s.lastAsked > IDLE_MS) return;
  }
}

async function step(s: Session): Promise<void> {
  if (!s.url) {
    const track = await captionTrack(s.videoId);
    s.title = track.title || s.title;
    if (!track.live) {
      s.status = "offline";
      return;
    }
    if (!track.url) {
      s.status = "no-captions";
      return;
    }
    s.url = track.url;
    s.media.setTracks(track.tracks.audio, track.tracks.video);
  }
  const newest = await fetchSegment(s.url);
  const head = newest.head ?? newest.seg.seq;
  if (head === null) throw new Error("no segment number");
  if (head !== s.head) {
    s.head = head;
    s.headMovedAt = Date.now();
  } else if (Date.now() - s.headMovedAt > 60_000) {
    // Nothing new for a minute: over, or stalled. The player tells which.
    s.url = null;
    return;
  }
  s.status = "live";
  const from = s.tr.lastSeq === null || s.tr.lastSeq < head - 12 * 720 ? Math.max(0, head - BACKFILL) : s.tr.lastSeq + 1;
  if (head - from > 8) {
    s.catchUp = { start: from, from, to: head };
    await readRange(s, from, head - 1);
    s.catchUp = null;
  } else if (from < head) await readRange(s, from, head - 1);
  appendSegment(s.tr, newest.seg, head);
  s.dirty = true;
}

async function follow(s: Session): Promise<void> {
  s.running = true;
  let failures = 0;
  try {
    while (Date.now() - s.lastAsked < IDLE_MS) {
      try {
        await step(s);
        failures = 0;
        s.error = null;
      } catch (err) {
        // An expired or refused URL: ask the player for a new one next round.
        if ((err as { status?: number }).status) s.url = null;
        failures++;
        s.error = err instanceof Error ? err.message : String(err);
        if (failures >= 5) s.status = "error";
      }
      if (s.status === "offline" || s.status === "no-captions") break;
      if (Date.now() - s.savedAt > 30_000) save(s);
      await sleep(failures ? Math.min(30_000, 4000 * failures) : 4000);
    }
  } finally {
    save(s);
    s.running = false;
    s.stoppedAt = Date.now();
    s.catchUp = null;
  }
}

export type TranscriptReply = {
  videoId: string;
  title: string;
  status: Status;
  error: string | null;
  /** Lines from `since` on; `total` is where the next poll starts. */
  lines: ScoredLine[];
  total: number;
  catchUp: { done: number; of: number } | null;
  /** 5-second segments YouTube refused and that were skipped. */
  missed: number;
  sentiment: Sentiment;
  /** Layers 2 and 3: the voices, how the main speaker sounds and looks. */
  media: MediaReport;
  /**
   * The Fed Sentiment Index with all three layers: the words' index (90%) made firmer or softer by
   * the delivery's confidence (10%): index × (0.9 + 0.1 × (2 × confidence − 1)). Null until layer 2
   * has heard enough of the main speaker.
   */
  combined: { index: number; stance: Stance } | null;
};

/**
 * The transcript of a broadcast from line `since`, and its sentiment. Asking keeps it being
 * followed; the first ask starts it (from disk, then from YouTube).
 */
export function transcript(videoId: string, since = 0, faces = true): TranscriptReply {
  let s = sessions.get(videoId);
  if (!s) {
    const saved = load(videoId);
    s = {
      videoId,
      title: saved?.title ?? "",
      status: "starting",
      error: null,
      url: null,
      tr: saved?.tr ?? emptyTranscript(),
      head: null,
      headMovedAt: Date.now(),
      catchUp: null,
      lastAsked: Date.now(),
      running: false,
      missed: 0,
      media: new MediaAnalyzer(videoId, faces),
      stoppedAt: 0,
      dirty: false,
      savedAt: Date.now(),
      scored: null,
    };
    sessions.set(videoId, s);
    // Room for this one: drop the session asked for longest ago.
    if (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.values()].filter((x) => x !== s).sort((a, b) => a.lastAsked - b.lastAsked)[0];
      if (oldest && !oldest.running) sessions.delete(oldest.videoId);
      else if (oldest) oldest.lastAsked = 0;
    }
  }
  s.lastAsked = Date.now();
  const resting = (s.status === "offline" || s.status === "no-captions") && Date.now() - s.stoppedAt < 60_000;
  if (!s.running && !resting) void follow(s);
  s.media.faces = faces;
  // Layers 2 and 3 follow the newest segment only (an hour of audio and video read back would be
  // heavy), on their own loop beside the captions'.
  s.media.start(() => Date.now() - s!.lastAsked < IDLE_MS);
  const key = `${s.tr.lines.length}:${s.media.version}`;
  if (s.scored?.key !== key) s.scored = { key, result: scoreTranscript(s.tr.lines, { speakerAt: (at) => s!.media.speakerAt(at), diarized: s.media.diarized() }) };
  const { lines, sentiment } = s.scored.result;
  const media = s.media.report(s.tr.lines.slice(-400));
  const combined =
    media.confidence === null ? null : (() => {
      const index = Math.round(sentiment.index * (0.9 + 0.1 * (2 * media.confidence - 1)) * 1000) / 1000;
      return { index, stance: stanceOf(index) };
    })();
  const start = Math.max(0, Math.min(since, lines.length));
  return {
    videoId,
    title: s.title,
    status: s.status,
    error: s.error,
    lines: lines.slice(start),
    total: lines.length,
    catchUp: s.catchUp ? { done: s.catchUp.from - s.catchUp.start, of: s.catchUp.to - s.catchUp.start } : null,
    missed: s.missed,
    sentiment,
    media,
    combined,
  };
}
