import { raw, Router } from "express";
import { apiKey, check, config, saveConfig, saveKey, LIVE_KEYTERMS, liveToken, speech, transcribe, VOICE_ID_RE, VoiceError, type Mood } from "../astrochat/elevenlabs.js";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../db.js";

// The assistant's ElevenLabs voice (astrochat/elevenlabs.ts): whether it's set up, the key and voice
// set from the ✦ Claude menu (the key is checked, kept on the server and never sent back), and an
// answer's speech. On its own limit: an answer is read in a few pieces.

export const astroVoiceRouter = Router();

const MOODS: Mood[] = ["santai", "antusias", "menenangkan", "tegas", "lembut"];

astroVoiceRouter.get("/", (_req, res) => {
  const c = config();
  res.json({ configured: Boolean(apiKey()), fromEnv: Boolean(process.env.ELEVENLABS_API_KEY), voiceId: c.voiceId, model: c.model });
});

astroVoiceRouter.post("/", async (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  const voiceId = typeof req.body?.voiceId === "string" ? req.body.voiceId.trim() : config().voiceId;
  if (!VOICE_ID_RE.test(voiceId)) return res.status(400).json({ error: "Voice ID tidak valid." });
  const useKey = key || apiKey();
  if (!useKey) return res.status(400).json({ error: "Isi API key ElevenLabs dulu." });
  if (key && !/^[A-Za-z0-9_\-]{20,120}$/.test(key)) return res.status(400).json({ error: "Format API key tidak dikenali." });
  try {
    const { name } = await check(useKey, voiceId);
    if (key) saveKey(key);
    const c = saveConfig({ voiceId });
    res.json({ configured: true, voiceId: c.voiceId, model: c.model, name });
  } catch (err) {
    res.status(err instanceof VoiceError && err.status < 500 ? 400 : 502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

astroVoiceRouter.delete("/key", (_req, res) => {
  saveKey(null);
  res.json({ configured: Boolean(apiKey()) });
});

// What conversation mode heard and decided (lib/astro-chat/voice.ts trace), kept on this machine
// only (data/astro-chat/voice-log.jsonl, the last ~2 MB), to see why it took the assistant's own
// voice for the user's, or sent before the user finished.
const LOG = join(dataDir, "astro-chat", "voice-log.jsonl");
const LOG_MAX = 2 * 1024 * 1024;
astroVoiceRouter.post("/log", (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 500) : [];
  if (!entries.length) return res.json({ ok: true });
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    if (existsSync(LOG) && statSync(LOG).size > LOG_MAX) renameSync(LOG, `${LOG}.old`);
    appendFileSync(LOG, entries.map((e: unknown) => JSON.stringify(e).slice(0, 4000)).join("\n") + "\n");
  } catch {
    // not kept
  }
  res.json({ ok: true });
});

// The realtime Scribe for conversation mode: a single-use token (the key stays here) and the key
// terms it's biased to; the page streams the microphone to ElevenLabs with them.
astroVoiceRouter.post("/live-token", async (_req, res) => {
  try {
    res.json({ token: await liveToken(), keyterms: LIVE_KEYTERMS });
  } catch (err) {
    res.status(err instanceof VoiceError && err.status < 500 ? 400 : 502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// What the user said in conversation mode, from its recording (a WAV of their turn), to Scribe.
astroVoiceRouter.post("/transcribe", raw({ type: ["audio/*", "application/octet-stream"], limit: "8mb" }), async (req, res) => {
  const audio = Buffer.isBuffer(req.body) ? req.body : null;
  if (!audio || audio.length < 1000) return res.status(400).json({ error: "audio required" });
  try {
    res.json(await transcribe(audio, req.get("content-type") ?? "audio/wav"));
  } catch (err) {
    res.status(err instanceof VoiceError && err.status < 500 ? 400 : 502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

astroVoiceRouter.post("/speech", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2500) : "";
  if (!text) return res.status(400).json({ error: "text required" });
  const mood: Mood = MOODS.includes(req.body?.tone) ? req.body.tone : "santai";
  try {
    const audio = await speech(text, mood);
    res.set("content-type", "audio/mpeg").set("cache-control", "no-store").send(audio);
  } catch (err) {
    res.status(err instanceof VoiceError && err.status < 500 ? 400 : 502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
