import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "eleven-"));
const { apiKey, config, DEFAULT_VOICE, explain, requestBody, saveConfig, saveKey, transcribe } = await import("./elevenlabs.js");

describe("the ElevenLabs voice", () => {
  it("starts on the user's designed voice and v3, and keeps what's set", () => {
    expect(config()).toEqual({ voiceId: DEFAULT_VOICE, model: "eleven_v3" });
    expect(saveConfig({ voiceId: "abcdefghijklmnopqrst" }).voiceId).toBe("abcdefghijklmnopqrst");
    expect(config().model).toBe("eleven_v3");
  });

  it("keeps the key on the server, and forgets it on request", () => {
    expect(apiKey()).toBeNull();
    saveKey("sk_test_0123456789abcdefghij");
    expect(apiKey()).toBe("sk_test_0123456789abcdefghij");
    saveKey(null);
    expect(apiKey()).toBeNull();
  });

  it("says each mood with v3's audio tag and preset, or v2's finer settings", () => {
    const v3 = requestBody("Halo, aku di sini.", "antusias", "eleven_v3");
    expect(v3.text).toBe("[excited] Halo, aku di sini.");
    expect(v3.voice_settings).toEqual({ stability: 0 });
    const v2 = requestBody("Halo.", "menenangkan", "eleven_multilingual_v2") as { text: string; voice_settings: { speed: number; stability: number } };
    expect(v2.text).toBe("Halo.");
    expect(v2.voice_settings.speed).toBeLessThan(1);
    expect(v2.voice_settings.stability).toBeGreaterThan(0.5);
  });

  it("explains ElevenLabs' refusals in words", () => {
    expect(explain(401, '{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota"}}')).toMatch(/Kuota/);
    expect(explain(401, '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}')).toMatch(/tidak valid/);
    expect(explain(404, '{"detail":{"status":"voice_not_found"}}')).toMatch(/tidak ditemukan/);
    // A restricted key without Text to Speech: said as that, not as an invalid key.
    const missing = explain(401, '{"detail":{"type":"authentication_error","code":"unauthorized","message":"The API key you used is missing the permission text_to_speech to execute this operation.","status":"missing_permissions"}}');
    expect(missing).toMatch(/Text to Speech/);
    expect(missing).not.toMatch(/tidak valid/);
  });
});

describe("what the user said, by Scribe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    saveKey(null);
  });

  it("asks the newest model, and the one before when the API doesn't know it", async () => {
    saveKey("sk_test_0123456789abcdefghij");
    const models: string[] = [];
    const terms: number[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: FormData }) => {
      const model = String(init.body.get("model_id"));
      models.push(model);
      terms.push(init.body.getAll("keyterms").length);
      if (model === "scribe_v2") return new Response('{"detail":{"status":"invalid_model","message":"model scribe_v2 not found"}}', { status: 422 });
      return new Response(JSON.stringify({ text: "harga DXY naik, what do you think?", language_code: "ind" }), { status: 200 });
    });
    const r = await transcribe(Buffer.alloc(2000), "audio/wav");
    // v2 with the market's key terms, v2 without them, then v1.
    expect(models).toEqual(["scribe_v2", "scribe_v2", "scribe_v1"]);
    expect(terms[0]).toBeGreaterThan(50);
    expect(terms[0]).toBeLessThan(100);
    expect(terms.slice(1)).toEqual([0, 0]);
    expect(r).toEqual({ text: "harga DXY naik, what do you think?", language: "ind", model: "scribe_v1" });
  });

  it("says a key without Speech to Text as that", async () => {
    saveKey("sk_test_0123456789abcdefghij");
    vi.stubGlobal("fetch", async () => new Response('{"detail":{"message":"The API key you used is missing the permission speech_to_text to execute this operation.","status":"missing_permissions"}}', { status: 401 }));
    await expect(transcribe(Buffer.alloc(2000), "audio/wav")).rejects.toThrow(/Speech to Text/);
  });
});
