// What a big US release does to markets: crypto, forex, stocks, the dollar, oil, gold and yields,
// learned from every release the engine follows (reactions.ts has the moves, macroengine.ts the
// surprises), as a reaction framework in two steps:
//
//   1. Before the release: scenarios. The surprise is made comparable across releases (hawkish-
//      signed, in standard deviations of that release's earlier surprises) and bucketed (cool,
//      in line, hot, very hot); each asset's moves after past releases in the same bucket, scaled to
//      the size of this release (how far gold usually moves on it), give its P10/P50/P90 over the
//      first 30 minutes and over the day. The engine's band says which bucket a print may land in.
//   2. After it: confirmation ("watch the second move"). The 10-year yield and the dollar index
//      moving the surprise's way together in the first 30 minutes confirm it. Live, the panel watches
//      1-minute bars from the release: CONFIRMED, WAIT or INVALID, with how often past moves
//      followed through from 30 to 90 minutes when confirmed and when not.
//
// Everything is tested walk-forward (each event predicted from the events before it). A quantile
// gradient boosting model was tried first and did no better than the bucketed history, so the
// simpler one stays: with ~35 timed events a year, a richer model mostly learns noise.

import { bars, type TvBar } from "./tvchart.js";
import { rows, TARGETS, type Engine, type Inputs, type Target } from "./macroengine.js";
import { barStore, INSTRUMENTS, moveIn, dayMove, type InstrumentKey } from "./reactions.js";
import { quantile } from "./quantgbm.js";

/** An event counts once its release type has this many earlier surprises to scale it by. */
const MIN_HISTORY = 12;
/** A bucket's history counts once it has this many moves; fewer, and the same side is pooled. */
const MIN_BUCKET = 15;

type Moves = Partial<Record<InstrumentKey, number | null>>;

export type ImpactEvent = {
  key: string;
  label: string;
  date: string;
  surprise: number;
  /** The surprise in standard deviations of this release's earlier surprises, + = hawkish. */
  z: number;
  /** 0 → 30 minutes, 30 → 90 minutes after the release, and the day. */
  first: Moves;
  second: Moves;
  day: Moves;
  /** +1: the 10Y yield and DXY both rose in the first 30 minutes; −1: both fell; 0: not together. */
  confirm: -1 | 0 | 1;
  /** How big this release usually moves markets: its earlier events' median |30-minute gold move|, %. */
  weight: number;
};

const sign = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Math.sign(v));

/**
 * A release's usual surprise, robustly: 1.4826 × the median absolute surprise (a standard deviation
 * for normal data), so that 2020's payrolls and jobless claims, off by millions, don't swamp it.
 */
export function scaleOf(surprises: number[]): number {
  const v = surprises.map(Math.abs).filter(Number.isFinite);
  const mad = v.length ? quantile(v, 0.5) * 1.4826 : 0;
  return mad > 0 ? mad : Math.sqrt(surprises.reduce((n, x) => n + x * x, 0) / Math.max(1, surprises.length)) || 1;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The events: every followed release since 2016 with its moves, in time order. */
export function impactEvents(inputs: Inputs, b30: Record<string, TvBar[]>, b60: Record<string, TvBar[]>, b1d: Record<string, TvBar[]>, now = Date.now()): ImpactEvent[] {
  const out: ImpactEvent[] = [];
  for (const t of TARGETS) {
    const data = rows(t, inputs);
    const past: number[] = [];
    const goldMoves: number[] = [];
    for (const r of data) {
      const at = Date.parse(r.date);
      const s = r.actual - r.consensus;
      if (at > now) break;
      if (past.length >= MIN_HISTORY && at >= Date.UTC(2016, 0, 1)) {
        const sd = scaleOf(past);
        const first: Moves = {};
        const second: Moves = {};
        const day: Moves = {};
        for (const inst of INSTRUMENTS) {
          const unit = inst.unit as "%" | "bp";
          const s30 = b30[inst.symbol] ?? [];
          const s60 = b60[inst.symbol] ?? [];
          first[inst.key] = moveIn(s30, 30, at, 30, unit) ?? moveIn(s60, 60, at, 30, unit);
          second[inst.key] = moveIn(s30, 30, at + 30 * 60_000, 60, unit) ?? moveIn(s60, 60, at + 30 * 60_000, 60, unit);
          day[inst.key] = dayMove(b1d[inst.symbol] ?? [], at, unit);
        }
        const c10 = sign(first.us10y);
        const cdx = sign(first.dxy);
        out.push({
          key: t.key,
          label: t.label,
          date: r.date,
          surprise: Math.round(s * 1000) / 1000,
          z: r2((s * t.hawk) / sd),
          first,
          second,
          day,
          confirm: c10 !== 0 && c10 === cdx ? (c10 as 1 | -1) : 0,
          weight: goldMoves.length ? quantile(goldMoves, 0.5) : 0.2,
        });
        if (first.xau !== null && first.xau !== undefined) goldMoves.push(Math.abs(first.xau));
        else if (day.xau !== null && day.xau !== undefined) goldMoves.push(Math.abs(day.xau) / 3);
      }
      past.push(s);
    }
  }
  // Releases out at the same minute (CPI and core CPI, claims beside retail sales) share one market
  // move: it's counted once, under the release whose surprise was biggest.
  const byTime = new Map<string, ImpactEvent>();
  for (const e of out) {
    const kept = byTime.get(e.date);
    if (!kept || Math.abs(e.z) > Math.abs(kept.z)) byTime.set(e.date, e);
  }
  return [...byTime.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- the history, bucketed

type Horizon = "first" | "second" | "day";
type Inst = (typeof INSTRUMENTS)[number];

export type Bucket = "dingin kuat" | "dingin" | "sesuai" | "panas" | "panas kuat";
export const bucketOf = (z: number): Bucket => (z <= -1 ? "dingin kuat" : z <= -0.5 ? "dingin" : z < 0.5 ? "sesuai" : z < 1 ? "panas" : "panas kuat");
const sideOf = (b: Bucket) => (b.startsWith("panas") ? 1 : b.startsWith("dingin") ? -1 : 0);

export type Band = { p10: number; p50: number; p90: number; n: number };

/**
 * An asset's moves after past events like this one (the same bucket; the same side when the bucket
 * is thin), each scaled from its release's size to this one's (`weight`).
 */
export function conditional(past: ImpactEvent[], inst: Inst, h: Horizon, z: number, weight: number): Band | null {
  const b = bucketOf(z);
  const pick = (f: (e: ImpactEvent) => boolean) =>
    past.filter((e) => f(e) && e[h][inst.key] !== null && e[h][inst.key] !== undefined).map((e) => (e[h][inst.key]! * weight) / Math.max(0.05, e.weight));
  let v = pick((e) => bucketOf(e.z) === b);
  if (v.length < MIN_BUCKET && sideOf(b) !== 0) v = pick((e) => sideOf(bucketOf(e.z)) === sideOf(b));
  if (v.length < MIN_BUCKET) return null;
  return { p10: r2(quantile(v, 0.1)), p50: r2(quantile(v, 0.5)), p90: r2(quantile(v, 0.9)), n: v.length };
}

export type Skill = {
  /** Events with a clear surprise (|z| ≥ 0.5) and a move. */
  calls: number;
  /** How often the history's median, and the plain rule (hawkish → the asset's usual way), had the move's direction. */
  hits: number;
  ruleHits: number;
  /** Share of all moves inside P10–P90. */
  coverage: number;
  n: number;
};

/** Walk-forward: each event's band from the events before it only. */
export function skill(events: ImpactEvent[], inst: Inst, h: Horizon): Skill {
  let n = 0;
  let inside = 0;
  let calls = 0;
  let hits = 0;
  let ruleHits = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const y = e[h][inst.key];
    if (y === null || y === undefined) continue;
    const band = conditional(events.slice(0, i), inst, h, e.z, e.weight);
    if (!band) continue;
    n++;
    if (y >= band.p10 && y <= band.p90) inside++;
    if (Math.abs(e.z) < 0.5 || y === 0) continue;
    calls++;
    if (Math.sign(band.p50) === Math.sign(y)) hits++;
    if (Math.sign(e.z) * inst.hawk === Math.sign(y)) ruleHits++;
  }
  return { calls, hits, ruleHits, coverage: n ? r2(inside / n) : 0, n };
}

/** The video's rule, counted: after a clear surprise, how often the 30–90 minute move followed through, confirmed or not. */
export function confirmationStats(events: ImpactEvent[]) {
  return INSTRUMENTS.map((inst) => {
    const tally = (pick: (e: ImpactEvent) => boolean) => {
      const v = events.filter((e) => Math.abs(e.z) >= 0.5 && pick(e) && e.second[inst.key] !== null && e.second[inst.key] !== undefined && e.second[inst.key] !== 0);
      const agree = v.filter((e) => Math.sign(e.second[inst.key]!) === Math.sign(e.z) * inst.hawk).length;
      return { n: v.length, agree };
    };
    return { key: inst.key, confirmed: tally((e) => e.confirm === Math.sign(e.z)), unconfirmed: tally((e) => e.confirm !== Math.sign(e.z)) };
  });
}

// ---------------------------------------------------------------- scenarios and the live watch

export type Scenario = { name: Bucket; z: number; print: number; first: Partial<Record<InstrumentKey, Band>>; day: Partial<Record<InstrumentKey, Band>> };

export type LiveWatch = {
  key: string;
  label: string;
  release: string;
  minutes: number;
  actual: number;
  consensus: number;
  z: number;
  status: "CONFIRMED" | "WAIT" | "INVALID" | "NETRAL";
  /** Moves since the release, from 1-minute bars. */
  moves: Moves;
  /** The 30 → 90 minute move after past events like this one, confirmed or not as this one is. */
  next: Partial<Record<InstrumentKey, Band>>;
};

export type Impact = {
  asOf: string;
  instruments: Array<{ key: string; label: string; unit: string; hawk: number; group: string }>;
  upcoming: Array<{ key: string; label: string; release: string; consensus: number; unit: string; p10: number; p90: number; scenarios: Scenario[] }>;
  live: LiveWatch[];
  skill: Array<{ key: string; first: Skill; day: Skill }>;
  confirmation: ReturnType<typeof confirmationStats>;
  events: number;
  /** The first event with 30-minute moves (intraday bars reach back to here). */
  since30: string | null;
};

/** Moves since a release for every instrument, from 1-minute bars (the live watch). */
async function minuteMoves(releaseMs: number, now: number): Promise<Moves> {
  const b = await bars(
    INSTRUMENTS.map((i) => i.symbol),
    "1",
    300,
    20_000,
  ).catch(() => ({}) as Record<string, TvBar[] | null>);
  const moves: Moves = {};
  for (const inst of INSTRUMENTS) {
    const series = b[inst.symbol] ?? [];
    const pre = [...series].reverse().find((x) => x.time * 1000 + 60_000 <= releaseMs);
    const last = [...series].reverse().find((x) => x.time * 1000 <= now);
    moves[inst.key] = !pre || !last || last.time * 1000 < releaseMs ? null : inst.unit === "bp" ? r2((last.close - pre.close) * 100) : r2(((last.close - pre.close) / pre.close) * 100);
  }
  return moves;
}

export async function impact(inputs: Inputs, engine: Engine, now = Date.now()): Promise<Impact> {
  const [b30, b60, b1d] = await Promise.all([barStore("30", 30 * 60_000, now), barStore("60", 3 * 3_600_000, now), barStore("1D", 6 * 3_600_000, now)]);
  const events = impactEvents(inputs, b30, b60, b1d, now);

  // A release's size: how far gold has usually moved on it in 30 minutes (its day move ÷ 3 before).
  const weightOf = (key: string) => [...events].reverse().find((e) => e.key === key)?.weight ?? 0.2;
  const sdOf = (t: Target) => scaleOf(rows(t, inputs).map((r) => r.actual - r.consensus));

  // Before: scenarios for the releases of the next week (one z per bucket), beside the engine's band.
  const upcoming: Impact["upcoming"] = [];
  for (const row of engine.rows) {
    const t = TARGETS.find((x) => x.key === row.key)!;
    if (row.actual !== null || Date.parse(row.release) < now || Date.parse(row.release) > now + 7 * 86_400_000) continue;
    const sd = sdOf(t);
    const weight = weightOf(t.key);
    const scen = (name: Bucket, z: number): Scenario => {
      const first: Scenario["first"] = {};
      const day: Scenario["day"] = {};
      for (const inst of INSTRUMENTS) {
        const f = conditional(events, inst, "first", z, weight);
        const d = conditional(events, inst, "day", z, weight);
        if (f) first[inst.key] = f;
        if (d) day[inst.key] = d;
      }
      const print = row.consensus + (z * sd) / t.hawk;
      return { name, z, print: t.unit === "K" ? Math.round(print) : r2(print), first, day };
    };
    upcoming.push({
      key: t.key,
      label: t.label,
      release: row.release,
      consensus: row.consensus,
      unit: t.unit,
      p10: row.p10,
      p90: row.p90,
      scenarios: [scen("dingin kuat", -1.5), scen("dingin", -0.75), scen("sesuai", 0), scen("panas", 0.75), scen("panas kuat", 1.5)],
    });
  }

  // After: releases out in the last two hours, watched minute by minute.
  const live: LiveWatch[] = [];
  const recent = inputs.releases.filter((e) => e.actual !== null && e.forecast !== null && Date.parse(e.date) <= now && now - Date.parse(e.date) < 2 * 3_600_000);
  const minute = new Map<number, Moves>();
  for (const e of recent) {
    const t = TARGETS.find((x) => x.title === e.title);
    if (!t) continue;
    const at = Date.parse(e.date);
    if (!minute.has(at)) minute.set(at, await minuteMoves(at, now));
    const moves = minute.get(at)!;
    const z = r2(((e.actual! - e.forecast!) * t.hawk) / sdOf(t));
    const side = Math.abs(z) < 0.5 ? 0 : Math.sign(z);
    const y = sign(moves.us10y);
    const d = sign(moves.dxy);
    const status: LiveWatch["status"] = side === 0 ? "NETRAL" : y === side && d === side ? "CONFIRMED" : y === -side && d === -side ? "INVALID" : "WAIT";
    const confirmed = status === "CONFIRMED";
    const like = events.filter((x) => Math.sign(x.z) === side && Math.abs(x.z) >= 0.5 && (x.confirm === side) === confirmed);
    const next: LiveWatch["next"] = {};
    for (const inst of INSTRUMENTS) {
      const v = like.map((x) => x.second[inst.key]).filter((m): m is number => m !== null && m !== undefined);
      if (v.length >= MIN_BUCKET) next[inst.key] = { p10: r2(quantile(v, 0.1)), p50: r2(quantile(v, 0.5)), p90: r2(quantile(v, 0.9)), n: v.length };
    }
    live.push({ key: t.key, label: t.label, release: e.date, minutes: Math.round((now - at) / 60_000), actual: e.actual!, consensus: e.forecast!, z, status, moves, next });
  }

  const timed = events.find((e) => e.first.xau !== null && e.first.xau !== undefined);
  return {
    asOf: new Date(now).toISOString(),
    instruments: INSTRUMENTS.map((i) => ({ key: i.key, label: i.label, unit: i.unit, hawk: i.hawk, group: i.group })),
    upcoming,
    live,
    skill: INSTRUMENTS.map((inst) => ({ key: inst.key, first: skill(events, inst, "first"), day: skill(events, inst, "day") })),
    confirmation: confirmationStats(events),
    events: events.length,
    since30: timed?.date ?? null,
  };
}
