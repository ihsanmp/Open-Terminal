// Pine runtime helpers the ported scripts lean on: color.new / color.from_gradient,
// str.tostring number patterns, calendar functions in the exchange time zone, and
// syminfo.mintick for charts whose feed doesn't report a tick size.
import type { Bars } from "./core";

type Rgba = [number, number, number, number];

function parseColor(c: string): Rgba {
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const v = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [v(0), v(2), v(4), hex.length >= 8 ? v(6) / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return [0, 0, 0, 1];
  const [r, g, b, a] = m[1].split(",").map((x) => Number(x.trim()));
  return [r, g, b, Number.isFinite(a) ? a : 1];
}

const rgba = ([r, g, b, a]: Rgba) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;

/** color.new(color, transp): transparency 0 (opaque) … 100 (invisible). */
export function colorNew(color: string, transp: number): string {
  const [r, g, b, a] = parseColor(color);
  return rgba([r, g, b, a * (1 - transp / 100)]);
}

/** color.from_gradient: clamps outside [bottom, top]; na in, na out. */
export function fromGradient(value: number, bottom: number, top: number, bottomColor: string, topColor: string): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const t = value <= bottom ? 0 : value >= top ? 1 : (value - bottom) / (top - bottom);
  const a = parseColor(bottomColor);
  const b = parseColor(topColor);
  return rgba(a.map((x, i) => x + (b[i] - x) * t) as Rgba);
}

function roundHalfEven(v: number, decimals: number): number {
  const m = 10 ** decimals;
  const x = v * m;
  const floor = Math.floor(x);
  if (Math.abs(x - floor - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / m;
  return Math.round(x) / m;
}

/** str.tostring(value, "#.##"): up to that many decimals, trailing zeros dropped. */
export function formatPattern(v: number, pattern: string): string {
  if (!Number.isFinite(v)) return "NaN";
  const decimals = pattern.includes(".") ? pattern.split(".")[1].length : 0;
  const s = roundHalfEven(v, decimals).toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, "") : s;
}

/** str.tostring(value, format.mintick): rounded to the tick, shown with its decimals. */
export function formatMintick(v: number, mintick: number): string {
  if (!Number.isFinite(v)) return "NaN";
  const decimals = Math.max(0, Math.round(-Math.log10(mintick)));
  return (Math.round(v / mintick) * mintick).toFixed(decimals);
}

/** str.tostring(value, format.volume): K / M / B abbreviations. */
export function formatVolume(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  const abs = Math.abs(v);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  return formatPattern(v / div, "#.###") + suffix;
}

export type TimeParts = { year: number; month: number; day: number; hour: number; minute: number; dayofweek: number; weekofyear: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };

/** year() / month() / hour() / dayofweek() / weekofyear() of a bar time in the exchange zone.
 *  dayofweek is Pine's 1 = Sunday … 7 = Saturday. */
export function timeParts(timeSec: number, timezone: string): TimeParts {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(timezone, f);
  }
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(timeSec * 1000))) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return { year, month, day, hour: Number(parts.hour) % 24, minute: Number(parts.minute), dayofweek: WEEKDAY[parts.weekday], weekofyear: weekOfYear(year, month, day) };
}

/** weekofyear(): Sunday-first weeks, week 1 being the one that holds January 1st — so the
 *  last days of December can already be week 1. */
export function weekOfYear(year: number, month: number, day: number): number {
  const DAY = 86_400_000;
  const date = Date.UTC(year, month - 1, day);
  const dow = new Date(date).getUTCDay();
  if (date - dow * DAY + 6 * DAY >= Date.UTC(year + 1, 0, 1)) return 1;
  const jan1 = Date.UTC(year, 0, 1);
  return Math.floor(((date - jan1) / DAY + new Date(jan1).getUTCDay()) / 7) + 1;
}

/** syminfo.mintick inferred from the prices themselves: the fewest decimals that express
 *  every recent open/high/low/close (float32-rounded feeds tolerated). */
export function inferMintick(bars: Bars): number {
  let decimals = 0;
  for (let i = Math.max(0, bars.length - 300); i < bars.length; i++) {
    for (const v of [bars.open[i], bars.high[i], bars.low[i], bars.close[i]]) {
      if (!(v > 0)) continue;
      let d = decimals;
      while (d < 10) {
        const x = v * 10 ** d;
        if (Math.abs(x - Math.round(x)) <= x * 3e-7 + 1e-9) break;
        d++;
      }
      decimals = Math.max(decimals, d);
    }
  }
  return 10 ** -decimals;
}
