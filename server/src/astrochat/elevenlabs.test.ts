import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "eleven-"));
const { apiKey, config, DEFAULT_VOICE, explain, requestBody, saveConfig, saveKey } = await import("./elevenlabs.js");

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
