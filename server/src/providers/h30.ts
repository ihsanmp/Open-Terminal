// The conclusion 30 minutes before a big release (H-30): where crypto, forex, stocks, the dollar,
// oil and gold are likely to go in the release's first 30 minutes, as a price.
//
// The engine's band for the print (P10/P50/P90, with the Fed Sentiment Index's nudge) becomes odds
// for each surprise bucket (very cool … very hot); past events' 30-minute moves are weighed by those
// odds (each bucket's history carrying its bucket's probability), scaled to this release's size.
// The weighted moves give each asset's chance of rising, its median move and P10–P90 range, and the
// prices those mean from the price now. Releases out at the same minute are read through the one
// that moves markets most. The conclusion is kept when the half hour begins, and scored against
// what the market did; the same recipe is also tested walk-forward on past releases.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { bars, type TvBar } from "./tvchart.js";
import { rows, TARGETS, walkForward, type Engine, type EngineRow, type Inputs } from "./macroengine.js";
import { INSTRUMENTS, type InstrumentKey } from "./reactions.js";
import { bucketOf, scaleOf, type Bucket, type ImpactEvent } from "./newsimpact.js";
import { quantile } from "./quantgbm.js";

const dir = join(dataDir, "macro-engine");
const file = () => join(dir, "h30-conclusions.json");
const BUCKETS: Bucket[] = ["dingin kuat", "dingin", "sesuai", "panas", "panas kuat"];
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The odds of each surprise bucket from three quantiles of the surprise (in z): a piecewise-linear
 * distribution through (z10, 10%), (z50, 50%), (z90, 90%), carried on at the same slopes beyond.
 */
export function bucketProbs(zq: [number, number, number]): Record<Bucket, number> {
  let [a, b, c] = [...zq].sort((x, y) => x - y);
  // A band of no width still has the release's usual uncertainty (±0.1 z at least).
  if (b - a < 0.05) a = b - 0.1;
  if (c - b < 0.05) c = b + 0.1;
  const lo = 0.4 / (b - a);
  const hi = 0.4 / (c - b);
  const cdf = (z: number) => Math.max(0, Math.min(1, z <= a ? 0.1 - (a - z) * lo : z <= b ? 0.1 + (z - a) * lo : z <= c ? 0.5 + (z - b) * hi : 0.9 + (z - c) * hi));
  const edges = [cdf(-1), cdf(-0.5), cdf(0.5), cdf(1)];
  return {
    "dingin kuat": edges[0],
    dingin: edges[1] - edges[0],
    sesuai: edges[2] - edges[1],
    panas: edges[3] - edges[2],
    "panas kuat": 1 - edges[3],
  };
}

export type Lean = { pUp: number; p10: number; p50: number; p90: number; n: number };

/** An asset's 30-minute moves after past events, each weighed by its bucket's odds now (shared in the bucket), scaled to this release. */
export function weighedMoves(past: ImpactEvent[], key: InstrumentKey, probs: Record<Bucket, number>, weight: number): Lean | null {
  const byBucket = new Map<Bucket, number[]>();
  for (const e of past) {
    const m = e.first[key];
    if (m === null || m === undefined) continue;
    const b = bucketOf(e.z);
    byBucket.set(b, [...(byBucket.get(b) ?? []), (m * weight) / Math.max(0.05, e.weight)]);
  }
  const points: Array<{ v: number; w: number }> = [];
  for (const b of BUCKETS) {
    const v = byBucket.get(b) ?? [];
    if (!v.length || probs[b] <= 0) continue;
    for (const x of v) points.push({ v: x, w: probs[b] / v.length });
  }
  const total = points.reduce((n, p) => n + p.w, 0);
  if (points.length < 10 || total <= 0) return null;
  points.sort((x, y) => x.v - y.v);
  const q = (alpha: number) => {
    let acc = 0;
    for (const p of points) {
      acc += p.w / total;
      if (acc >= alpha) return p.v;
    }
    return points[points.length - 1].v;
  };
  const up = points.filter((p) => p.v > 0).reduce((n, p) => n + p.w, 0);
  const down = points.filter((p) => p.v < 0).reduce((n, p) => n + p.w, 0);
  return { pUp: r2(up / Math.max(1e-9, up + down)), p10: r2(q(0.1)), p50: r2(q(0.5)), p90: r2(q(0.9)), n: points.length };
}

export type Dir = "naik" | "turun" | "datar";
const dirOf = (pUp: number): Dir => (pUp >= 0.55 ? "naik" : pUp <= 0.45 ? "turun" : "datar");

export type AssetConclusion = {
  key: InstrumentKey;
  label: string;
  group: string;
  unit: string;
  dir: Dir;
  /** The chance of the direction named (of rising for "naik" and "datar", of falling for "turun"). */
  chance: number;
  lean: Lean;
  price: number | null;
  /** The prices the P10 / P50 / P90 moves mean from now (a yield in %, moved in bp). */
  levels: { p10: number; p50: number; p90: number } | null;
};

export type H30Conclusion = {
  release: string;
  /** The release read (the one that moves markets most at that minute), and the others out with it. */
  driver: { key: string; label: string; consensus: number; p10: number; p50: number; p90: number };
  others: string[];
  probs: Record<Bucket, number>;
  assets: AssetConclusion[];
  at: string;
  /** Kept at H-30 (true), or the live view before then. */
  final: boolean;
};

export type ScoredConclusion = H30Conclusion & { moves: Partial<Record<InstrumentKey, number | null>>; hits: number; calls: number };

/** A price after a move, to the precision the price is quoted in (EUR/USD to 5 decimals, gold to 2). */
export function levelOf(price: number, move: number, unit: string): number {
  const v = unit === "bp" ? price + move / 100 : price * (1 + move / 100);
  const decimals = unit === "bp" ? 3 : price < 10 ? 5 : price < 1000 ? 3 : 2;
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
}

/** The latest price of every instrument (1-minute bars). */
async function prices(): Promise<Partial<Record<InstrumentKey, number>>> {
  const b = await bars(
    INSTRUMENTS.map((i) => i.symbol),
    "1",
    5,
    15_000,
  ).catch(() => ({}) as Record<string, TvBar[] | null>);
  const out: Partial<Record<InstrumentKey, number>> = {};
  for (const i of INSTRUMENTS) {
    const last = b[i.symbol]?.at(-1);
    if (last) out[i.key] = last.close;
  }
  return out;
}

/** The three quantiles of a release's surprise in z, hawkish-signed, from the engine's band (median nudged by the Fed). */
function zBand(row: EngineRow, hawk: 1 | -1, scale: number): [number, number, number] {
  const shift = row.adjusted - row.p50;
  return [row.p10 + shift, row.adjusted, row.p90 + shift].map((v) => ((v - row.consensus) * hawk) / scale) as [number, number, number];
}

function conclude(events: ImpactEvent[], row: EngineRow, others: string[], now: number, px: Partial<Record<InstrumentKey, number>>, inputs: Inputs): H30Conclusion | null {
  const t = TARGETS.find((x) => x.key === row.key)!;
  const scale = scaleOf(rows(t, inputs).map((r) => r.actual - r.consensus));
  const probs = bucketProbs(zBand(row, t.hawk, scale));
  const weight = [...events].reverse().find((e) => e.key === t.key)?.weight ?? 0.2;
  const assets: AssetConclusion[] = [];
  for (const inst of INSTRUMENTS) {
    const lean = weighedMoves(events, inst.key, probs, weight);
    if (!lean) continue;
    const dir = dirOf(lean.pUp);
    const price = px[inst.key] ?? null;
    assets.push({
      key: inst.key,
      label: inst.label,
      group: inst.group,
      unit: inst.unit,
      dir,
      chance: dir === "turun" ? r2(1 - lean.pUp) : lean.pUp,
      lean,
      price,
      levels: price === null ? null : { p10: levelOf(price, lean.p10, inst.unit), p50: levelOf(price, lean.p50, inst.unit), p90: levelOf(price, lean.p90, inst.unit) },
    });
  }
  const r = (k: number) => Object.fromEntries(Object.entries(probs).map(([b, p]) => [b, Math.round(p * k) / k])) as Record<Bucket, number>;
  return {
    release: row.release,
    driver: { key: t.key, label: t.label, consensus: row.consensus, p10: row.p10, p50: row.adjusted, p90: row.p90 },
    others,
    probs: r(1000),
    assets,
    at: new Date(now).toISOString(),
    final: false,
  };
}

/** The conclusions kept at H-30, by release time. */
function kept(): Record<string, H30Conclusion> {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Record<string, H30Conclusion>) : {};
  } catch {
    return {};
  }
}

export type H30Skill = Partial<Record<InstrumentKey, { calls: number; hits: number }>>;

/**
 * The recipe walk-forward: each past event's conclusion from the engine's walk-forward band for it
 * and the events before it only, against its 30-minute move.
 */
export function h30Backtest(events: ImpactEvent[], inputs: Inputs): H30Skill {
  const bands = new Map<string, { lo: number; mid: number; hi: number }>();
  for (const t of TARGETS) for (const p of walkForward(rows(t, inputs))) bands.set(`${t.key}|${p.date}`, p);
  const out: H30Skill = {};
  for (const inst of INSTRUMENTS) out[inst.key] = { calls: 0, hits: 0 };
  events.forEach((e, i) => {
    const b = bands.get(`${e.key}|${e.date}`);
    const t = TARGETS.find((x) => x.key === e.key);
    if (!b || !t) return;
    const probs = bucketProbs([b.lo, b.mid, b.hi].map((v) => (v * t.hawk) / e.scale) as [number, number, number]);
    const past = events.slice(0, i);
    for (const inst of INSTRUMENTS) {
      const y = e.first[inst.key];
      if (y === null || y === undefined || y === 0) continue;
      const lean = weighedMoves(past, inst.key, probs, e.weight);
      if (!lean) continue;
      const dir = dirOf(lean.pUp);
      if (dir === "datar") continue;
      out[inst.key]!.calls++;
      if ((dir === "naik") === y > 0) out[inst.key]!.hits++;
    }
  });
  return out;
}

export type H30 = { next: H30Conclusion | null; recent: ScoredConclusion[]; skill: H30Skill };

/**
 * The next release time's conclusion (kept once inside its last half hour), and the kept ones of
 * the last 60 days scored against the 30-minute moves that followed.
 */
export async function h30(events: ImpactEvent[], inputs: Inputs, engine: Engine, now = Date.now()): Promise<H30> {
  const store = kept();
  // The next release minute, its releases, and the one that moves markets most.
  const due = engine.rows.filter((r) => r.actual === null && Date.parse(r.release) > now).sort((a, b) => a.release.localeCompare(b.release));
  let next: H30Conclusion | null = null;
  if (due.length) {
    const time = due[0].release;
    const same = due.filter((r) => r.release === time);
    const weightOf = (key: string) => [...events].reverse().find((e) => e.key === key)?.weight ?? 0;
    const driver = [...same].sort((a, b) => weightOf(b.key) - weightOf(a.key))[0];
    const left = Date.parse(time) - now;
    if (store[time]) next = store[time];
    else {
      next = conclude(events, driver, same.filter((r) => r !== driver).map((r) => r.label), now, await prices(), inputs);
      if (next && left <= 30 * 60_000) {
        next.final = true;
        store[time] = next;
        mkdirSync(dir, { recursive: true });
        writeFileSync(file(), JSON.stringify(store));
      }
    }
  }
  const byTime = new Map(events.map((e) => [e.date, e]));
  const recent: ScoredConclusion[] = Object.values(store)
    .filter((c) => Date.parse(c.release) <= now && Date.parse(c.release) > now - 60 * 86_400_000)
    .map((c) => {
      const e = byTime.get(c.release);
      const moves: ScoredConclusion["moves"] = {};
      let hits = 0;
      let calls = 0;
      for (const a of c.assets) {
        const y = e?.first[a.key] ?? null;
        moves[a.key] = y;
        if (y === null || y === 0 || a.dir === "datar") continue;
        calls++;
        if ((a.dir === "naik") === y > 0) hits++;
      }
      return { ...c, moves, hits, calls };
    })
    .sort((a, b) => b.release.localeCompare(a.release));
  return { next, recent, skill: h30Backtest(events, inputs) };
}

