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
const MIN_VOICE = 0.004;
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
      // No gain control: it would turn the echo up and down, and the levels couldn't be compared.
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      const c = new AudioContext();
      void c.resume();
      micAnalyser = c.createAnalyser();
      micAnalyser.fftSize = 1024;
      c.createMediaStreamSource(s).connect(micAnalyser);
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

export function closeEar(): void {
  window.clearInterval(timer);
  if (stream) saveCoupling();
  stopHearingPlayback();
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
