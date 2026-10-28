// Scenarios for the Fed's rate decision. Unlike a data release it has no surprise to scale: the
// consensus on the rate is right nearly every time (98% of 118 meetings, in the research the app
// follows, "Astronomi, Makro, dan Pergerakan Market"), and markets move on the statement, the dot
// plot and the press conference. So a meeting is read the way the market read it: the 2-year
// yield's move after the statement (the market's own measure of where the Fed is headed), from
// clearly dovish to clearly hawkish; for each, what gold, bitcoin, stocks, the dollar, oil and the
// 10-year yield did in the first 30 minutes and over the day, at past meetings since 2016. And
// how often each went the 2-year's way (the usual one: hawkish lifts the dollar and yields and
// weighs on gold, crypto and stocks). The next meeting's FedWatch odds go beside it.

import { barStore, dayMove, INSTRUMENTS, moveIn, type InstrumentKey } from "./reactions.js";
import { usReleases } from "./macroengine.js";
import { quantile } from "./quantgbm.js";
import { fedWatch } from "./fedwatch.js";

export type FomcBucket = "dovish kuat" | "dovish" | "netral" | "hawkish" | "hawkish kuat";
export const FOMC_BUCKETS: FomcBucket[] = ["dovish kuat", "dovish", "netral", "hawkish", "hawkish kuat"];

/** Where the 2-year's move puts a meeting (bp): the first 30 minutes, and the day (wider: more news in it). */
export const LIMITS = { first: [1.5, 4], day: [3, 8] } as const;
export type Span = keyof typeof LIMITS;

export function bucketOf(move: number, span: Span): FomcBucket {
  const [a, b] = LIMITS[span];
  return move <= -b ? "dovish kuat" : move <= -a ? "dovish" : move < a ? "netral" : move < b ? "hawkish" : "hawkish kuat";
}

/** The markets shown (the 2-year sorts the meetings, so it isn't one of them). */
const SHOWN: InstrumentKey[] = ["xau", "btc", "es", "dxy", "oil", "us10y"];

export type FomcMeeting = { date: string; at: number; first: Partial<Record<InstrumentKey, number | null>>; day: Partial<Record<InstrumentKey, number | null>> };
export type Cell = { p10: number; p50: number; p90: number; n: number };
export type FomcScenarioSpan = {
  /** The meetings in each bucket, and each market's moves there. */
  buckets: Array<{ name: FomcBucket; range: string; n: number; cells: Partial<Record<InstrumentKey, Cell>> }>;
  /** After a clear read (outside "netral"): how often each market went the 2-year's usual way. */
  follow: Partial<Record<InstrumentKey, { n: number; agree: number }>>;
  meetings: number;
};
export type FomcScenarios = {
  instruments: Array<{ key: InstrumentKey; label: string; unit: string; hawk: number }>;
  first: FomcScenarioSpan;
  day: FomcScenarioSpan;
  next: { at: string; consensus: number | null; previous: number | null; odds: Record<string, number> | null } | null;
  since: string | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The buckets and the follow-through, from the meetings' moves (exported for the tests). */
export function scenarioSpan(meetings: FomcMeeting[], span: Span, minN = 3): FomcScenarioSpan {
  const usable = meetings.filter((m) => m[span].us2y !== null && m[span].us2y !== undefined);
  const buckets = FOMC_BUCKETS.map((name) => {
    const inB = usable.filter((m) => bucketOf(m[span].us2y!, span) === name);
    const cells: Partial<Record<InstrumentKey, Cell>> = {};
    for (const k of SHOWN) {
      const v = inB.map((m) => m[span][k]).filter((x): x is number => x !== null && x !== undefined);
      if (v.length >= minN) cells[k] = { p10: r2(quantile(v, 0.1)), p50: r2(quantile(v, 0.5)), p90: r2(quantile(v, 0.9)), n: v.length };
    }
    const [a, b] = LIMITS[span];
    const range = name === "dovish kuat" ? `2Y ≤ −${b} bp` : name === "dovish" ? `2Y −${b} … −${a} bp` : name === "netral" ? `2Y ±${a} bp` : name === "hawkish" ? `2Y +${a} … +${b} bp` : `2Y ≥ +${b} bp`;
    return { name, range, n: inB.length, cells };
  });
  const follow: FomcScenarioSpan["follow"] = {};
  for (const k of SHOWN) {
    const inst = INSTRUMENTS.find((i) => i.key === k)!;
    let n = 0;
    let agree = 0;
    for (const m of usable) {
      const y = m[span].us2y!;
      const v = m[span][k];
      if (bucketOf(y, span) === "netral" || v === null || v === undefined || v === 0) continue;
      n++;
      if (Math.sign(v) === Math.sign(y) * inst.hawk) agree++;
    }
    follow[k] = { n, agree };
  }
  return { buckets, follow, meetings: usable.length };
}

/** The scenarios from the meetings since 2016 and the next one's FedWatch odds. */
export async function fomcScenarios(now = Date.now()): Promise<FomcScenarios> {
  const releases = (await usReleases(now)).filter((r) => r.title === "Fed Interest Rate Decision");
  const [b30, b60, b1d] = await Promise.all([barStore("30", 30 * 60_000, now), barStore("60", 3 * 3_600_000, now), barStore("1D", 6 * 3_600_000, now)]);
  const meetings: FomcMeeting[] = [];
  for (const r of releases) {
    const at = Date.parse(r.date);
    if (at > now - 30 * 60_000 || at < Date.UTC(2016, 0, 1)) continue;
    const first: FomcMeeting["first"] = {};
    const day: FomcMeeting["day"] = {};
    for (const inst of INSTRUMENTS) {
      const unit = inst.unit as "%" | "bp";
      first[inst.key] = moveIn(b30[inst.symbol] ?? [], 30, at, 30, unit) ?? moveIn(b60[inst.symbol] ?? [], 60, at, 30, unit);
      day[inst.key] = dayMove(b1d[inst.symbol] ?? [], at, unit);
    }
    meetings.push({ date: r.date, at, first, day });
  }
  const upcoming = releases.filter((r) => Date.parse(r.date) > now).sort((a, b) => a.date.localeCompare(b.date))[0];
  let odds: Record<string, number> | null = null;
  if (upcoming) {
    const fw = await fedWatch(new Date(now)).catch(() => null);
    odds = fw?.meetings.find((m) => m.date === upcoming.date.slice(0, 10))?.probs ?? fw?.next?.at[0]?.probs ?? null;
  }
  return {
    instruments: SHOWN.map((k) => INSTRUMENTS.find((i) => i.key === k)!).map((i) => ({ key: i.key, label: i.label, unit: i.unit, hawk: i.hawk })),
    first: scenarioSpan(meetings, "first"),
    day: scenarioSpan(meetings, "day"),
    next: upcoming ? { at: upcoming.date, consensus: upcoming.forecast, previous: upcoming.previous, odds } : null,
    since: meetings[0]?.date ?? null,
  };
}
