// Series primitives that mirror Pine Script's `ta.*` / `math.*` semantics, so
// TradingView's built-in indicators can be ported line for line. A series is
// a plain number[] aligned with the candles; NaN plays the role of Pine's `na`.

export type Series = number[];

export type Bars = {
  time: number[];
  open: Series;
  high: Series;
  low: Series;
  close: Series;
  volume: Series;
  length: number;
};

export const isNa = (v: number) => v !== v; // faster Number.isNaN for hot loops
export const nz = (v: number, replacement = 0) => (isNa(v) ? replacement : v);

export function fill(n: number, v = NaN): Series {
  return new Array<number>(n).fill(v);
}

export function map(x: Series, f: (v: number, i: number) => number): Series {
  const out = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) out[i] = f(x[i], i);
  return out;
}

export function zip(a: Series, b: Series, f: (a: number, b: number, i: number) => number): Series {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f(a[i], b[i], i);
  return out;
}

export const add = (a: Series, b: Series) => zip(a, b, (x, y) => x + y);
export const sub = (a: Series, b: Series) => zip(a, b, (x, y) => x - y);
export const mul = (a: Series, b: Series) => zip(a, b, (x, y) => x * y);
export const div = (a: Series, b: Series) => zip(a, b, (x, y) => x / y);
export const scale = (a: Series, k: number) => map(a, (x) => x * k);

/** x[n] — the value n bars ago. */
export function shift(x: Series, n: number): Series {
  return map(x, (_, i) => (i - n >= 0 && i - n < x.length ? x[i - n] : NaN));
}

export function change(x: Series, n = 1): Series {
  return map(x, (v, i) => (i >= n ? v - x[i - n] : NaN));
}

export function nzSeries(x: Series, replacement = 0): Series {
  return map(x, (v) => nz(v, replacement));
}

/** Pine's fixnan: replace na with the last non-na value. */
export function fixnan(x: Series): Series {
  let last = NaN;
  return map(x, (v) => (isNa(v) ? last : (last = v)));
}

export function cum(x: Series): Series {
  let s = 0;
  let started = false;
  return map(x, (v) => {
    if (isNa(v)) return started ? s : NaN;
    started = true;
    return (s += v);
  });
}

// ---- rolling window helpers ----------------------------------------------

/** Rolling sum; na whenever the window contains an na (like math.sum). */
export function sum(x: Series, len: number): Series {
  const out = fill(x.length);
  let s = 0;
  let nas = 0;
  for (let i = 0; i < x.length; i++) {
    if (isNa(x[i])) nas++;
    else s += x[i];
    if (i >= len) {
      if (isNa(x[i - len])) nas--;
      else s -= x[i - len];
    }
    if (i >= len - 1 && nas === 0) out[i] = s;
  }
  return out;
}

export function sma(x: Series, len: number): Series {
  return map(sum(x, len), (v) => v / len);
}

function windowReduce(x: Series, len: number, f: (from: number, to: number) => number): Series {
  const out = fill(x.length);
  for (let i = len - 1; i < x.length; i++) out[i] = f(i - len + 1, i);
  return out;
}

export function highest(x: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    let m = -Infinity;
    for (let j = a; j <= b; j++) {
      if (isNa(x[j])) return NaN;
      if (x[j] > m) m = x[j];
    }
    return m;
  });
}

export function lowest(x: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    let m = Infinity;
    for (let j = a; j <= b; j++) {
      if (isNa(x[j])) return NaN;
      if (x[j] < m) m = x[j];
    }
    return m;
  });
}

/** Offset (<= 0) to the highest bar within the last len bars. */
export function highestbars(x: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    let m = -Infinity;
    let at = b;
    for (let j = b; j >= a; j--) {
      if (isNa(x[j])) return NaN;
      if (x[j] > m) {
        m = x[j];
        at = j;
      }
    }
    return at - b;
  });
}

export function lowestbars(x: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    let m = Infinity;
    let at = b;
    for (let j = b; j >= a; j--) {
      if (isNa(x[j])) return NaN;
      if (x[j] < m) {
        m = x[j];
        at = j;
      }
    }
    return at - b;
  });
}

/** Population standard deviation over the window (ta.stdev, biased=true). */
export function stdev(x: Series, len: number): Series {
  const mean = sma(x, len);
  return windowReduce(x, len, (a, b) => {
    const m = mean[b];
    if (isNa(m)) return NaN;
    let s = 0;
    for (let j = a; j <= b; j++) s += (x[j] - m) ** 2;
    return Math.sqrt(s / len);
  });
}

export function variance(x: Series, len: number): Series {
  return map(stdev(x, len), (v) => v * v);
}

/** Mean absolute deviation from the SMA (ta.dev). */
export function dev(x: Series, len: number): Series {
  const mean = sma(x, len);
  return windowReduce(x, len, (a, b) => {
    const m = mean[b];
    if (isNa(m)) return NaN;
    let s = 0;
    for (let j = a; j <= b; j++) s += Math.abs(x[j] - m);
    return s / len;
  });
}

// ---- moving averages -----------------------------------------------------

/** Exponential smoothing seeded with an SMA, as ta.ema / ta.rma do. */
function smoothed(x: Series, len: number, alpha: number): Series {
  const seed = sma(x, len);
  const out = fill(x.length);
  for (let i = 0; i < x.length; i++) {
    const prev = i > 0 ? out[i - 1] : NaN;
    out[i] = isNa(prev) ? seed[i] : alpha * x[i] + (1 - alpha) * prev;
  }
  return out;
}

export const ema = (x: Series, len: number) => smoothed(x, len, 2 / (len + 1));
export const rma = (x: Series, len: number) => smoothed(x, len, 1 / len);

export function wma(x: Series, len: number): Series {
  const norm = (len * (len + 1)) / 2;
  return windowReduce(x, len, (a, b) => {
    let s = 0;
    for (let j = a; j <= b; j++) {
      if (isNa(x[j])) return NaN;
      s += x[j] * (j - a + 1);
    }
    return s / norm;
  });
}

export function vwma(x: Series, volume: Series, len: number): Series {
  return div(sma(mul(x, volume), len), sma(volume, len));
}

/** Symmetrically weighted MA over 4 bars (ta.swma). */
export function swma(x: Series): Series {
  return map(x, (v, i) => (i >= 3 ? (x[i - 3] + 2 * x[i - 2] + 2 * x[i - 1] + v) / 6 : NaN));
}

export function hma(x: Series, len: number): Series {
  const half = wma(x, Math.floor(len / 2));
  const full = wma(x, len);
  return wma(zip(half, full, (h, f) => 2 * h - f), Math.floor(Math.sqrt(len)));
}

export function alma(x: Series, len: number, offset = 0.85, sigma = 6, floorOffset = false): Series {
  const m = floorOffset ? Math.floor(offset * (len - 1)) : offset * (len - 1);
  const s = len / sigma;
  const weights: number[] = [];
  let norm = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.exp(-((i - m) ** 2) / (2 * s * s));
    weights.push(w);
    norm += w;
  }
  return windowReduce(x, len, (a, b) => {
    let acc = 0;
    // weights[i] applies to x[b - (len - 1 - i)], i.e. oldest bar first.
    for (let i = 0; i < len; i++) {
      const v = x[a + i];
      if (isNa(v)) return NaN;
      acc += v * weights[i];
    }
    return acc / norm;
  });
}

export function dema(x: Series, len: number): Series {
  const e1 = ema(x, len);
  const e2 = ema(e1, len);
  return zip(e1, e2, (a, b) => 2 * a - b);
}

export function tema(x: Series, len: number): Series {
  const e1 = ema(x, len);
  const e2 = ema(e1, len);
  const e3 = ema(e2, len);
  return map(e1, (v, i) => 3 * (v - e2[i]) + e3[i]);
}

/** Least squares linear regression value at `offset` bars back (ta.linreg). */
export function linreg(x: Series, len: number, offset = 0): Series {
  return windowReduce(x, len, (a, b) => {
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let j = a; j <= b; j++) {
      if (isNa(x[j])) return NaN;
      const t = j - a;
      sx += t;
      sy += x[j];
      sxy += t * x[j];
      sxx += t * t;
    }
    const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
    const intercept = (sy - slope * sx) / len;
    return intercept + slope * (len - 1 - offset);
  });
}

export function correlation(x: Series, y: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let j = a; j <= b; j++) {
      if (isNa(x[j]) || isNa(y[j])) return NaN;
      sx += x[j];
      sy += y[j];
      sxy += x[j] * y[j];
      sxx += x[j] * x[j];
      syy += y[j] * y[j];
    }
    const cov = sxy / len - (sx / len) * (sy / len);
    const den = Math.sqrt((sxx / len - (sx / len) ** 2) * (syy / len - (sy / len) ** 2));
    return den === 0 ? NaN : cov / den;
  });
}

/** Percent of the previous `len` values that are <= the current one. */
export function percentrank(x: Series, len: number): Series {
  const out = fill(x.length);
  for (let i = len; i < x.length; i++) {
    if (isNa(x[i])) continue;
    let count = 0;
    let bad = false;
    for (let j = i - len; j < i; j++) {
      if (isNa(x[j])) {
        bad = true;
        break;
      }
      if (x[j] <= x[i]) count++;
    }
    if (!bad) out[i] = (100 * count) / len;
  }
  return out;
}

/** Rank Correlation Index: Spearman correlation of price ranks vs time. */
export function rci(x: Series, len: number): Series {
  return windowReduce(x, len, (a, b) => {
    const vals: Array<{ v: number; t: number }> = [];
    for (let j = a; j <= b; j++) {
      if (isNa(x[j])) return NaN;
      vals.push({ v: x[j], t: b - j + 1 }); // time rank: 1 = newest
    }
    // Price rank: 1 = highest; ties share the average rank.
    const sorted = [...vals].sort((p, q) => q.v - p.v);
    const rank = new Map<{ v: number; t: number }, number>();
    for (let i = 0; i < sorted.length; ) {
      let k = i;
      while (k + 1 < sorted.length && sorted[k + 1].v === sorted[i].v) k++;
      const avg = (i + k) / 2 + 1;
      for (let m = i; m <= k; m++) rank.set(sorted[m], avg);
      i = k + 1;
    }
    let d2 = 0;
    for (const p of vals) d2 += (p.t - rank.get(p)!) ** 2;
    return 100 * (1 - (6 * d2) / (len * (len * len - 1)));
  });
}

// ---- price-derived series --------------------------------------------------

export type SourceKey = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4" | "hlcc4" | "volume";

export const SOURCES: SourceKey[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4", "volume"];

export function source(b: Bars, key: SourceKey | string): Series {
  switch (key) {
    case "open":
      return b.open;
    case "high":
      return b.high;
    case "low":
      return b.low;
    case "volume":
      return b.volume;
    case "hl2":
      return zip(b.high, b.low, (h, l) => (h + l) / 2);
    case "hlc3":
      return map(b.close, (c, i) => (b.high[i] + b.low[i] + c) / 3);
    case "ohlc4":
      return map(b.close, (c, i) => (b.open[i] + b.high[i] + b.low[i] + c) / 4);
    case "hlcc4":
      return map(b.close, (c, i) => (b.high[i] + b.low[i] + 2 * c) / 4);
    default:
      return b.close;
  }
}

/** True range. handleNa=true uses high-low on the first bar (as ta.atr does). */
export function tr(b: Bars, handleNa = false): Series {
  return map(b.close, (_, i) => {
    if (i === 0) return handleNa ? b.high[0] - b.low[0] : NaN;
    const pc = b.close[i - 1];
    return Math.max(b.high[i] - b.low[i], Math.abs(b.high[i] - pc), Math.abs(b.low[i] - pc));
  });
}

export const atr = (b: Bars, len: number) => rma(tr(b, true), len);

export function rsi(x: Series, len: number): Series {
  const ch = change(x);
  const up = rma(map(ch, (v) => (isNa(v) ? NaN : Math.max(v, 0))), len);
  const down = rma(map(ch, (v) => (isNa(v) ? NaN : Math.max(-v, 0))), len);
  return zip(up, down, (u, d) => (isNa(u) || isNa(d) ? NaN : d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d)));
}

export function stoch(x: Series, high: Series, low: Series, len: number): Series {
  const hh = highest(high, len);
  const ll = lowest(low, len);
  return map(x, (v, i) => (100 * (v - ll[i])) / (hh[i] - ll[i]));
}

export function roc(x: Series, len: number): Series {
  return map(x, (v, i) => (i >= len ? (100 * (v - x[i - len])) / x[i - len] : NaN));
}

export function cci(x: Series, len: number): Series {
  const m = sma(x, len);
  const d = dev(x, len);
  return map(x, (v, i) => (v - m[i]) / (0.015 * d[i]));
}

export function mfi(x: Series, volume: Series, len: number): Series {
  const ch = change(x);
  const upper = sum(map(x, (v, i) => (isNa(ch[i]) ? NaN : volume[i] * (ch[i] <= 0 ? 0 : v))), len);
  const lower = sum(map(x, (v, i) => (isNa(ch[i]) ? NaN : volume[i] * (ch[i] >= 0 ? 0 : v))), len);
  return zip(upper, lower, (u, l) => 100 - 100 / (1 + u / l));
}

/** True Strength Index in the -1..1 range (ta.tsi). */
export function tsi(x: Series, shortLen: number, longLen: number): Series {
  const pc = change(x);
  const num = ema(ema(pc, longLen), shortLen);
  const den = ema(ema(map(pc, Math.abs), longLen), shortLen);
  return div(num, den);
}

export function dmi(b: Bars, diLen: number, adxLen: number): { plus: Series; minus: Series; adx: Series } {
  const up = change(b.high);
  const down = map(change(b.low), (v) => -v);
  const plusDM = map(up, (u, i) => (isNa(u) ? NaN : u > down[i] && u > 0 ? u : 0));
  const minusDM = map(down, (d, i) => (isNa(d) ? NaN : d > up[i] && d > 0 ? d : 0));
  const trur = rma(tr(b), diLen);
  const plus = fixnan(zip(rma(plusDM, diLen), trur, (p, t) => (100 * p) / t));
  const minus = fixnan(zip(rma(minusDM, diLen), trur, (m, t) => (100 * m) / t));
  const ratio = zip(plus, minus, (p, m) => {
    const s = p + m;
    return Math.abs(p - m) / (s === 0 ? 1 : s);
  });
  const adx = scale(rma(ratio, adxLen), 100);
  return { plus, minus, adx };
}

export function supertrend(b: Bars, factor: number, atrLen: number): { value: Series; direction: Series } {
  const src = source(b, "hl2");
  const a = atr(b, atrLen);
  const n = b.length;
  const value = fill(n);
  const direction = fill(n);
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevST = NaN;
  for (let i = 0; i < n; i++) {
    let upper = src[i] + factor * a[i];
    let lower = src[i] - factor * a[i];
    const pl = nz(prevLower);
    const pu = nz(prevUpper);
    const prevClose = i > 0 ? b.close[i - 1] : NaN;
    lower = lower > pl || prevClose < pl ? lower : pl;
    upper = upper < pu || prevClose > pu ? upper : pu;
    let dir: number;
    if (i === 0 || isNa(a[i - 1])) dir = 1;
    else if (prevST === pu) dir = b.close[i] > upper ? -1 : 1;
    else dir = b.close[i] < lower ? 1 : -1;
    const st = dir === -1 ? lower : upper;
    value[i] = st;
    direction[i] = isNa(a[i]) ? NaN : dir;
    if (isNa(a[i])) value[i] = NaN;
    prevUpper = upper;
    prevLower = lower;
    prevST = st;
  }
  return { value, direction };
}

export function sar(b: Bars, start: number, inc: number, max: number): Series {
  const n = b.length;
  const out = fill(n);
  let result = NaN;
  let maxMin = NaN;
  let acc = NaN;
  let isBelow = false;
  for (let i = 1; i < n; i++) {
    let firstTrendBar = false;
    if (i === 1) {
      if (b.close[1] > b.close[0]) {
        isBelow = true;
        maxMin = b.high[1];
        result = b.low[0];
      } else {
        isBelow = false;
        maxMin = b.low[1];
        result = b.high[0];
      }
      firstTrendBar = true;
      acc = start;
    }
    result = result + acc * (maxMin - result);
    if (isBelow) {
      if (result > b.low[i]) {
        firstTrendBar = true;
        isBelow = false;
        result = Math.max(b.high[i], maxMin);
        maxMin = b.low[i];
        acc = start;
      }
    } else if (result < b.high[i]) {
      firstTrendBar = true;
      isBelow = true;
      result = Math.min(b.low[i], maxMin);
      maxMin = b.high[i];
      acc = start;
    }
    if (!firstTrendBar) {
      if (isBelow) {
        if (b.high[i] > maxMin) {
          maxMin = b.high[i];
          acc = Math.min(acc + inc, max);
        }
      } else if (b.low[i] < maxMin) {
        maxMin = b.low[i];
        acc = Math.min(acc + inc, max);
      }
    }
    if (isBelow) {
      result = Math.min(result, b.low[i - 1]);
      if (i > 1) result = Math.min(result, b.low[i - 2]);
    } else {
      result = Math.max(result, b.high[i - 1]);
      if (i > 1) result = Math.max(result, b.high[i - 2]);
    }
    out[i] = result;
  }
  return out;
}

/** Index of each confirmed pivot high: the bar `right` bars before i. */
export function pivotHighs(x: Series, left: number, right: number): boolean[] {
  const out = new Array<boolean>(x.length).fill(false);
  for (let p = left; p < x.length - right; p++) {
    const v = x[p];
    if (isNa(v)) continue;
    let ok = true;
    for (let j = p - left; j <= p + right && ok; j++) {
      if (j === p) continue;
      if (j < p ? x[j] > v : x[j] >= v) ok = false;
    }
    out[p] = ok;
  }
  return out;
}

export function pivotLows(x: Series, left: number, right: number): boolean[] {
  const out = new Array<boolean>(x.length).fill(false);
  for (let p = left; p < x.length - right; p++) {
    const v = x[p];
    if (isNa(v)) continue;
    let ok = true;
    for (let j = p - left; j <= p + right && ok; j++) {
      if (j === p) continue;
      if (j < p ? x[j] < v : x[j] <= v) ok = false;
    }
    out[p] = ok;
  }
  return out;
}

export function crossover(a: Series, b: Series, i: number): boolean {
  return i > 0 && a[i] > b[i] && a[i - 1] <= b[i - 1];
}

export function crossunder(a: Series, b: Series, i: number): boolean {
  return i > 0 && a[i] < b[i] && a[i - 1] >= b[i - 1];
}

// ---- moving average selector used by many inputs -------------------------

export const MA_TYPES = ["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"] as const;

export function maByType(type: string, x: Series, len: number, volume?: Series): Series {
  switch (type) {
    case "EMA":
      return ema(x, len);
    case "SMMA (RMA)":
    case "RMA":
      return rma(x, len);
    case "WMA":
      return wma(x, len);
    case "VWMA":
      return volume ? vwma(x, volume, len) : sma(x, len);
    default:
      return sma(x, len);
  }
}

// ---- anchored periods ----------------------------------------------------

const nyParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Median spacing between bars in seconds. */
export function barSpacing(time: number[]): number {
  if (time.length < 2) return 86_400;
  const diffs: number[] = [];
  for (let i = Math.max(1, time.length - 200); i < time.length; i++) diffs.push(time[i] - time[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

export const isIntraday = (time: number[]) => barSpacing(time) < 20 * 3600;

/** Calendar date (y, m, d) of a bar: exchange-local for intraday, UTC otherwise. */
function barDate(t: number, intraday: boolean): { y: number; m: number; d: number } {
  if (intraday) {
    const [y, m, d] = nyParts.format(new Date(t * 1000)).split("-").map(Number);
    return { y, m, d };
  }
  const dt = new Date(t * 1000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export type Anchor = "Session" | "Week" | "Month" | "Quarter" | "Year" | "Decade";

/** A key that changes whenever a new anchor period starts. */
export function periodKeys(time: number[], anchor: Anchor): string[] {
  const intraday = isIntraday(time);
  return time.map((t) => {
    const { y, m, d } = barDate(t, intraday);
    switch (anchor) {
      case "Week": {
        // Monday-based week number counted from a fixed Monday.
        const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) + 3; // 1970-01-01 was a Thursday
        return `w${Math.floor(days / 7)}`;
      }
      case "Month":
        return `${y}-${m}`;
      case "Quarter":
        return `${y}-q${Math.floor((m - 1) / 3)}`;
      case "Year":
        return `${y}`;
      case "Decade":
        return `${Math.floor(y / 10)}`;
      default:
        return `${y}-${m}-${d}`;
    }
  });
}
