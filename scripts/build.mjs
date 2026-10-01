// Builds the API (server/) and the web app (web/) — only the ones whose sources changed since
// they were last built, both at once.
//
//   node scripts/build.mjs          build what changed (full checks: types, lint)
//   node scripts/build.mjs --fast   the desktop launcher's build: no type-check, lint or Docker
//                                   output (the code is checked before it's committed)
//   node scripts/build.mjs --check  exit 0 if everything is built, 1 if something isn't
//   node scripts/build.mjs --force  build both regardless
//
// A build records a hash of the sources it was made from in data/.build-<part>; tests, docs and
// other files that don't end up in the build don't count.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");

const bin = (rel) => join(root, "node_modules", rel);
const PARTS = {
  server: { paths: ["server"], output: "server/dist/index.js", cwd: "server", cmd: [bin("typescript/bin/tsc"), "-p", "."] },
  web: { paths: ["web"], output: "web/.next/BUILD_ID", cwd: "web", cmd: [bin("next/dist/bin/next"), "build"] },
};
const SHARED = ["package.json", "package-lock.json"];
const IGNORE = /(^|\/)(__tests__|docs)\/|\.test\.[jt]sx?$|\.md$|tsbuildinfo$|(^|\/)(vitest|eslint)\.config\./;

/** Hash of the files a part is built from: tracked and new files, not ignored ones. */
function sourceHash(paths) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths, ...SHARED], { cwd: root });
  const files = out.toString("utf8").split("\0").filter((f) => f && !IGNORE.test(f)).sort();
  const h = createHash("sha256");
  for (const f of files) {
    const full = join(root, f);
    if (!existsSync(full)) continue; // deleted but not yet committed
    h.update(f).update("\0").update(readFileSync(full)).update("\0");
  }
  return h.digest("hex");
}

const markerOf = (name) => join(root, "data", `.build-${name}`);
const stale = Object.entries(PARTS).filter(([name, part]) => {
  if (args.has("--force") || !existsSync(join(root, part.output))) return true;
  const marker = markerOf(name);
  return !existsSync(marker) || readFileSync(marker, "utf8").trim() !== sourceHash(part.paths);
});

if (args.has("--check")) {
  if (stale.length) console.log(`needs building: ${stale.map(([n]) => n).join(", ")}`);
  process.exit(stale.length ? 1 : 0);
}
if (!stale.length) {
  console.log("up to date");
  process.exit(0);
}

function build(name, part) {
  // Hashed before building, so an edit made meanwhile shows up as stale next time.
  const hash = sourceHash(part.paths);
  const started = Date.now();
  return new Promise((resolveBuild) => {
    const child = spawn(process.execPath, part.cmd, {
      cwd: join(root, part.cwd),
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...(fast ? { OPENTERMINAL_FAST_BUILD: "1" } : {}) },
    });
    child.on("exit", (code) => {
      if (code === 0) {
        mkdirSync(join(root, "data"), { recursive: true });
        writeFileSync(markerOf(name), hash);
      }
      console.log(`${name}: ${code === 0 ? "built" : `failed (${code})`} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      resolveBuild(code === 0);
    });
  });
}

const results = await Promise.all(stale.map(([name, part]) => build(name, part)));
process.exit(results.every(Boolean) ? 0 : 1);
