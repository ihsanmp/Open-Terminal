// The economic calendar's period: one day or one week (Monday to Sunday), with its bounds taken
// at midnight in the calendar's chosen time zone. Days are "YYYY-MM-DD" strings.

export type Period = { kind: "day" | "week"; day: string };

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const utcOf = (day: string) => {
  const [y, m, d] = parts(day);
  return Date.UTC(y, m - 1, d);
};

export const addDays = (day: string, n: number) => fromUtc(utcOf(day) + n * DAY_MS);

/** The Monday of the day's week. */
export const weekStart = (day: string) => addDays(day, -((new Date(utcOf(day)).getUTCDay() + 6) % 7));

/** The calendar day at this time in the zone (the computer's own when none). */
export function dayIn(ms: number, zone?: string): string {
  if (!zone) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** How far the zone's clock is ahead of UTC at this time. */
function offsetAt(ms: number, zone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ms);
  const get = (t: string) => Number(f.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ms / 1000) * 1000;
}

/** The time at which the day starts in the zone (the computer's own when none). */
export function midnight(day: string, zone?: string): number {
  const [y, m, d] = parts(day);
  if (!zone) return new Date(y, m - 1, d).getTime();
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetAt(wall, zone);
  return wall - offsetAt(guess, zone);
}

/** The period's first day and the day after its last. */
export function daysOf(p: Period): { first: string; end: string } {
  const first = p.kind === "week" ? weekStart(p.day) : p.day;
  return { first, end: addDays(first, p.kind === "week" ? 7 : 1) };
}

/** The period's bounds in time: from (inclusive) to (exclusive). */
export function rangeOf(p: Period, zone?: string): { from: number; to: number } {
  const { first, end } = daysOf(p);
  return { from: midnight(first, zone), to: midnight(end, zone) };
}

/** The same kind of period, `n` steps later (or earlier). */
export function step(p: Period, n: number): Period {
  return p.kind === "week" ? { kind: "week", day: addDays(weekStart(p.day), 7 * n) } : { kind: "day", day: addDays(p.day, n) };
}

export function inPeriod(day: string, p: Period): boolean {
  const { first, end } = daysOf(p);
  return day >= first && day < end;
}

/** The weeks (Monday first) that show a month: each a row of seven days. */
export function monthWeeks(year: number, month: number): string[][] {
  const first = `${year}-${pad(month + 1)}-01`;
  const last = addDays(`${month === 11 ? year + 1 : year}-${pad(month === 11 ? 1 : month + 2)}-01`, -1);
  const weeks: string[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };

/** "Sat, Oct 10 2026" or "Oct 5 – Oct 11, 2026". */
export function periodLabel(p: Period): string {
  const { first, end } = daysOf(p);
  if (p.kind === "day") {
    return new Date(utcOf(first)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const last = addDays(end, -1);
  const fmt = (d: string) => new Date(utcOf(d)).toLocaleDateString("en-US", SHORT);
  return `${fmt(first)} – ${fmt(last)}, ${parts(last)[0]}`;
}
