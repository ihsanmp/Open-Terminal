// The news data, kept as CSV in data/newsdata/ for every release and every Fed event, watched or not:
//
//   releases.csv   the big US releases (the macro engine's targets) since 2016: actual, consensus,
//                  previous, surprise, its side, the engine's call. From the economic calendar.
//   reactions.csv  what the markets did after each one, and after each Fed event: the first 30
//                  minutes and the day, by instrument. From TradingView's bars.
//   fed_events.csv each Fed event on the Board's calendar (FOMC statement and press conference,
//                  speeches, testimony): how much of it the app heard live (a broadcast followed in
//                  Live TV), its official text where there is one, and both read by the Fed lexicon.
//   gaps.csv       what is still missing: an event nobody watched in full and with no official text
//                  yet, a release without its actual. What Claude's scheduled search looks for.
//   texts/         the transcripts and texts themselves.
//   inbox/         where that search drops what it found (README.md has the format); read here,
//                  checked, kept with its source, then moved to inbox/done/ (or inbox/rejected/).
//
// The app fills everything it can itself (the calendar, the bars, the broadcasts it followed, the
// FOMC statement from federalreserve.gov); the search only fills the gaps, never overwrites the app's
// own readings, and every row says where it came from.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { findHits, indexOf, normalize, stanceOf } from "../providers/fedsentiment.js";
import { abroad, fedCalendar, type FedEvent } from "../providers/fedlive.js";
import type { Line } from "../providers/fedtranscript.js";
import { mergeRows, parseCsv, toCsv, type Row } from "./csv.js";

export const DIR = join(dataDir, "newsdata");
const TEXTS = join(DIR, "texts");
const INBOX = join(DIR, "inbox");
const TRANSCRIPTS = join(dataDir, "fed-transcripts");

export const COLUMNS = {
  releases: ["key", "date_utc", "date_wib", "target", "label", "title", "unit", "actual", "consensus", "previous", "surprise", "side", "engine_call", "source", "source_url", "updated_at"],
  reactions: ["key", "event_key", "event", "date_utc", "instrument", "span", "move", "unit", "source", "updated_at"],
  fed: [
    "key", "date_utc", "date_wib", "type", "kind", "title", "location",
    "live_from_utc", "live_to_utc", "live_minutes", "expected_minutes", "coverage", "live_lines", "live_hawkish", "live_dovish", "live_index", "live_file",
    "official_kind", "official_source", "official_url", "official_words", "official_hawkish", "official_dovish", "official_index", "official_file",
    "index", "stance", "index_from", "app_tries", "updated_at",
  ],
  gaps: ["key", "kind", "date_utc", "date_wib", "title", "type", "missing", "hint", "app_tries", "claude_ready", "since"],
} as const;

const iso = (ms: number) => new Date(ms).toISOString();
export const wib = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const num = (v: number | null | undefined, dp = 4) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(Math.round(v * 10 ** dp) / 10 ** dp));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function readRows(name: keyof typeof COLUMNS): Row[] {
  const f = join(DIR, `${name === "fed" ? "fed_events" : name}.csv`);
  try {
    return existsSync(f) ? parseCsv(readFileSync(f, "utf8")) : [];
  } catch {
    return [];
  }
}

function writeRows(name: keyof typeof COLUMNS, rows: Row[], sortBy = "date_utc"): void {
  mkdirSync(DIR, { recursive: true });
  const sorted = [...rows].sort((a, b) => (a[sortBy] ?? "").localeCompare(b[sortBy] ?? "") || (a.key ?? "").localeCompare(b.key ?? ""));
  writeFileSync(join(DIR, `${name === "fed" ? "fed_events" : name}.csv`), toCsv([...COLUMNS[name]], sorted));
}

/**
 * The chair's words in a press conference transcript ("CHAIRMAN WARSH. Good day." … "NICK
 * TIMIRAOS. Thank you …"): the reporters' questions read nothing about the Fed. A text without
 * such names, or without a chair among them, is read whole.
 */
export function chairsWords(text: string): string {
  const parts = text.split(/(?:^|\n)\s*([A-Z][A-Z.'\- ]{2,40}[A-Z])\.\s/);
  if (parts.length < 3) return text;
  const kept: string[] = [];
  for (let i = 1; i < parts.length; i += 2) if (/\bCHAIR/.test(parts[i])) kept.push(parts[i + 1] ?? "");
  return kept.length ? kept.join("\n") : text;
}

/** A text's hawkish and dovish phrases by the Fed lexicon, and its index. */
export function readText(text: string): { hawkish: number; dovish: number; index: number; words: number } {
  const hits = findHits(normalize(chairsWords(text).replace(/\s+/g, " ")));
  const hawkish = hits.filter((h) => h.side === 1).length;
  const dovish = hits.length - hawkish;
  return { hawkish, dovish, index: indexOf(hawkish, dovish), words: text.split(/\s+/).filter(Boolean).length };
}

// ---------------------------------------------------------------- Fed events

/** How long a Fed event of each kind usually runs, minutes: what "heard in full" is measured against. */
export function kindOf(e: Pick<FedEvent, "title" | "type">): { kind: string; minutes: number } {
  if (/press conference/i.test(e.title)) return { kind: "press_conference", minutes: 60 };
  if (/^FOMC Meeting/i.test(e.title)) return { kind: "statement", minutes: 0 };
  if (/minutes/i.test(e.title)) return { kind: "minutes", minutes: 0 };
  if (/testimony/i.test(e.type) || /testimony|semiannual/i.test(e.title)) return { kind: "testimony", minutes: 150 };
  return { kind: "speech", minutes: 45 };
}

/** The Fed's event types read here (statistical releases and Board meetings aren't news to read). */
const FED_TYPES = /^(Speeches|FOMC|Testimony|Conferences)$/;

export const fedKey = (e: Pick<FedEvent, "start" | "title">) => `${e.start.slice(0, 10)}|${e.title}`;

type Saved = { videoId: string; title: string; lines: Line[] };

function savedTranscripts(): Saved[] {
  if (!existsSync(TRANSCRIPTS)) return [];
  const out: Saved[] = [];
  for (const f of readdirSync(TRANSCRIPTS)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(TRANSCRIPTS, f), "utf8")) as Partial<Saved>;
      if (j.videoId && Array.isArray(j.lines) && j.lines.length) out.push({ videoId: j.videoId, title: j.title ?? "", lines: j.lines });
    } catch {
      /* a file being written */
    }
  }
  return out;
}

/**
 * What the app heard of an event live: the followed broadcasts' lines from a quarter hour before it
 * to the end of its usual length (three hours for an open-ended one), and the minutes they cover
 * (a pause of more than five minutes isn't counted: the panel was closed, or nothing was said).
 */
export function heardOf(lines: Line[], startMs: number, minutes: number): { lines: Line[]; minutes: number; from: number; to: number } | null {
  const end = startMs + (minutes || 180) * 60_000 + 30 * 60_000;
  const mine = lines.filter((l) => l.at >= startMs - 15 * 60_000 && l.at <= end).sort((a, b) => a.at - b.at);
  if (!mine.length) return null;
  let covered = 0;
  for (let i = 1; i < mine.length; i++) {
    const gap = mine[i].at - mine[i - 1].at;
    if (gap <= 5 * 60_000) covered += gap;
  }
  return { lines: mine, minutes: Math.round(covered / 60_000), from: mine[0].at, to: mine.at(-1)!.at };
}

/** The FOMC statement from federalreserve.gov: the press release's paragraphs, without the page around it. */
export function statementText(html: string): string | null {
  const i = html.indexOf('id="article"');
  if (i < 0) return null;
  const lines = html
    .slice(i, i + 60_000)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h\d|li)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = lines.findIndex((l) => /^The Federal Open Market Committee|^Recent indicators|^The Committee/i.test(l));
  const to = lines.findIndex((l, k) => k > from && /^For media inquiries|^Implementation Note|^Last Update/i.test(l));
  if (from < 0) return null;
  const text = lines.slice(from, to > from ? to : undefined).join("\n\n");
  return text.length > 200 ? text : null;
}

/**
 * A speech's, testimony's or minutes' text on federalreserve.gov: the article after its heading
 * (title, speaker, venue, "Share") to the end of the page's text.
 */
export function articleText(html: string): string | null {
  const i = html.indexOf('id="article"');
  if (i < 0) return null;
  const lines = html
    .slice(i)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h\d|li|tr)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const share = lines.findIndex((l) => l === "Share");
  let from = share >= 0 ? share + 1 : 1;
  while (from < lines.length && /^Watch (Live|Video)$|^Accessible Version|^PDF$/i.test(lines[from])) from++;
  const to = lines.findIndex((l, k) => k > from && /^(Last Update|Back to Top)/.test(l));
  const text = lines.slice(from, to > from ? to : undefined).join("\n\n");
  return text.split(/\s+/).length >= 80 ? text : null;
}

/** The US Eastern date of a moment, as the Board names its pages (yyyymmdd). */
export function easternDay(ms: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return p.replace(/-/g, "");
}

/** The speaker's surname in a calendar title ("Speech - Vice Chair for Supervision Michelle W. Bowman" → "bowman"). */
export const surnameOf = (title: string) => (title.split(/[,(]/)[0].trim().split(/\s+/).at(-1) ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Where the Board puts an event's official text, best guess first: the statement's press release,
 * the press conference's PDF transcript, the minutes (of the meeting two to four weeks before), a
 * speech's or a testimony's page (surname and Eastern date, "a" then "b" for a second one that day).
 */
export function officialUrls(r: Row, statements: string[]): string[] {
  const base = "https://www.federalreserve.gov";
  const at = Date.parse(r.date_utc);
  const day = easternDay(at);
  switch (r.kind) {
    case "statement":
      return [`${base}/newsevents/pressreleases/monetary${day}a.htm`];
    case "press_conference":
      return [`${base}/mediacenter/files/FOMCpresconf${day}.pdf`];
    case "minutes": {
      const meeting = statements.map((d) => Date.parse(d)).filter((m) => at - m > 13 * 86_400_000 && at - m < 30 * 86_400_000).sort((a, b) => b - a)[0];
      return meeting ? [`${base}/monetarypolicy/fomcminutes${easternDay(meeting)}.htm`] : [];
    }
    case "testimony":
    case "speech": {
      const who = surnameOf(r.title);
      if (!who) return [];
      const kind = r.kind === "testimony" ? "testimony" : "speech";
      return [`${base}/newsevents/${kind}/${who}${day}a.htm`, `${base}/newsevents/${kind}/${who}${day}b.htm`];
    }
    default:
      return [];
  }
}

/** The pdftotext that ships with Git for Windows, or one on the PATH. */
function pdftotext(): string {
  const git = "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe";
  return existsSync(git) ? git : "pdftotext";
}

async function pdfText(bytes: ArrayBuffer): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "ot-pdf-"));
  try {
    writeFileSync(join(dir, "in.pdf"), Buffer.from(bytes));
    await new Promise<void>((ok, fail) => execFile(pdftotext(), ["-layout", join(dir, "in.pdf"), join(dir, "out.txt")], { timeout: 60_000 }, (err) => (err ? fail(err) : ok())));
    const text = readFileSync(join(dir, "out.txt"), "utf8").replace(/\f/g, "\n");
    return text.split(/\s+/).length >= 80 ? text : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first of the official URLs that answers with a text. */
async function fetchOfficial(urls: string[], kind: string): Promise<{ text: string; url: string } | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (OpenTerminal)" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const text = url.endsWith(".pdf") ? await pdfText(await res.arrayBuffer()) : kind === "statement" ? statementText(await res.text()) : articleText(await res.text());
      if (text) return { text, url };
    } catch {
      /* the next guess */
    }
  }
  return null;
}

/** How long after an event its text is usually up, and how often to look again until it is. */
const TEXT_AFTER: Record<string, number> = { statement: 10 * 60_000, minutes: 10 * 60_000, speech: 30 * 60_000, testimony: 60 * 60_000, press_conference: 3 * 3_600_000 };
const RETRY_MS = 6 * 3_600_000;
const tried = new Map<string, number>();

function saveText(name: string, text: string): string {
  mkdirSync(TEXTS, { recursive: true });
  writeFileSync(join(TEXTS, name), text);
  return `texts/${name}`;
}

/** The Fed events of the last 45 days, with what was heard of them live and their official texts. */
async function collectFed(now: number, calendar: FedEvent[]): Promise<Row[]> {
  const old = new Map(readRows("fed").map((r) => [r.key, r]));
  const transcripts = savedTranscripts();
  const statements = calendar.filter((e) => /^FOMC Meeting/i.test(e.title) && !e.allDay).map((e) => e.start);
  const rows: Row[] = [];
  for (const e of calendar) {
    const at = Date.parse(e.start);
    if (e.allDay || !FED_TYPES.test(e.type) || abroad(e.location) || at > now || at < now - 45 * 86_400_000) continue;
    const { kind, minutes } = kindOf(e);
    const key = fedKey(e);
    const was = old.get(key);
    const row: Row = { key, date_utc: iso(at), date_wib: wib(at), type: e.type, kind, title: e.title, location: e.location, expected_minutes: String(minutes), updated_at: iso(now) };
    // Heard live: the followed broadcasts around it (the press conference's, not the statement's).
    if (minutes > 0) {
      const heard = transcripts.map((t) => ({ t, h: heardOf(t.lines, at, minutes) })).filter((x) => x.h).sort((a, b) => b.h!.minutes - a.h!.minutes)[0];
      if (heard?.h) {
        const text = heard.h.lines.map((l) => l.text).join(" ");
        const r = readText(text);
        Object.assign(row, {
          live_from_utc: iso(heard.h.from),
          live_to_utc: iso(heard.h.to),
          live_minutes: String(heard.h.minutes),
          live_lines: String(heard.h.lines.length),
          live_hawkish: String(r.hawkish),
          live_dovish: String(r.dovish),
          live_index: num(r.index, 3),
          live_file: saveText(`${e.start.slice(0, 10)}_${slug(e.title)}_live.txt`, heard.h.lines.map((l) => `[${wib(l.at)} WIB] ${l.text}`).join("\n")),
        });
      }
    }
    // The official text, from the Board's own pages: the app looks itself, every six hours until
    // it's there, and the search is left only what it can't find.
    const due = TEXT_AFTER[kind];
    if (due !== undefined && !was?.official_file && now - at > due && now - (tried.get(key) ?? 0) > RETRY_MS) {
      tried.set(key, now);
      row.app_tries = String(Number(was?.app_tries || 0) + 1);
      const s = await fetchOfficial(officialUrls(row, statements), kind);
      if (s) {
        const r = readText(s.text);
        Object.assign(row, {
          official_kind: kind,
          official_source: "federalreserve.gov (app)",
          official_url: s.url,
          official_words: String(r.words),
          official_hawkish: String(r.hawkish),
          official_dovish: String(r.dovish),
          official_index: num(r.index, 3),
          official_file: saveText(`${e.start.slice(0, 10)}_${slug(e.title)}_official.txt`, s.text),
        });
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Heard in full, in part, or not at all; and the reading kept: the official text's when there is one. */
export function finishFed(r: Row): Row {
  const expected = Number(r.expected_minutes || 0);
  const heard = Number(r.live_minutes || 0);
  const coverage = expected === 0 ? "text" : heard >= expected * 0.8 ? "full" : heard > 0 ? "partial" : "none";
  const fromOfficial = r.official_index !== "" && r.official_index !== undefined;
  const index = fromOfficial ? r.official_index : r.live_index ?? "";
  return { ...r, coverage, index: index ?? "", stance: index ? stanceOf(Number(index)) : "", index_from: fromOfficial ? "official" : index ? "live" : "" };
}

// ---------------------------------------------------------------- the inbox (Claude's search)

export type InboxItem =
  | { type: "fed_text"; event_key?: string; title: string; date: string; kind?: string; text: string; source_url: string; retrieved_at?: string; by?: string; note?: string }
  | { type: "release"; title: string; date: string; actual: number; consensus?: number | null; previous?: number | null; unit?: string; source_url: string; retrieved_at?: string; by?: string; note?: string };

/** Why an inbox item can't be taken, or null when it can. */
export function rejectReason(x: Partial<InboxItem> & Record<string, unknown>): string | null {
  if (x.type !== "fed_text" && x.type !== "release") return "type harus fed_text atau release";
  if (typeof x.title !== "string" || !x.title.trim()) return "title kosong";
  if (typeof x.date !== "string" || Number.isNaN(Date.parse(x.date))) return "date bukan tanggal ISO";
  if (typeof x.source_url !== "string" || !/^https:\/\/\S+$/.test(x.source_url)) return "source_url harus https";
  if (x.type === "fed_text" && (typeof x.text !== "string" || x.text.split(/\s+/).length < 80)) return "text terlalu pendek (minimal 80 kata)";
  if (x.type === "release" && (typeof x.actual !== "number" || !Number.isFinite(x.actual))) return "actual harus angka";
  return null;
}

function ingestInbox(now: number, fed: Map<string, Row>, releases: Map<string, Row>): { taken: number; rejected: number } {
  let taken = 0;
  let rejected = 0;
  if (!existsSync(INBOX)) return { taken, rejected };
  for (const f of readdirSync(INBOX)) {
    if (!f.endsWith(".json")) continue;
    const path = join(INBOX, f);
    let item: InboxItem & Record<string, unknown>;
    try {
      item = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      move(path, "rejected", f, "JSON tidak valid");
      rejected++;
      continue;
    }
    const why = rejectReason(item);
    if (why) {
      move(path, "rejected", f, why);
      rejected++;
      continue;
    }
    const source = `${item.by || "claude"} (web)`;
    if (item.type === "fed_text") {
      const day = new Date(Date.parse(item.date)).toISOString().slice(0, 10);
      const key =
        (item.event_key && fed.has(item.event_key) ? item.event_key : null) ??
        [...fed.keys()].find((k) => k.startsWith(day) && sameEvent(k.slice(11), item.title)) ??
        `${day}|${item.title}`;
      const was = fed.get(key);
      // The app's own official text stays; a search's text fills only what's missing.
      if (was?.official_file && !/web/.test(was.official_source ?? "")) {
        move(path, "done", f, "teks resmi sudah ada dari aplikasi");
        continue;
      }
      const r = readText(item.text);
      const at = Date.parse(was?.date_utc || item.date);
      fed.set(
        key,
        finishFed({
          ...(was ?? { key, date_utc: iso(at), date_wib: wib(at), type: "web", kind: item.kind ?? "speech", title: item.title, expected_minutes: "0" }),
          official_kind: item.kind ?? "transcript",
          official_source: source,
          official_url: item.source_url,
          official_words: String(r.words),
          official_hawkish: String(r.hawkish),
          official_dovish: String(r.dovish),
          official_index: num(r.index, 3),
          official_file: saveText(`${day}_${slug(item.title)}_official.txt`, `${item.text}\n\nSumber: ${item.source_url}\n`),
          updated_at: iso(now),
        }),
      );
    } else {
      const day = new Date(Date.parse(item.date)).toISOString().slice(0, 10);
      const key = [...releases.keys()].find((k) => k.startsWith(`${item.title}|${day}`)) ?? `${item.title}|${new Date(Date.parse(item.date)).toISOString()}`;
      const was = releases.get(key);
      if (was?.actual) {
        move(path, "done", f, "actual sudah ada dari kalender");
        continue;
      }
      releases.set(key, {
        ...(was ?? { key, date_utc: new Date(Date.parse(item.date)).toISOString(), date_wib: wib(Date.parse(item.date)), title: item.title, label: item.title, unit: item.unit ?? "" }),
        actual: String(item.actual),
        consensus: was?.consensus || num(item.consensus ?? null),
        previous: was?.previous || num(item.previous ?? null),
        source: source,
        source_url: item.source_url,
        updated_at: iso(now),
      });
    }
    move(path, "done", f, null);
    taken++;
  }
  return { taken, rejected };
}

/** Two names for one event ("FOMC Press Conference" and "Transcript of Chair's Press Conference"): enough words alike. */
export function sameEvent(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !/^(federal|reserve|board|governor|speech|remarks)$/.test(w)));
  const A = words(a);
  const B = words(b);
  let same = 0;
  for (const w of A) if (B.has(w)) same++;
  return same >= Math.min(2, A.size, B.size) && same > 0;
}

function move(path: string, to: "done" | "rejected", name: string, why: string | null): void {
  const dir = join(INBOX, to);
  mkdirSync(dir, { recursive: true });
  renameSync(path, join(dir, name));
  if (why) writeFileSync(join(dir, `${name}.txt`), `${why}\n`);
}

// ---------------------------------------------------------------- releases and reactions

async function collectReleases(now: number): Promise<{ releases: Row[]; reactions: Row[] }> {
  const [{ engineInputs, TARGETS, walkForward, rows, biasOf }, { reactions }, { cached }] = await Promise.all([
    import("../providers/macroengine.js"),
    import("../providers/reactions.js"),
    import("../cache.js"),
  ]);
  const inputs = await engineInputs(now);
  const reacted = await cached("macro:reactions", 15 * 60_000, () => reactions(inputs, now));
  const units = new Map(reacted.instruments.map((i) => [i.key, i.unit]));
  const out: Row[] = [];
  const moves: Row[] = [];
  for (const t of TARGETS) {
    const calls = new Map(walkForward(rows(t, inputs)).map((p) => [p.date, p]));
    for (const r of inputs.releases) {
      if (r.title !== t.title || Date.parse(r.date) < Date.UTC(2016, 0, 1) || Date.parse(r.date) > now) continue;
      const key = `${r.title}|${r.date}`;
      const surprise = r.actual !== null && r.forecast !== null ? r.actual - r.forecast : null;
      const p = calls.get(r.date);
      out.push({
        key,
        date_utc: r.date,
        date_wib: wib(Date.parse(r.date)),
        target: t.key,
        label: t.label,
        title: r.title,
        unit: t.unit,
        actual: num(r.actual),
        consensus: num(r.forecast),
        previous: num(r.previous),
        surprise: num(surprise),
        side: surprise === null ? "" : biasOf(t, surprise),
        engine_call: p ? biasOf(t, p.mid) : "",
        source: r.actual === null ? "" : "economic calendar (app)",
        updated_at: iso(now),
      });
    }
  }
  for (const rr of reacted.releases) {
    const t = TARGETS.find((x) => x.key === rr.key);
    if (!t) continue;
    const eventKey = `${t.title}|${rr.date}`;
    for (const [span, m] of [["first30", rr.m30], ["day", rr.day]] as const)
      for (const [inst, v] of Object.entries(m))
        if (v !== null && v !== undefined)
          moves.push({ key: `${eventKey}|${inst}|${span}`, event_key: eventKey, event: rr.label, date_utc: rr.date, instrument: inst, span, move: num(v), unit: units.get(inst) ?? "", source: "TradingView bars (app)", updated_at: iso(now) });
  }
  return { releases: out, reactions: moves };
}

/** The markets after each Fed event: the first 30 minutes and the day. */
async function fedReactions(now: number, fed: Row[]): Promise<Row[]> {
  const { barStore, dayMove, moveIn, INSTRUMENTS } = await import("../providers/reactions.js");
  const [b30, b60, b1d] = await Promise.all([barStore("30", 30 * 60_000, now), barStore("60", 3 * 3_600_000, now), barStore("1D", 6 * 3_600_000, now)]);
  const out: Row[] = [];
  for (const r of fed) {
    const at = Date.parse(r.date_utc);
    if (now - at < 35 * 60_000) continue;
    for (const inst of INSTRUMENTS) {
      const unit = inst.unit as "%" | "bp";
      const first = moveIn(b30[inst.symbol] ?? [], 30, at, 30, unit) ?? moveIn(b60[inst.symbol] ?? [], 60, at, 30, unit);
      const day = dayMove(b1d[inst.symbol] ?? [], at, unit);
      for (const [span, v] of [["first30", first], ["day", day]] as const)
        if (v !== null) out.push({ key: `${r.key}|${inst.key}|${span}`, event_key: r.key, event: r.title, date_utc: r.date_utc, instrument: inst.key, span, move: num(v), unit, source: "TradingView bars (app)", updated_at: iso(now) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- gaps, readme, the run

export function gapsOf(now: number, fed: Row[], releases: Row[]): Row[] {
  const gaps: Row[] = [];
  for (const r of fed) {
    if (r.official_file) continue;
    const at = Date.parse(r.date_utc);
    if (now - at < 2 * 3_600_000) continue;
    if (r.coverage === "full") continue;
    const missing =
      r.kind === "press_conference"
        ? "transkrip resmi konferensi pers (PDF di federalreserve.gov/mediacenter/files/FOMCpresconfYYYYMMDD.pdf)"
        : r.kind === "statement"
          ? "teks pernyataan FOMC"
          : r.kind === "minutes"
            ? "teks risalah FOMC"
            : r.kind === "testimony"
              ? "teks kesaksian (testimony)"
              : "teks pidato";
    const hint =
      r.kind === "press_conference"
        ? `https://www.federalreserve.gov/mediacenter/files/FOMCpresconf${r.date_utc.slice(0, 10).replace(/-/g, "")}.pdf`
        : r.kind === "statement"
          ? `https://www.federalreserve.gov/newsevents/pressreleases/monetary${r.date_utc.slice(0, 10).replace(/-/g, "")}a.htm`
          : "https://www.federalreserve.gov/newsevents/speeches.htm";
    // The search only gets what the app has looked for twice (six hours apart) and not found; a
    // "Discussion" (a moderated conversation) seldom has a text, so it isn't searched for.
    const tries = Number(r.app_tries || 0);
    const ready = /^Discussion/i.test(r.title) ? "no" : tries >= 2 || officialUrls(r, []).length === 0 ? "yes" : "no";
    gaps.push({
      key: r.key,
      kind: "fed_text",
      date_utc: r.date_utc,
      date_wib: r.date_wib,
      title: r.title,
      type: r.kind,
      missing: `${/^Discussion/i.test(r.title) ? "teks (acara diskusi biasanya tanpa teks)" : missing}${r.coverage === "partial" ? `; siaran hanya terdengar ${r.live_minutes} dari ±${r.expected_minutes} menit` : ""}`,
      hint,
      app_tries: String(tries),
      claude_ready: ready,
      since: iso(now),
    });
  }
  for (const r of releases) {
    if (r.actual || now - Date.parse(r.date_utc) < 3 * 3_600_000 || now - Date.parse(r.date_utc) > 60 * 86_400_000) continue;
    gaps.push({ key: r.key, kind: "release", date_utc: r.date_utc, date_wib: r.date_wib, title: r.title, type: r.target, missing: "angka aktual rilis", hint: "situs resmi penerbit data (BLS, BEA, ISM, Departemen Tenaga Kerja)", app_tries: "", claude_ready: "yes", since: iso(now) });
  }
  return gaps;
}

export const README = `# Data berita OpenTerminal

Folder ini diisi otomatis oleh aplikasi (server/src/newsdata/newsdata.ts) setiap 30 menit selama aplikasi
berjalan, untuk semua rilis dan acara The Fed, ditonton atau tidak. Semua waktu dalam UTC, dengan kolom WIB.

| Berkas | Isi |
|---|---|
| releases.csv | Rilis data besar AS sejak 2016: aktual, konsensus, sebelumnya, kejutan, sisinya, tebakan engine |
| reactions.csv | Gerak tiap aset 30 menit pertama dan sepanjang hari setelah tiap rilis dan acara The Fed |
| fed_events.csv | Acara The Fed 45 hari terakhir: berapa menit siarannya didengar live, teks resminya, dan bacaan kamus hawkish/dovish |
| gaps.csv | Yang masih kurang: dicari oleh tugas terjadwal Claude |
| texts/ | Transkrip live dan teks resmi |
| inbox/ | Hasil pencarian Claude, dibaca aplikasi lalu dipindah ke inbox/done/ atau inbox/rejected/ |

Folder ini ikut di-commit ke GitHub sekali sehari (kecuali inbox/) oleh tugas terjadwal Claude.

Teks resmi The Fed (pernyataan FOMC, transkrip konferensi pers, pidato, kesaksian, risalah) dicari aplikasi
sendiri di federalreserve.gov tiap 6 jam sampai ketemu (kolom app_tries). Yang tetap tidak ketemu setelah dua
kali dicoba ditandai claude_ready=yes di gaps.csv: hanya itu yang dicari Claude.

Kolom \`source\` / \`official_source\` selalu menyebut asal datanya: "(app)" diambil aplikasi sendiri, "(web)"
dicari Claude di internet. Data dari internet tidak pernah menimpa data aplikasi.

## Format inbox (untuk tugas terjadwal Claude)

Satu berkas JSON per temuan, nama bebas berakhiran .json, di \`inbox/\`:

Teks acara The Fed (transkrip konferensi pers, pidato, kesaksian, risalah):

\`\`\`json
{
  "type": "fed_text",
  "event_key": "2026-10-28|FOMC Press Conference",
  "title": "FOMC Press Conference",
  "date": "2026-10-28T18:30:00Z",
  "kind": "press_conference | speech | testimony | minutes | statement",
  "text": "teks lengkap, apa adanya dari sumber resmi",
  "source_url": "https://www.federalreserve.gov/...",
  "retrieved_at": "2026-10-29T02:00:00Z",
  "by": "claude",
  "note": "opsional"
}
\`\`\`

Angka rilis yang belum ada di kalender:

\`\`\`json
{ "type": "release", "title": "Core PCE Price Index MoM", "date": "2026-10-29T12:30:00Z",
  "actual": 0.2, "consensus": 0.3, "previous": 0.2, "unit": "%",
  "source_url": "https://www.bea.gov/...", "retrieved_at": "...", "by": "claude" }
\`\`\`

Aturan: \`event_key\` disalin dari kolom \`key\` di gaps.csv; \`text\` minimal 80 kata dan berasal dari sumber
resmi (federalreserve.gov, situs Fed regional, BLS, BEA, ISM) atau, bila tidak ada, media besar yang mengutip
langsung; \`source_url\` wajib https. Berkas yang tidak lolos dipindah ke inbox/rejected/ dengan alasannya.
`;

export type Status = { dir: string; lastRun: string | null; error: string | null; files: Array<{ name: string; rows: number }>; gaps: Row[]; inbox: { waiting: number; taken: number; rejected: number } };

let last: { at: number; error: string | null; taken: number; rejected: number } | null = null;
let running: Promise<void> | null = null;

/** One pass: the calendar, the broadcasts heard, the official texts, the inbox, the gaps. */
export async function runNewsData(now = Date.now()): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      mkdirSync(INBOX, { recursive: true });
      writeFileSync(join(DIR, "README.md"), README);
      const calendar = await fedCalendar().catch(() => [] as FedEvent[]);
      const fedNew = (await collectFed(now, calendar)).map(finishFed);
      const fed = new Map(mergeRows(readRows("fed"), fedNew, "key").map((r) => [r.key, finishFed(r)]));
      const { releases: relNew, reactions: moves } = await collectReleases(now).catch((err) => {
        console.warn("newsdata releases:", err instanceof Error ? err.message : err);
        return { releases: [] as Row[], reactions: [] as Row[] };
      });
      const releases = new Map(mergeRows(readRows("releases"), relNew, "key").map((r) => [r.key, r]));
      const inbox = ingestInbox(now, fed, releases);
      const fedRows = [...fed.values()];
      const fedMoves = await fedReactions(now, fedRows).catch(() => [] as Row[]);
      writeRows("fed", fedRows);
      writeRows("releases", [...releases.values()]);
      writeRows("reactions", mergeRows(readRows("reactions"), [...moves, ...fedMoves], "key"));
      // A gap keeps the moment it was first seen.
      const seen = new Map(readRows("gaps").map((g) => [g.key, g.since]));
      writeRows("gaps", gapsOf(now, fedRows, [...releases.values()]).map((g) => ({ ...g, since: seen.get(g.key) || g.since })));
      last = { at: now, error: null, ...inbox };
    } catch (err) {
      last = { at: now, error: err instanceof Error ? err.message : String(err), taken: 0, rejected: 0 };
      console.warn("newsdata:", last.error);
    } finally {
      running = null;
    }
  })();
  return running;
}

export function newsDataStatus(): Status {
  const files = (["releases", "reactions", "fed", "gaps"] as const).map((n) => ({ name: `${n === "fed" ? "fed_events" : n}.csv`, rows: readRows(n).length }));
  const waiting = existsSync(INBOX) ? readdirSync(INBOX).filter((f) => f.endsWith(".json")).length : 0;
  return { dir: DIR, lastRun: last ? iso(last.at) : null, error: last?.error ?? null, files, gaps: readRows("gaps"), inbox: { waiting, taken: last?.taken ?? 0, rejected: last?.rejected ?? 0 } };
}

/** Every half hour while the app runs, the first a minute after it starts. */
export function startNewsData(): void {
  setTimeout(() => void runNewsData(), 60_000).unref?.();
  setInterval(() => void runNewsData(), 30 * 60_000).unref?.();
}
