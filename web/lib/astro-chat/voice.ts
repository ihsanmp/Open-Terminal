"use client";

import { useSyncExternalStore } from "react";
import { closeEar, earOpen, earState, hearPlayback, openEar, sinceVoice, stopHearingPlayback } from "./ear";

// The Astro chat by voice, with the browser's own speech (no download, nothing installed): what's
// said is written by its speech recognition (Edge: Microsoft's, Chrome: Google's; online, the
// microphone asked for once), and the answers are read out by its speech synthesis, in an
// Indonesian voice when there is one (Edge: Gadis or Ardi, natural, online).

export const LANG = "id-ID";

// ---------------------------------------------------------------- what's spoken

const DIGITS = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];

/** A whole number in Indonesian words ("80700": "delapan puluh ribu tujuh ratus"). */
export function terbilang(n: number): string {
  const say = (x: number): string => {
    if (x < 10) return DIGITS[x];
    if (x === 10) return "sepuluh";
    if (x === 11) return "sebelas";
    if (x < 20) return `${DIGITS[x - 10]} belas`;
    const join = (head: string, rest: number) => (rest ? `${head} ${say(rest)}` : head);
    if (x < 100) return join(`${DIGITS[Math.floor(x / 10)]} puluh`, x % 10);
    if (x < 200) return join("seratus", x - 100);
    if (x < 1000) return join(`${DIGITS[Math.floor(x / 100)]} ratus`, x % 100);
    if (x < 2000) return join("seribu", x - 1000);
    for (const [size, name] of [
      [1e12, "triliun"],
      [1e9, "miliar"],
      [1e6, "juta"],
      [1e3, "ribu"],
    ] as const) {
      if (x >= size) return join(`${say(Math.floor(x / size))} ${name}`, x % size);
    }
    return String(x);
  };
  return say(Math.floor(Math.abs(n)));
}

/**
 * A number as written in an Indonesian answer: a dot between thousands ("80.700"), a comma before
 * the decimals ("4,995"; "1.5" too, written the English way), a sign before it. Not one inside a
 * word or a code ("US10Y", "SMA20"), a time or a date ("15:30", "26/10").
 */
const NUMBER = /(?<![\p{L}\d.,:/])([+\-−]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:([.,])(\d+))?(?![\p{L}\d:/]|[.,]\d)/gu;

/**
 * The number said in words: the voices read "80.700" as "delapan puluh" and, after a pause, "tujuh
 * ratus" (the dot taken for a sentence's end), not "delapan puluh ribu tujuh ratus".
 */
function spokenNumber(sign: string, whole: string, mark: string | undefined, decimals: string | undefined): string {
  const digits = whole.replace(/\./g, "");
  // Too long to be an amount (an account, a phone number): left as written.
  if (digits.length > 15) return `${sign}${whole}${mark ?? ""}${decimals ?? ""}`;
  const head = sign === "+" ? "plus " : sign ? "minus " : "";
  const tail = decimals ? ` koma ${[...decimals].map((d) => DIGITS[Number(d)]).join(" ")}` : "";
  return `${head}${terbilang(Number(digits))}${tail}`;
}

/** Letters said the English way, written so an Indonesian voice says them so. */
const LETTERS: Record<string, string> = {
  A: "ei", B: "bi", C: "si", D: "di", E: "i", F: "ef", G: "ji", H: "eic", I: "ai", J: "jei", K: "kei", L: "el", M: "em",
  N: "en", O: "ou", P: "pi", Q: "kyu", R: "ar", S: "es", T: "ti", U: "yu", V: "vi", W: "dabelyu", X: "eks", Y: "wai", Z: "zi",
};
/** English abbreviations said letter by letter, the English way (not Indonesian ones: "OJK", "BI" stay as they are). */
const SPELLED = new Set("DXY ETF FOMC CPI PPI PCE GDP NFP SMA EMA RSI MACD ATR ATH ATL BTC ETH USD WTI SPX NDX AI CEO IPO OTC".split(" "));
/**
 * English words an answer uses, written as they sound in English for an Indonesian voice (it reads
 * "support" letter by letter the Indonesian way). Longer phrases first.
 */
const IN_ENGLISH: [string, string][] = [
  ["all-time high", "ol taim hai"], ["moving average", "muving everej"], ["golden cross", "golden kros"], ["death cross", "det kros"],
  ["stop loss", "stop los"], ["take profit", "teik profit"], ["open interest", "oupen intrest"], ["smart money", "smart mani"],
  ["price action", "prais ekson"], ["safe haven", "seif heiven"], ["real yield", "riel yild"], ["funding rate", "fanding reit"],
  ["on-chain", "on cein"], ["support", "sepot"], ["resistance", "resistens"], ["breakout", "breikaut"], ["breakdown", "breikdaun"],
  ["pullback", "pulbek"], ["rebound", "ribaund"], ["bullish", "bulis"], ["bearish", "beris"], ["sideways", "saidweis"],
  ["uptrend", "aptren"], ["downtrend", "dauntren"], ["traders", "treiders"], ["trader", "treider"], ["trading", "treiding"],
  ["chart", "cart"], ["candlestick", "kendelstik"], ["candle", "kendel"], ["market", "markit"], ["yield", "yild"], ["rates", "reits"],
  ["rate", "reit"], ["outlook", "autluk"], ["hedge", "hej"], ["funding", "fanding"], ["fund", "fand"], ["range", "reinj"],
  ["swing", "suing"], ["scalping", "skelping"], ["entry", "entri"], ["exit", "eksit"], ["short", "syort"], ["leverage", "leverej"],
  ["whales", "weils"], ["whale", "weil"], ["inflows", "inflous"], ["inflow", "inflou"], ["outflows", "autflous"], ["outflow", "autflou"],
  ["futures", "fyucers"], ["halving", "heving"], ["staking", "steiking"], ["mining", "maining"], ["altcoins", "altkoins"],
  ["altcoin", "altkoin"], ["bitcoin", "bitkoin"], ["ethereum", "itiriem"], ["rally", "reli"], ["crash", "kres"], ["pump", "pamp"],
  ["dump", "damp"], ["hawkish", "hokis"], ["dovish", "dafis"], ["update", "apdeit"], ["overbought", "overbot"], ["divergence", "daivergens"],
  ["fear", "fir"], ["greed", "grid"], ["news", "nyus"], ["spread", "spred"], ["treasury", "tresyeri"], ["earnings", "ernings"],
  ["guidance", "gaidens"], ["shutdown", "syatdaun"], ["setup", "setap"], ["insight", "insait"], ["timing", "taiming"],
  ["insider", "insaider"], ["buyers", "baiers"], ["buyer", "baier"], ["sellers", "selers"], ["seller", "seler"], ["buy", "bai"],
  ["sell", "sel"], ["hold", "hould"], ["higher", "haier"], ["high", "hai"], ["lower", "louer"], ["low", "lou"], ["cut", "kat"],
  ["hike", "haik"], ["screen", "skrin"],
];
const ENGLISH_RE = IN_ENGLISH.map(([en, say]) => [new RegExp(`\\b${en.replace(/[ -]/g, "[\\s-]?")}(?=(?:-?(?:nya|mu|ku|lah|kah))?\\b)`, "gi"), say] as const);

/** English words and abbreviations in an answer, written to be said the English way. */
export function inEnglish(text: string): string {
  let out = text.replace(/\bS&P\b/g, "es en pi").replace(/(\p{L})\s*&\s*(?=\p{L})/gu, "$1 en ");
  for (const [re, say] of ENGLISH_RE) out = out.replace(re, say);
  return out.replace(/\b([A-Z]{2,5})(s?)\b/g, (m, a: string, s: string) => (SPELLED.has(a) ? `${[...a].map((c) => LETTERS[c]).join(" ")}${s}` : m));
}

/** The answer as it should be heard: no markup, bullets as pauses, signs read as words, numbers in words. */
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
    .replace(/~\s*(?=\d)/g, "sekitar ")
    .replace(/(\d)\s*%/g, "$1 persen")
    .replace(NUMBER, (_m, sign: string, whole: string, mark: string | undefined, decimals: string | undefined) => spokenNumber(sign, whole, mark, decimals))
    .replace(/[^\n]+/g, (line) => inEnglish(line))
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
  if (wasSpeaking && speakingId === null) {
    endedAt = Date.now();
    spokeUntil = endedAt + 3000;
  }
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
 * What's coming out of the speakers about now, and when it last was: the microphone hears it back,
 * and that mustn't count as the user talking (isEcho). Only the piece being read and the one before
 * it (the recognizer is a moment behind), not the whole answer: a long answer has most everyday
 * words in it, and the user's would pass for its echo.
 */
let hearing = "";
let spokeUntil = 0;
/** When it last stopped reading, and when it last began to. */
let endedAt = 0;
let spokeFrom = 0;
const nowSaying = (parts: string[], i: number) => {
  hearing = parts.slice(Math.max(0, i - 1), i + 1).join(" ");
};
export const assistantSpeaking = () => speakingId !== null || Date.now() < spokeUntil;

/** Reads a message out in its mood (stopping whatever was being read); `id` marks it as the one playing. */
export function speak(text: string, id: string | null = null, mood: Mood = "santai"): void {
  stopAudio();
  spokeFrom = Date.now();
  // Nothing out of the speakers until its first piece plays: anything heard till then is the user.
  hearing = "";
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
  note("speak", { engine: "browser", pieces: parts.length });
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
    nowSaying(parts, i);
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
const alike = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.slice(0, 4) === b.slice(0, 4) || oneOff(a, b)));

/** One letter apart, as the recognizer mishears ("jatoh"/"jatuh", "dalem"/"dalam", "gimna"/"gimana"). */
function oneOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}

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
 * Said over an answer, these stop it: while it reads, nothing else does (the microphone hears it as
 * loud as the user, garbled, so no other words can be told from its echo). Not "bentar", "udah":
 * heard back, the answer's own "sebentar", "sudah" come out like that.
 */
const STOP = new Set("stop setop tunggu berhenti diam cukup sebentar halo hei hey wait".split(" "));

/** Where in what's heard a word that means stop is, one the answer isn't saying itself (-1: none). */
export function stopWordAt(heard: string, reading: string): number {
  const out = words(reading);
  return heard
    .trim()
    .split(/\s+/)
    .findIndex((t) => words(t).some((w) => STOP.has(w) && !out.some((o) => alike(w, o))));
}

/** What the user says after the word that stopped the answer (all of it, if there's none). */
export function afterStopWord(heard: string, reading: string): string {
  const at = stopWordAt(heard, reading);
  return at < 0 ? heard.trim() : heard.trim().split(/\s+/).slice(at + 1).join(" ");
}

/** What the user said as they cut in: the answer's own words heard just before them taken off the front. */
export function afterEcho(heard: string, reading: string): string {
  const out = words(reading);
  const tokens = heard.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && words(tokens[i]).every((w) => numberish(w) || out.some((o) => alike(w, o)))) i++;
  return tokens.slice(i).join(" ");
}

/** After the user's voice ends, this long a silence ends what they say (ms): a moment to finish the question. */
const QUIET_TO_SEND = 1500;
/** Without the ear, silence is told only by the recognizer's words stopping, and they come in late: longer. */
const QUIET_NO_EAR = 2200;
/** Ending on "ehmm" or a word that leads on ("dan", "terus", "yang"…): still going, this much longer. */
const STILL_GOING = 2000;
/** However the ear hears the room, sent once the recognizer has had nothing new for this long. */
const QUIET_MAX = 5000;

/** Fillers ("ehmm", "emm", "hmm", "eh", "eee"): the user thinking, not the question. */
const FILLER = /^(e+h*m*|e+m+|h+m+|a+h*m+|u+m+)$/;
/** Words a question doesn't end on: what comes after them is still to be said. */
const LEADS_ON = new Set("dan terus trus lalu yang tapi tetapi kalau kalo atau karena soalnya misalnya dengan untuk buat sama dari ke di".split(" "));

/** Whether what the user said so far ends as if more is coming: on a filler, or a word that leads on. */
export function stillGoing(text: string): boolean {
  const last = words(text).pop();
  return !!last && (FILLER.test(last) || LEADS_ON.has(last));
}

/** What the user said without the fillers. */
export function dropFillers(text: string): string {
  return text
    .split(/\s+/)
    .filter((t) => {
      const w = words(t);
      return !(w.length === 1 && FILLER.test(w[0]));
    })
    .join(" ")
    .replace(/^[\s,.…]+|[\s,]+$/g, "")
    .trim();
}

/** A result begun this soon after the answer ended is its last words (ms): the recognizer is a moment behind. */
const ECHO_TAIL = 1200;
/** For this long after it ended (ms), what's plainly its words is its echo. */
const ECHO_GRACE = 3000;

// ---------------------------------------------------------------- the conversation's trace

/**
 * What conversation mode heard and decided, and the ear's levels while the answer plays, kept on
 * this machine (server: data/astro-chat/voice-log.jsonl) to see why it went wrong when it does.
 */
let tracing = false;
const trace: Record<string, unknown>[] = [];
function note(ev: string, data: Record<string, unknown> = {}): void {
  if (tracing && trace.length < 3000) trace.push({ t: Date.now(), ev, ...data });
}
function flushTrace(): void {
  if (!trace.length) return;
  const entries = trace.splice(0);
  void fetch("/api/astro-voice/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }) }).catch(() => undefined);
}

/**
 * Conversation mode: the microphone stays on until it's switched off (the 🎤 again). What the user
 * says goes to `onText` as it's heard and to `onUtterance` once they've been quiet a moment (longer
 * after "ehmm" or a word that leads on); the assistant's voice is stopped the moment the user starts
 * talking over it (barge-in), and what's only its own voice heard back is ignored. The recognizer is
 * restarted whenever the browser ends it (silence, its time limit). Returns the switch-off.
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
  // The words heard but not settled yet (the recognizer may still change them).
  let pending = "";
  let lastHeard = 0;
  let pause: ReturnType<typeof setTimeout> | undefined;
  let restarts = 0;
  // The user has cut in, or is talking: what follows is theirs until they pause, not checked for echo.
  let floor = false;
  let floorAt = 0;
  // The recognizer's results by their slot in its list: those begun as the answer's echo stay its
  // echo however late their words settle; those the user's stay theirs; the one a stop word was
  // heard in counts from after that word.
  let echoSlots = new Set<number>();
  let userSlots = new Map<number, number>();
  let cutSlot = -1;
  tracing = true;
  note("on", { ear: earState() });
  const tracer = window.setInterval(() => {
    if (assistantSpeaking() || sinceVoice() < 3000) note("ear", earState());
  }, 250);
  const flusher = window.setInterval(flushTrace, 3000);
  const commit = (why: string) => {
    clearTimeout(pause);
    const text = dropFillers(`${buffer} ${pending}`);
    const unsettled = Boolean(pending);
    buffer = "";
    pending = "";
    floor = false;
    note("send", { text, why, unsettled });
    if (text) h.onUtterance(text);
    // Words still unsettled went with it: the recognizer is started afresh, so they don't come in
    // again, settled, as a message of their own.
    if (unsettled && on) r?.abort();
  };
  /** Sends once the user has been quiet long enough: by the ear when it's open, else by the words. */
  const waitToSend = () => {
    clearTimeout(pause);
    const check = () => {
      if (!on) return;
      const text = `${buffer} ${pending}`.trim();
      if (!text) return;
      const now = Date.now();
      const going = stillGoing(text);
      const quietWords = now - lastHeard;
      const ear = earOpen() ? sinceVoice(now) : null;
      const need = (ear === null ? QUIET_NO_EAR : QUIET_TO_SEND) + (going ? STILL_GOING : 0);
      if (ear === null ? quietWords >= need : ear >= need && quietWords >= 500) return commit(going ? "quiet, after a lead-on" : "quiet");
      if (quietWords >= QUIET_MAX + (going ? STILL_GOING : 0)) return commit("no new words");
      pause = setTimeout(check, 150);
    };
    pause = setTimeout(check, 150);
  };
  const start = () => {
    if (!on) return;
    r = new R();
    echoSlots = new Set();
    userSlots = new Map();
    cutSlot = -1;
    r.lang = LANG;
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const speaking = speakingId !== null;
      const sinceEnd = Date.now() - endedAt;
      // An answer begun since the user last had the floor: what they said is done; from here on
      // what's heard is its echo again.
      if (floor && floorAt < spokeFrom) floor = false;
      let interim = "";
      let finals = "";
      const decided: string[] = [];
      const take = (i: number, why: string) => {
        userSlots.set(i, Date.now());
        floor = true;
        floorAt = Date.now();
        if (why) decided.push(why);
      };
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        let said = res[0].transcript;
        // An empty result is nobody's (the recognizer sends them now and then).
        if (!said.trim()) continue;
        // The user's from before this answer, still being added to while it reads: the answer's
        // echo running on in it.
        const mine = userSlots.get(i);
        if (mine !== undefined && speaking && mine < spokeFrom) {
          userSlots.delete(i);
          echoSlots.add(i);
        }
        if (echoSlots.has(i)) {
          // The recognizer doesn't split the user's voice from the echo it runs into: a word that
          // means stop, heard in the echo's own result, still stops it.
          if (!speaking || stopWordAt(said, hearing) < 0) {
            decided.push(`e: ${said}`);
            continue;
          }
          echoSlots.delete(i);
          stopSpeaking();
          cutSlot = i;
          take(i, `stop: ${said}`);
        } else if (!floor && !userSlots.has(i)) {
          if (speaking) {
            // While it reads, all the microphone hears is taken for its echo (it's as loud there as
            // the user, and comes out garbled), unless a word that means stop is heard.
            if (stopWordAt(said, hearing) < 0) {
              echoSlots.add(i);
              decided.push(`echo: ${said}`);
              continue;
            }
            stopSpeaking();
            cutSlot = i;
            take(i, `stop: ${said}`);
          } else if (hearing && sinceEnd < ECHO_TAIL) {
            // Begun just as it ended: its last words, the recognizer being a moment behind.
            echoSlots.add(i);
            decided.push(`tail: ${said}`);
            continue;
          } else if (hearing && sinceEnd < ECHO_GRACE && isEcho(said, hearing)) {
            echoSlots.add(i);
            decided.push(`late echo: ${said}`);
            continue;
          } else take(i, "");
        }
        // What's said after the word that stopped it is the user's question.
        if (i === cutSlot) said = afterStopWord(said, hearing);
        if (res.isFinal) finals += `${said} `;
        else interim += `${said} `;
      }
      note("heard", { text: `${finals}${interim}`.trim(), final: Boolean(finals), speaking, floor, decided, hearing: hearing.slice(0, 200), ear: earState() });
      if (!`${finals}${interim}`.trim()) return;
      restarts = 0;
      lastHeard = Date.now();
      if (finals.trim()) buffer = `${buffer} ${finals.trim()}`.trim();
      pending = interim.trim();
      h.onText(`${buffer} ${pending}`.trim());
      waitToSend();
    };
    r.onerror = (e) => {
      note("error", { error: e.error });
      if (e.error === "no-speech" || e.error === "aborted") return;
      stop();
      h.onError(LISTEN_ERRORS[e.error] ?? `Pengenalan suara gagal (${e.error}).`);
    };
    r.onend = () => {
      if (!on) return;
      // The browser ends it on silence and after a while: again, unless it keeps failing at once.
      if (++restarts > 20) {
        stop();
        h.onError("Mikrofon berhenti berulang kali; klik 🎤 untuk mencoba lagi.");
        return;
      }
      setTimeout(start, 250);
    };
    try {
      r.start();
      h.onListening?.(true);
    } catch (err) {
      stop();
      h.onError(`Pengenalan suara tidak bisa dimulai: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  /** Off: the recognizer, the ear, the trace (what's left of it sent). */
  const stop = () => {
    on = false;
    clearTimeout(pause);
    window.clearInterval(tracer);
    window.clearInterval(flusher);
    note("off");
    flushTrace();
    tracing = false;
    closeEar();
    h.onListening?.(false);
  };
  start();
  // The second ear, to tell the user's voice from the answer's (without it, the words alone tell).
  void openEar().then((open) => {
    note("ear open", { open });
    if (open && !on) closeEar();
  });
  return () => {
    if (!on) return;
    commit("switched off");
    r?.abort();
    stop();
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
    audio.onplaying = null;
    audio.pause();
    audio = null;
  }
  stopHearingPlayback();
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
  note("speak", { engine: "eleven", pieces: parts.length });
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
    nowSaying(parts, i);
    // Its sound to the ear as it plays, to tell its echo from the user (ear.ts).
    a.onplaying = () => {
      if (audio === a) note("playing", { piece: i, heard: hearPlayback(a) });
    };
    a.play().catch(() => play(i + 1));
  };
  void play(0);
}
