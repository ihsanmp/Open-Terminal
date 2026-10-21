import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { dataDir } from "../db.js";

// The research journal and the trade plans (Notepad, Nodes Plan), kept on disk in data/journal/:
// the page sends its whole list after each change and reads it back on opening, so they survive
// a cleared browser and are shared by every window. Each kind is a JSON array of objects with an
// id; written to a temporary file first, the copy before kept as <kind>.prev.json.

const dir = join(dataDir, "journal");
export const KINDS = ["notes", "plans"] as const;
export type Kind = (typeof KINDS)[number];
const MAX_ITEMS = 5000;

const fileOf = (kind: Kind) => join(dir, `${kind}.json`);

export function isList(v: unknown): v is Array<{ id: string }> {
  return Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
}

export function readList(kind: Kind): Array<{ id: string }> {
  for (const f of [fileOf(kind), join(dir, `${kind}.prev.json`)]) {
    try {
      if (!existsSync(f)) continue;
      const v = JSON.parse(readFileSync(f, "utf8"));
      if (isList(v)) return v;
    } catch {
      // damaged: try the copy before
    }
  }
  return [];
}

export function writeList(kind: Kind, list: Array<{ id: string }>): void {
  mkdirSync(dir, { recursive: true });
  const f = fileOf(kind);
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(list));
  if (existsSync(f)) renameSync(f, join(dir, `${kind}.prev.json`));
  renameSync(tmp, f);
}

export const journalRouter = Router();

journalRouter.get("/:kind", (req, res) => {
  const kind = req.params.kind as Kind;
  if (!KINDS.includes(kind)) return res.status(404).json({ error: "unknown list" });
  res.json(readList(kind));
});

journalRouter.put("/:kind", (req, res) => {
  const kind = req.params.kind as Kind;
  if (!KINDS.includes(kind)) return res.status(404).json({ error: "unknown list" });
  if (!isList(req.body)) return res.status(400).json({ error: "expected an array of items with an id" });
  try {
    writeList(kind, req.body);
    res.json({ ok: true, count: req.body.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
