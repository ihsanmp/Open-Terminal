import { Router } from "express";
import { gather } from "../astrochat/brief.js";
import { askClaude, cliStatus } from "../astrochat/claude.js";
import { knowledgeFor, modelFor, systemPrompt, userPrompt, type Turn } from "../astrochat/prompt.js";

// The Astro chat's online mode: the question, the thread it replies to and the app's offline answer
// in; the data gathered here, the knowledge it touches, and Claude's answer (the Claude Code CLI on
// this machine, the user's own account) out. When Claude can't answer, the client shows its offline
// answer instead.

export const astroChatRouter = Router();

astroChatRouter.get("/status", async (_req, res) => {
  const s = await cliStatus();
  res.json({ claude: s.ok, version: s.version });
});

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

astroChatRouter.post("/", async (req, res) => {
  const question = text(req.body?.question, 2000).trim();
  if (!question) return res.status(400).json({ error: "question required" });
  const thread: Turn[] = (Array.isArray(req.body?.thread) ? req.body.thread : [])
    .slice(-8)
    .map((t: { role?: string; text?: unknown }) => ({ role: t.role === "user" ? "user" : "assistant", text: text(t.text, 6000) }))
    .filter((t: Turn) => t.text);
  const offline = text(req.body?.offline, 20_000);
  const model = modelFor(question);
  try {
    const data = await gather(question, offline);
    const knowledge = knowledgeFor(question, thread.map((t) => t.text).join("\n"));
    const r = await askClaude(userPrompt(question, thread, data, knowledge), systemPrompt(), model);
    res.json({ text: r.text, model: r.model, ms: r.ms, knowledge: knowledge.map((k) => k.file) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
