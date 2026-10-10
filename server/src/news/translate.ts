// English → Indonesian for the headlines the news recap quotes, through Google Translate's
// public web endpoint (no key). Each text is translated once and kept on disk; when the service
// can't be reached the text stays in English and is tried again on a later recap.
import { db } from "../db.js";
import { batches, clean, linesOf } from "./translate-lines.js";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t";

db.exec(`
CREATE TABLE IF NOT EXISTS translations (
  source TEXT NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (source, lang)
);
`);
const lookup = db.prepare("SELECT text FROM translations WHERE source = ? AND lang = 'id'");
const keep = db.prepare("INSERT OR REPLACE INTO translations (source, lang, text, at) VALUES (?, 'id', ?, ?)");

async function request(texts: string[]): Promise<string[] | null> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" },
    body: `q=${encodeURIComponent(texts.join("\n"))}`,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const lines = linesOf(await res.json());
  // A reply that doesn't line up with what was sent can't be matched back: none of it is used.
  return lines.length === texts.length && lines.every(Boolean) ? lines : null;
}

/** Indonesian for each text (the ones that couldn't be translated left out). */
export async function toIndonesian(texts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const raw of new Set(texts.map(clean).filter(Boolean))) {
    const hit = lookup.get(raw) as { text: string } | undefined;
    if (hit) out.set(raw, hit.text);
    else missing.push(raw);
  }
  const at = new Date().toISOString();
  for (const group of batches(missing)) {
    try {
      const lines = await request(group);
      if (!lines) continue;
      group.forEach((src, i) => {
        out.set(src, lines[i]);
        keep.run(src, lines[i], at);
      });
    } catch {
      // Offline or refused: these stay in English this time.
    }
  }
  return out;
}
