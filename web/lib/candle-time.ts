// Bar timing helpers: how long one candle covers, when the current one closes,
// and how to label a candle's timestamp.

/** Seconds one candle covers, taken from the data itself (median gap between bars). */
export function barIntervalSeconds(times: number[]): number {
  if (times.length < 3) return 86_400;
  const gaps: number[] = [];
  for (let i = Math.max(1, times.length - 200); i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 86_400;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export const isIntradayInterval = (seconds: number) => seconds < 86_400;

/** Human label for a candle interval: 300 -> "5m", 3600 -> "1h", 86400 -> "1D". */
export function intervalLabel(seconds: number): string {
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}D`;
  if (seconds < 28 * 86_400) return `${Math.round(seconds / (7 * 86_400))}W`;
  return `${Math.round(seconds / (30 * 86_400))}M`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateOnly = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" });

/** Candle open timestamp, in the viewer's own timezone. */
export function formatBarTime(time: number, intervalSeconds: number): string {
  const d = new Date(time * 1000);
  return isIntradayInterval(intervalSeconds) ? dateTime.format(d) : dateOnly.format(d);
}

/** Seconds until the candle that opened at `barTime` closes; null once it's past. */
export function secondsToClose(barTime: number, intervalSeconds: number, now = Date.now()): number | null {
  const remaining = barTime + intervalSeconds - Math.floor(now / 1000);
  return remaining > 0 ? remaining : null;
}

/** mm:ss, or h:mm:ss past an hour. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(s / 3_600);
  const rest = s % 3_600;
  return hours > 0 ? `${hours}:${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` : `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
}

// ---- when the open candle closes ------------------------------------------------------

/** Regular-session close (local time) by exchange time zone; US hours otherwise. */
const SESSION_CLOSE: Record<string, [number, number]> = {
  "America/New_York": [16, 0],
  "America/Toronto": [16, 0],
  "America/Sao_Paulo": [17, 0],
  "America/Mexico_City": [15, 0],
  "Europe/London": [16, 30],
  "Europe/Berlin": [17, 30],
  "Europe/Paris": [17, 30],
  "Europe/Amsterdam": [17, 30],
  "Europe/Brussels": [17, 30],
  "Europe/Madrid": [17, 30],
  "Europe/Rome": [17, 30],
  "Europe/Zurich": [17, 30],
  "Europe/Stockholm": [17, 30],
  "Europe/Oslo": [16, 20],
  "Europe/Copenhagen": [17, 0],
  "Europe/Helsinki": [18, 30],
  "Asia/Jakarta": [16, 0],
  "Asia/Tokyo": [15, 30],
  "Asia/Hong_Kong": [16, 0],
  "Asia/Shanghai": [15, 0],
  "Asia/Seoul": [15, 30],
  "Asia/Kolkata": [15, 30],
  "Asia/Singapore": [17, 0],
  "Asia/Taipei": [13, 30],
  "Asia/Bangkok": [16, 30],
  "Asia/Kuala_Lumpur": [17, 0],
  "Australia/Sydney": [16, 0],
  "Pacific/Auckland": [16, 45],
  "Africa/Johannesburg": [17, 0],
};

const partFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date and weekday (0 = Sunday) of a moment in a time zone. */
function zonedDate(t: number, timeZone: string) {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
    partFormatters.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t * 1000))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Unix time of a wall-clock time in a time zone. */
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  const shown = zonedDate(guess, timeZone);
  const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second) / 1000 - guess;
  return guess - offset;
}

export type Market = { type: "crypto" | "forex" | "stock" | "index"; timezone: string };

/** When the candle that opened at `barTime` closes. Crypto and forex bars run their full length;
 *  stock and index bars end with the session (a daily bar at 16:00, the last 4h bar at 16:00 too,
 *  a weekly one on Friday's close, a monthly one on the month's last weekday). */
export function candleCloseTime(barTime: number, intervalSeconds: number, market: Market): number {
  const monthly = intervalSeconds >= 28 * 86_400;
  if (market.type === "crypto" || market.type === "forex") {
    if (!monthly) return barTime + intervalSeconds;
    const d = new Date(barTime * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  const tz = market.timezone;
  const [hh, mm] = SESSION_CLOSE[tz] ?? [16, 0];
  const day = zonedDate(barTime, tz);
  const closeOn = (y: number, m: number, d: number) => zonedTime(y, m, d, hh, mm, tz);
  if (intervalSeconds < 86_400) return Math.min(barTime + intervalSeconds, closeOn(day.year, day.month, day.day));
  if (!monthly && intervalSeconds < 7 * 86_400) return closeOn(day.year, day.month, day.day);
  const utcDay = new Date(Date.UTC(day.year, day.month - 1, day.day));
  if (!monthly) {
    // Friday of the bar's week.
    const friday = new Date(utcDay.getTime() + ((5 - utcDay.getUTCDay() + 7) % 7) * 86_400_000);
    return closeOn(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate());
  }
  // Last weekday of the bar's month.
  const last = new Date(Date.UTC(day.year, day.month, 0));
  while (last.getUTCDay() === 0 || last.getUTCDay() === 6) last.setUTCDate(last.getUTCDate() - 1);
  return closeOn(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate());
}

/** Seconds until the open candle closes; null when it already has (the market is shut) or
 *  hasn't opened yet. */
export function secondsUntilClose(barTime: number, intervalSeconds: number, market: Market, now = Date.now()): number | null {
  const t = Math.floor(now / 1000);
  if (t < barTime) return null;
  const left = candleCloseTime(barTime, intervalSeconds, market) - t;
  return left > 0 ? left : null;
}

/** Countdown for the price-axis label, as TradingView shows it: 11:48, 3:05:12, 2d 03h. */
export function formatAxisCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${String(Math.floor((s % 86_400) / 3_600)).padStart(2, "0")}h`;
  return formatCountdown(s);
}
