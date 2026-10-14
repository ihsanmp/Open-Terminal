// How markets actually moved on each release and Fed broadcast, against what the engine and the
// Fed Sentiment Index said (the blueprint's point: markets move on actual vs expected).
//
// For each release the engine follows: gold, bitcoin, S&P 500 futures, the dollar index and the
// 2-year yield, from the price at the release to 30 minutes after (TradingView bars: 30-minute bars
// cover this year, hourly bars the year before, window ~±30 min around the release; daily bars back
// to 2016 give the release day's close against the day before). A hawkish surprise should send
// gold, bitcoin and stocks down, the dollar and the 2-year yield up; how often they did is the
// test, for the surprise itself and for the engine's call made before it (walk-forward).
// Fed broadcasts are kept as they're followed (start, end, the index heard) and scored the same way.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { bars, type TvBar } from "./tvchart.js";
import { biasOf, rows, TARGETS, walkForward, type Bias, type Inputs } from "./macroengine.js";

const dir = join(dataDir, "macro-engine");

export const INSTRUMENTS = [
  { key: "xau", label: "XAU/USD", symbol: "OANDA:XAUUSD", hawk: -1, unit: "%" },
  { key: "btc", label: "BTC", symbol: "BITSTAMP:BTCUSD", hawk: -1, unit: "%" },
  { key: "es", label: "S&P 500 fut", symbol: "CME_MINI:ES1!", hawk: -1, unit: "%" },
  { key: "dxy", label: "DXY", symbol: "TVC:DXY", hawk: 1, unit: "%" },
  { key: "us2y", label: "Yield 2Y", symbol: "TVC:US02Y", hawk: 1, unit: "bp" },
] as const;
export type InstrumentKey = (typeof INSTRUMENTS)[number]["key"];

type Store = { at: number; bars: Record<string, TvBar[]> };

function read<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}
function write(file: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/**
 * The instruments' bars at a resolution, kept on disk and merged with each read: TradingView gives
 * only the latest few thousand, so the store grows forward from the first read.
 */
export async function barStore(resolution: "30" | "60" | "1D", maxAgeMs: number, now = Date.now()): Promise<Record<string, TvBar[]>> {
  const file = join(dir, `bars-${resolution}.json`);
  const store = read<Store>(file) ?? { at: 0, bars: {} };
  if (now - store.at < maxAgeMs && INSTRUMENTS.every((i) => store.bars[i.symbol]?.length)) return store.bars;
  const fresh = await bars(
    INSTRUMENTS.map((i) => i.symbol),
    resolution,
    resolution === "1D" ? 3000 : 20000,
    40_000,
  ).catch(() => ({}) as Record<string, TvBar[] | null>);
  for (const i of INSTRUMENTS) {
    const merged = new Map<number, TvBar>();
    for (const b of store.bars[i.symbol] ?? []) merged.set(b.time, b);
    for (const b of fresh[i.symbol] ?? []) merged.set(b.time, b);
    store.bars[i.symbol] = [...merged.values()].sort((a, b) => a.time - b.time);
  }
  store.at = now;
  write(file, store);
  return store.bars;
}

/**
 * The move over a window starting at `startMs` and `minutes` long, from bars of `res` minutes: the
 * last bar ending by the start against the first ending at or after the end (null when there's no
 * bar near either, the market shut). A % change, or basis points for a yield.
 */
export function moveIn(series: TvBar[], res: number, startMs: number, minutes: number, unit: "%" | "bp"): number | null {
  const R = res * 60_000;
  const end = startMs + minutes * 60_000;
  let pre: TvBar | undefined;
  let post: TvBar | undefined;
  for (const b of series) {
    const close = b.time * 1000 + R;
    if (close <= startMs) pre = b;
    else if (close >= end && !post) post = b;
  }
  if (!pre || !post) return null;
  // Both within a bar of the window: a gap (a weekend, a holiday) is no reading.
  if (startMs - (pre.time * 1000 + R) > R || post.time * 1000 + R - end > R) return null;
  return unit === "bp" ? Math.round((post.close - pre.close) * 10000) / 100 : Math.round(((post.close - pre.close) / pre.close) * 10000) / 100;
}

/**
 * The release day's close against the day before's: the daily bar the release falls in (a bar's
 * time is its session's open, which for FX is the evening before) and the one before it.
 */
export function dayMove(series: TvBar[], releaseMs: number, unit: "%" | "bp"): number | null {
  let i = -1;
  for (let k = 0; k < series.length && series[k].time * 1000 <= releaseMs; k++) i = k;
  if (i < 1 || releaseMs - series[i].time * 1000 > 86_400_000) return null;
  const pre = series[i - 1];
  const post = series[i];
  return unit === "bp" ? Math.round((post.close - pre.close) * 10000) / 100 : Math.round(((post.close - pre.close) / pre.close) * 10000) / 100;
}

export type Moves = Partial<Record<InstrumentKey, number | null>>;

export type ReleaseReaction = {
  key: string;
  label: string;
  date: string;
  surprise: number;
  /** The surprise's side (a print above the consensus is hawkish for inflation and jobs). */
  side: Bias;
  /** The engine's call before the release (walk-forward), null before its 36th release. */
  call: Bias | null;
  /** ~30 minutes from the release (30-minute or hourly bars), and the day. */
  m30: Moves;
  day: Moves;
};

/** Whether a move went the way a side says (hawkish: gold, BTC, stocks down; dollar, yield up). */
export function agrees(side: Bias, inst: (typeof INSTRUMENTS)[number], move: number | null | undefined): boolean | null {
  if (side === "neutral" || move === null || move === undefined || move === 0) return null;
  return Math.sign(move) === (side === "hawkish" ? inst.hawk : -inst.hawk);
}

export type Tally = Record<InstrumentKey, { n: number; agree: number }>;
const emptyTally = (): Tally => Object.fromEntries(INSTRUMENTS.map((i) => [i.key, { n: 0, agree: 0 }])) as Tally;

function count(t: Tally, side: Bias | null, moves: Moves): void {
  if (!side) return;
  for (const inst of INSTRUMENTS) {
    const a = agrees(side, inst, moves[inst.key]);
    if (a === null) continue;
    t[inst.key].n++;
    if (a) t[inst.key].agree++;
  }
}

export type FedBroadcast = { videoId: string; title: string; start: number; end: number; index: number };
export type BroadcastReaction = FedBroadcast & { side: Bias; moves: Moves };

const fedFile = () => join(dir, "fed-broadcasts.json");

/** Keeps a followed Fed broadcast (one entry a video, the latest reading) to score afterwards. */
export function noteFedBroadcast(b: FedBroadcast): void {
  const all = read<FedBroadcast[]>(fedFile()) ?? [];
  const i = all.findIndex((x) => x.videoId === b.videoId);
  if (i >= 0) all[i] = { ...b, start: Math.min(all[i].start, b.start) };
  else all.push(b);
  write(fedFile(), all.slice(-200));
}

export type Reactions = {
  asOf: string;
  releases: ReleaseReaction[];
  /** By target: how often each instrument moved the surprise's way (~30 min / day), and the engine's call's. */
  summary: Array<{ key: string; label: string; surprise30: Tally; surpriseDay: Tally; call30: Tally; callDay: Tally; releases: number }>;
  broadcasts: BroadcastReaction[];
  instruments: Array<{ key: string; label: string; unit: string }>;
};

const sideOfIndex = (index: number): Bias => (index >= 0.2 ? "hawkish" : index <= -0.2 ? "dovish" : "neutral");

export async function reactions(inputs: Inputs, now = Date.now()): Promise<Reactions> {
  const [b30, b60, b1d] = await Promise.all([barStore("30", 30 * 60_000, now), barStore("60", 3 * 3_600_000, now), barStore("1D", 6 * 3_600_000, now)]);
  const out: ReleaseReaction[] = [];
  const summary: Reactions["summary"] = [];
  for (const t of TARGETS) {
    const data = rows(t, inputs);
    const calls = new Map(walkForward(data).map((p) => [p.date, p]));
    const sum = { key: t.key, label: t.label, surprise30: emptyTally(), surpriseDay: emptyTally(), call30: emptyTally(), callDay: emptyTally(), releases: 0 };
    for (const r of data) {
      const at = Date.parse(r.date);
      if (at < Date.UTC(2016, 0, 1) || at > now) continue;
      const s = r.actual - r.consensus;
      const m30: Moves = {};
      const day: Moves = {};
      for (const inst of INSTRUMENTS) {
        const unit = inst.unit as "%" | "bp";
        m30[inst.key] = moveIn(b30[inst.symbol] ?? [], 30, at, 30, unit) ?? moveIn(b60[inst.symbol] ?? [], 60, at, 30, unit);
        day[inst.key] = dayMove(b1d[inst.symbol] ?? [], at, unit);
      }
      const p = calls.get(r.date);
      const side = biasOf(t, s);
      const call = p ? biasOf(t, p.mid) : null;
      count(sum.surprise30, side, m30);
      count(sum.surpriseDay, side, day);
      count(sum.call30, call, m30);
      count(sum.callDay, call, day);
      sum.releases++;
      out.push({ key: t.key, label: t.label, date: r.date, surprise: Math.round(s * 1000) / 1000, side, call, m30, day });
    }
    summary.push(sum);
  }
  const broadcasts = (read<FedBroadcast[]>(fedFile()) ?? []).map((b) => {
    const moves: Moves = {};
    const minutes = Math.max(30, Math.round((b.end - b.start) / 60_000));
    for (const inst of INSTRUMENTS) moves[inst.key] = moveIn(b30[inst.symbol] ?? [], 30, b.start, minutes, inst.unit as "%" | "bp");
    return { ...b, side: sideOfIndex(b.index), moves };
  });
  return {
    asOf: new Date(now).toISOString(),
    releases: out.filter((r) => Object.values(r.m30).some((v) => v !== null) || Object.values(r.day).some((v) => v !== null)).sort((a, b) => b.date.localeCompare(a.date)),
    summary,
    broadcasts: broadcasts.sort((a, b) => b.start - a.start),
    instruments: INSTRUMENTS.map((i) => ({ key: i.key, label: i.label, unit: i.unit })),
  };
}

