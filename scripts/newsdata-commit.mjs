// Commits and pushes the news data (data/newsdata/, its inbox ignored) for the scheduled Claude
// task, and nothing else: a pathspec commit, so whatever else is staged stays staged. Skips quietly
// when there's no data yet (the app hasn't run) or nothing changed, and stops when git is in the
// middle of a merge or rebase. Prints one line.
//
//   node scripts/newsdata-commit.mjs

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

if (!existsSync(join(repo, "data", "newsdata", "releases.csv"))) {
  console.log("lewati: data/newsdata belum ada (Parallax belum pernah dibuka sejak fitur ini)");
  process.exit(0);
}
const gitDir = git("rev-parse", "--git-dir");
const abs = (p) => (/^[a-zA-Z]:|^\//.test(p) ? p : join(repo, p));
if (["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].some((f) => existsSync(join(abs(gitDir), f)))) {
  console.log("berhenti: git sedang di tengah merge/rebase, data tidak di-commit");
  process.exit(0);
}
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") {
  console.log("berhenti: repo tidak sedang di branch main");
  process.exit(0);
}
git("add", "--", "data/newsdata");
const changed = git("diff", "--cached", "--name-only", "--", "data/newsdata");
if (!changed) {
  console.log("tidak ada perubahan");
  process.exit(0);
}
const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
git("commit", "-q", "-m", `News data: ${day}`, "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "--", "data/newsdata");
const sha = git("rev-parse", "--short", "HEAD");
try {
  git("push", "-q", "origin", "main");
  console.log(`commit ${sha} (${changed.split("\n").length} berkas) di-push ke origin/main`);
} catch (err) {
  console.log(`commit ${sha} dibuat, tetapi push gagal: ${String(err.stderr ?? err.message).split("\n")[0]}`);
}
