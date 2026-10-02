import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express, { Router } from "express";
import { dataDir } from "../db.js";

// A copy of the app's workspace (tabs, their pages, charts and settings, the watchlist) on disk,
// beside the browser's own copy: the page sends it a moment after every change and when a
// window closes, and reads it back when the browser has nothing saved (its storage cleared, a
// new browser profile). data/workspace.json, with the copy before it in workspace.prev.json.

const file = join(dataDir, "workspace.json");
const prev = join(dataDir, "workspace.prev.json");

type Saved = { savedAt: number; workspace: { state: { tabs: unknown[] }; version: number } };

export function isWorkspace(v: unknown): v is Saved["workspace"] {
  const w = v as Saved["workspace"] | null;
  return Boolean(w && typeof w === "object" && typeof w.version === "number" && w.state && Array.isArray(w.state.tabs) && w.state.tabs.length > 0);
}

export function readSaved(): Saved | null {
  for (const f of [file, prev]) {
    try {
      if (!existsSync(f)) continue;
      const saved = JSON.parse(readFileSync(f, "utf8")) as Saved;
      if (isWorkspace(saved.workspace)) return saved;
    } catch {
      // a damaged file: try the one before
    }
  }
  return null;
}

/** Written to a temporary file first, so a crash mid-write can't leave a half file. */
export function writeSaved(workspace: Saved["workspace"], now = Date.now()): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ savedAt: now, workspace }));
  if (existsSync(file)) renameSync(file, prev);
  renameSync(tmp, file);
}

export const workspaceRouter = Router();

// Its own body limit: a workspace with many tabs and indicators is larger than the default 100 kB.
workspaceRouter.use(express.json({ limit: "20mb", type: ["application/json", "text/plain"] }));

workspaceRouter.get("/", (_req, res) => {
  const saved = readSaved();
  if (!saved) {
    res.status(404).json({ error: "no saved workspace" });
    return;
  }
  res.json(saved);
});

// POST as well as PUT: a closing window sends it with navigator.sendBeacon, which only POSTs.
const save = (req: express.Request, res: express.Response) => {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!isWorkspace(body)) {
    res.status(400).json({ error: "not a workspace" });
    return;
  }
  writeSaved(body);
  res.status(204).end();
};
workspaceRouter.put("/", save);
workspaceRouter.post("/", save);
