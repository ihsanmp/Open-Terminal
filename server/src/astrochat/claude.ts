// Claude for the Astro chat, the way ihsanmp/Crypto-Analis runs it: the Claude Code CLI on this
// machine (`claude -p`), signed in with the user's own Claude account, so no API key is needed.
// It's asked to interpret only: no tools, no MCP servers, no settings or project memory (an empty
// working folder), one turn. The data it reads was gathered by the app's code beforehand.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir } from "../db.js";

export type ClaudeModel = "haiku" | "sonnet" | "opus";
export type ClaudeReply = { text: string; model: string; ms: number; costUsd: number | null };

/** The CLI: CLAUDE_CLI, else on the PATH, else where its installer puts it. */
const CLI = process.env.CLAUDE_CLI || "claude";
const FALLBACK = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
/** An empty folder to run in: no CLAUDE.md or project settings to pick up. */
const cwd = join(dataDir, "astro-chat", "cwd");

let available: { ok: boolean; version: string | null; at: number } | null = null;

/** Whether the CLI is installed (asked once in ten minutes). */
export function cliStatus(): Promise<{ ok: boolean; version: string | null }> {
  if (available && Date.now() - available.at < 10 * 60_000) return Promise.resolve(available);
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(cliPath(), ["--version"], { windowsHide: true, shell: false });
    p.stdout.on("data", (c: Buffer) => (out += c.toString()));
    p.on("error", () => {
      available = { ok: false, version: null, at: Date.now() };
      resolve(available);
    });
    p.on("close", (code) => {
      available = { ok: code === 0, version: out.trim().split(/\s/)[0] || null, at: Date.now() };
      resolve(available);
    });
  });
}

const cliPath = () => (process.env.CLAUDE_CLI || !existsSync(FALLBACK) ? CLI : FALLBACK);

/**
 * The CLI's arguments: one printed turn, no tools, nothing loaded but the given system prompt (a
 * file: with the knowledge it runs far past Windows' ~32 000-character command line; the question
 * goes in on stdin for the same reason).
 */
export function cliArgs(systemFile: string, model: ClaudeModel, withImages = false): string[] {
  return [
    "-p",
    // With pictures the question goes in as a message of its own (text and images), which the CLI
    // takes only as stream-json, and answers as stream-json (the result last).
    ...(withImages ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["--output-format", "json"]),
    "--model", model,
    "--system-prompt-file", systemFile,
    "--tools", "",
    "--max-turns", "1",
    "--no-session-persistence",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
}

/** The answer out of the CLI's JSON (`result`), its model and cost. */
export function parseOutput(stdout: string): { text: string; model: string | null; costUsd: number | null; error: string | null } {
  const lines = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .reverse();
  // stream-json: the "result" message among the others; json: the one line.
  const line = lines.find((l) => /"type"\s*:\s*"result"/.test(l)) ?? lines[0];
  if (!line) return { text: "", model: null, costUsd: null, error: stdout.trim().slice(0, 300) || "no output" };
  try {
    const j = JSON.parse(line) as { result?: string; is_error?: boolean; total_cost_usd?: number; modelUsage?: Record<string, unknown>; subtype?: string };
    const model = j.modelUsage ? Object.keys(j.modelUsage)[0] ?? null : null;
    if (j.is_error || !j.result) return { text: j.result ?? "", model, costUsd: j.total_cost_usd ?? null, error: j.result || j.subtype || "error" };
    return { text: j.result, model, costUsd: j.total_cost_usd ?? null, error: null };
  } catch {
    return { text: "", model: null, costUsd: null, error: "unreadable output" };
  }
}

// One question at a time: the CLI is a process each, and the account's limits are shared.
let queue: Promise<unknown> = Promise.resolve();

/** The question as one stream-json message: each picture (PNG files), then the text. */
export function imageMessage(prompt: string, images: string[]): string {
  const content = [
    ...images.map((f) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(f).toString("base64") } })),
    { type: "text", text: prompt },
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

/** `images`: pictures to look at with the question (the app's window: astrochat/screen.ts). */
export function askClaude(prompt: string, system: string, model: ClaudeModel, timeoutMs = 150_000, images: string[] = []): Promise<ClaudeReply> {
  const run = () =>
    new Promise<ClaudeReply>((resolve, reject) => {
      if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
      const t0 = Date.now();
      // The system prompt by its content's hash: the same one is written once.
      const systemFile = join(dataDir, "astro-chat", `system-${createHash("sha1").update(system).digest("hex").slice(0, 12)}.md`);
      if (!existsSync(systemFile)) writeFileSync(systemFile, system);
      const p = spawn(cliPath(), cliArgs(systemFile, model, images.length > 0), { cwd, windowsHide: true, shell: false, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
      p.stdin.on("error", () => undefined);
      p.stdin.end(images.length ? imageMessage(prompt, images) : prompt);
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error(`Claude tidak menjawab dalam ${Math.round(timeoutMs / 1000)} detik`));
      }, timeoutMs);
      p.stdout.on("data", (c: Buffer) => (out += c.toString()));
      p.stderr.on("data", (c: Buffer) => (err += c.toString()));
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Claude Code CLI tidak bisa dijalankan: ${e.message}`));
      });
      p.on("close", () => {
        clearTimeout(timer);
        const r = parseOutput(out);
        if (r.error) reject(new Error(r.error.includes("login") || r.error.includes("auth") ? `Claude belum login: ${r.error}` : `${r.error}${err ? ` (${err.trim().slice(0, 200)})` : ""}`));
        else resolve({ text: r.text, model: r.model ?? model, ms: Date.now() - t0, costUsd: r.costUsd });
      });
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
