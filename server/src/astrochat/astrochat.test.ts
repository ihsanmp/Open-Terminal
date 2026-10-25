import { describe, expect, it } from "vitest";
import { cliArgs, imageMessage, parseOutput } from "./claude.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeFor, modelFor, systemPrompt, userPrompt } from "./prompt.js";

describe("the Astro chat's prompt", () => {
  it("carries the rules and the analyst's seeds from Crypto-Analis", () => {
    const s = systemPrompt();
    expect(s).toMatch(/DATA DIKUMPULKAN KODE/);
    expect(s).toMatch(/PROYEKSI BOLEH, RAMALAN TIDAK/);
    expect(s).toMatch(/ATURAN KALIBRASI/); // peran/inti.md
    expect(s.length).toBeGreaterThan(20_000);
  });

  it("picks the knowledge a question touches", () => {
    const files = (q: string) => knowledgeFor(q, "").map((k) => k.file);
    expect(files("bagaimana emas saat merkurius retrograde?")).toEqual(expect.arrayContaining(["astro_trading.md", "gold_drivers.md"]));
    expect(files("btc saat bulan purnama")).toEqual(expect.arrayContaining(["moon_phase_btc.md", "pola_btc.md"]));
    expect(files("narasi altcoin apa yang sedang rotasi")).toContain("naratif_rotasi.md");
    expect(files("halo")).toEqual([]);
    // Within its budget.
    const all = knowledgeFor("analisa btc emas minyak astro purnama narasi kalimasada jam sesi swing", "");
    expect(all.reduce((n, k) => n + k.text.length, 0)).toBeLessThanOrEqual(60_000);
  });

  it("marks a reply as one, and a new message as a new topic", () => {
    expect(userPrompt("kalau btc?", [{ role: "assistant", text: "Emas selama Merkurius retrograde…" }], "DATA", [])).toMatch(/# UTAS[\s\S]*ASISTEN: Emas[\s\S]*\(balasan\)/);
    expect(userPrompt("kalau btc?", [], "DATA", [])).toMatch(/\(topik baru\)/);
    expect(userPrompt("x", [], "DATA", [])).not.toMatch(/UTAS/);
  });

  it("picks the model by the question", () => {
    expect(modelFor("halo")).toBe("haiku");
    expect(modelFor("bagaimana emas minggu ini?")).toBe("sonnet");
    expect(modelFor("analisa mendalam btc vs emas")).toBe("opus");
  });
});

describe("the Claude Code CLI", () => {
  it("runs one turn with no tools, MCP, settings or session", () => {
    const a = cliArgs("sys.md", "sonnet");
    expect(a).toEqual(expect.arrayContaining(["-p", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]));
    expect(a[a.indexOf("--max-turns") + 1]).toBe("1");
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("");
    expect(a[a.indexOf("--system-prompt-file") + 1]).toBe("sys.md");
  });

  it("reads its JSON answer, and its errors", () => {
    expect(parseOutput('{"type":"result","result":"Halo!","is_error":false,"total_cost_usd":0.001,"modelUsage":{"claude-sonnet-5-5":{}}}')).toEqual({ text: "Halo!", model: "claude-sonnet-5-5", costUsd: 0.001, error: null });
    expect(parseOutput('{"result":"Not logged in · Please run /login","is_error":true}').error).toMatch(/login/);
    expect(parseOutput("").error).toBeTruthy();
  });

  it("asks with a picture of the screen as one stream-json message, and reads its result", () => {
    expect(cliArgs("sys.md", "sonnet", true)).toEqual(expect.arrayContaining(["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]));
    expect(cliArgs("sys.md", "sonnet")).not.toContain("stream-json");
    const dir = mkdtempSync(join(tmpdir(), "astro-"));
    const png = join(dir, "s.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const msg = JSON.parse(imageMessage("Apa yang terlihat?", [png]));
    expect(msg.type).toBe("user");
    expect(msg.message.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw==" } });
    expect(msg.message.content[1]).toEqual({ type: "text", text: "Apa yang terlihat?" });
    // stream-json answers with several messages: the result is read, whatever follows it.
    const out = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{}}', '{"type":"result","result":"Chart SOL/BTC.","is_error":false,"total_cost_usd":0.002,"modelUsage":{"claude-sonnet-5-5":{}}}', '{"type":"telemetry","x":1}'].join("\n");
    expect(parseOutput(out)).toMatchObject({ text: "Chart SOL/BTC.", model: "claude-sonnet-5-5", error: null });
  });

  it("puts the screen first in the question when there is one", () => {
    const q = userPrompt("lihat layar", [], "data", [], "Jendela: Chart — OpenTerminal");
    expect(q.indexOf("# LAYAR")).toBeLessThan(q.indexOf("# DATA"));
    expect(userPrompt("halo", [], "data", [])).not.toContain("# LAYAR");
  });
});
