// The assistant's own voice, from ElevenLabs (the user's account and API key): an answer's text in,
// MP3 out, in the mood Claude marked it with. The key is kept in data/.elevenlabs-key (or the
// ELEVENLABS_API_KEY variable) and never leaves the server; the voice and model in data/elevenlabs.json.
// Each piece of speech is kept on disk by its text, voice and mood, so hearing it again costs nothing.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

const API = "https://api.elevenlabs.io/v1";
const KEY_FILE = join(dataDir, ".elevenlabs-key");
const CONFIG_FILE = join(dataDir, "elevenlabs.json");
const CACHE = join(dataDir, "astro-chat", "speech");
const KEEP = 200;

/** The voice the user designed for the assistant ("deredere"), until another is set. */
export const DEFAULT_VOICE = "B8tGvdoomnQGzmPJDRkC";
/** v3 is the most expressive (the voice was designed on it) and reads audio tags; multilingual v2 the fallback. */
export const MODELS = ["eleven_v3", "eleven_multilingual_v2"] as const;

export type Mood = "santai" | "antusias" | "menenangkan" | "tegas" | "lembut";
export type VoiceConfig = { voiceId: string; model: string };

export function apiKey(): string | null {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    const k = readFileSync(KEY_FILE, "utf8").trim();
    return k || null;
  } catch {
    return null;
  }
}

export function saveKey(key: string | null): void {
  if (key) writeFileSync(KEY_FILE, key.trim(), { mode: 0o600 });
  else rmSync(KEY_FILE, { force: true });
}

export function config(): VoiceConfig {
  try {
    const c = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<VoiceConfig>;
    return { voiceId: c.voiceId || DEFAULT_VOICE, model: c.model || MODELS[0] };
  } catch {
    return { voiceId: DEFAULT_VOICE, model: MODELS[0] };
  }
}

export function saveConfig(c: Partial<VoiceConfig>): VoiceConfig {
  const next = { ...config(), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) } as VoiceConfig;
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

export const VOICE_ID_RE = /^[A-Za-z0-9]{16,40}$/;

/** A failure ElevenLabs gave, in words the chat can show. */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What ElevenLabs' error body says, in Indonesian where it's one of the usual ones. */
export function explain(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body) as { detail?: { status?: string; message?: string } | string };
    detail = typeof j.detail === "string" ? j.detail : `${j.detail?.status ?? ""} ${j.detail?.message ?? ""}`.trim();
  } catch {
    detail = body.slice(0, 200);
  }
  if (/quota|credits/i.test(detail)) return "Kuota karakter ElevenLabs habis bulan ini.";
  // A restricted key without an endpoint's permission: which one, as the key's settings name it.
  const missing = /missing the permission ([a-z_]+)/i.exec(detail)?.[1] ?? (/missing_permissions/i.test(detail) ? "" : null);
  if (missing !== null) {
    const name: Record<string, string> = { text_to_speech: "Text to Speech → Access", voices_read: "Voices → Read" };
    return `API key ElevenLabs belum diberi izin ${name[missing] ?? (missing || "yang dibutuhkan")}. Ubah izin key itu di ElevenLabs (Developers → API Keys), atau buat key baru dengan izin tersebut.`;
  }
  if (status === 401 || /invalid_api_key|api key/i.test(detail)) return "API key ElevenLabs tidak valid.";
  if (/voice_not_found|voice.*not found/i.test(detail) || status === 404) return "Suara (voice ID) tidak ditemukan di akun ElevenLabs ini.";
  if (status === 429) return "ElevenLabs sedang membatasi permintaan; coba lagi sebentar.";
  return `ElevenLabs menolak (${status}${detail ? `: ${detail}` : ""}).`;
}

/**
 * How each mood is said. v3 takes an audio tag before the text and only the stability presets
 * (0 creative, 0.5 natural, 1 robust); multilingual v2 takes the finer settings.
 */
export const MOOD_VOICE: Record<Mood, { tag: string; v3Stability: number; stability: number; style: number; speed: number }> = {
  santai: { tag: "[warmly]", v3Stability: 0.5, stability: 0.45, style: 0.35, speed: 1.0 },
  antusias: { tag: "[excited]", v3Stability: 0, stability: 0.3, style: 0.6, speed: 1.08 },
  menenangkan: { tag: "[softly]", v3Stability: 0.5, stability: 0.6, style: 0.2, speed: 0.92 },
  tegas: { tag: "[calm]", v3Stability: 1, stability: 0.7, style: 0.1, speed: 0.95 },
  lembut: { tag: "[gently]", v3Stability: 0.5, stability: 0.65, style: 0.25, speed: 0.9 },
};

/** The request ElevenLabs gets for a piece of text, in a mood, on a model. */
export function requestBody(text: string, mood: Mood, model: string): Record<string, unknown> {
  const m = MOOD_VOICE[mood] ?? MOOD_VOICE.santai;
  if (model.startsWith("eleven_v3")) return { text: `${m.tag} ${text}`, model_id: model, voice_settings: { stability: m.v3Stability } };
  return { text, model_id: model, voice_settings: { stability: m.stability, similarity_boost: 0.8, style: m.style, use_speaker_boost: true, speed: m.speed } };
}

async function post(text: string, mood: Mood, model: string, key: string, voiceId: string): Promise<Buffer> {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(requestBody(text, mood, model)),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new VoiceError(explain(res.status, await res.text().catch(() => "")), res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Speech for a piece of an answer: from the disk if it was said before, else ElevenLabs. */
export async function speech(text: string, mood: Mood): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new VoiceError("API key ElevenLabs belum diisi.", 400);
  const { voiceId, model } = config();
  const id = createHash("sha1").update(`${voiceId}|${model}|${mood}|${text}`).digest("hex");
  const file = join(CACHE, `${id}.mp3`);
  if (existsSync(file)) return readFileSync(file);
  let audio: Buffer;
  try {
    audio = await post(text, mood, model, key, voiceId);
  } catch (err) {
    // A model this account can't use (v3 on some plans): the next one, and it's kept.
    const next = MODELS[MODELS.indexOf(model as (typeof MODELS)[number]) + 1];
    if (!(err instanceof VoiceError) || !next || ![400, 403, 422].includes(err.status) || /kuota|tidak valid|tidak ditemukan/.test(err.message)) throw err;
    audio = await post(text, mood, next, key, voiceId);
    saveConfig({ model: next });
  }
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, audio);
  prune();
  return audio;
}

/** Checks a key and a voice together (the voice must be in that account), before they're kept. */
export async function check(key: string, voiceId: string): Promise<{ name: string }> {
  const res = await fetch(`${API}/voices/${encodeURIComponent(voiceId)}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new VoiceError(explain(res.status, await res.text().catch(() => "")), res.status);
  const j = (await res.json()) as { name?: string };
  // And that the key may speak: a key restricted to reading voices passes the check above but
  // can't read an answer out (a few characters of the quota).
  const model = config().model;
  try {
    await post("Hai.", "santai", model, key, voiceId);
  } catch (err) {
    const next = MODELS[MODELS.indexOf(model as (typeof MODELS)[number]) + 1];
    if (!(err instanceof VoiceError) || !next || ![400, 403, 422].includes(err.status)) throw err;
    await post("Hai.", "santai", next, key, voiceId);
    saveConfig({ model: next });
  }
  return { name: j.name ?? voiceId };
}

/** Only the latest pieces of speech are kept. */
function prune(): void {
  try {
    const files = readdirSync(CACHE)
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => ({ f, t: statSync(join(CACHE, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP)) rmSync(join(CACHE, f), { force: true });
  } catch {
    // nothing to tidy
  }
}
