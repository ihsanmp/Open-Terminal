"use client";

import { useSyncExternalStore } from "react";

// The user's voice told apart from the assistant's. The speech recognizer hears the raw microphone,
// the answer coming back from the speakers and all; this is a second ear on the same microphone
// through the browser's echo cancellation, which takes out what the app itself plays (the
// ElevenLabs voice), so what's left is the user. It says when the user was really talking.

/** How often the level is looked at (ms). */
const FRAME_MS = 40;
/** The least level counted as a voice (RMS, after the browser's gain control), whatever the room. */
const MIN_VOICE = 0.012;
/** A voice is this far above the room's own level (×, about +10 dB). */
const OVER_ROOM = 3.2;
/** A word's worth of frames above it before it counts: a click or a bump isn't a voice. */
const ONSET_FRAMES = 3;

let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let timer: number | undefined;
let opening: Promise<boolean> | null = null;
let room = 0.004;
let above = 0;
let lastVoice = 0;
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

/** The level of one frame, and from it the room's and whether the user is talking. */
export function hear(level: number, now: number): void {
  // The room's level follows the quiet moments down at once and comes back up slowly (~10 s), so a
  // voice going on doesn't become the room.
  room = level < room ? level : room + (level - room) * 0.004;
  above = level > Math.max(MIN_VOICE, room * OVER_ROOM) ? above + 1 : 0;
  if (above >= ONSET_FRAMES) lastVoice = now;
  set(now - lastVoice < 250);
}

/** Opens the second ear (the microphone, echo-cancelled); false when it can't be (no permission, no support). */
export function openEar(): Promise<boolean> {
  if (stream) return Promise.resolve(true);
  if (opening) return opening;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return Promise.resolve(false);
  opening = (async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const c = new AudioContext();
      void c.resume();
      const analyser = c.createAnalyser();
      analyser.fftSize = 1024;
      c.createMediaStreamSource(s).connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      stream = s;
      ctx = c;
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        hear(Math.sqrt(sum / frame.length), Date.now());
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
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  stream = null;
  ctx = null;
  lastVoice = 0;
  above = 0;
  set(false);
}

export const earOpen = () => stream !== null;

/** Whether the user's own voice was heard within the last `ms` (the recognizer's words come in that late). */
export const userSpoke = (ms: number, now = Date.now()) => now - lastVoice < ms;

/** Whether the user is talking right now, for the chat to show. */
export const useUserTalking = () => useSyncExternalStore(subscribe, () => talking, () => false);

/** For tests: back to a quiet room. */
export function resetEar(): void {
  room = 0.004;
  above = 0;
  lastVoice = 0;
  talking = false;
}
