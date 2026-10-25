import { Router } from "express";
import { gather } from "../astrochat/brief.js";
import { askClaude, cliStatus } from "../astrochat/claude.js";
import { knowledgeFor, modelFor, splitTone, systemPrompt, userPrompt, type Turn } from "../astrochat/prompt.js";
import { captureScreen, screensDir, type ScreenResult } from "../astrochat/screen.js";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

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

// The look at the screen, taken first: the client hides the chat's own panel for it, then asks
// with the picture's id.
astroChatRouter.post("/screen", async (req, res) => {
  const shot = await captureScreen(text(req.body?.title, 300));
  res.json({ id: shot.screen ? basename(shot.screen.file) : null, reason: shot.reason, width: shot.screen?.width ?? null, height: shot.screen?.height ?? null });
});

/** A picture taken by /screen, by its id (nothing else in the folder, nothing outside it). */
function takenShot(id: unknown): ScreenResult | null {
  if (typeof id !== "string" || !/^screen-\d+\.png$/.test(id)) return null;
  const file = join(screensDir, id);
  return existsSync(file) ? { screen: { file, width: 0, height: 0 }, reason: "ok" } : null;
}

astroChatRouter.post("/", async (req, res) => {
  const question = text(req.body?.question, 2000).trim();
  if (!question) return res.status(400).json({ error: "question required" });
  const thread: Turn[] = (Array.isArray(req.body?.thread) ? req.body.thread : [])
    .slice(-8)
    .map((t: { role?: string; text?: unknown }) => ({ role: t.role === "user" ? "user" : "assistant", text: text(t.text, 6000) }))
    .filter((t: Turn) => t.text);
  const offline = text(req.body?.offline, 20_000);
  // Asked to look at the screen: the app's window as a picture, and what the client read off it.
  const screen = req.body?.screen && typeof req.body.screen === "object" ? (req.body.screen as Record<string, unknown>) : null;
  // A picture is read by Sonnet at least.
  const asked = modelFor(question);
  const model = screen && asked === "haiku" ? "sonnet" : asked;
  try {
    // The picture taken for this question, else one taken now; when none could be had, why.
    const shot = !screen ? null : takenShot(screen.shot) ?? (screen.reason ? { screen: null, reason: screen.reason as ScreenResult["reason"] } : await captureScreen(text(screen.title, 300)));
    const data = await gather(question, offline);
    const knowledge = knowledgeFor(question, thread.map((t) => t.text).join("\n"));
    const look = screen ? screenSection(screen, shot) : undefined;
    // An answer that will be read out (asked by voice, or with 🔊 on) is said for the ear.
    const spoken = req.body?.spoken === true;
    const r = await askClaude(userPrompt(question, thread, data, knowledge, look, spoken), systemPrompt(), model, 150_000, shot?.screen ? [shot.screen.file] : []);
    // The tone Claude marked for the reader's voice, off the text shown.
    const { text: answer, tone } = splitTone(r.text);
    res.json({ text: answer, tone, model: r.model, ms: r.ms, knowledge: knowledge.map((k) => k.file), screen: shot ? shot.reason : null });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const WHY_NO_PICTURE: Record<ScreenResult["reason"], string> = {
  ok: "",
  none: "jendela aplikasi tidak ditemukan",
  minimized: "jendela aplikasi sedang diminimalkan",
  unsupported: "pengambilan gambar hanya ada di Windows",
  failed: "pengambilan gambar gagal",
};

/** The LAYAR part of the question: the window, whether its picture is attached, the chart, the text shown. */
function screenSection(screen: Record<string, unknown>, shot: ScreenResult | null): string {
  const pic = shot?.screen ? "terlampir" : `tidak ada (${WHY_NO_PICTURE[shot?.reason ?? "failed"] ?? "pengambilan gambar gagal"}); pakai teks di bawah`;
  return [
    `Jendela: ${text(screen.title, 300) || "OpenTerminal"}`,
    `Gambar: ${pic}`,
    screen.chart ? `KEADAAN CHART (persis dari aplikasi):\n${text(screen.chart, 4000)}` : "",
    screen.text ? `TEKS YANG TAMPIL (dibaca dari halaman):\n${text(screen.text, 12_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
