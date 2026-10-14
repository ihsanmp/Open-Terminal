// FOMC target-rate probabilities, worked out as CME's FedWatch does from the 30-Day Fed Funds
// futures (CBOT ZQ, one contract a month, priced 100 − the month's average effective rate):
//
//   - Each meeting starts from the rate the one before it ended on (the first from today's
//     effective rate). Its end rate is the next month's average when that month has no meeting
//     (the whole month at the new rate), else it's backed out of the meeting month's average:
//     avg = start × d/N + end × (N − d)/N, d the days before the change takes effect.
//   - The move (end − start) is read in 25bp steps: a move of 0.15 is a 60% chance of +25bp and
//     40% of none. Chained meeting to meeting, that gives each target range's probability.
//
// Prices come from TradingView's chart feed (CBOT:ZQV2026 …), ten minutes late without an account.

import * as tvchart from "./tvchart.js";
import * as fred from "./fred.js";

/** The FOMC's decision days (the second day of each meeting), as the Fed has scheduled them. */
export const FOMC_MEETINGS = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];

const MONTH_CODES = "FGHJKMNQUVXZ";
const STEP = 0.25;

/** "2026-10" → "CBOT:ZQV2026". */
export const zqSymbol = (month: string) => `CBOT:ZQ${MONTH_CODES[Number(month.slice(5, 7)) - 1]}${month.slice(0, 4)}`;
const monthOf = (date: string) => date.slice(0, 7);
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const nextMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** A target range's label in basis points, as FedWatch writes it: 3.75 → "375-400". */
export const bucketLabel = (lower: number) => `${Math.round(lower * 100)}-${Math.round((lower + STEP) * 100)}`;

export type MeetingOdds = { date: string; probs: Record<string, number> };

/**
 * Each upcoming meeting's target-range probabilities.
 * @param prices  each month's contract price ("2026-10" → 96.115)
 * @param effr    the effective rate now (%)
 * @param lower   the target range's lower bound now (%)
 */
export function fedwatchOdds(meetings: string[], prices: Record<string, number>, effr: number, lower: number): MeetingOdds[] {
  const meetingMonths = new Set(meetings.map(monthOf));
  // The distribution over target ranges, as steps of 25bp from today's (0 = unchanged).
  let dist = new Map<number, number>([[0, 1]]);
  let start = effr;
  const out: MeetingOdds[] = [];
  for (const date of meetings) {
    const month = monthOf(date);
    const avg = prices[month] !== undefined ? 100 - prices[month] : null;
    const next = nextMonth(month);
    const nextAvg = !meetingMonths.has(next) && prices[next] !== undefined ? 100 - prices[next] : null;
    let end: number | null = null;
    if (nextAvg !== null) end = nextAvg;
    else if (avg !== null) {
      const n = daysIn(month);
      const d = Number(date.slice(8, 10)); // the new rate from the day after the decision
      end = n - d > 0 ? (avg - (start * d) / n) / ((n - d) / n) : avg;
    }
    if (end === null) break; // no contract that far out
    const steps = (end - start) / STEP;
    const lo = Math.floor(steps);
    const frac = steps - lo;
    const moved = new Map<number, number>();
    for (const [k, p] of dist) {
      if (1 - frac > 1e-9) moved.set(k + lo, (moved.get(k + lo) ?? 0) + p * (1 - frac));
      if (frac > 1e-9) moved.set(k + lo + 1, (moved.get(k + lo + 1) ?? 0) + p * frac);
    }
    dist = moved;
    start = end;
    const probs: Record<string, number> = {};
    for (const [k, p] of [...dist].sort((a, b) => a[0] - b[0])) if (p >= 0.0005) probs[bucketLabel(lower + k * STEP)] = p;
    out.push({ date, probs });
  }
  return out;
}

export type FedWatch = {
  asOf: number;
  target: { lower: number; upper: number };
  effr: number;
  buckets: string[];
  meetings: MeetingOdds[];
  /** The next meeting's odds now and a day, a week and a month ago. */
  next: { date: string; at: Array<{ label: string; date: string; probs: Record<string, number> }> } | null;
  source: string;
};

/** Today's FedWatch table, and the next meeting's odds back over the last month. */
export async function fedWatch(now = new Date()): Promise<FedWatch> {
  const today = now.toISOString().slice(0, 10);
  const meetings = FOMC_MEETINGS.filter((d) => d >= today);
  if (!meetings.length) throw new Error("fedwatch: no meetings scheduled ahead");
  // Every month from this one to the month after the last meeting.
  const months: string[] = [];
  for (let m = monthOf(today); m <= nextMonth(monthOf(meetings.at(-1)!)); m = nextMonth(m)) months.push(m);
  const [bars, upper, lowerPt, effrPt] = await Promise.all([
    tvchart.bars(months.map(zqSymbol), "1D", 45),
    fred.latest("DFEDTARU"),
    fred.latest("DFEDTARL"),
    fred.latest("EFFR"),
  ]);
  if (!upper || !lowerPt) throw new Error("fedwatch: target range unavailable");
  const lower = lowerPt.value;
  const effr = effrPt?.value ?? lower + 0.08;

  /** Each month's price on a day (the last close on or before it). */
  const pricesOn = (day: string | null) => {
    const prices: Record<string, number> = {};
    for (const m of months) {
      const b = bars[zqSymbol(m)];
      if (!b?.length) continue;
      const bar = day ? [...b].reverse().find((x) => new Date(x.time * 1000).toISOString().slice(0, 10) <= day) : b.at(-1);
      if (bar) prices[m] = bar.close;
    }
    return prices;
  };
  const odds = fedwatchOdds(meetings, pricesOn(null), effr, lower);
  const buckets = [...new Set(odds.flatMap((o) => Object.keys(o.probs)))].sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const next = odds[0]
    ? {
        date: odds[0].date,
        at: [
          { label: "NOW", date: today, probs: odds[0].probs },
          ...([["1 DAY", 1], ["1 WEEK", 7], ["1 MONTH", 30]] as const).map(([label, days]) => ({
            label,
            date: ago(days),
            probs: fedwatchOdds([meetings[0]], pricesOn(ago(days)), effr, lower)[0]?.probs ?? {},
          })),
        ],
      }
    : null;
  return { asOf: now.getTime(), target: { lower, upper: upper.value }, effr, buckets, meetings: odds, next, source: "CBOT 30-Day Fed Funds futures (ZQ) via TradingView, 10 min delayed; target range and EFFR from FRED" };
}
