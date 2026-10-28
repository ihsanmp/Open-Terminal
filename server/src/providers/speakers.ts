// Who's speaking: seconds of speech grouped by voice, as they come (online clustering of voice
// prints from prosody.ts). Each dimension is scaled by its spread over everything heard so far, so
// pitch and timbre weigh alike; a second goes to the nearest voice, or starts a new one when no voice
// is near. The main speaker is the one heard most lately: at a Fed event, the Fed official. Not the
// one heard longest over the broadcast: a stream opens up to an hour early with a presenter, a
// video and hold music, and that voice would outweigh the chair's first ten minutes (FOMC, 28 Oct
// 2026: the chair's words were all left out as another voice's).

export type Voice = { id: number; seconds: number; centroid: number[]; /** Seconds heard, fading with a ten-minute time constant. */ recent: number };

/** The time constant (seconds of speech) the main speaker is judged over. */
const RECENT_S = 600;
const FADE = Math.exp(-1 / RECENT_S);

const MAX_VOICES = 8;
/** Typical spreads: log f0, pitch range (octaves), spectral centroid (kHz), MFCC 1..12 (÷10). */
const PRIOR = [0.25, 0.15, 0.4, 0.6];
/**
 * How much each dimension counts: pitch most (it changes least within a voice and most between
 * voices), the twelve MFCCs, which move with every vowel, a little each.
 */
const WEIGHTS = [4, 1, 1, ...Array(12).fill(0.35)];
/** A second further than this from every voice (in spreads, root mean square) starts a new one. */
const THRESHOLD = 1.5;

export class Speakers {
  voices: Voice[] = [];
  private n = 0;
  private sum: number[] = [];
  private sumSq: number[] = [];

  constructor(private threshold = THRESHOLD) {}

  /**
   * Each dimension's spread: what's been heard, leaning on a typical spread (PRIOR, worth 30
   * seconds) until there's enough of it.
   */
  private scale(): number[] {
    return this.sum.map((s, i) => {
      const mean = s / this.n;
      const variance = Math.max(this.sumSq[i] / this.n - mean * mean, 0);
      const prior = PRIOR[Math.min(i, PRIOR.length - 1)];
      return Math.sqrt((prior * prior * 30 + variance * this.n) / (30 + this.n));
    });
  }

  /** Weighted root mean square of the per-dimension differences, each in its spread. */
  distance(a: number[], b: number[], scale = this.scale()): number {
    let d = 0;
    let w = 0;
    for (let i = 0; i < a.length; i++) {
      const v = (a[i] - b[i]) / scale[i];
      const k = WEIGHTS[i] ?? 0.35;
      d += k * v * v;
      w += k;
    }
    return Math.sqrt(d / w);
  }

  /** The voice a second of speech belongs to (a new one if it's like none heard). */
  assign(print: number[]): number {
    if (!this.sum.length) {
      this.sum = print.map(() => 0);
      this.sumSq = print.map(() => 0);
    }
    this.n++;
    print.forEach((v, i) => {
      this.sum[i] += v;
      this.sumSq[i] += v * v;
    });
    const scale = this.scale();
    let best: Voice | null = null;
    let bestD = Infinity;
    for (const v of this.voices) {
      const d = this.distance(print, v.centroid, scale);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best && (bestD <= this.threshold || this.voices.length >= MAX_VOICES)) return this.add(best, print);
    const voice: Voice = { id: this.voices.length, seconds: 0, centroid: [...print], recent: 0 };
    this.voices.push(voice);
    return this.add(voice, print);
  }

  private add(v: Voice, print: number[]): number {
    for (const x of this.voices) x.recent *= FADE;
    v.recent++;
    v.seconds++;
    const w = 1 / Math.min(v.seconds, 60);
    v.centroid = v.centroid.map((c, i) => c + (print[i] - c) * w);
    return v.id;
  }

  /** The voice heard most lately. */
  main(): number | null {
    if (!this.voices.length) return null;
    return this.voices.reduce((a, b) => (b.recent > a.recent ? b : a)).id;
  }
}

/** Each second's voice, with one-off seconds inside a run of another voice put back with the run. */
export function smooth(ids: Array<number | null>): Array<number | null> {
  return ids.map((id, i) => {
    const prev = ids[i - 1];
    const next = ids[i + 1];
    if (id !== null && prev !== undefined && prev !== null && prev === next && prev !== id) return prev;
    return id;
  });
}
