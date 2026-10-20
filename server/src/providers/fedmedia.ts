// Layers 2 and 3 of the Fed Sentiment Watcher: how the speaker sounds and looks, beside what they
// say (fedtranscript.ts, layer 1).
//
//   - Audio (every 5-second segment while the broadcast is followed): decoded by ffmpeg to 16 kHz,
//     each second's speech, pitch and voice print (prosody.ts); the voices told apart
//     (speakers.ts) and the main speaker (heard longest: the Fed official) followed.
//   - Video (two frames of each segment): faces, expressions and mouth openness (faceworker.ts, on
//     its own thread). The main face is locked by lip sync: while the main speaker's voice is heard,
//     the face whose mouth is moving; held across frames while its box stays put, dropped at a cut.
//     No face is identified, only followed.
//
// Against the main speaker's own baseline over the broadcast, the last minute's raised pitch, wider
// pitch swings and louder voice read as stress; pauses and fillers ("uh", "um") as hesitation; the
// locked face's anger, fear, sadness and disgust as tension. Together they're the delivery's
// confidence, 0..1.

import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { analyzeSegment, pcmToFloat } from "./prosody.js";
import { Speakers, smooth } from "./speakers.js";
import { liveTracks, segment } from "./youtubelive.js";
import type { FaceResult, FrameReply } from "./faceworker.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FRAME_W = 384;
export const FRAME_H = 216;
/** Of each segment's five frames (one a second), the ones looked at: ~0.8 s of CPU each. */
const FRAMES_LOOKED_AT = [1, 3];
const KEEP_MS = 3 * 3_600_000;

let ffmpegMissing = false;

function ffmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") ffmpegMissing = true;
      reject(e);
    });
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`))));
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}

// ---------------------------------------------------------------- the face worker (shared)

let worker: Worker | null = null;

/** Whether the face worker (and its ~150 MB of models) is loaded now. */
export const faceWorkerRunning = () => worker !== null;

/** Lets the face worker go now (no broadcast is being watched with the voice and face layers). */
export function stopFaceWorker(): void {
  void worker?.terminate();
}
let workerIdle: ReturnType<typeof setTimeout> | null = null;
let jobId = 0;
const pending = new Map<number, (r: FrameReply) => void>();

function faceWorker(): Worker {
  if (worker) return worker;
  const ts = import.meta.url.endsWith(".ts");
  // Under tsx (development) the worker is the .ts file and needs tsx's loader too.
  worker = new Worker(new URL(ts ? "./faceworker.ts" : "./faceworker.js", import.meta.url), ts ? { execArgv: ["--import", "tsx"] } : {});
  worker.unref();
  worker.on("message", (r: FrameReply) => {
    pending.get(r.id)?.(r);
    pending.delete(r.id);
  });
  const fail = (err: unknown) => {
    for (const [id, done] of pending) done({ id, error: err instanceof Error ? err.message : String(err) });
    pending.clear();
    worker = null;
  };
  worker.on("error", fail);
  worker.on("exit", () => fail(new Error("face worker stopped")));
  return worker;
}

function lookAtFrames(frames: Uint8Array[]): Promise<FaceResult[][]> {
  const w = faceWorker();
  if (workerIdle) clearTimeout(workerIdle);
  // Its models hold ~150 MB: let it go after five quiet minutes.
  workerIdle = setTimeout(() => void worker?.terminate(), 5 * 60_000);
  workerIdle.unref();
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => ("error" in r ? reject(new Error(r.error)) : resolve(r.faces)));
    w.postMessage({ id, width: FRAME_W, height: FRAME_H, frames });
  });
}

// ---------------------------------------------------------------- one broadcast

type Second = { at: number; voiced: number; energy: number; f0: number | null; f0Spread: number | null; speaker: number | null };
type Frame = { at: number; faces: FaceResult[]; locked: number | null };

export type Prosody = {
  /** The main speaker's median pitch over the last minute, and over the broadcast. */
  pitchHz: number | null;
  baseHz: number | null;
  /** Last minute against the baseline: pitch (z), pitch swings (ratio), loudness (z). */
  pitchZ: number;
  swings: number;
  loudZ: number;
  pausesPerMin: number;
  fillersPerMin: number;
  wordsPerMin: number | null;
  stress: number;
  hesitation: number;
};

export type FaceReport = {
  /** Share of the last minute's frames with the main face locked. */
  lockedShare: number;
  expressions: Record<string, number>;
  tension: number;
  frames: number;
  facesSeen: number;
  /** The last frame's faces and which is locked, for drawing over the video (boxes in 384×216). */
  last: { at: number; faces: Array<{ box: [number, number, number, number]; locked: boolean }> } | null;
};

export type MediaReport = {
  audio: "starting" | "on" | "off" | "error";
  video: "starting" | "on" | "off" | "error";
  message: string | null;
  speakers: Array<{ id: number; seconds: number; main: boolean }>;
  prosody: Prosody | null;
  face: FaceReport | null;
  /** How sure the delivery sounds and looks, 0..1 (null until there's enough). */
  confidence: number | null;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const iqr = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length < 4 ? 0 : s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
};
const semitones = (hz: number) => 12 * Math.log2(hz / 100);
const iou = (a: number[], b: number[]) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
};
const TENSE = ["angry", "fearful", "sad", "disgusted"];

export class MediaAnalyzer {
  private audioUrl: string | null = null;
  private videoUrl: string | null = null;
  private speakers = new Speakers();
  private seconds: Second[] = [];
  private bySecond = new Map<number, number | null>();
  private segs: Array<{ at: number; pauses: number; main: boolean }> = [];
  private frames: Frame[] = [];
  private lockBox: { box: number[]; at: number } | null = null;
  private audioBusy = false;
  private videoBusy = false;
  private running = false;
  private lastSeq = -1;
  audio: MediaReport["audio"] = "starting";
  video: MediaReport["video"] = "starting";
  message: string | null = null;
  /** Bumped whenever speakers change, so the transcript's scoring is redone. */
  version = 0;

  constructor(
    private videoId: string,
    public faces = true,
    /** Off in the regular mode (text only): no audio or video is fetched or analysed. */
    public enabled = true,
  ) {}

  /** New URLs from the player (they're refreshed together with the captions'). */
  setTracks(audio: string | null, video: string | null): void {
    this.audioUrl = audio;
    this.videoUrl = video;
  }

  private refreshedAt = 0;

  private async refresh(): Promise<void> {
    this.refreshedAt = Date.now();
    const t = await liveTracks(this.videoId);
    this.setTracks(t.audio, t.video);
  }

  private async fetch(kind: "audio" | "video", seq: number): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      const url = kind === "audio" ? this.audioUrl : this.videoUrl;
      if (!url) throw new Error(`no ${kind} track`);
      try {
        return (await segment(url, seq)).body;
      } catch (err) {
        if (attempt >= 1 || !(err as { status?: number }).status) throw err;
        await this.refresh();
      }
    }
  }

  /**
   * Follows the broadcast on its own (every 4 s, the newest segment) for as long as `alive` says,
   * beside the captions rather than after them: a transcript reading an hour back doesn't hold it up.
   */
  start(alive: () => boolean): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      try {
        while (alive() && this.enabled) {
          try {
            await this.tick();
          } catch (err) {
            this.message = err instanceof Error ? err.message : String(err);
          }
          await new Promise((r) => setTimeout(r, 4000));
        }
      } finally {
        this.running = false;
      }
    })();
  }

  private async tick(): Promise<void> {
    // Not live (yet): the player is asked again a minute on, not every round.
    if (!this.audioUrl && Date.now() - this.refreshedAt > 60_000) await this.refresh();
    if (!this.audioUrl) {
      this.audio = this.video = "off";
      this.message = "Siaran tidak sedang live, atau tanpa trek audio.";
      return;
    }
    let newest: { head: number | null; body: Buffer };
    try {
      newest = await segment(this.audioUrl);
    } catch (err) {
      if ((err as { status?: number }).status) this.audioUrl = null;
      throw err;
    }
    // Each segment carries its sequence number and when it was taken in (as the captions' do).
    const meta = newest.body.subarray(0, 4096).toString("latin1");
    const seq = newest.head ?? Number(/Sequence-Number: (\d+)/.exec(meta)?.[1]);
    const wall = Number(/Ingestion-Walltime-Us: (\d+)/.exec(meta)?.[1]) / 1000;
    if (!Number.isFinite(seq) || !Number.isFinite(wall) || seq === this.lastSeq) return;
    this.lastSeq = seq;
    this.process(seq, Math.round(wall), newest.body);
  }

  /** Reads segment `seq` (it started at `wallMs`): its audio now, its frames when the worker's free. */
  process(seq: number, wallMs: number, audioBody?: Buffer): void {
    if (ffmpegMissing) {
      this.audio = this.video = "off";
      this.message = "ffmpeg tidak ditemukan: Layer 2 dan 3 butuh ffmpeg (atau FFMPEG_PATH).";
      return;
    }
    if (!this.audioBusy && this.audioUrl) {
      this.audioBusy = true;
      this.listen(seq, wallMs, audioBody)
        .then(() => {
          this.audio = "on";
          this.message = null;
        })
        .catch((err: unknown) => {
          this.audio = ffmpegMissing ? "off" : "error";
          this.message = err instanceof Error ? err.message : String(err);
        })
        .finally(() => (this.audioBusy = false));
    }
    if (!this.faces) this.video = "off";
    else if (!this.videoBusy && this.videoUrl) {
      this.videoBusy = true;
      this.look(seq, wallMs)
        .then(() => {
          this.video = "on";
          if (this.audio === "on") this.message = null;
        })
        .catch((err: unknown) => {
          this.video = ffmpegMissing ? "off" : "error";
          this.message = err instanceof Error ? err.message : String(err);
        })
        .finally(() => (this.videoBusy = false));
    }
  }

  private async listen(seq: number, wallMs: number, body?: Buffer): Promise<void> {
    const pcm = await ffmpeg(["-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"], body ?? (await this.fetch("audio", seq)));
    this.takeAudio(wallMs, pcmToFloat(pcm));
  }

  /**
   * A segment's audio (16 kHz mono) that started at `wallMs`: its seconds' pitch, loudness and voice.
   * The live loop's, and a recorded broadcast's read back five seconds at a time (cli/fomc-delivery.ts).
   */
  takeAudio(wallMs: number, samples: Float32Array): void {
    const p = analyzeSegment(samples);
    const ids = p.seconds.map((s) => (s.print ? this.speakers.assign(s.print) : null));
    const prev = this.seconds.at(-1);
    const smoothed = smooth([prev?.speaker ?? null, ...ids]).slice(1);
    p.seconds.forEach((s, i) => {
      const at = wallMs + s.at;
      this.seconds.push({ at, voiced: s.voiced, energy: s.energy, f0: s.f0, f0Spread: s.f0Spread, speaker: smoothed[i] });
      this.bySecond.set(Math.floor(at / 1000), smoothed[i]);
    });
    const main = this.speakers.main();
    this.segs.push({ at: wallMs, pauses: p.pauses, main: main !== null && smoothed.filter((x) => x === main).length >= smoothed.length / 2 });
    this.trim();
    this.version++;
  }

  private async look(seq: number, wallMs: number): Promise<void> {
    const raw = await ffmpeg(["-i", "pipe:0", "-an", "-vf", `fps=1,scale=${FRAME_W}:${FRAME_H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], await this.fetch("video", seq));
    const size = FRAME_W * FRAME_H * 3;
    const picks = FRAMES_LOOKED_AT.filter((i) => (i + 1) * size <= raw.length);
    if (!picks.length) return;
    await this.takeFrames(
      picks.map((i) => wallMs + i * 1000),
      picks.map((i) => new Uint8Array(raw.buffer, raw.byteOffset + i * size, size).slice()),
    );
  }

  /** Frames (RGB, FRAME_W × FRAME_H) taken at the given moments: their faces, the main one locked. */
  async takeFrames(at: number[], frames: Uint8Array[]): Promise<void> {
    if (!frames.length) return;
    const results = await lookAtFrames(frames);
    results.forEach((faces, k) => this.frames.push({ at: at[k], faces, locked: this.lockOn(at[k], faces) }));
    this.trim();
  }

  /**
   * The main face in a frame: the one under the lock if its box hasn't moved off (a camera cut drops
   * it); otherwise, while the main speaker is talking, the face whose mouth is open widest for its
   * size among the larger faces.
   */
  private lockOn(at: number, faces: FaceResult[]): number | null {
    if (!faces.length) {
      if (this.lockBox && at - this.lockBox.at > 6000) this.lockBox = null;
      return null;
    }
    if (this.lockBox && at - this.lockBox.at <= 6000) {
      let best = -1;
      let bestIou = 0.3;
      faces.forEach((f, i) => {
        const v = iou(f.box, this.lockBox!.box);
        if (v > bestIou) {
          bestIou = v;
          best = i;
        }
      });
      if (best >= 0) {
        this.lockBox = { box: faces[best].box, at };
        return best;
      }
    }
    this.lockBox = null;
    const main = this.speakers.main();
    const sec = this.bySecond.get(Math.floor(at / 1000));
    const talking = main === null ? sec !== undefined : sec === main;
    if (!talking) return null;
    const largest = Math.max(...faces.map((f) => f.box[2] * f.box[3]));
    let pick = -1;
    let score = -1;
    faces.forEach((f, i) => {
      const area = f.box[2] * f.box[3];
      if (area < largest * 0.25) return;
      const s = (f.mouth + 0.02) * Math.sqrt(area);
      if (s > score) {
        score = s;
        pick = i;
      }
    });
    if (pick >= 0) this.lockBox = { box: faces[pick].box, at };
    return pick >= 0 ? pick : null;
  }

  private trim(): void {
    const cut = Date.now() - KEEP_MS;
    while (this.seconds.length && this.seconds[0].at < cut) this.bySecond.delete(Math.floor(this.seconds.shift()!.at / 1000));
    while (this.frames.length && this.frames[0].at < cut) this.frames.shift();
    while (this.segs.length && this.segs[0].at < cut) this.segs.shift();
  }

  /** Who was speaking at a moment: the voice, and whether it's the main speaker (null: not heard). */
  speakerAt(at: number): { id: number; main: boolean } | null {
    const id = this.bySecond.get(Math.floor(at / 1000)) ?? this.bySecond.get(Math.floor(at / 1000) - 1);
    if (id === undefined || id === null) return null;
    return { id, main: id === this.speakers.main() };
  }

  /** Whether voices are told apart well enough to leave others' words out of the index. */
  diarized(): boolean {
    const main = this.speakers.voices.find((v) => v.id === this.speakers.main());
    return !!main && main.seconds >= 30 && this.speakers.voices.length > 1;
  }

  report(lines: Array<{ at: number; text: string }>): MediaReport {
    if (!this.enabled) {
      return { audio: "off", video: "off", message: "Mode reguler: lapisan suara & wajah dimatikan.", speakers: [], prosody: null, face: null, confidence: null };
    }
    const main = this.speakers.main();
    const end = this.seconds.at(-1)?.at ?? Date.now();
    const recentCut = end - 60_000;
    const mine = this.seconds.filter((s) => s.speaker !== null && s.speaker === main && s.f0 !== null);
    const recent = mine.filter((s) => s.at >= recentCut);
    let prosody: Prosody | null = null;
    if (mine.length >= 20 && recent.length >= 5) {
      const st = (v: Second[]) => v.map((s) => semitones(s.f0!));
      const base = st(mine);
      const pitchZ = (median(st(recent)) - median(base)) / Math.max(1, iqr(base) / 1.35);
      const swings = median(recent.map((s) => s.f0Spread!)) / Math.max(0.5, median(mine.map((s) => s.f0Spread!)));
      const logE = (v: Second[]) => v.map((s) => Math.log(s.energy + 1e-6));
      const loudZ = (median(logE(recent)) - median(logE(mine))) / Math.max(0.1, iqr(logE(mine)) / 1.35);
      const mainSecs = this.seconds.filter((s) => s.at >= recentCut && s.speaker === main);
      const speakingMin = Math.max(0.1, mainSecs.reduce((n, s) => n + s.voiced, 0) / 60);
      const recentSegs = this.segs.filter((g) => g.at >= recentCut && g.main);
      const pausesPerMin = recentSegs.reduce((n, g) => n + g.pauses, 0) / speakingMin;
      const theirLines = lines.filter((l) => l.at >= recentCut && (this.speakerAt(l.at)?.main ?? true));
      const words = theirLines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
      const fillers = theirLines.reduce((n, l) => n + (l.text.match(/\b(?:uh|um|uhm|erm|er|ah)\b/gi)?.length ?? 0), 0);
      const fillersPerMin = fillers / speakingMin;
      prosody = {
        pitchHz: Math.round(median(recent.map((s) => s.f0!))),
        baseHz: Math.round(median(mine.map((s) => s.f0!))),
        pitchZ: Math.round(pitchZ * 100) / 100,
        swings: Math.round(swings * 100) / 100,
        loudZ: Math.round(loudZ * 100) / 100,
        pausesPerMin: Math.round(pausesPerMin * 10) / 10,
        fillersPerMin: Math.round(fillersPerMin * 10) / 10,
        wordsPerMin: speakingMin >= 0.25 ? Math.round(words / speakingMin) : null,
        stress: Math.round(clamp01((0.45 * Math.max(0, pitchZ)) / 2 + 0.35 * Math.max(0, swings - 1) + (0.2 * Math.max(0, loudZ)) / 2) * 100) / 100,
        // Unscripted speech runs ~15–20 pauses and ~5–10 fillers a minute; full marks at twice that.
        hesitation: Math.round(clamp01((0.5 * pausesPerMin) / 45 + (0.5 * fillersPerMin) / 20) * 100) / 100,
      };
    }

    let face: FaceReport | null = null;
    const recentFrames = this.frames.filter((f) => f.at >= (this.frames.at(-1)?.at ?? 0) - 60_000);
    if (recentFrames.length) {
      const locked = recentFrames.filter((f) => f.locked !== null).map((f) => f.faces[f.locked!]);
      const expressions: Record<string, number> = {};
      for (const f of locked) for (const [k, v] of Object.entries(f.expressions)) expressions[k] = (expressions[k] ?? 0) + v / locked.length;
      const last = this.frames.at(-1)!;
      face = {
        lockedShare: Math.round((locked.length / recentFrames.length) * 100) / 100,
        expressions: Object.fromEntries(Object.entries(expressions).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
        tension: Math.round(clamp01(TENSE.reduce((n, k) => n + (expressions[k] ?? 0), 0)) * 100) / 100,
        frames: recentFrames.length,
        facesSeen: Math.max(0, ...recentFrames.map((f) => f.faces.length)),
        last: { at: last.at, faces: last.faces.map((f, i) => ({ box: f.box, locked: i === last.locked })) },
      };
    }

    let confidence: number | null = null;
    if (prosody) {
      const hasFace = face !== null && face.lockedShare > 0;
      const strain = hasFace ? 0.5 * prosody.stress + 0.3 * prosody.hesitation + 0.2 * face!.tension : (0.5 * prosody.stress + 0.3 * prosody.hesitation) / 0.8;
      confidence = Math.round((1 - clamp01(strain)) * 100) / 100;
    }
    return {
      audio: this.audio,
      video: this.video,
      message: this.message,
      speakers: this.speakers.voices.map((v) => ({ id: v.id, seconds: v.seconds, main: v.id === main })).sort((a, b) => b.seconds - a.seconds),
      prosody,
      face,
      confidence,
    };
  }
}
