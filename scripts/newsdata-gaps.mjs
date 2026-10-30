// The news data's gaps the scheduled Claude search should look for (data/newsdata/gaps.csv), one
// line each, short: only those the app couldn't fill itself (claude_ready=yes), not already in the
// inbox, not tried by the search in the last 20 hours and not given up on (three tries). Prints
// "0 gaps" when there's nothing to do, so the search can stop at once.
//
//   node scripts/newsdata-gaps.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.env.NEWSDATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data", "newsdata");

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

const gapsFile = join(dir, "gaps.csv");
if (!existsSync(gapsFile)) {
  console.log("0 gaps (no gaps.csv: the app hasn't run yet)");
  process.exit(0);
}
const statePath = join(dir, "claude-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};

const inInbox = new Set();
for (const d of ["inbox", join("inbox", "done")]) {
  const p = join(dir, d);
  if (!existsSync(p)) continue;
  for (const f of readdirSync(p)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(p, f), "utf8"));
      inInbox.add(j.event_key || `${j.title}|${j.date}`);
    } catch {
      /* not ours */
    }
  }
}

const now = Date.now();
const todo = parseCsv(readFileSync(gapsFile, "utf8")).filter((g) => {
  if (g.claude_ready !== "yes" || inInbox.has(g.key)) return false;
  const s = state[g.key];
  return !s || (s.tries < 3 && now - Date.parse(s.last) > 20 * 3_600_000);
});
console.log(`${todo.length} gaps`);
for (const g of todo.slice(0, 10)) console.log([g.key, g.kind, g.type, `${g.date_wib} WIB`, g.missing, g.hint].join(" | "));
