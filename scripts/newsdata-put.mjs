// Puts what the scheduled Claude search found into the news data's inbox (data/newsdata/inbox/), in
// the format the app reads (README.md there), without the text ever passing through the search's
// own context: the text is read from the downloaded file here. Also keeps the search's tries per
// gap (claude-state.json), so a gap it can't fill isn't looked for again and again.
//
//   node scripts/newsdata-put.mjs fed_text --key "<gap key>" --url <https source> --file <downloaded .pdf/.htm/.txt>
//   node scripts/newsdata-put.mjs release  --key "<gap key>" --url <https source> --actual 0.2 [--consensus 0.3] [--previous 0.2]
//   node scripts/newsdata-put.mjs miss     --key "<gap key>" --why "<why not found>"
//
// Prints one line: what was written, or why not.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.env.NEWSDATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data", "newsdata");
const [mode, ...rest] = process.argv.slice(2);
const arg = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const key = arg("key");
if (!["fed_text", "release", "miss"].includes(mode) || !key) {
  console.log("usage: newsdata-put.mjs fed_text|release|miss --key <gap key> …");
  process.exit(1);
}

const statePath = join(dir, "claude-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const note = (result) => {
  const s = state[key] ?? { tries: 0 };
  state[key] = { tries: s.tries + 1, last: new Date().toISOString(), result };
  writeFileSync(statePath, JSON.stringify(state, null, 1));
};

if (mode === "miss") {
  note(`miss: ${arg("why") ?? ""}`);
  console.log(`noted miss for ${key}`);
  process.exit(0);
}

const url = arg("url");
if (!url || !/^https:\/\//.test(url)) {
  console.log("--url must be https");
  process.exit(1);
}

/** The text of a downloaded file: a PDF through pdftotext, a page through its article (federalreserve.gov) or its tags stripped. */
function textOf(file) {
  if (/\.pdf$/i.test(file)) {
    const git = "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe";
    return execFileSync(existsSync(git) ? git : "pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 64 << 20 }).replace(/\f/g, "\n");
  }
  let html = readFileSync(file, "utf8");
  if (!/<html|<div|<p[ >]/i.test(html)) return html;
  const article = html.indexOf('id="article"');
  if (article >= 0) html = html.slice(article);
  const lines = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h\d|li|tr)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const share = lines.indexOf("Share");
  const end = lines.findIndex((l, k) => k > share && /^(Last Update|Back to Top)/.test(l));
  return lines.slice(share >= 0 ? share + 1 : 0, end > share ? end : undefined).join("\n\n");
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))) : [];
}

const row = existsSync(join(dir, "gaps.csv")) ? parseCsv(readFileSync(join(dir, "gaps.csv"), "utf8")).find((g) => g.key === key) : null;
const gap = row ? { dateUtc: row.date_utc, title: row.title, type: row.type } : null;
if (!gap) {
  console.log(`no gap with key ${key} in gaps.csv`);
  process.exit(1);
}

let item;
if (mode === "fed_text") {
  const file = arg("file");
  if (!file || !existsSync(file)) {
    console.log("--file missing");
    process.exit(1);
  }
  const text = textOf(file).trim();
  const words = text.split(/\s+/).length;
  if (words < 80) {
    note(`too short (${words} words) from ${url}`);
    console.log(`not written: only ${words} words in ${file}`);
    process.exit(0);
  }
  item = { type: "fed_text", event_key: key, title: gap.title, date: gap.dateUtc, kind: gap.type, text, source_url: url, retrieved_at: new Date().toISOString(), by: "claude" };
} else {
  const n = (v) => (v === undefined ? null : Number(v));
  const actual = n(arg("actual"));
  if (actual === null || !Number.isFinite(actual)) {
    console.log("--actual must be a number");
    process.exit(1);
  }
  item = { type: "release", title: gap.title, date: gap.dateUtc, actual, consensus: n(arg("consensus")), previous: n(arg("previous")), source_url: url, retrieved_at: new Date().toISOString(), by: "claude" };
}

const inbox = join(dir, "inbox");
mkdirSync(inbox, { recursive: true });
const name = `${String(gap.dateUtc).slice(0, 10)}_${String(gap.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.json`;
writeFileSync(join(inbox, `${name}.tmp`), JSON.stringify(item, null, 1));
renameSync(join(inbox, `${name}.tmp`), join(inbox, name));
note(`written ${name}`);
console.log(`written inbox/${name}${item.text ? ` (${item.text.split(/\s+/).length} words)` : ""}`);
