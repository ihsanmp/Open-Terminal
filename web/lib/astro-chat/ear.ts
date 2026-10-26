"use client";

import { useSyncExternalStore } from "react";

// The user's voice told apart from the assistant's. The speech recognizer hears the raw microphone,
// the answer coming back from the speakers and all; this is a second ear on the same microphone
// that also hears what the app is playing (the ElevenLabs voice, straight from the player), and
// learns how much of it comes back into the microphone. What's on the microphone beyond that echo
// is the user. (The browser's echo cancellation is asked for too, but can't be counted on: Edge
// doesn't always take out what a page plays.)

/** How often the levels are looked at (ms). */
const FRAME_MS = 40;
/** The least level counted as a voice (RMS), whatever the room. */
const MIN_VOICE = 0.0015;
/** A voice is this far above the room's own level (×, about +10 dB). */
const OVER_ROOM = 3.2;
/** Over the echo the speakers explain: this far is surely the user (×, about +10 dB) … */
const OVER_ECHO = 3;
/** … under this far, surely only the echo; in between, the ear can't tell. */
const NEAR_ECHO = 1.6;
/** A word's worth of frames above it before it counts: a click or a bump isn't a voice. */
const ONSET_FRAMES = 3;
/** Below this the player is silent (RMS). */
const PLAYING = 0.003;
/** How fast the echo's share is learned (log units per frame). */
const LEARN = 0.015;
const COUPLING_KEY = "ot-astro-echo";

let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let timer: number | undefined;
let opening: Promise<boolean> | null = null;
let micFrame: Float32Array<ArrayBuffer> | null = null;
let micAnalyser: AnalyserNode | null = null;
let playback: { node: MediaStreamAudioSourceNode; analyser: AnalyserNode; frame: Float32Array<ArrayBuffer> } | null = null;

let room = 0.002;
let lastMic = 0;
/** The speakers' sound, held a moment for the way to the microphone and the room's ring. */
let speakers = 0;
/** How much of the speakers' sound comes back into the microphone (log of the ratio), learned while they play. */
let coupling = 0;
let above = 0;
let unsureAbove = 0;
let lastVoice = 0;
let lastUnsure = 0;
let talking = false;

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const set = (on: boolean) => {
  if (on === talking) return;
  talking = on;
  listeners.forEach((l) => l());
};

/** One frame's levels, the microphone's and the player's, and from them whether the user is talking. */
export function hear(mic: number, played: number, now: number): void {
  lastMic = +mic.toFixed(4);
  speakers = Math.max(played, speakers * 0.8);
  const playing = speakers > PLAYING;
  const echo = playing ? Math.exp(coupling) * speakers : 0;
  const floor = Math.max(MIN_VOICE, room * OVER_ROOM);
  const sure = mic > floor && mic > echo * OVER_ECHO;
  const maybe = mic > floor && mic > echo * NEAR_ECHO;
  // While it plays, the microphone is mostly its echo: the share moves toward what's heard (a
  // running median, so the user now and then doesn't pull it up much; slower while they're heard,
  // but never still, or an echo louder than first thought would pass for the user for good).
  if (playing && mic > 1e-5) coupling += (Math.log(mic / speakers) > coupling ? 1 : -1) * (sure ? LEARN / 3 : LEARN);
  // The room's level follows the quiet moments down at once and comes back up slowly (~10 s; ten
  // times slower for the first 4 s the user is heard, so a long sentence doesn't become the room,
  // but a fan switched on does: nobody talks 4 s without a breath).
  if (!playing) room = mic < room ? mic : room + (mic - room) * (sure && above < 100 ? 0.0004 : 0.004);
  above = sure ? above + 1 : 0;
  unsureAbove = maybe ? unsureAbove + 1 : 0;
  if (above >= ONSET_FRAMES) lastVoice = now;
  if (unsureAbove >= ONSET_FRAMES) lastUnsure = now;
  set(now - lastVoice < 250);
}

const rms = (a: AnalyserNode, f: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(f);
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  return Math.sqrt(sum / f.length);
};

const saveCoupling = () => {
  try {
    localStorage.setItem(COUPLING_KEY, String(coupling));
  } catch {
    // not kept
  }
};

/** Opens the second ear (the microphone); false when it can't be (no permission, no support). */
export function openEar(): Promise<boolean> {
  if (stream) return Promise.resolve(true);
  if (opening) return opening;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return Promise.resolve(false);
  opening = (async () => {
    try {
      // Echo-cancelled and evened out: the recognizer listens to this one too (earTrack), and the
      // user's voice was too quiet for it without gain control.
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const c = new AudioContext();
      void c.resume();
      micAnalyser = c.createAnalyser();
      micAnalyser.fftSize = 1024;
      const source = c.createMediaStreamSource(s);
      source.connect(micAnalyser);
      void startRecording(c, source);
      micFrame = new Float32Array(micAnalyser.fftSize);
      try {
        const kept = Number(localStorage.getItem(COUPLING_KEY));
        if (kept && Number.isFinite(kept)) coupling = kept;
      } catch {
        // the default
      }
      stream = s;
      ctx = c;
      let frames = 0;
      timer = window.setInterval(() => {
        if (!micAnalyser || !micFrame) return;
        hear(rms(micAnalyser, micFrame), playback ? rms(playback.analyser, playback.frame) : 0, Date.now());
        if (++frames % 250 === 0) saveCoupling();
      }, FRAME_MS);
      return true;
    } catch {
      return false;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

/**
 * The recording: the last minute of the echo-cancelled microphone, so a turn of the
 * user's can be sent to Scribe (it hears Indonesian and English as said; the browser's recognizer
 * one language only). Taken by a worklet in batches, kept in a ring.
 */
/** Kept as long as this (s), at the microphone's own rate: brought down by hand it lost detail Scribe needs. */
const KEEP_S = 60;
let rate = 48_000;
let ring: Int16Array | null = null;
let written = 0;
let writtenAt = 0;
let tap: AudioWorkletNode | null = null;

const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("ot-tap", Tap);`;

async function startRecording(c: AudioContext, source: MediaStreamAudioSourceNode): Promise<void> {
  try {
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    await c.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    if (ctx !== c) return;
    const node = new AudioWorkletNode(c, "ot-tap");
    const size = Math.round(c.sampleRate * KEEP_S);
    const r = new Int16Array(size);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data;
      for (let i = 0; i < f.length; i++) r[(written + i) % size] = Math.max(-1, Math.min(1, f[i])) * 32767;
      written += f.length;
      writtenAt = Date.now();
      audioListeners.forEach((l) => l(f));
    };
    source.connect(node);
    // A worklet runs only when something pulls on it: a silent way out.
    const mute = c.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(c.destination);
    ring = r;
    rate = c.sampleRate;
    written = 0;
    tap = node;
  } catch {
    ring = null;
  }
}

/** What the microphone heard from `from` to `to` (times in ms), as a WAV; null when there's no recording of it. */
export function recording(from: number, to: number): Blob | null {
  if (!ring || !written) return null;
  const size = ring.length;
  const at = (t: number) => Math.round(written - ((writtenAt - t) * rate) / 1000);
  const start = Math.max(at(from), written - size + 1, 0);
  const end = Math.min(at(to), written);
  const n = end - start;
  if (n < rate * 0.3) return null;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, ring[(start + i) % size], true);
  return new Blob([buf], { type: "audio/wav" });
}

const audioListeners = new Set<(f: Float32Array) => void>();
/** The echo-cancelled microphone's sound as it comes (batches at earRate()), for streaming it; the unsubscribe. */
export function onAudio(l: (f: Float32Array) => void): () => void {
  audioListeners.add(l);
  return () => audioListeners.delete(l);
}
/** The recording's sample rate (the microphone's own). */
export const earRate = () => rate;

/** The recording from `from` (ms) to now, as 16-bit samples at earRate(): to send what was said just before a stream opened. */
export function samplesSince(from: number): Int16Array {
  if (!ring || !written) return new Int16Array(0);
  const size = ring.length;
  const start = Math.max(Math.round(written - ((writtenAt - from) * rate) / 1000), written - size + 1, 0);
  const out = new Int16Array(Math.max(0, written - start));
  for (let i = 0; i < out.length; i++) out[i] = ring[(start + i) % size];
  return out;
}

/** The echo-cancelled microphone itself, for the recognizer to listen to (null when the ear is closed). */
export function earTrack(): MediaStreamTrack | null {
  const t = stream?.getAudioTracks()[0];
  return t && t.readyState === "live" ? t : null;
}

export function closeEar(): void {
  window.clearInterval(timer);
  if (stream) saveCoupling();
  stopHearingPlayback();
  tap?.disconnect();
  tap = null;
  ring = null;
  written = 0;
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  stream = null;
  ctx = null;
  micAnalyser = null;
  micFrame = null;
  lastVoice = 0;
  lastUnsure = 0;
  above = 0;
  unsureAbove = 0;
  set(false);
}

/**
 * Listens to what a player is playing (its sound as it goes out, not through the microphone), so
 * its echo is known. False when it can't be (the ear isn't open, or the browser can't share the sound).
 */
export function hearPlayback(el: HTMLMediaElement): boolean {
  stopHearingPlayback();
  if (!ctx) return false;
  try {
    const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream?.();
    if (!capture?.getAudioTracks().length) return false;
    const node = ctx.createMediaStreamSource(capture);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    playback = { node, analyser, frame: new Float32Array(analyser.fftSize) };
    return true;
  } catch {
    return false;
  }
}

export function stopHearingPlayback(): void {
  playback?.node.disconnect();
  playback = null;
}

export const earOpen = () => stream !== null;
export const earHearsPlayback = () => playback !== null;

/**
 * Whether the user's own voice was on the microphone within the last `ms` (the recognizer's words
 * come in that late): yes, no, or null when it was only somewhat over the echo and the ear can't tell.
 */
export function userSpoke(ms: number, now = Date.now()): boolean | null {
  if (now - lastVoice < ms) return true;
  if (now - lastUnsure < ms) return null;
  return false;
}

/** How long since the user's voice was last on the microphone, even only somewhat over the echo (ms). */
export const sinceVoice = (now = Date.now()) => now - Math.max(lastVoice, lastUnsure);

/** The ear's levels now, for the conversation's trace. */
export const earState = () => ({
  open: stream !== null,
  playback: playback !== null,
  mic: lastMic,
  speakers: +speakers.toFixed(4),
  share: +Math.exp(coupling).toFixed(3),
  room: +room.toFixed(4),
});

/** Whether the user is talking right now, for the chat to show. */
export const useUserTalking = () => useSyncExternalStore(subscribe, () => talking, () => false);

/** For tests: back to a quiet room, with an echo share. */
export function resetEar(share = 1): void {
  room = 0.002;
  speakers = 0;
  coupling = Math.log(share);
  above = 0;
  unsureAbove = 0;
  lastVoice = 0;
  lastUnsure = 0;
  talking = false;
}
