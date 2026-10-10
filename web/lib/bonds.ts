// The US Bonds page's arithmetic: yields by tenor, their moves over a period in basis points, the
// curve as it stood when the period began, and the spreads between tenors.

export type Tenor = { tenor: string; symbol: string; value: number | null; changeBp: number | null; refs?: Partial<Record<string, number>> };

/** The tenors the page puts first. */
export const KEY_TENORS = ["2Y", "10Y", "30Y"];

/** The spreads shown: [label, short tenor, long tenor, what it says]. */
export const SPREADS: Array<[string, string, string, string]> = [
  ["2s10s", "2Y", "10Y", "Di bawah nol: kurva terbalik, sinyal resesi yang sering dipakai"],
  ["10s30s", "10Y", "30Y", "Premi jangka panjang (term premium)"],
  ["2s30s", "2Y", "30Y", "Kemiringan seluruh kurva"],
  ["3M10Y", "3M", "10Y", "Pengukur resesi favorit The Fed: di bawah nol berarti terbalik"],
];

/** The yield where the period began (yesterday's close for 1D when that's all there is). */
export function startOf(t: Tenor, period: string): number | null {
  const r = t.refs?.[period];
  if (r !== undefined && r !== null) return r;
  if (period === "1D" && t.value !== null && t.changeBp !== null) return t.value - t.changeBp / 100;
  return null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The move over the period, in basis points to 0.1. */
export function moveBp(t: Tenor, period: string): number | null {
  const start = startOf(t, period);
  return t.value === null || start === null ? null : round1((t.value - start) * 100);
}

/** A spread now and where it stood when the period began, in basis points. */
export function spread(curve: Tenor[], short: string, long: string, period: string): { value: number | null; move: number | null } {
  const s = curve.find((c) => c.tenor === short);
  const l = curve.find((c) => c.tenor === long);
  if (!s || !l || s.value === null || l.value === null) return { value: null, move: null };
  const value = round1((l.value - s.value) * 100);
  const [s0, l0] = [startOf(s, period), startOf(l, period)];
  return { value, move: s0 === null || l0 === null ? null : round1(value - (l0 - s0) * 100) };
}

/** The curve now and at the period's start, for the chart. */
export function curveThen(curve: Tenor[], period: string): Array<{ tenor: string; now: number | null; then: number | null }> {
  return curve.map((c) => ({ tenor: c.tenor, now: c.value, then: startOf(c, period) }));
}

/** How the curve is shaped, from 2s10s and 3M10Y. */
export function shapeOf(curve: Tenor[]): string | null {
  const a = spread(curve, "2Y", "10Y", "1D").value;
  const b = spread(curve, "3M", "10Y", "1D").value;
  if (a === null) return null;
  if (a < 0 && (b === null || b < 0)) return "Terbalik (inverted)";
  if (a < 0 || (b !== null && b < 0)) return "Sebagian terbalik";
  if (a < 25) return "Datar";
  return "Normal (menanjak)";
}

/** Time until a date ("YYYY-MM-DD"): "29 thn 10 bln", "1 bln 5 hr", "12 hr". */
export function timeLeft(date: string, now = Date.now()): string {
  const end = new Date(`${date}T00:00:00Z`);
  const from = new Date(now);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= now) return "jatuh tempo";
  let months = (end.getUTCFullYear() - from.getUTCFullYear()) * 12 + (end.getUTCMonth() - from.getUTCMonth());
  if (end.getUTCDate() < from.getUTCDate()) months--;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years > 0) return rest ? `${years} thn ${rest} bln` : `${years} thn`;
  const anchor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, from.getUTCDate());
  const days = Math.ceil((end.getTime() - anchor) / 86_400_000);
  if (months > 0) return days ? `${months} bln ${days} hr` : `${months} bln`;
  return `${Math.max(1, Math.ceil((end.getTime() - now) / 86_400_000))} hr`;
}
