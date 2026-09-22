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
