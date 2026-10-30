// Windows notifications for the moments the Live TV's THE FED watches, raised by the server whether
// or not anyone has the tab open:
//
//   - a Fed broadcast going live (the Board's and the regional banks' channels, US events only);
//   - a reminder about three hours before a big US release: what's due, and what the markets did
//     in the first 30 minutes after past releases with a hot or a cold surprise (the news impact's
//     scenarios, as the Astro Calendar shows them);
//   - H-30: half an hour before a big US release, its consensus, the engine's band and the H-30
//     bias the macro engine keeps then (h30-conclusions.json);
//   - the result: the print against the consensus, and the side it falls on (hawkish or dovish);
//   - the first five minutes: how gold, bitcoin, S&P futures, the dollar and the 2-year yield moved,
//     and how many went the surprise's way.
//
// Each kind can be turned off (the 🔔 tab), and each moment is notified once, even across restarts
// (notify.json keeps what was sent).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cached } from "../cache.js";
import { dataDir } from "../db.js";
import { formatReading, type TVRaw } from "../providers/econcalendar.js";
import { fedLive } from "../providers/fedlive.js";
import type { H30Conclusion } from "../providers/h30.js";
import { TARGETS } from "../providers/macroengine.js";
import { INSTRUMENTS } from "../providers/reactions.js";
import { bars, type TvBar } from "../providers/tvchart.js";
import { showToast, toastsSupported } from "./toast.js";

export type Kind = "fed" | "early" | "h30" | "result" | "reaction";
export type Settings = Record<Kind, boolean>;
export type Sent = { at: number; kind: Kind | "test"; title: string; lines: string[]; shown: boolean };

const DEFAULTS: Settings = { fed: true, early: true, h30: true, result: true, reaction: true };

/** The releases notified: the engine's targets, the Fed's decision and the ISM services survey. */
type Followed = { label: string; unit: string; hawk: 1 | -1; hot: number; rank: number };
export const FOLLOWED: Record<string, Followed> = Object.fromEntries([
  ["Fed Interest Rate Decision", { label: "Suku bunga The Fed", unit: "%", hawk: 1 as const, hot: 0.125, rank: 0 }],
  ...TARGETS.map((t, k) => [t.title, { label: t.label, unit: t.unit, hawk: t.hawk, hot: t.hot, rank: k + 1 }] as const),
  ["ISM Services PMI", { label: "ISM Services PMI", unit: "pt", hawk: 1 as const, hot: 1, rank: 99 }],
]);

/** The markets the five-minute reaction reads. */
const REACTION_KEYS = ["xau", "btc", "es", "dxy", "us2y"] as const;

export type Release = { title: string; date: string; actual: number | null; forecast: number | null; unit?: string; scale?: string };
/** The releases due at one minute, the most market-moving first. */
export type Group = { time: number; iso: string; releases: Release[] };

// ---------------------------------------------------------------- what to say (pure)

export function groupReleases(events: Release[]): Group[] {
  const by = new Map<string, Release[]>();
  for (const e of events) if (FOLLOWED[e.title]) (by.get(e.date) ?? by.set(e.date, []).get(e.date)!).push(e);
  return [...by]
    .map(([iso, releases]) => ({ iso, time: Date.parse(iso), releases: releases.sort((a, b) => FOLLOWED[a.title].rank - FOLLOWED[b.title].rank) }))
    .sort((a, b) => a.time - b.time);
}

const num = (v: number, digits = 2) => v.toLocaleString("id-ID", { maximumFractionDigits: digits });
const reading = (r: Release, v: number | null) => formatReading(v, r.unit, r.scale)?.replace(/(\d)\.(\d)/g, "$1,$2") ?? "–";
export const clock = (t: number) => new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

/** +1 hawkish (hotter or stronger than the consensus), −1 dovish, 0 in line (within its `hot` gap). */
export function sideOf(r: Release): -1 | 0 | 1 | null {
  const f = FOLLOWED[r.title];
  if (!f || r.actual === null || r.forecast === null) return null;
  const gap = r.actual - r.forecast;
  if (Math.abs(gap) < f.hot - 1e-9) return 0;
  return (Math.sign(gap) * f.hawk) as -1 | 1;
}
const SIDE_TEXT = { 1: "lebih panas/kuat dari perkiraan → hawkish", "-1": "lebih lemah/dingin dari perkiraan → dovish", 0: "sesuai konsensus" } as const;

/**
 * A release's scenarios as the notifications quote them: newsimpact's for a data release (the first
 * 30 minutes), fomcscenarios' for the Fed's decision (the day: its 30-minute history is thin).
 */
export type ReleaseScenarios = {
  /** `first` holds the quoted span's moves (the day's, for the Fed). */
  scenarios: Array<{ name: string; first: Partial<Record<string, { p50: number }>> }>;
  /** How often the history's median had the first 30 minutes' direction, by market; for the Fed, how often it went the 2-year's usual way. */
  hit: Partial<Record<string, number>>;
  /** Set for the Fed's decision: the meetings the scenarios come from. */
  fomc?: { meetings: number };
};

/** The markets a reminder quotes, by the news impact's keys. */
const SCENARIO_KEYS: Array<[string, string]> = [
  ["xau", "Emas"],
  ["btc", "BTC"],
  ["es", "S&P"],
];

/**
 * Two lines: what gold, bitcoin and the S&P did in the first 30 minutes after past releases with a
 * clearly hot and a clearly cold surprise (medians), and how often that side was right.
 */
export function scenarioLines(sc: ReleaseScenarios | null): string[] {
  if (!sc) return [];
  const pick = (name: string) => sc.scenarios.find((s) => s.name === name);
  const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}%`;
  const line = (name: string, say: string) => {
    const s = pick(name);
    if (!s) return null;
    const parts = SCENARIO_KEYS.filter(([k]) => s.first[k]).map(([k, label]) => `${label} ${fmt(s.first[k]!.p50)}`);
    return parts.length ? `${say}: ${parts.join(" · ")}` : null;
  };
  const out = (
    sc.fomc
      ? [line("hawkish kuat", "Kalau dibaca hawkish kuat"), line("dovish kuat", "Kalau dibaca dovish kuat")]
      : [line("panas kuat", "Kalau jauh lebih panas"), line("dingin kuat", "Kalau jauh lebih dingin")]
  ).filter((l): l is string => l !== null);
  if (!out.length) return [];
  const hits = SCENARIO_KEYS.filter(([k]) => sc.hit[k] != null).map(([k, label]) => `${label} ${Math.round(sc.hit[k]! * 100)}%`);
  out.push(
    sc.fomc
      ? `Gerak hari itu, median ${sc.fomc.meetings} rapat sejak 2016, dibaca dari yield 2Y${hits.length ? `; ikut arah ${hits.join(" · ")}` : ""}`
      : `30 menit pertama, median riwayat${hits.length ? `; arahnya benar ${hits.join(" · ")}` : ""}`,
  );
  return out;
}

/** The reminder a few hours ahead: what's due, its consensus, and the scenarios. */
export function earlyMessage(g: Group, sc: ReleaseScenarios | null): { title: string; lines: string[] } {
  const lead = g.releases[0];
  const title = `Rilis besar ${clock(g.time)}: ${g.releases.map((r) => FOLLOWED[r.title].label).join(", ")}`;
  const lines = [`Konsensus ${FOLLOWED[lead.title].label}: ${reading(lead, lead.forecast)}`, ...scenarioLines(sc)];
  if (lines.length === 1) lines.push("Skenario: Astro Calendar → Skenario rilis");
  return { title, lines };
}

export function h30Message(g: Group, conclusion: H30Conclusion | null, now = g.time - 30 * 60_000, sc: ReleaseScenarios | null = null): { title: string; lines: string[] } {
  const lead = g.releases[0];
  // Thirty minutes ahead as a rule; less when the app was opened inside the half hour.
  const minutes = Math.max(1, Math.round((g.time - now) / 60_000));
  const title = `${minutes} menit lagi (${clock(g.time)}): ${g.releases.map((r) => FOLLOWED[r.title].label).join(", ")}`;
  const lines = [`Konsensus ${FOLLOWED[lead.title].label}: ${reading(lead, lead.forecast)}`];
  if (conclusion) {
    const d = conclusion.driver;
    const u = FOLLOWED[lead.title].unit === "K" ? "K" : FOLLOWED[lead.title].unit === "%" ? "%" : "";
    lines[0] += ` · model P50 ${num(d.p50)}${u} (P10–P90 ${num(d.p10)}–${num(d.p90)}${u})`;
    const leans = conclusion.assets
      .filter((a) => a.dir !== "datar")
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 3)
      .map((a) => `${a.label} ${a.dir} ${Math.round(a.chance * 100)}%`);
    if (leans.length) lines.push(`Bias H-30 (bukan sinyal): ${leans.join(" · ")}`);
  }
  // The first 30 minutes' scenarios, the clearer read (one line, the toast is short).
  const scen = scenarioLines(sc);
  if (scen.length) lines.push(scen.slice(0, 2).join(" | "));
  return { title, lines };
}

export function resultMessage(g: Group): { title: string; lines: string[] } | null {
  const out = g.releases.filter((r) => r.actual !== null);
  if (!out.length) return null;
  const lead = out[0];
  const side = sideOf(lead);
  const title = `${FOLLOWED[lead.title].label}: ${reading(lead, lead.actual)} (konsensus ${reading(lead, lead.forecast)})`;
  const lines = [side === null ? "Tanpa konsensus" : SIDE_TEXT[side]];
  const rest = out.slice(1).map((r) => `${FOLLOWED[r.title].label} ${reading(r, r.actual)} (${reading(r, r.forecast)})`);
  if (rest.length) lines.push(rest.join(" · "));
  return { title, lines };
}

/** Each market's move from the last close before `time` to the close five minutes after (null when it didn't trade). */
export function fiveMinuteMoves(series: Record<string, TvBar[] | null>, time: number): Array<{ key: string; label: string; move: number; unit: string; hawk: number }> {
  const out: Array<{ key: string; label: string; move: number; unit: string; hawk: number }> = [];
  for (const key of REACTION_KEYS) {
    const inst = INSTRUMENTS.find((i) => i.key === key)!;
    const b = series[inst.symbol];
    if (!b?.length) continue;
    const before = [...b].reverse().find((x) => x.time * 1000 < time);
    const after = b.find((x) => x.time * 1000 === time + 4 * 60_000);
    if (!before || !after || before.time * 1000 < time - 10 * 60_000) continue;
    const move = inst.unit === "bp" ? (after.close - before.close) * 100 : (after.close / before.close - 1) * 100;
    out.push({ key, label: inst.label, move, unit: inst.unit, hawk: inst.hawk });
  }
  return out;
}

export function reactionMessage(g: Group, moves: ReturnType<typeof fiveMinuteMoves>): { title: string; lines: string[] } | null {
  if (!moves.length) return null;
  const lead = g.releases.find((r) => r.actual !== null) ?? g.releases[0];
  const fmt = (m: (typeof moves)[number]) => `${m.label} ${m.move >= 0 ? "+" : "−"}${num(Math.abs(m.move), m.unit === "bp" ? 1 : 2)}${m.unit === "bp" ? " bp" : "%"}`;
  const lines = [moves.map(fmt).join(" · ")];
  const side = sideOf(lead);
  if (side) {
    const agree = moves.filter((m) => Math.sign(m.move) === side * m.hawk).length;
    lines.push(`Searah kejutan ${side > 0 ? "hawkish" : "dovish"}: ${agree} dari ${moves.length}`);
  }
  return { title: `Reaksi 5 menit · ${FOLLOWED[lead.title].label}`, lines };
}

// ---------------------------------------------------------------- state

const file = join(dataDir, "notify.json");
type State = { settings: Settings; sent: Record<string, number>; recent: Sent[] };
let state: State | null = null;

function load(): State {
  if (state) return state;
  let s: Partial<State> = {};
  try {
    if (existsSync(file)) s = JSON.parse(readFileSync(file, "utf8")) as Partial<State>;
  } catch {
    // a broken file starts over
  }
  state = { settings: { ...DEFAULTS, ...(s.settings ?? {}) }, sent: s.sent ?? {}, recent: s.recent ?? [] };
  return state;
}

function save(): void {
  const s = load();
  const old = Date.now() - 7 * 86_400_000;
  for (const [k, t] of Object.entries(s.sent)) if (t < old) delete s.sent[k];
  s.recent = s.recent.slice(0, 40);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(s));
}

export const settings = (): Settings => ({ ...load().settings });
export const recent = (): Sent[] => load().recent;

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = load();
  for (const k of Object.keys(DEFAULTS) as Kind[]) if (typeof patch[k] === "boolean") s.settings[k] = patch[k]!;
  save();
  return settings();
}

async function send(kind: Kind | "test", key: string | null, title: string, lines: string[]): Promise<Sent> {
  const s = load();
  if (key) s.sent[key] = Date.now();
  const shown = await showToast(title, lines);
  const entry: Sent = { at: Date.now(), kind, title, lines, shown };
  s.recent.unshift(entry);
  save();
  return entry;
}

export const sendTest = () => send("test", null, "Notifikasi Parallax aktif", ["Siaran The Fed, pengingat rilis, H-30, hasil rilis dan reaksi 5 menit akan muncul seperti ini."]);

// ---------------------------------------------------------------- the watch

/** The followed US releases from `from` to `to`, as TradingView's calendar has them now. */
async function usReleases(from: number, to: number): Promise<Release[]> {
  const url = `https://economic-calendar.tradingview.com/events?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}&countries=US`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`tradingview calendar ${res.status}`);
  const body = (await res.json()) as { status?: string; result?: TVRaw[] };
  if (body.status !== "ok" || !Array.isArray(body.result)) throw new Error("tradingview calendar: unexpected reply");
  return body.result
    .filter((e) => FOLLOWED[e.title])
    .map((e) => ({ title: e.title, date: new Date(e.date).toISOString(), actual: e.actual ?? null, forecast: e.forecast ?? null, unit: e.unit, scale: e.scale }));
}

function conclusionAt(iso: string): H30Conclusion | null {
  try {
    const f = join(dataDir, "macro-engine", "h30-conclusions.json");
    return existsSync(f) ? ((JSON.parse(readFileSync(f, "utf8")) as Record<string, H30Conclusion>)[iso] ?? null) : null;
  } catch {
    return null;
  }
}

/** The news impact's scenarios for a group's lead release (null when it has none: the Fed's decision, a release it doesn't follow). */
export async function scenariosFor(g: Group): Promise<ReleaseScenarios | null> {
  if (g.releases.some((r) => r.title === "Fed Interest Rate Decision")) return fomcFor();
  const lead = TARGETS.find((t) => t.title === g.releases[0].title) ?? TARGETS.find((t) => g.releases.some((r) => r.title === t.title));
  if (!lead) return null;
  try {
    // Loaded when a reminder needs them: the news impact pulls in the whole macro engine.
    const [macroengine, fedtranscript, newsimpact] = await Promise.all([import("../providers/macroengine.js"), import("../providers/fedtranscript.js"), import("../providers/newsimpact.js")]);
    const imp = await cached("macro:impact", 10 * 60_000, async () => {
      const inputs = await macroengine.engineInputs();
      const engine = await cached("macro:engine", 2 * 60_000, () => macroengine.engine(fedtranscript.latestFedSentiment()));
      return newsimpact.impact(inputs, engine);
    });
    const u = imp.upcoming.find((x) => x.key === lead.key && Math.abs(Date.parse(x.release) - g.time) < 60_000);
    if (!u) return null;
    const hit = Object.fromEntries(imp.skill.filter((x) => x.first.calls > 0).map((x) => [x.key, x.first.hits / x.first.calls]));
    return { scenarios: u.scenarios, hit };
  } catch {
    return null;
  }
}

/** The Fed decision's scenarios: the day's moves after meetings read clearly hawkish or dovish (the route's cache). */
async function fomcFor(): Promise<ReleaseScenarios | null> {
  try {
    const { fomcScenarios } = await import("../providers/fomcscenarios.js");
    const f = await cached("macro:fomc-scenarios", 30 * 60_000, () => fomcScenarios());
    const hit = Object.fromEntries(Object.entries(f.day.follow).filter(([, x]) => x && x.n > 0).map(([k, x]) => [k, x!.agree / x!.n]));
    return { scenarios: f.day.buckets.map((b) => ({ name: b.name, first: b.cells })), hit, fomc: { meetings: f.day.meetings } };
  } catch {
    return null;
  }
}

/** How long before a big release the reminder comes. */
export const EARLY_MS = 3 * 3_600_000;

let calendar: { at: number; groups: Group[] } = { at: 0, groups: [] };
let lastFed = 0;

/** One look: what's due to be notified now, sent. */
export async function check(now = Date.now()): Promise<void> {
  const s = load();
  const { settings: on, sent } = s;

  // The calendar every ten minutes, every half minute around a release (for its actual).
  const hot = calendar.groups.some((g) => now >= g.time - 31 * 60_000 && now <= g.time + 20 * 60_000 && (now < g.time || g.releases.some((r) => r.actual === null)));
  if ((on.early || on.h30 || on.result || on.reaction) && now - calendar.at >= (hot ? 30_000 : 10 * 60_000)) {
    const fresh = await usReleases(now - 6 * 3_600_000, now + 36 * 3_600_000).catch(() => null);
    if (fresh) calendar = { at: now, groups: groupReleases(fresh) };
  }

  for (const g of calendar.groups) {
    const left = g.time - now;
    // About three hours ahead (or as soon as the app is up inside them, while there's more than the
    // half hour H-30 covers): a reminder with the scenarios.
    if (on.early && left > 31 * 60_000 && left <= EARLY_MS && !sent[`early:${g.iso}`]) {
      const m = earlyMessage(g, await scenariosFor(g));
      await send("early", `early:${g.iso}`, m.title, m.lines);
    }
    // H-30: once the engine has kept its conclusion (it runs every five minutes), or at H-25 without it.
    if (on.h30 && left > 0 && left <= 30 * 60_000 && !sent[`h30:${g.iso}`]) {
      const c = conclusionAt(g.iso);
      if (c || left <= 25 * 60_000) {
        const m = h30Message(g, c, now, await scenariosFor(g));
        await send("h30", `h30:${g.iso}`, m.title, m.lines);
      }
    }
    // The result, once the lead release's actual is out (within the hour).
    if (on.result && left <= 0 && left > -60 * 60_000 && !sent[`result:${g.iso}`] && g.releases[0].actual !== null) {
      const m = resultMessage(g);
      if (m) await send("result", `result:${g.iso}`, m.title, m.lines);
    }
    // The first five minutes, once their last one-minute bar has closed (tried for ten minutes).
    if (on.reaction && left <= -5.5 * 60_000 && left > -15 * 60_000 && !sent[`reaction:${g.iso}`]) {
      const symbols = REACTION_KEYS.map((k) => INSTRUMENTS.find((i) => i.key === k)!.symbol);
      const series = await bars(symbols, "1", 40).catch(() => ({}) as Record<string, TvBar[] | null>);
      const m = reactionMessage(g, fiveMinuteMoves(series, g.time));
      if (m) await send("reaction", `reaction:${g.iso}`, m.title, m.lines);
      else if (left <= -12 * 60_000) sent[`reaction:${g.iso}`] = now; // nothing traded: let it go
    }
  }

  // A Fed broadcast going live, looked for every two minutes (shared with the Live TV's own look).
  if (on.fed && now - lastFed >= 2 * 60_000) {
    lastFed = now;
    const live = await cached("fed:live", 60_000, () => fedLive()).catch(() => null);
    for (const l of live?.live ?? []) {
      if (sent[`fed:${l.videoId}`]) continue;
      const lines = [l.channel, "Buka Live TV → THE FED untuk transkrip dan Fed Sentiment Index"];
      await send("fed", `fed:${l.videoId}`, `The Fed LIVE: ${l.title}`, lines);
    }
  }
}

let started = false;

/** Starts the watch (every 30 seconds). On anything but Windows nothing is shown, but the watch keeps the record. */
export function startNotifier(): void {
  if (started) return;
  started = true;
  // At boot, a broadcast still live or a result out within the hour is notified then, once.
  // One look at a time: a slow one (the bars, the Fed's channels) mustn't let the next send the same.
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    void check()
      .catch((err) => console.warn("notify:", err instanceof Error ? err.message : err))
      .finally(() => (busy = false));
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 30_000).unref();
}

export const platformSupported = toastsSupported;
