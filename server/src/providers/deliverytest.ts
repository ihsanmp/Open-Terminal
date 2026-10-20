// The test of layers 2 and 3 (the voice and the face, fedmedia.ts) against the markets: does how a
// Fed speaker sounds and looks tell anything the words don't? Three hypotheses, set down before
// any data was in (20 Oct 2026), each tested the same way once enough broadcasts are recorded:
//
//   H1 Follow-through: the markets follow the words more when the delivery is confident. The
//      reaction regressed on the words' index and its product with the confidence (centred):
//      the product's coefficient should be > 0.
//   H2 Volatility: a strained delivery comes with bigger moves, whichever way: the rank
//      correlation of strain (1 − confidence) with the size of the reaction should be > 0.
//   H3 The combined index (words 90%, delivery 10%, as the Live TV shows it) should follow the
//      reaction more closely than the words alone.
//
// The reaction is one number a broadcast: the move over the broadcast of the 2-year yield, the
// dollar index, gold and S&P futures, each signed the way a hawkish reading would move it and in
// units of its own typical move over these broadcasts, averaged. Each hypothesis' p-value is by
// permutation (the delivery shuffled across broadcasts, 2000 times): how often chance does as well.
// A hypothesis counts as shown only with 20 broadcasts or more and p < 0.05; with fewer, the
// numbers are shown as they stand, marked as too few.

import type { InstrumentKey } from "./reactions.js";

/** The main speaker's delivery over one minute of a broadcast (fedmedia.ts's report). */
export type DeliverySample = {
  /** Unix ms (the minute). */
  at: number;
  confidence: number;
  stress: number;
  hesitation: number;
  /** The locked face's tension, null when no face was locked that minute. */
  tension: number | null;
};

export type DeliverySummary = { minutes: number; faceMinutes: number; confidence: number; stress: number; hesitation: number; tension: number | null };

export const MIN_MINUTES = 10;
export const MIN_BROADCASTS = 20;
const PERMUTATIONS = 2000;
/** What a hawkish reading does to each: the yield and the dollar up, gold and stocks down. */
const CORE: Array<{ key: InstrumentKey; hawk: number }> = [
  { key: "us2y", hawk: 1 },
  { key: "dxy", hawk: 1 },
  { key: "xau", hawk: -1 },
  { key: "es", hawk: -1 },
];

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(samples: DeliverySample[]): DeliverySummary | null {
  if (!samples.length) return null;
  const faces = samples.filter((s) => s.tension !== null).map((s) => s.tension as number);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    minutes: samples.length,
    faceMinutes: faces.length,
    confidence: r(mean(samples.map((s) => s.confidence))),
    stress: r(mean(samples.map((s) => s.stress))),
    hesitation: r(mean(samples.map((s) => s.hesitation))),
    tension: faces.length ? r(mean(faces)) : null,
  };
}

/** Merges two runs of samples of the same broadcast (an app restarted mid-way), one a minute. */
export function mergeSamples(a: DeliverySample[] = [], b: DeliverySample[] = []): DeliverySample[] {
  const byMinute = new Map<number, DeliverySample>();
  for (const s of [...a, ...b]) byMinute.set(Math.floor(s.at / 60_000), s);
  return [...byMinute.values()].sort((x, y) => x.at - y.at);
}

export function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < x.length; k++) {
    sxy += (x[k] - mx) * (y[k] - my);
    sxx += (x[k] - mx) ** 2;
    syy += (y[k] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

const ranks = (v: number[]) => {
  const order = v.map((x, k) => [x, k] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
};
export const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

/** Least squares of y on [1, a, b]: the coefficient of b. */
export function interaction(y: number[], a: number[], b: number[]): number {
  // The normal equations for three columns, solved directly.
  const n = y.length;
  const cols = [new Array<number>(n).fill(1), a, b];
  const M = cols.map((c1) => cols.map((c2) => c1.reduce((s, v, k) => s + v * c2[k], 0)));
  const v = cols.map((c) => c.reduce((s, x, k) => s + x * y[k], 0));
  // Gaussian elimination on the 3×3 system.
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [v[c], v[p]] = [v[p], v[c]];
    if (Math.abs(M[c][c]) < 1e-12) return 0;
    for (let r = c + 1; r < 3; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 3; k++) M[r][k] -= f * M[c][k];
      v[r] -= f * v[c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = v[r];
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x[2];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How often a statistic of the shuffled delivery does at least as well as the real one (one-sided). */
function permutationP(conf: number[], stat: (c: number[]) => number, seed = 11): number {
  const observed = stat(conf);
  const random = rng(seed);
  const c = [...conf];
  let atLeast = 0;
  for (let k = 0; k < PERMUTATIONS; k++) {
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    if (stat(c) >= observed - 1e-12) atLeast++;
  }
  return (atLeast + 1) / (PERMUTATIONS + 1);
}

export type Hypothesis = { id: "H1" | "H2" | "H3"; label: string; stat: number | null; statLabel: string; p: number | null; shown: boolean };
export type DeliveryRow = { videoId: string; title: string; start: number; words: number; delivery: DeliverySummary; reaction: number | null };
export type DeliveryReport = {
  /** Broadcasts with enough delivery (≥ MIN_MINUTES minutes) and a reaction. */
  n: number;
  needed: number;
  rows: DeliveryRow[];
  hypotheses: Hypothesis[];
};

type Broadcast = { videoId: string; title: string; start: number; index: number; wordsIndex?: number; delivery?: DeliverySample[]; moves: Partial<Record<InstrumentKey, number | null>> };

/** The reaction of each broadcast: the core instruments' moves, hawk-signed, in their typical move's units. */
export function reactionsOf(list: Array<{ moves: Partial<Record<InstrumentKey, number | null>> }>): Array<number | null> {
  const scale = Object.fromEntries(
    CORE.map(({ key }) => [key, median(list.map((b) => b.moves[key]).filter((v): v is number => typeof v === "number").map(Math.abs).filter((v) => v > 0))]),
  ) as Record<InstrumentKey, number>;
  return list.map((b) => {
    const parts = CORE.flatMap(({ key, hawk }) => {
      const v = b.moves[key];
      return typeof v === "number" && scale[key] > 0 ? [(hawk * v) / scale[key]] : [];
    });
    return parts.length >= 2 ? mean(parts) : null;
  });
}

export function deliveryTest(broadcasts: Broadcast[]): DeliveryReport {
  const eligible = broadcasts.filter((b) => (b.delivery?.length ?? 0) >= MIN_MINUTES);
  const R = reactionsOf(eligible);
  const rows: DeliveryRow[] = eligible.map((b, k) => ({
    videoId: b.videoId,
    title: b.title,
    start: b.start,
    words: b.wordsIndex ?? b.index,
    delivery: summarize(b.delivery!)!,
    reaction: R[k] === null ? null : Math.round((R[k] as number) * 1000) / 1000,
  }));
  const usable = rows.filter((r) => r.reaction !== null);
  const n = usable.length;
  const y = usable.map((r) => r.reaction as number);
  const w = usable.map((r) => r.words);
  const conf = usable.map((r) => r.delivery.confidence);
  const enough = n >= MIN_BROADCASTS;
  const canTest = n >= 5;

  const h1 = (c: number[]) => {
    const m = median(c);
    return interaction(y, w, w.map((x, k) => x * (c[k] - m)));
  };
  const h2 = (c: number[]) => spearman(c.map((x) => 1 - x), y.map(Math.abs));
  const combined = (c: number[]) => w.map((x, k) => x * (0.9 + 0.1 * (2 * c[k] - 1)));
  const h3 = (c: number[]) => pearson(combined(c), y) - pearson(w, y);

  const test = (id: Hypothesis["id"], label: string, statLabel: string, f: (c: number[]) => number): Hypothesis => {
    if (!canTest) return { id, label, stat: null, statLabel, p: null, shown: false };
    const stat = f(conf);
    const p = permutationP(conf, f);
    return { id, label, stat: Math.round(stat * 1000) / 1000, statLabel, p: Math.round(p * 1000) / 1000, shown: enough && p < 0.05 && stat > 0 };
  };
  return {
    n,
    needed: MIN_BROADCASTS,
    rows: rows.sort((a, b) => b.start - a.start),
    hypotheses: [
      test("H1", "Pasar lebih mengikuti kata-kata saat cara bicara yakin", "koef. interaksi", h1),
      test("H2", "Cara bicara tegang → gerak pasar lebih besar (arah apa pun)", "Spearman ρ", h2),
      test("H3", "Indeks gabungan (kata 90% + cara bicara 10%) lebih searah pasar daripada kata saja", "selisih r", h3),
    ],
  };
}
