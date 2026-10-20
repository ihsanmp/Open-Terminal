// The voice-and-face test's history (providers/deliverytest.ts): the FOMC press conferences since
// 2019, as recorded on the Federal Reserve Board's YouTube channel, read by the same layers the
// Live TV runs live (fedmedia.ts: the voice five seconds at a time, a face every 15 seconds) and
// the same index of the words (from their captions); the markets' moves over each from histdata.com's
// one-minute bars (gold, the dollar index, the S&P 500 and dollar-yen). Run in steps, each picking up
// where it stopped:
//
//   node dist/cli/fomc-delivery.js list      the videos (YouTube's search, by meeting date)
//   node dist/cli/fomc-delivery.js analyze   download, read and delete each (results/<id>.json)
//   node dist/cli/fomc-delivery.js prices    the one-minute bars (kept only around each press conference)
//   node dist/cli/fomc-delivery.js seed <file>  the seed the app ships (src/seed/fomc-delivery.ts)
//
// DATA_DIR must be set to a working folder (not the app's data).
//
// As of October 2026 `analyze` can't run: YouTube serves a recording's audio and video to this
// client only up to its first ~1 MB without a "PO token" (other clients ask this address to sign
// in). The words still can: `words`, `prices` and `evaluate` read the captions against the
// one-minute bars. Their result (20 Oct 2026, 57 press conferences 2019–2026): the words' index
// against the markets over the press conference, Pearson r 0.23 (permutation p 0.04), but by ranks
// ρ 0.14 (p 0.17) — a few big reactions of 2022 carry it — and ρ 0.02 over 2023–2026; against the
// statement's half hour before, r −0.08. The index reads the Fed's stance, not its surprise.

import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { FRAME_H, FRAME_W, MediaAnalyzer } from "../providers/fedmedia.js";
import { scoreTranscript, type Line } from "../providers/fedtranscript.js";
import { get4 } from "../providers/youtubelive.js";
import { FOMC_MEETINGS_SEEN } from "../seed/fomc.js";
import type { DeliverySample } from "../providers/deliverytest.js";

const root = join(dataDir, "fomc-delivery");
const resultsDir = join(root, "results");
const tmp = join(root, "tmp");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const WEB = { clientName: "WEB", clientVersion: "2.20241010.00.00", hl: "en" };
const IOS = { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A face looked at every this many seconds (the live loop looks twice every five: too slow for 50 hours). */
const FRAME_EVERY_S = 15;

export type Video = { date: string; id: string; title: string; secs: number };
export type Result = Video & { wordsIndex: number; phrases: number; samples: DeliverySample[]; minutesHeard: number };

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null);

// ---------------------------------------------------------------- the videos

const hms = (s: string) => s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);

async function search(q: string): Promise<Array<{ id: string; title: string; secs: number; channel: string }>> {
  const r = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: WEB }, query: q }),
  });
  const out: Array<{ id: string; title: string; secs: number; channel: string }> = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const v = (o as { videoRenderer?: any }).videoRenderer;
    if (v) out.push({ id: v.videoId, title: v.title?.runs?.map((x: { text: string }) => x.text).join("") ?? "", secs: hms(v.lengthText?.simpleText ?? "0"), channel: v.ownerText?.runs?.[0]?.text ?? "" });
    for (const k of Object.keys(o)) walk((o as Record<string, unknown>)[k]);
  };
  walk(await r.json());
  return out;
}

async function list(): Promise<void> {
  const out: Video[] = [];
  for (const m of FOMC_MEETINGS_SEEN.filter((x) => x.date >= "2019-01-01")) {
    const d = new Date(`${m.date}T12:00:00Z`);
    const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
    const hit = (await search(`FOMC Press Conference ${label}`)).find(
      (v) => /federal reserve/i.test(v.channel) && /press conference/i.test(v.title) && v.title.replace(/,/g, "").includes(label) && v.secs > 15 * 60,
    );
    if (hit) out.push({ date: m.date, id: hit.id, title: hit.title, secs: hit.secs });
    log(m.date, hit ? `${hit.id} ${Math.round(hit.secs / 60)} min` : "none");
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "videos.json"), JSON.stringify(out, null, 1));
  log(`${out.length} videos`);
}

// ---------------------------------------------------------------- one video

type Player = { audio: { url: string; size: number } | null; video: { url: string; size: number } | null; captions: string | null };

async function player(id: string): Promise<Player> {
  const res = await get4("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: id, context: { client: IOS }, contentCheckOk: true, racyCheckOk: true }),
  });
  const j = JSON.parse(res.body.toString("utf8"));
  const f: Array<{ itag: number; url: string; contentLength: string }> = j.streamingData?.adaptiveFormats ?? [];
  const pick = (itags: number[]) => {
    const x = itags.map((t) => f.find((y) => y.itag === t)).find(Boolean);
    return x ? { url: x.url, size: Number(x.contentLength) } : null;
  };
  const tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }> = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  // The automatic captions, as the live ones are (they keep the "uh"s the hesitation counts); else the uploaded.
  const cap = tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ?? tracks.find((t) => t.languageCode.startsWith("en"));
  // 240p where there is one (faces are read at 384 × 216 anyway), else 360p.
  return { audio: pick([139, 140]), video: pick([133, 134]), captions: cap?.baseUrl ?? null };
}

/**
 * A track downloaded to a file in ranges of under half a megabyte (googlevideo refuses bigger ones
 * to this client), four at a time.
 */
async function download(url: string, size: number, file: string): Promise<void> {
  const CHUNK = 448 * 1024;
  const fd = openSync(file, "w");
  try {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const from = next;
        if (from >= size) return;
        next += CHUNK;
        const to = Math.min(size, from + CHUNK) - 1;
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await get4(`${url}&range=${from}-${to}`);
            if ((r.status !== 200 && r.status !== 206) || r.body.length !== to - from + 1) throw new Error(`range ${from}: status ${r.status}, ${r.body.length} bytes`);
            writeSync(fd, r.body, 0, r.body.length, from);
            break;
          } catch (err) {
            if (attempt === 4) throw err;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    closeSync(fd);
  }
}

function ffmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`))));
  });
}

/** The captions as the live transcript's lines: one per caption event, ">>" a new speaker's turn. */
async function captions(url: string, base: number): Promise<Line[]> {
  const r = await get4(`${url}&fmt=json3`);
  const j = JSON.parse(r.body.toString("utf8")) as { events?: Array<{ tStartMs: number; segs?: Array<{ utf8: string }> }> };
  const lines: Line[] = [];
  let turn = 0;
  for (const e of j.events ?? []) {
    const text = (e.segs ?? []).map((s) => s.utf8).join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.startsWith(">>")) turn++;
    lines.push({ seq: lines.length, at: base + e.tStartMs, text: text.replace(/^>>\s*/, ""), turn });
  }
  return lines;
}

async function analyzeOne(v: Video): Promise<Result> {
  mkdirSync(tmp, { recursive: true });
  const p = await player(v.id);
  if (!p.audio) throw new Error("no audio track");
  const audioFile = join(tmp, `${v.id}.m4a`);
  const videoFile = join(tmp, `${v.id}.mp4`);
  log(v.date, v.id, `audio ${(p.audio.size / 1e6).toFixed(1)} MB, video ${p.video ? (p.video.size / 1e6).toFixed(0) : "-"} MB`);
  await download(p.audio.url, p.audio.size, audioFile);
  if (p.video) await download(p.video.url, p.video.size, videoFile);
  try {
    const pcm = await ffmpegToBuffer(["-i", audioFile, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"]);
    const samplesTotal = pcm.length / 2;
    const secs = Math.floor(samplesTotal / 16000);
    const frameSize = FRAME_W * FRAME_H * 3;
    const raw = p.video ? await ffmpegToBuffer(["-i", videoFile, "-an", "-vf", `fps=1/${FRAME_EVERY_S},scale=${FRAME_W}:${FRAME_H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]) : Buffer.alloc(0);
    const nFrames = Math.floor(raw.length / frameSize);

    // Played back as if live, its clock set to just now (the analyzer keeps the last three hours).
    const base = Date.now() - (secs + 60) * 1000;
    const lines = p.captions ? await captions(p.captions, base) : [];
    const a = new MediaAnalyzer(v.id, true, true);
    const f32 = new Float32Array(samplesTotal);
    for (let k = 0; k < samplesTotal; k++) f32[k] = pcm.readInt16LE(k * 2) / 32768;
    const samples: DeliverySample[] = [];
    let nextFrame = 0;
    let lastMinute = 0;
    for (let t = 0; t + 5 <= secs; t += 5) {
      a.takeAudio(base + t * 1000, f32.subarray(t * 16000, (t + 5) * 16000));
      // The frames this stretch holds (fps=1/15: frame k is at about k × 15 + 7.5 s).
      const due: number[] = [];
      while (nextFrame < nFrames && nextFrame * FRAME_EVERY_S + FRAME_EVERY_S / 2 < t + 5) due.push(nextFrame++);
      if (due.length)
        await a.takeFrames(
          due.map((k) => base + (k * FRAME_EVERY_S + FRAME_EVERY_S / 2) * 1000),
          due.map((k) => new Uint8Array(raw.buffer, raw.byteOffset + k * frameSize, frameSize).slice()),
        );
      const minute = Math.floor((t + 5) / 60);
      if (minute > lastMinute) {
        lastMinute = minute;
        const now = base + (t + 5) * 1000;
        const r = a.report(lines.filter((l) => l.at <= now).slice(-400));
        if (r.prosody && r.confidence !== null)
          samples.push({
            // Minutes into the press conference (the market's clock is set later, from the meeting's date).
            at: minute * 60_000,
            confidence: r.confidence,
            stress: r.prosody.stress,
            hesitation: r.prosody.hesitation,
            tension: r.face && r.face.lockedShare >= 0.5 ? r.face.tension : null,
          });
      }
    }
    const { sentiment } = scoreTranscript(lines, { speakerAt: (at) => a.speakerAt(at), diarized: a.diarized() });
    return { ...v, wordsIndex: sentiment.index, phrases: sentiment.hawkish + sentiment.dovish, samples, minutesHeard: Math.floor(secs / 60) };
  } finally {
    rmSync(audioFile, { force: true });
    rmSync(videoFile, { force: true });
  }
}

async function analyze(only?: string): Promise<void> {
  const videos = readJson<Video[]>(join(root, "videos.json"));
  if (!videos) throw new Error("run `list` first");
  mkdirSync(resultsDir, { recursive: true });
  for (const v of videos.filter((x) => !only || x.id === only || x.date === only)) {
    const file = join(resultsDir, `${v.id}.json`);
    if (existsSync(file)) continue;
    const t0 = Date.now();
    try {
      const r = await analyzeOne(v);
      writeFileSync(file, JSON.stringify(r));
      const conf = r.samples.length ? r.samples.reduce((s, x) => s + x.confidence, 0) / r.samples.length : NaN;
      log(v.date, `done in ${Math.round((Date.now() - t0) / 1000)} s: ${r.samples.length} minutes, confidence ${conf.toFixed(2)}, faces ${r.samples.filter((s) => s.tension !== null).length} min, words ${r.wordsIndex.toFixed(2)} (${r.phrases} phrases)`);
    } catch (err) {
      log(v.date, "failed:", err instanceof Error ? err.message : err);
    }
  }
}

// ---------------------------------------------------------------- the words alone

export type WordsResult = Video & { wordsIndex: number; hawkish: number; dovish: number; lines: number };
const wordsDir = join(root, "words");

/** Each press conference's captions read by the Live TV's index (no voices: the whole transcript, questions left out by turn). */
async function words(): Promise<void> {
  const videos = readJson<Video[]>(join(root, "videos.json"));
  if (!videos) throw new Error("run `list` first");
  mkdirSync(wordsDir, { recursive: true });
  for (const v of videos) {
    const file = join(wordsDir, `${v.id}.json`);
    if (existsSync(file)) continue;
    try {
      const p = await player(v.id);
      if (!p.captions) throw new Error("no captions");
      const lines = await captions(p.captions, 0);
      const { sentiment } = scoreTranscript(lines);
      const r: WordsResult = { ...v, wordsIndex: sentiment.index, hawkish: sentiment.hawkish, dovish: sentiment.dovish, lines: lines.length };
      writeFileSync(file, JSON.stringify(r));
      log(v.date, `index ${r.wordsIndex.toFixed(2)} (${r.hawkish} hawkish, ${r.dovish} dovish phrases, ${r.lines} lines)`);
    } catch (err) {
      log(v.date, "failed:", err instanceof Error ? err.message : err);
    }
  }
}

/** What a hawkish reading does: the dollar and dollar-yen up, gold and stocks down. */
const HAWK: Record<Key, number> = { dxy: 1, usdjpy: 1, xau: -1, es: -1 };

/** The words' index against the markets over the press conference (and, for contrast, the statement's half hour). */
function evaluate(): void {
  const moves = readJson<Record<string, Windows>>(join(root, "moves.json")) ?? {};
  const rows = readdirSync(wordsDir)
    .map((f) => readJson<WordsResult>(join(wordsDir, f))!)
    .filter((r) => moves[r.date])
    .sort((a, b) => a.date.localeCompare(b.date));
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  for (const win of ["presser", "statement"] as const) {
    // Each instrument in units of its typical move over these windows, hawk-signed, averaged.
    const scale = Object.fromEntries(
      (Object.keys(HAWK) as Key[]).map((k) => [k, median(rows.map((r) => moves[r.date][win][k]).filter((x): x is number => typeof x === "number").map(Math.abs).filter((x) => x > 0))]),
    ) as Record<Key, number>;
    const pts = rows.flatMap((r) => {
      const parts = (Object.keys(HAWK) as Key[]).flatMap((k) => {
        const m = moves[r.date][win][k];
        return typeof m === "number" && scale[k] > 0 ? [(HAWK[k] * m) / scale[k]] : [];
      });
      return parts.length >= 2 ? [{ r, x: r.wordsIndex, y: parts.reduce((a, b) => a + b, 0) / parts.length }] : [];
    });
    const x = pts.map((p) => p.x);
    const y = pts.map((p) => p.y);
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let k = 0; k < a.length; k++) {
        sab += (a[k] - ma) * (b[k] - mb);
        saa += (a[k] - ma) ** 2;
        sbb += (b[k] - mb) ** 2;
      }
      return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    };
    const r = corr(x, y);
    // One-sided permutation p (the index shuffled across press conferences).
    let seed = 17;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let atLeast = 0;
    const xs = [...x];
    for (let k = 0; k < 5000; k++) {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
      }
      if (corr(xs, y) >= r) atLeast++;
    }
    const sided = pts.filter((p) => Math.abs(p.x) >= 0.2 && p.y !== 0);
    const agree = sided.filter((p) => Math.sign(p.x) === Math.sign(p.y)).length;
    log(`${win.padEnd(9)} n ${pts.length}  r ${r.toFixed(3)}  p ${((atLeast + 1) / 5001).toFixed(3)}  sided calls ${agree}/${sided.length} the index's way`);
    if (win === "presser") for (const p of pts) log(`  ${p.r.date} words ${p.x.toFixed(2).padStart(5)}  reaction ${p.y.toFixed(2).padStart(5)}`);
  }
}

// ---------------------------------------------------------------- the markets' one-minute bars

const SYMBOLS = { xau: "XAUUSD", dxy: "UDXUSD", es: "SPXUSD", usdjpy: "USDJPY" } as const;
type Key = keyof typeof SYMBOLS;
type Moves = Partial<Record<Key, number | null>>;
/** The moves over the press conference, and over the statement's half hour before it. */
type Windows = { presser: Moves; statement: Moves };

/** The press conference's start: 2:30 p.m. US Eastern on the decision day (as unix ms). */
export function presserStart(date: string): number {
  // Eastern time's offset that day, from the platform's zone data.
  const noon = new Date(`${date}T12:00:00Z`);
  const et = new Date(noon.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetH = Math.round((noon.getTime() - Date.UTC(et.getFullYear(), et.getMonth(), et.getDate(), et.getHours(), et.getMinutes())) / 3_600_000);
  return Date.parse(`${date}T14:30:00Z`) + offsetH * 3_600_000;
}

/** histdata.com's file for a year (before the current one) or a month, unzipped; its CSV's path. */
async function histdata(symbol: string, year: number, month: number | null): Promise<string> {
  const dir = join(tmp, "histdata");
  mkdirSync(dir, { recursive: true });
  const zipFile = join(dir, `${symbol}_${year}_${month ?? "all"}.zip`);
  const out = join(dir, `${symbol}_${year}_${month ?? "all"}`);
  // A file fetched before (a run stopped after it) is read again, not fetched again.
  if (!existsSync(zipFile)) await fetchHistdata(symbol, year, month, zipFile);
  mkdirSync(out, { recursive: true });
  // Windows' own tar (bsdtar) reads zips and takes C:\ paths; Git's would read "C:" as a host.
  execFileSync(process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar", ["-xf", zipFile, "-C", out]);
  rmSync(zipFile, { force: true });
  const csv = readdirSync(out).find((f) => f.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error(`histdata ${symbol} ${year}: no csv`);
  return join(out, csv);
}

async function fetchHistdata(symbol: string, year: number, month: number | null, zipFile: string): Promise<void> {
  const page = `https://www.histdata.com/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/${symbol.toLowerCase()}/${year}${month ? `/${month}` : ""}`;
  const html = await (await fetch(page, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  const form = /<form id="file_down"[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  const fields = new URLSearchParams();
  for (const m of form.matchAll(/<input type="hidden" name="(\w+)" id="\w+" value="([^"]*)"/g)) fields.set(m[1], m[2]);
  if (!fields.get("tk")) throw new Error(`histdata ${symbol} ${year}/${month ?? ""}: no download form`);
  const zip = await fetch("https://www.histdata.com/get.php", {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded", Referer: page },
    body: fields.toString(),
  });
  const buf = Buffer.from(await zip.arrayBuffer());
  if (buf.length < 1000 || buf.subarray(0, 2).toString("latin1") !== "PK") throw new Error(`histdata ${symbol} ${year}: not a zip (${buf.length} bytes)`);
  writeFileSync(zipFile, buf);
  log(`histdata ${symbol} ${year}${month ? `/${month}` : ""}: ${(buf.length / 1e6).toFixed(1)} MB`);
}

/**
 * The bars around each press conference (an hour before to two after), from a histdata CSV: its
 * times are US Eastern Standard Time all year (UTC−5, no daylight saving).
 */
function windowsOf(csv: string, starts: Map<string, number>): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  const spans = [...starts.entries()].map(([date, s]) => ({ date, from: s - 3_600_000, to: s + 3 * 3_600_000 }));
  for (const line of readFileSync(csv, "utf8").split("\n")) {
    const m = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})\d{2};[^;]*;[^;]*;[^;]*;([^;]*)/.exec(line);
    if (!m) continue;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 5 * 3_600_000;
    for (const s of spans) if (t >= s.from && t <= s.to) (out.get(s.date) ?? out.set(s.date, []).get(s.date)!).push([t, Number(m[6])]);
  }
  return out;
}

/** The % move from the last close before `from` to the first at or after `to` (within 5 minutes of each). */
export function moveBetween(bars: Array<[number, number]>, from: number, to: number): number | null {
  const before = bars.filter(([t]) => t < from && from - t <= 5 * 60_000).at(-1);
  const after = bars.find(([t]) => t >= to && t - to <= 5 * 60_000);
  return before && after ? Math.round(((after[1] - before[1]) / before[1]) * 10000) / 100 : null;
}

async function prices(): Promise<void> {
  const results = existsSync(resultsDir) ? readdirSync(resultsDir).map((f) => readJson<Result>(join(resultsDir, f))!) : [];
  const videos = readJson<Video[]>(join(root, "videos.json")) ?? [];
  const all = videos.length ? videos : results;
  const starts = new Map(all.map((v) => [v.date, presserStart(v.date)]));
  const file = join(root, "moves.json");
  const moves = readJson<Record<string, Windows>>(file) ?? {};
  const thisYear = new Date().getUTCFullYear();
  for (const [key, symbol] of Object.entries(SYMBOLS) as Array<[Key, string]>) {
    // A year's file for past years; the months of the current one, one by one.
    const years = [...new Set(all.map((v) => Number(v.date.slice(0, 4))))];
    for (const year of years) {
      const parts: Array<number | null> = year < thisYear ? [null] : [...new Set(all.filter((v) => v.date.startsWith(`${year}`)).map((v) => Number(v.date.slice(5, 7))))];
      for (const month of parts) {
        const dates = all.filter((v) => v.date.startsWith(`${year}`) && (month === null || Number(v.date.slice(5, 7)) === month)).map((v) => v.date);
        if (dates.every((d) => moves[d]?.presser?.[key] !== undefined)) continue;
        try {
          const csv = await histdata(symbol, year, month);
          const win = windowsOf(csv, new Map(dates.map((d) => [d, starts.get(d)!])));
          rmSync(join(csv, ".."), { recursive: true, force: true });
          for (const d of dates) {
            const v = all.find((x) => x.date === d)!;
            const s = starts.get(d)!;
            const w = (moves[d] ??= { presser: {}, statement: {} });
            w.presser[key] = moveBetween(win.get(d) ?? [], s, s + v.secs * 1000);
            // The statement comes out at 2 p.m., half an hour before.
            w.statement[key] = moveBetween(win.get(d) ?? [], s - 30 * 60_000, s);
          }
          writeFileSync(file, JSON.stringify(moves, null, 1));
        } catch (err) {
          log(symbol, year, month ?? "", "failed:", err instanceof Error ? err.message : err);
        }
      }
    }
  }
  log(`moves for ${Object.keys(moves).length} press conferences`);
}

// ---------------------------------------------------------------- the seed

function seed(target: string): void {
  const moves = readJson<Record<string, Windows>>(join(root, "moves.json")) ?? {};
  const results = readdirSync(resultsDir)
    .map((f) => readJson<Result>(join(resultsDir, f))!)
    .sort((a, b) => a.date.localeCompare(b.date));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const rows = results.map((r) => {
    const start = presserStart(r.date);
    return {
      date: r.date,
      videoId: r.id,
      title: r.title,
      start,
      end: start + r.secs * 1000,
      wordsIndex: Math.round(r.wordsIndex * 1000) / 1000,
      // [minute, confidence, stress, hesitation, tension or −1]
      delivery: r.samples.map((s) => [s.at / 60_000, r2(s.confidence), r2(s.stress), r2(s.hesitation), s.tension === null ? -1 : r2(s.tension)]),
      moves: moves[r.date]?.presser ?? {},
    };
  });
  const body = `// Generated by cli/fomc-delivery.ts (seed): the FOMC press conferences since 2019 read by the voice
// and face layers (the recordings on the Federal Reserve Board's YouTube channel), the words' index
// from their captions, and the markets' moves over each (histdata.com's one-minute bars: gold, the
// dollar index, the S&P 500, dollar-yen; % from 2:30 p.m. US Eastern to the end of the recording).
// Delivery rows: [minute, confidence, stress, hesitation, face tension (−1: no face locked)].

export type FomcDeliveryRow = {
  date: string;
  videoId: string;
  title: string;
  start: number;
  end: number;
  wordsIndex: number;
  delivery: Array<[number, number, number, number, number]>;
  moves: Partial<Record<"xau" | "dxy" | "es" | "usdjpy", number | null>>;
};

export const FOMC_DELIVERY: FomcDeliveryRow[] = ${JSON.stringify(rows)};
`;
  writeFileSync(target, body);
  log(`${rows.length} press conferences → ${target}`);
}

const [cmd, arg] = process.argv.slice(2);
const run =
  cmd === "list" ? list()
  : cmd === "analyze" ? analyze(arg)
  : cmd === "words" ? words()
  : cmd === "prices" ? prices()
  : cmd === "evaluate" ? Promise.resolve(evaluate())
  : cmd === "seed" ? Promise.resolve(seed(arg))
  : Promise.reject(new Error("list | analyze [id|date] | words | prices | evaluate | seed <file>"));
run.then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
