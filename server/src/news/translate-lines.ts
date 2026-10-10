// The translation service's side of server/src/news/translate.ts that needs no database: texts go
// in batches joined by line breaks, and the reply's lines come back in the same order.

/** Texts per request: joined by line breaks, which the service keeps. */
const BATCH_CHARS = 3500;

export const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** The lines of the service's reply: its segments' translations, joined. */
export function linesOf(reply: unknown): string[] {
  const segments = Array.isArray(reply) && Array.isArray(reply[0]) ? (reply[0] as unknown[]) : [];
  const text = segments.map((s) => (Array.isArray(s) && typeof s[0] === "string" ? s[0] : "")).join("");
  return text.replace(/\n$/, "").split("\n").map(clean);
}

/** Groups of texts whose joined length stays under the request limit. */
export function batches(texts: string[], max = BATCH_CHARS): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of texts) {
    if (cur.length && len + t.length + 1 > max) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(t);
    len += t.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

