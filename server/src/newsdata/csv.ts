// CSV for the news data (newsdata.ts): RFC 4180, a header row, one row a record keyed by a column.

export type Row = Record<string, string>;

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(columns: string[], rows: Row[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => quote(r[c] ?? "")).join(","))].join("\r\n") + "\r\n";
}

export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [head, ...body] = records.filter((r) => r.length > 1 || r[0] !== "");
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * The rows by key, the new over the old field by field: a field the new row leaves empty keeps
 * what was there (a broadcast's live transcript may be gone by the time its official text comes).
 * A row nothing changed in keeps its old `updated_at`, so the files only change where the data
 * does (they're committed to git every day).
 */
export function mergeRows(old: Row[], fresh: Row[], key: string): Row[] {
  const byKey = new Map(old.map((r) => [r[key], r]));
  for (const r of fresh) {
    const was = byKey.get(r[key]);
    if (!was) {
      byKey.set(r[key], r);
      continue;
    }
    const merged = { ...was, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")) };
    const changed = Object.keys(merged).some((k) => k !== "updated_at" && merged[k] !== was[k]);
    byKey.set(r[key], changed ? merged : was);
  }
  return [...byKey.values()];
}
