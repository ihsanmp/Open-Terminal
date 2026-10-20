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
import { MediaAnalyzer, stopFaceWorker, type MediaReport } from "./fedmedia.js";
import { noteFedBroadcast } from "./reactions.js";
import type { DeliverySample } from "./deliverytest.js";
import { check, claimsInLines, LABEL, UNIT, type Check, type Claim } from "./factcheck.js";
import { findReports, eventPart, statements, type Evidence } from "./evidence.js";

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

export type Session = {
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
  /** A Fed broadcast (not a pasted link), and the index last shown for it. */
  fed: boolean;
  lastIndex: number | null;
  /** When following last stopped (an ended or upcoming broadcast is asked about again a minute on). */
  stoppedAt: number;
  dirty: boolean;
  savedAt: number;
  scored: { key: string; result: ReturnType<typeof scoreTranscript> } | null;
  /** The figures said about the US data, each checked against the official data (factcheck.ts). */
  facts: { scanned: number; read: number; items: Map<string, FactItem> };
  /** The events said (not figures), each looked for in the news archive (evidence.ts). */
  evidence: { scanned: number; checked: number; items: Map<string, EvidenceItem> };
  /** The main speaker's delivery, a sample a minute of the broadcast (for deliverytest.ts), and when it was last kept. */
  delivery: { samples: DeliverySample[]; keptAt: number };
};

type EvidenceItem = Evidence & { at: number; askedAt: number };
const MAX_EVIDENCE = 300;
/** Statements read per poll (a broadcast read back from disk is caught up on over a few polls). */
const EVIDENCE_PER_POLL = 60;
/** A statement no outlet had reported yet is looked for again, for two hours after it was said. */
const EVIDENCE_RETRY_MS = 10 * 60_000;
const EVIDENCE_RETRY_FOR = 2 * 3_600_000;

/**
 * Reads the settled lines (their sentences done) for statements of events and looks each up in
 * the news archive; one not found yet is looked for again as the news comes in.
 */
export function scanEvidence(s: Session, now = Date.now()): void {
  const settled = s.tr.lines.length - SETTLE;
  const ev = s.evidence;
  if (settled > ev.scanned) {
    // From the first statement not read yet (one still running on last time, or the next).
    const from = ev.scanned;
    const lines = s.tr.lines.slice(from, settled);
    let pending: number | null = null;
    let done = 0;
    for (const st of statements(lines.map((l) => l.text))) {
      const line = from + st.line;
      const lastLine = from + st.lastLine;
      // Running on into the lines not settled yet: read once it's done.
      if (lastLine >= settled - 1 && !/[.?!]$/.test(st.text)) {
        pending ??= line;
        continue;
      }
      if (done >= EVIDENCE_PER_POLL) {
        pending ??= line;
        break;
      }
      // Keyed by how it ends: read again from its middle, it's the same statement.
      const key = `${lastLine}:${st.text.slice(-40)}`;
      if (ev.items.has(key)) continue;
      const text = eventPart(st.text);
      if (!text) continue;
      done++;
      ev.checked++;
      const said = s.tr.lines[line]?.at ?? now;
      const at = said > 1e12 ? said : now;
      ev.items.set(key, { text, line, lastLine, at, askedAt: now, sources: safeReports(text, at) });
      if (ev.items.size > MAX_EVIDENCE) ev.items.delete(ev.items.keys().next().value!);
    }
    ev.scanned = pending ?? settled;
  }
  // Said before an outlet had it: looked for again a while.
  for (const item of ev.items.values()) {
    if (item.sources.length || now - item.at > EVIDENCE_RETRY_FOR || now - item.askedAt < EVIDENCE_RETRY_MS) continue;
    item.askedAt = now;
    item.sources = safeReports(item.text, item.at);
  }
}

/**
 * The statements an outlet reported, and how many were looked for: overlapping stretches of
 * unpunctuated captions telling one story (the same lead headline, or none) count once.
 */
function evidenceReply(s: Session): TranscriptReply["evidence"] {
  const all = [...s.evidence.items.values()].sort((a, b) => a.line - b.line);
  const one = all.filter((e, k) => {
    const p = all[k - 1];
    return !p || e.line > p.lastLine + 1 || (p.sources[0]?.link ?? null) !== (e.sources[0]?.link ?? null);
  });
  return {
    checked: one.length,
    items: one.filter((e) => e.sources.length).map(({ text, line, lastLine, sources }) => ({ text, line, lastLine, sources })),
  };
}

function safeReports(text: string, at: number) {
  try {
    return findReports(text, at);
  } catch (err) {
    console.warn("evidence:", err instanceof Error ? err.message : err);
    return [];
  }
}

type FactItem = { line: number; claim: Claim; result: Check | null; provisional: boolean; asked: string };
/**
 * A claim with the line it was said in: its check once in, else the claim alone (verdict null).
 * Provisional while the two lines after it aren't in: their words may still name its month, or
 * make it a goal or a forecast instead.
 */
export type FactCheck = (Check | (Claim & { verdict: null })) & { line: number; provisional: boolean; label: string; unit: string };
const MAX_FACTS = 300;
/** Lines after a claim's that can still change it. */
const SETTLE = 2;

/**
 * Reads the newest lines for claims as soon as they're in, and checks each in the background: a
 * claim in the last two lines is provisional, read again as the next lines come (its month added,
 * or dropped if they make it a goal or a forecast), then settled.
 */
export function scanFacts(s: Session): void {
  const n = s.tr.lines.length;
  if (n === s.facts.read) return;
  // From a few lines before the settled ones: a claim begun there may end in the new lines.
  const from = Math.max(0, s.facts.scanned - 8);
  const lines = s.tr.lines.slice(from, n);
  // Said when it was said (a broadcast read back from disk is checked against the data of its day).
  const at = lines.at(-1)?.at ?? Date.now();
  const asOf = new Date(at > 1e12 ? at : Date.now());
  const settled = n - SETTLE;
  const seen = new Set<string>();
  for (const c of claimsInLines(lines.map((l) => l.text), asOf)) {
    const line = from + c.line;
    const key = `${line}:${c.indicator}:${c.value}`;
    seen.add(key);
    const asked = `${c.month}|${c.approx}|${c.high}`;
    const had = s.facts.items.get(key);
    if (had && (!had.provisional || had.asked === asked)) {
      had.provisional = line >= settled;
      continue;
    }
    // New, or a provisional one the next words have changed (a month named after the figure).
    const item: FactItem = { line, claim: c, result: null, provisional: line >= settled, asked };
    s.facts.items.set(key, item);
    void check(c, asOf).then((r) => {
      if (s.facts.items.get(key) === item) item.result = r;
    });
    if (s.facts.items.size > MAX_FACTS) s.facts.items.delete(s.facts.items.keys().next().value!);
  }
  // A provisional claim the next words have undone ("… 2 percent objective") goes.
  for (const [key, item] of s.facts.items) if (item.provisional && item.line >= from && !seen.has(key)) s.facts.items.delete(key);
  for (const item of s.facts.items.values()) if (item.line < settled) item.provisional = false;
  s.facts.scanned = Math.max(s.facts.scanned, settled);
  s.facts.read = n;
}

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
    keepBroadcast(s);
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
  /** The figures said about the US data, checked against the official data, in the order said. */
  facts: FactCheck[];
  /**
   * The events said, looked for in the news archive: those an outlet has reported (with its
   * headlines), and how many were looked for.
   */
  evidence: { checked: number; items: Evidence[] };
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
/** A Fed broadcast with a reading (three or more policy phrases), kept to score markets' moves on. */
function keepBroadcast(s: Session): void {
  const sent = s.scored?.result.sentiment;
  const first = s.tr.lines[0];
  const last = s.tr.lines.at(-1);
  if (!s.fed || !sent || !first || !last || sent.hawkish + sent.dovish < 3) return;
  try {
    noteFedBroadcast({ videoId: s.videoId, title: s.title, start: first.at, end: last.at, index: s.lastIndex ?? sent.index, wordsIndex: sent.index, delivery: s.delivery.samples });
    s.delivery.keptAt = Date.now();
  } catch (err) {
    console.warn("fed broadcast:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------- the latest reading, for the engine

const sentimentFile = join(dataDir, "fed-sentiment.json");
let sentimentSavedAt = 0;

export type FedReading = { index: number; at: string; title: string; videoId: string };

/** The Fed Sentiment Index last heard on a Fed broadcast (the macro engine's input), or null. */
export function latestFedSentiment(): FedReading | null {
  try {
    return existsSync(sentimentFile) ? (JSON.parse(readFileSync(sentimentFile, "utf8")) as FedReading) : null;
  } catch {
    return null;
  }
}

function keepReading(r: FedReading): void {
  if (Date.now() - sentimentSavedAt < 60_000) return;
  sentimentSavedAt = Date.now();
  try {
    writeFileSync(sentimentFile, JSON.stringify(r));
  } catch {
    // Not kept this time; the next poll tries again.
  }
}

/**
 * `fed` is false for a link pasted in the panel (a news channel's talk isn't the Fed's): its
 * reading isn't kept for the engine.
 */
export function transcript(videoId: string, since = 0, faces = true, fed = true, withMedia = true): TranscriptReply {
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
      fed,
      lastIndex: null,
      stoppedAt: 0,
      dirty: false,
      savedAt: Date.now(),
      scored: null,
      facts: { scanned: 0, read: 0, items: new Map() },
      evidence: { scanned: 0, checked: 0, items: new Map() },
      delivery: { samples: [], keptAt: Date.now() },
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
  s.media.enabled = withMedia;
  // Layers 2 and 3 follow the newest segment only (an hour of audio and video read back would be
  // heavy), on their own loop beside the captions'.
  if (withMedia) s.media.start(() => Date.now() - s!.lastAsked < IDLE_MS);
  // The regular mode everywhere: the face models' memory goes back at once.
  else if (![...sessions.values()].some((x) => x.media.enabled && Date.now() - x.lastAsked < IDLE_MS)) stopFaceWorker();
  const key = `${s.tr.lines.length}:${s.media.version}`;
  if (s.scored?.key !== key) s.scored = { key, result: scoreTranscript(s.tr.lines, { speakerAt: (at) => s!.media.speakerAt(at), diarized: s.media.diarized() }) };
  const { lines, sentiment } = s.scored.result;
  const media = s.media.report(s.tr.lines.slice(-400));
  const combined =
    media.confidence === null ? null : (() => {
      const index = Math.round(sentiment.index * (0.9 + 0.1 * (2 * media.confidence - 1)) * 1000) / 1000;
      return { index, stance: stanceOf(index) };
    })();
  // A reading worth keeping: three or more policy phrases heard from the Fed speaker.
  s.fed = fed;
  s.lastIndex = combined?.index ?? sentiment.index;
  if (fed && sentiment.hawkish + sentiment.dovish >= 3) keepReading({ index: combined?.index ?? sentiment.index, at: new Date().toISOString(), title: s.title, videoId });
  // A minute's delivery of the main speaker, for the voice-and-face test (deliverytest.ts): live
  // only (layers 2 and 3 follow the newest segment), kept with the broadcast every five minutes.
  if (fed && media.prosody && media.confidence !== null && s.status === "live") {
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const lastSample = s.delivery.samples.at(-1);
    if (!lastSample || lastSample.at < minute) {
      s.delivery.samples.push({
        at: minute,
        confidence: media.confidence,
        stress: media.prosody.stress,
        hesitation: media.prosody.hesitation,
        tension: media.face && media.face.lockedShare >= 0.5 ? media.face.tension : null,
      });
      if (Date.now() - s.delivery.keptAt > 5 * 60_000) keepBroadcast(s);
    }
  }
  const start = Math.max(0, Math.min(since, lines.length));
  scanFacts(s);
  scanEvidence(s);
  const facts: FactCheck[] = [...s.facts.items.values()]
    .sort((a, b) => a.line - b.line)
    .map((f) => ({ ...(f.result ?? { ...f.claim, verdict: null }), line: f.line, provisional: f.provisional, label: LABEL[f.claim.indicator], unit: UNIT[f.claim.indicator] }));
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
    facts,
    evidence: evidenceReply(s),
  };
}
