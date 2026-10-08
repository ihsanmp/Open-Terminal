import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataDir, db } from "../db.js";
import { readJournal, writeJournal, type JournalImage, type JournalRow } from "../journal/xlsx.js";

export const portfolioRouter = Router();

// Chart photos live beside the database, one file each, named by a random id.
const imageDir = join(dataDir, "journal-images");
mkdirSync(imageDir, { recursive: true });
const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpeg)$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Entry = JournalRow & { id: number; portfolio_id: number; chart_image: string | null; created_at: string };

/** A PNG or JPEG by its first bytes; anything else isn't kept. */
function imageExt(data: Buffer): "png" | "jpeg" | null {
  if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  return null;
}
function saveImage(img: JournalImage): string {
  const name = `${randomUUID()}.${img.ext}`;
  writeFileSync(join(imageDir, name), img.data);
  return name;
}
function removeImage(name: string | null) {
  if (name && IMAGE_NAME.test(name)) rmSync(join(imageDir, name), { force: true });
}

portfolioRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM portfolios ORDER BY id").all());
});

portfolioRouter.post("/", (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const info = db.prepare("INSERT INTO portfolios (name) VALUES (?)").run(parsed.data.name);
    res.status(201).json({ id: info.lastInsertRowid, name: parsed.data.name });
  } catch {
    res.status(409).json({ error: "portfolio name already exists" });
  }
});

portfolioRouter.delete("/:id", (req, res) => {
  const images = db.prepare("SELECT chart_image FROM journal_entries WHERE portfolio_id = ?").all(req.params.id) as Array<{ chart_image: string | null }>;
  db.prepare("DELETE FROM journal_entries WHERE portfolio_id = ?").run(req.params.id);
  db.prepare("DELETE FROM transactions WHERE portfolio_id = ?").run(req.params.id);
  db.prepare("DELETE FROM portfolios WHERE id = ?").run(req.params.id);
  images.forEach((i) => removeImage(i.chart_image));
  res.status(204).end();
});

// ---- the journal ----

const text = z.string().max(4000).default("");
const entrySchema = z.object({
  traded_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  symbol: z.string().trim().min(1).max(40).transform((s) => s.toUpperCase()),
  side: z.enum(["BUY", "SELL"]).nullable().default(null),
  quantity: z.number().positive().nullable().default(null),
  price: z.number().nonnegative().nullable().default(null),
  reason: text,
  emotion_before: text,
  emotion_after: text,
  grade: z.number().int().min(1).max(5).nullable().default(null),
  lesson: text,
  chart_url: z
    .string()
    .max(2000)
    .regex(/^https?:\/\//i, "chart link must start with http(s)://")
    .nullable()
    .default(null)
    .or(z.literal("").transform(() => null)),
});
const FIELDS = ["traded_at", "symbol", "side", "quantity", "price", "reason", "emotion_before", "emotion_after", "grade", "lesson", "chart_url"] as const;

const entryOf = (pid: string, id: string | number) =>
  db.prepare("SELECT * FROM journal_entries WHERE id = ? AND portfolio_id = ?").get(id, pid) as Entry | undefined;

portfolioRouter.get("/:id/journal", (req, res) => {
  res.json(db.prepare("SELECT * FROM journal_entries WHERE portfolio_id = ? ORDER BY traded_at DESC, id DESC").all(req.params.id));
});

portfolioRouter.post("/:id/journal", (req, res) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  const e = parsed.data;
  const info = db
    .prepare(`INSERT INTO journal_entries (portfolio_id, ${FIELDS.join(", ")}) VALUES (?, ${FIELDS.map(() => "?").join(", ")})`)
    .run(req.params.id, ...FIELDS.map((f) => e[f]));
  res.status(201).json(entryOf(req.params.id, Number(info.lastInsertRowid)));
});

portfolioRouter.put("/:id/journal/:entryId", (req, res) => {
  if (!entryOf(req.params.id, req.params.entryId)) return res.status(404).json({ error: "no such entry" });
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  const e = parsed.data;
  db.prepare(`UPDATE journal_entries SET ${FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ? AND portfolio_id = ?`).run(
    ...FIELDS.map((f) => e[f]),
    req.params.entryId,
    req.params.id
  );
  res.json(entryOf(req.params.id, req.params.entryId));
});

portfolioRouter.delete("/:id/journal/:entryId", (req, res) => {
  const entry = entryOf(req.params.id, req.params.entryId);
  db.prepare("DELETE FROM journal_entries WHERE id = ? AND portfolio_id = ?").run(req.params.entryId, req.params.id);
  removeImage(entry?.chart_image ?? null);
  res.status(204).end();
});

// A chart photo, sent as base64 (the web proxy relays request bodies as text).
portfolioRouter.post("/:id/journal/:entryId/image", (req, res) => {
  const entry = entryOf(req.params.id, req.params.entryId);
  if (!entry) return res.status(404).json({ error: "no such entry" });
  const data = Buffer.from(String(req.body?.data ?? ""), "base64");
  if (data.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "image larger than 8 MB" });
  const ext = imageExt(data);
  if (!ext) return res.status(400).json({ error: "the chart photo must be a PNG or JPEG" });
  const name = saveImage({ data, ext });
  db.prepare("UPDATE journal_entries SET chart_image = ? WHERE id = ?").run(name, entry.id);
  removeImage(entry.chart_image);
  res.json(entryOf(req.params.id, req.params.entryId));
});

portfolioRouter.delete("/:id/journal/:entryId/image", (req, res) => {
  const entry = entryOf(req.params.id, req.params.entryId);
  if (!entry) return res.status(404).json({ error: "no such entry" });
  db.prepare("UPDATE journal_entries SET chart_image = NULL WHERE id = ?").run(entry.id);
  removeImage(entry.chart_image);
  res.json(entryOf(req.params.id, req.params.entryId));
});

portfolioRouter.get("/journal-images/:name", (req, res) => {
  const name = req.params.name;
  const path = join(imageDir, name);
  if (!IMAGE_NAME.test(name) || !existsSync(path)) return res.status(404).json({ error: "no such image" });
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(name.endsWith(".png") ? "image/png" : "image/jpeg").send(readFileSync(path));
});

/** The journal as an .xlsx in the template's layout, oldest entry first, photos in place. */
portfolioRouter.get("/:id/journal.xlsx", (req, res) => {
  const portfolio = db.prepare("SELECT name FROM portfolios WHERE id = ?").get(req.params.id) as { name: string } | undefined;
  if (!portfolio) return res.status(404).json({ error: "no such portfolio" });
  const rows = db.prepare("SELECT * FROM journal_entries WHERE portfolio_id = ? ORDER BY traded_at, id").all(req.params.id) as Entry[];
  const buf = writeJournal(
    rows,
    (i) => {
      const name = rows[i].chart_image;
      if (!name || !IMAGE_NAME.test(name)) return null;
      try {
        return { data: readFileSync(join(imageDir, name)), ext: name.endsWith(".png") ? "png" : "jpeg" };
      } catch {
        return null;
      }
    },
    { title: `TRADING JOURNAL — ${portfolio.name.toUpperCase()}`, exportedAt: new Date().toISOString().slice(0, 10) }
  );
  res.setHeader("Content-Disposition", `attachment; filename="trading-journal.xlsx"`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
});

/** Rows from an .xlsx laid out like the template (base64), added to the journal. */
portfolioRouter.post("/:id/journal/import", (req, res) => {
  if (!db.prepare("SELECT 1 FROM portfolios WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "no such portfolio" });
  let rows;
  try {
    rows = readJournal(Buffer.from(String(req.body?.data ?? ""), "base64"));
  } catch (err) {
    return res.status(400).json({ error: `Not a journal workbook: ${err instanceof Error ? err.message : String(err)}` });
  }
  const insert = db.prepare(
    `INSERT INTO journal_entries (portfolio_id, ${FIELDS.join(", ")}, chart_image) VALUES (?, ${FIELDS.map(() => "?").join(", ")}, ?)`
  );
  const saved: string[] = [];
  try {
    db.transaction(() => {
      for (const r of rows) {
        const image = r.image && r.image.data.length <= MAX_IMAGE_BYTES ? saveImage(r.image) : null;
        if (image) saved.push(image);
        insert.run(req.params.id, ...FIELDS.map((f) => r[f]), image);
      }
    })();
  } catch (err) {
    saved.forEach(removeImage);
    return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
  res.json({ imported: rows.length, photos: saved.length });
});

/** Holdings from the entries with a side, quantity and price (average-cost method). */
portfolioRouter.get("/:id/positions", (req, res) => {
  const txs = db
    .prepare(
      "SELECT * FROM journal_entries WHERE portfolio_id = ? AND side IS NOT NULL AND quantity IS NOT NULL AND price IS NOT NULL ORDER BY traded_at, id"
    )
    .all(req.params.id) as Array<{ symbol: string; side: string; quantity: number; price: number }>;

  const positions = new Map<string, { qty: number; avgCost: number; realizedPnl: number }>();
  for (const tx of txs) {
    let p = positions.get(tx.symbol);
    if (!p) {
      p = { qty: 0, avgCost: 0, realizedPnl: 0 };
      positions.set(tx.symbol, p);
    }
    if (tx.side === "BUY") {
      const totalCost = p.avgCost * p.qty + tx.price * tx.quantity;
      p.qty += tx.quantity;
      p.avgCost = p.qty > 0 ? totalCost / p.qty : 0;
    } else {
      const sold = Math.min(tx.quantity, p.qty);
      p.realizedPnl += (tx.price - p.avgCost) * sold;
      p.qty -= sold;
      if (p.qty === 0) p.avgCost = 0;
    }
  }
  res.json(
    [...positions.entries()]
      .filter(([, p]) => p.qty > 0 || p.realizedPnl !== 0)
      .map(([symbol, p]) => ({ symbol, quantity: p.qty, avgCost: p.avgCost, realizedPnl: p.realizedPnl }))
  );
});
