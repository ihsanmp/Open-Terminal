"use client";

import { useSyncExternalStore } from "react";

// The Astro chat by voice, with the browser's own speech (no download, nothing installed): what's
// said is written by its speech recognition (Edge: Microsoft's, Chrome: Google's; online, the
// microphone asked for once), and the answers are read out by its speech synthesis, in an
// Indonesian voice when there is one (Edge: Gadis or Ardi, natural, online).

export const LANG = "id-ID";

// ---------------------------------------------------------------- what's spoken

/** The answer as it should be heard: no markup, bullets as pauses, signs read as words. */
export function toSpeech(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^\s*[•\-*]\s+/gm, "")
    .replace(/[_`#>]/g, "")
    // Icons (✦, 👁, 🔊 …) aren't read out.
    .replace(/[←-⇿☀-➿⬀-⯿]|\p{Extended_Pictographic}/gu, (c) => (c === "→" ? c : ""))
    // "emas/BTC/DXY" as a list, not "slash".
    .replace(/(\p{L})\/(?=\p{L})/gu, "$1, ")
    .replace(/\s*→\s*/g, ", ke ")
    .replace(/\s*(±|\+\/-)\s*/g, " kurang lebih ")
    .replace(/(\d)\s*%/g, "$1 persen")
    .replace(/\n{2,}/g, ".\n")
    .replace(/([^.!?:;\n])\n/g, "$1.\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The text in pieces a voice reads through: Chrome stops a long utterance after ~15 s, so each
 * sentence is spoken on its own (each in its own tone: toneOf), a fragment shorter than `join`
 * characters with the next, and a sentence longer than `max` by its commas.
 */
export function chunks(text: string, max = 220, join = 16): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*|\n+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) out.push(cur);
      cur = "";
      // A sentence too long by itself: by its commas.
      let part = "";
      for (const w of s.split(/(?<=,)\s+/)) {
        if (part && part.length + w.length + 1 > max) {
          out.push(part);
          part = w;
        } else part = part ? `${part} ${w}` : w;
      }
      if (part) out.push(part);
    } else if (cur && (cur.length >= join || cur.length + s.length + 1 > max)) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- speaking

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** The voices that speak Indonesian, the natural ones first. */
export function indonesianVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^id(-|_|$)/i.test(v.lang))
    .sort((a, b) => Number(/natural|online/i.test(b.name)) - Number(/natural|online/i.test(a.name)));
}

const REPLY_KEY = "astroVoiceReply";
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    // this session only
  }
};

/** Women's Indonesian voices by name (Edge: Gadis; Chrome: Google Bahasa Indonesia; macOS: Damayanti). */
const FEMALE = /gadis|damayanti|google bahasa indonesia|female|wanita|perempuan/i;

/** The voice answers are read in: an Indonesian woman's, the natural one first. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const all = indonesianVoices();
  return all.find((v) => FEMALE.test(v.name)) ?? all.find((v) => !/ardi|male|pria/i.test(v.name)) ?? all[0] ?? null;
}

/** The mood an answer is read in, as Claude marks it (server: astrochat/prompt.ts, splitTone). */
export type Mood = "santai" | "antusias" | "menenangkan" | "tegas" | "lembut";

/**
 * Each mood's voice, after the pairing of user states with speech in the voice-agent notes the user
 * gave: excited is matched (higher, faster); anxious is calmed (slower, softer, longer breaths); annoyed
 * gets it straight (slower, falling, no rising questions); tired or sad gets it gently (softest, longest
 * pauses). `pause` is the breath between sentences (ms); questions rise by `lift`.
 */
export const MOODS: Record<Mood, { rate: number; pitch: number; volume: number; pause: number; lift: number }> = {
  santai: { rate: 1.04, pitch: 1.02, volume: 1, pause: 140, lift: 0.12 },
  antusias: { rate: 1.12, pitch: 1.12, volume: 1, pause: 60, lift: 0.16 },
  menenangkan: { rate: 0.94, pitch: 0.98, volume: 0.85, pause: 380, lift: 0.06 },
  tegas: { rate: 0.95, pitch: 0.94, volume: 1, pause: 220, lift: 0 },
  lembut: { rate: 0.92, pitch: 0.97, volume: 0.8, pause: 480, lift: 0.05 },
};

/**
 * How a sentence is said in a mood, so the voice isn't flat: a question rises, an exclamation is
 * brisker, a caution ("tapi", "hati-hati") slower and lower, "nah"/"jadi" lighter, and the rest
 * sways a little from sentence to sentence.
 */
export function toneOf(sentence: string, i: number, mood: Mood = "santai"): { rate: number; pitch: number; volume: number } {
  const m = MOODS[mood] ?? MOODS.santai;
  const s = sentence.trim();
  const at = (dr: number, dp: number) => ({ rate: +(m.rate + dr).toFixed(3), pitch: +(m.pitch + dp).toFixed(3), volume: m.volume });
  if (/\?["')]*$/.test(s)) return at(-0.02, m.lift);
  if (/!["')]*$/.test(s)) return at(0.06, 0.08);
  if (/^(tapi|namun|hati-hati|awas|ingat|sayangnya|risikonya)\b/i.test(s)) return at(-0.08, -0.07);
  if (/^(nah|jadi|oke|intinya|singkatnya)\b/i.test(s)) return at(0.02, 0.04);
  const sway = [0, 0.04, -0.02, 0.02][i % 4];
  return at(sway / 2, sway);
}

// Which message is being read, for its button; kept outside React so every message sees it.
let speakingId: string | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSpeakingId = () => useSyncExternalStore(subscribe, () => speakingId, () => null);

/** Bumped by each new reading and by stop, so a pause's timer from an older one does nothing. */
let reading = 0;

/** Reads a message out in its mood (stopping whatever was being read); `id` marks it as the one playing. */
export function speak(text: string, id: string | null = null, mood: Mood = "santai"): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice();
  // Sentence by sentence (fragments joined), each in its own tone, a breath between them.
  const parts = chunks(toSpeech(text), 140);
  if (!parts.length) return;
  const run = ++reading;
  speakingId = id;
  changed();
  const done = () => {
    if (run === reading && speakingId === id) {
      speakingId = null;
      changed();
    }
  };
  const say = (i: number) => {
    if (run !== reading) return;
    if (i >= parts.length) return done();
    const u = new SpeechSynthesisUtterance(parts[i]);
    u.lang = voice?.lang ?? LANG;
    if (voice) u.voice = voice;
    const tone = toneOf(parts[i], i, mood);
    u.rate = tone.rate;
    u.pitch = tone.pitch;
    u.volume = tone.volume;
    u.onend = () => window.setTimeout(() => say(i + 1), MOODS[mood]?.pause ?? 140);
    u.onerror = done;
    synth.speak(u);
  };
  say(0);
}

export function stopSpeaking(): void {
  reading++;
  if (canSpeak()) window.speechSynthesis.cancel();
  speakingId = null;
  changed();
}

/** Whether answers are read out as they come (kept in this browser). */
export const voiceReplyOn = () => read(REPLY_KEY) === "1";
export function setVoiceReply(on: boolean): void {
  write(REPLY_KEY, on ? "1" : "0");
  if (!on) stopSpeaking();
  changed();
}
export const useVoiceReply = () => useSyncExternalStore(subscribe, voiceReplyOn, () => false);

// ---------------------------------------------------------------- listening

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Recognizer = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const canListen = () => Recognizer() !== null;

/** What went wrong, as the chat says it. */
export const LISTEN_ERRORS: Record<string, string> = {
  "not-allowed": "Mikrofon tidak diizinkan. Izinkan mikrofon untuk aplikasi ini (ikon gembok/kamera di bilah alamat), lalu coba lagi.",
  "service-not-allowed": "Pengenalan suara browser tidak diizinkan di sini.",
  "audio-capture": "Mikrofon tidak ditemukan.",
  network: "Pengenalan suara butuh internet (diproses layanan browser).",
  "no-speech": "Tidak terdengar suara. Coba lagi lebih dekat ke mikrofon.",
  "language-not-supported": "Bahasa Indonesia tidak didukung pengenalan suara browser ini.",
};

/**
 * Listens once: `onText` gets what's heard so far as it's said, `onDone` the whole of it when the
 * speaker stops (empty when nothing was understood), `onError` why it couldn't. Returns a stop.
 */
export function listen(handlers: { onText: (text: string) => void; onDone: (text: string) => void; onError: (message: string) => void }): () => void {
  const R = Recognizer();
  if (!R) {
    handlers.onError("Browser ini tidak punya pengenalan suara. Buka aplikasi lewat Edge atau Chrome.");
    return () => undefined;
  }
  // The voice isn't read over what's being said.
  stopSpeaking();
  const r = new R();
  r.lang = LANG;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = "";
  let failed = false;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    handlers.onText(`${finalText}${interim}`.trim());
  };
  r.onerror = (e) => {
    failed = true;
    if (e.error !== "aborted") handlers.onError(LISTEN_ERRORS[e.error] ?? `Pengenalan suara gagal (${e.error}).`);
  };
  r.onend = () => {
    if (!failed) handlers.onDone(finalText.trim());
  };
  try {
    r.start();
  } catch (err) {
    handlers.onError(`Pengenalan suara tidak bisa dimulai: ${err instanceof Error ? err.message : String(err)}`);
  }
  return () => r.stop();
}

// ---------------------------------------------------------------- the ✦ Claude menu's switches

/** A switch of the ✦ Claude menu (🎤 the microphone button, 👁 a look at the screen with every question), kept in this browser. */
export function usePref(key: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const v = read(key);
      return v === null ? fallback : v === "1";
    },
    () => fallback
  );
}
export function setPref(key: string, on: boolean): void {
  write(key, on ? "1" : "0");
  changed();
}
