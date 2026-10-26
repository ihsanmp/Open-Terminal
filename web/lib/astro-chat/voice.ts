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
let wasSpeaking = false;
const changed = () => {
  // Just stopped reading: what the microphone hears in the next moment may still be its voice.
  // (The recognizer is online, so its last words can come in a while after.)
  if (wasSpeaking && speakingId === null) spokeUntil = Date.now() + 2500;
  wasSpeaking = speakingId !== null;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSpeakingId = () => useSyncExternalStore(subscribe, () => speakingId, () => null);

/** Bumped by each new reading and by stop, so a pause's timer from an older one does nothing. */
let reading = 0;

/**
 * What's being read out, and when it last was: the microphone hears it back from the speakers, and
 * that mustn't count as the user talking (isEcho).
 */
let spoken = "";
let spokeUntil = 0;
export const assistantSpeaking = () => speakingId !== null || Date.now() < spokeUntil;

/** Reads a message out in its mood (stopping whatever was being read); `id` marks it as the one playing. */
export function speak(text: string, id: string | null = null, mood: Mood = "santai"): void {
  stopAudio();
  spoken = toSpeech(text);
  const decide = () => (elevenOn() ? speakEleven(text, id, mood) : speakBrowser(text, id, mood));
  if (eleven !== null) return decide();
  // Whether ElevenLabs is set up isn't known yet (the chat opened before the app's server was up,
  // or it couldn't be asked): asked now, rather than reading in Gadis without a word.
  const run = ++reading;
  void refreshEleven().then((state) => {
    if (run !== reading) return;
    if (!state) {
      elevenIssue = "Status suara ElevenLabs belum bisa dicek (server aplikasi belum siap?). Dibacakan dengan suara cadangan (Gadis).";
      changed();
    }
    decide();
  });
}

/** The browser's own voice (Edge: Gadis): the one used without ElevenLabs, and when it fails. */
function speakBrowser(text: string, id: string | null, mood: Mood, keepRun = false): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice();
  // Sentence by sentence (fragments joined), each in its own tone, a breath between them.
  const parts = chunks(toSpeech(text), 140);
  if (!parts.length) return;
  const run = keepRun ? reading : ++reading;
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
  stopAudio();
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

const words = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

/**
 * Numbers as they're said: the answer writes "4.015", the recognizer hears "4015" or "empat ribu
 * lima belas", so heard back they can't be matched; they count as the answer's.
 */
const NUMBERS = new Set(
  "nol satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas belas puluh ratus seratus ribu seribu juta miliar triliun koma persen minus".split(" "),
);
const numberish = (w: string) => /^\d+$/.test(w) || NUMBERS.has(w);

/** The same word, give or take how the recognizer spells it or a suffix ("kayaknya"/"kayanya", "turun"/"turunnya"). */
const alike = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/** The words heard that aren't in what's being read out. */
export function ownWords(heard: string, reading: string): string[] {
  const out = words(reading);
  return words(heard).filter((w) => !numberish(w) && !out.some((o) => alike(w, o)));
}

/**
 * Whether what the microphone heard is the assistant's own voice coming back from the speakers:
 * most of its words are in what's being read out. The user's own words, even mid-answer, aren't.
 */
export function isEcho(heard: string, reading: string): boolean {
  const said = words(heard);
  if (!said.length || !reading) return false;
  return ownWords(heard, reading).length / said.length < 0.4;
}

/**
 * Said over an answer, these stop it even alone (not "udah", "bentar": heard back, the answer's
 * "sudah", "sebentar" come out like that).
 */
const HOLD = new Set("stop tunggu sebentar berhenti diam cukup halo".split(" "));

/** What the user said as they cut in: the answer's own words heard just before them taken off the front. */
export function afterEcho(heard: string, reading: string): string {
  const out = words(reading);
  const tokens = heard.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && words(tokens[i]).every((w) => numberish(w) || out.some((o) => alike(w, o)))) i++;
  return tokens.slice(i).join(" ");
}

/**
 * Whether what's heard while an answer is read out is the user cutting in. Judged on what follows
 * the answer's own words heard back: mostly words of their own, at least two (a word or two of the
 * answer misheard isn't enough), or one that means stop.
 */
export function cutsIn(heard: string, reading: string): boolean {
  const rest = afterEcho(heard, reading);
  const own = ownWords(rest, reading);
  if (own.some((w) => HOLD.has(w))) return true;
  return own.length >= 2 && own.length / words(rest).length >= 0.6;
}

/** After the last word heard, this long a pause ends what the user says (ms). */
const UTTERANCE_PAUSE = 1100;

/**
 * Conversation mode: the microphone stays on until it's switched off (the 🎤 again). What the user
 * says goes to `onText` as it's heard and to `onUtterance` when they pause; the assistant's voice is
 * stopped the moment the user starts talking over it (barge-in), and what's only its own voice heard
 * back is ignored. The recognizer is restarted whenever the browser ends it (silence, its time limit).
 * Returns the switch-off.
 */
export function converse(h: { onText: (text: string) => void; onUtterance: (text: string) => void; onError: (message: string) => void; onListening?: (on: boolean) => void }): () => void {
  const R = Recognizer();
  if (!R) {
    h.onError("Browser ini tidak punya pengenalan suara. Buka aplikasi lewat Edge atau Chrome.");
    return () => undefined;
  }
  let on = true;
  let r: Recognition | null = null;
  let buffer = "";
  let pause: ReturnType<typeof setTimeout> | undefined;
  let restarts = 0;
  // The user has cut in: what follows is theirs until they pause, not checked for echo.
  let floor = false;
  const commit = () => {
    const text = buffer.trim();
    buffer = "";
    floor = false;
    if (text) h.onUtterance(text);
  };
  const start = () => {
    if (!on) return;
    r = new R();
    r.lang = LANG;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = "";
      let finals = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      const heard = `${finals} ${interim}`.trim();
      if (!heard) return;
      if (!floor && assistantSpeaking()) {
        // The assistant's own voice heard back, or too little yet to tell it from the user: ignored.
        if (!cutsIn(heard, spoken)) return;
        // The user talks over the answer: it stops, and listens to what they say (not its echo before it).
        floor = true;
        stopSpeaking();
        finals = afterEcho(finals, spoken);
        if (!finals) interim = afterEcho(interim, spoken);
      }
      restarts = 0;
      if (finals) buffer = `${buffer} ${finals}`.trim();
      h.onText(`${buffer} ${interim}`.trim());
      clearTimeout(pause);
      pause = setTimeout(commit, UTTERANCE_PAUSE);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      on = false;
      h.onListening?.(false);
      h.onError(LISTEN_ERRORS[e.error] ?? `Pengenalan suara gagal (${e.error}).`);
    };
    r.onend = () => {
      if (!on) return;
      // The browser ends it on silence and after a while: again, unless it keeps failing at once.
      if (++restarts > 20) {
        on = false;
        h.onListening?.(false);
        h.onError("Mikrofon berhenti berulang kali; klik 🎤 untuk mencoba lagi.");
        return;
      }
      setTimeout(start, 250);
    };
    try {
      r.start();
      h.onListening?.(true);
    } catch (err) {
      on = false;
      h.onListening?.(false);
      h.onError(`Pengenalan suara tidak bisa dimulai: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  start();
  return () => {
    on = false;
    clearTimeout(pause);
    commit();
    r?.abort();
    h.onListening?.(false);
  };
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

// ---------------------------------------------------------------- ElevenLabs (the assistant's own voice)

export type ElevenState = { configured: boolean; fromEnv: boolean; voiceId: string; model: string };
let eleven: ElevenState | null = null;
/** Why the last answer wasn't read in the ElevenLabs voice (then Gadis read it), for the chat to say. */
let elevenIssue: string | null = null;

/** Asks the server whether ElevenLabs is set up (after a key is saved or removed, again). */
export async function refreshEleven(): Promise<ElevenState | null> {
  try {
    const r = await fetch("/api/astro-voice");
    eleven = r.ok ? ((await r.json()) as ElevenState) : null;
  } catch {
    eleven = null;
  }
  changed();
  return eleven;
}
export const useEleven = () => useSyncExternalStore(subscribe, () => eleven, () => null);
export const useElevenIssue = () => useSyncExternalStore(subscribe, () => elevenIssue, () => null);
/** The ElevenLabs voice is used when it's set up and its switch in the ✦ Claude menu is on. */
const elevenOn = () => Boolean(eleven?.configured) && read("astroEleven") !== "0";

/** An answer in pieces of a few sentences, so the first is heard while the next is made. */
export function elevenPieces(text: string): string[] {
  const sentences = chunks(text, 400, 0);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    // The first piece short (heard sooner), the rest up to ~400 characters.
    const max = out.length === 0 ? 160 : 400;
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

let audio: HTMLAudioElement | null = null;
const urls: string[] = [];
function stopAudio(): void {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio = null;
  }
  while (urls.length) URL.revokeObjectURL(urls.pop()!);
}

async function fetchSpeech(text: string, mood: Mood): Promise<string> {
  const r = await fetch("/api/astro-voice/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, tone: mood }) });
  if (!r.ok) {
    let msg = `suara ElevenLabs gagal (${r.status})`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await r.blob());
  urls.push(url);
  return url;
}

function speakEleven(text: string, id: string | null, mood: Mood): void {
  const parts = elevenPieces(toSpeech(text));
  if (!parts.length) return;
  const run = ++reading;
  speakingId = id;
  elevenIssue = null;
  changed();
  // Each piece is made while the one before it plays, and played as soon as it's in and its turn comes.
  const pending = parts.map(() => null as Promise<string> | null);
  const want = (i: number) => (pending[i] ??= fetchSpeech(parts[i], mood));
  const finish = () => {
    if (run === reading && speakingId === id) {
      speakingId = null;
      changed();
    }
  };
  const play = async (i: number) => {
    if (run !== reading) return;
    if (i >= parts.length) return finish();
    if (i + 1 < parts.length) void want(i + 1).catch(() => undefined);
    let url: string;
    try {
      url = await want(i);
    } catch (err) {
      if (run !== reading) return;
      // The rest in the browser's voice, and why.
      elevenIssue = `${err instanceof Error ? err.message : String(err)} Dibacakan dengan suara cadangan (Gadis).`;
      changed();
      speakBrowser(parts.slice(i).join(" "), id, mood, true);
      return;
    }
    if (run !== reading) return;
    const a = new Audio(url);
    audio = a;
    a.onended = () => play(i + 1);
    a.onerror = () => play(i + 1);
    a.play().catch(() => play(i + 1));
  };
  void play(0);
}
