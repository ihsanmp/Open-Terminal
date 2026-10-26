"use client";

// ElevenLabs' realtime Scribe, the page's side: a single-use token from the app's server (the key
// stays there), a WebSocket straight to ElevenLabs, the echo-cancelled microphone streamed as
// 16-bit PCM, and what it writes back as it hears it (partial) and once a stretch of speech has
// ended (committed, after 1.5 s of quiet, by its own voice detection). It hears Indonesian and
// English as said, and what leaks of the assistant's voice through the echo cancellation comes
// out of it as nothing.

const URL_BASE = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
/** The PCM rates it takes; any other is brought to 16 kHz. */
const RATES = [8000, 16000, 22050, 24000, 44100, 48000];

export type Live = {
  /** Sends the microphone's samples (floats or 16-bit, at the rate it was opened with). */
  send(samples: Float32Array | Int16Array): void;
  close(): void;
};

export type LiveHandlers = {
  partial(text: string): void;
  committed(text: string): void;
  /** fatal: not to be tried again (the key not allowed, no quota). */
  failed(message: string, fatal: boolean): void;
  closed(): void;
};

/** Message types that mean it won't work however often it's tried. */
const FATAL = new Set(["auth_error", "quota_exceeded", "unaccepted_terms"]);

const toInt16 = (f: Float32Array) => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
  return out;
};

/** Down to 16 kHz, each sample the average of the ones it stands for (only for a rate it doesn't take). */
function to16k(s: Int16Array, from: number): Int16Array {
  const step = from / 16000;
  const out = new Int16Array(Math.floor(s.length / step));
  for (let o = 0; o < out.length; o++) {
    const a = Math.floor(o * step);
    const b = Math.max(a + 1, Math.floor((o + 1) * step));
    let sum = 0;
    for (let i = a; i < b; i++) sum += s[i];
    out[o] = sum / (b - a);
  }
  return out;
}

function base64(s: Int16Array): string {
  const bytes = new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Opens a stream at the microphone's `rate`; null (and `failed` told) when it can't be. */
export async function openLive(rate: number, h: LiveHandlers): Promise<Live | null> {
  let token: string;
  let keyterms: string[];
  try {
    const r = await fetch("/api/astro-voice/live-token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { token?: string; keyterms?: string[]; error?: string };
    if (!r.ok || !j.token) {
      h.failed(j.error ?? `token ElevenLabs gagal (${r.status})`, r.status === 400);
      return null;
    }
    token = j.token;
    keyterms = j.keyterms ?? [];
  } catch (err) {
    h.failed(err instanceof Error ? err.message : String(err), false);
    return null;
  }
  const sendRate = RATES.includes(rate) ? rate : 16000;
  const qs = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    token,
    audio_format: `pcm_${sendRate}`,
    commit_strategy: "vad",
    vad_silence_threshold_secs: "1.5",
    no_verbatim: "true",
  });
  for (const t of keyterms) qs.append("keyterms", t);
  const ws = new WebSocket(`${URL_BASE}?${qs}`);
  const queue: string[] = [];
  let open = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    h.closed();
  };
  ws.onopen = () => {
    open = true;
    for (const m of queue.splice(0)) ws.send(m);
  };
  ws.onmessage = (ev) => {
    let m: { message_type?: string; text?: string; error?: string; warning?: string };
    try {
      m = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (m.message_type === "partial_transcript") h.partial(m.text ?? "");
    else if (m.message_type === "committed_transcript") h.committed(m.text ?? "");
    else if (m.message_type && m.message_type !== "session_started" && m.message_type !== "warning" && m.error !== undefined) {
      h.failed(`${m.message_type}: ${m.error}`, FATAL.has(m.message_type));
      ws.close();
    }
  };
  ws.onerror = () => {
    if (!open) h.failed("koneksi ke ElevenLabs gagal", false);
  };
  ws.onclose = finish;
  return {
    send(samples) {
      if (done) return;
      let s = samples instanceof Float32Array ? toInt16(samples) : samples;
      if (sendRate !== rate) s = to16k(s, rate);
      if (!s.length) return;
      const msg = JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: base64(s), commit: false, sample_rate: sendRate });
      if (open) ws.send(msg);
      else queue.push(msg);
    },
    close() {
      try {
        ws.close();
      } catch {
        // already
      }
      finish();
    },
  };
}
