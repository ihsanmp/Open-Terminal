// How someone sounds, from 16 kHz mono audio, with no model: plain signal processing.
//   - voice activity from frame energy against the segment's own noise floor;
//   - pitch (f0) by YIN on voiced frames, 60–400 Hz;
//   - a voice print per second of speech (log pitch, its spread, spectral centroid and 12 MFCCs)
//     for telling speakers apart;
//   - pauses (silences of 300 ms or more between speech) for hesitation.

export const RATE = 16_000;
const FRAME = 512; // 32 ms
const HOP = 160; // 10 ms
const MIN_F0 = 60;
const MAX_F0 = 400;

/** s16le PCM as floats in −1..1. */
export function pcmToFloat(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

function rms(x: Float32Array, start: number, len: number): number {
  let s = 0;
  for (let i = start; i < start + len; i++) s += x[i] * x[i];
  return Math.sqrt(s / len);
}

/**
 * The fundamental frequency of a frame by YIN (de Cheveigné & Kawahara, 2002), or null when the
 * frame isn't clearly periodic.
 */
export function yin(x: Float32Array, start: number, len = FRAME, threshold = 0.15): number | null {
  const maxLag = Math.min(Math.floor(RATE / MIN_F0), len - 1);
  const minLag = Math.floor(RATE / MAX_F0);
  const half = len - maxLag;
  if (half <= 0) return null;
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const v = x[start + i] - x[start + i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // Cumulative mean normalized difference; the first dip under the threshold is the period.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let best = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return null;
  // Parabolic interpolation around the dip.
  const a = d[best - 1] ?? d[best];
  const b = d[best];
  const c = d[best + 1] ?? d[best];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return RATE / (best + (Number.isFinite(shift) ? shift : 0));
}

// ---------------------------------------------------------------- spectrum and MFCCs

function fftMag(frame: Float32Array): Float32Array {
  // Radix-2 FFT of a real frame (length a power of two), magnitudes of the first half.
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
  const mag = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const MELS = 26;
const CEPS = 12;
const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** Triangular mel filters over the FFT bins, 80 Hz to 7.6 kHz. */
const FILTERS: Float32Array[] = (() => {
  const bins = FRAME / 2 + 1;
  const lo = hzToMel(80);
  const hi = hzToMel(7600);
  const points = Array.from({ length: MELS + 2 }, (_, i) => Math.floor(((FRAME + 1) * melToHz(lo + ((hi - lo) * i) / (MELS + 1))) / RATE));
  return Array.from({ length: MELS }, (_, m) => {
    const f = new Float32Array(bins);
    for (let k = points[m]; k < points[m + 1]; k++) f[k] = (k - points[m]) / Math.max(1, points[m + 1] - points[m]);
    for (let k = points[m + 1]; k < points[m + 2]; k++) f[k] = (points[m + 2] - k) / Math.max(1, points[m + 2] - points[m + 1]);
    return f;
  });
})();

const WINDOW = Float32Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** A frame's MFCCs (1..12) and spectral centroid (Hz). */
export function spectralFeatures(x: Float32Array, start: number): { mfcc: number[]; centroid: number } {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = (x[start + i] ?? 0) * WINDOW[i];
  const mag = fftMag(frame);
  let num = 0;
  let den = 0;
  for (let k = 0; k < mag.length; k++) {
    num += k * mag[k];
    den += mag[k];
  }
  const energies = FILTERS.map((f) => {
    let s = 0;
    for (let k = 0; k < mag.length; k++) s += f[k] * mag[k] * mag[k];
    return Math.log(s + 1e-10);
  });
  const mfcc: number[] = [];
  for (let c = 1; c <= CEPS; c++) {
    let s = 0;
    for (let m = 0; m < MELS; m++) s += energies[m] * Math.cos((Math.PI * c * (m + 0.5)) / MELS);
    mfcc.push(s);
  }
  return { mfcc, centroid: den > 0 ? ((num / den) * RATE) / FRAME : 0 };
}

// ---------------------------------------------------------------- a segment's prosody

/** One second of audio: whether there's speech, its pitch, and its voice print. */
export type SecondFeatures = {
  /** Offset from the segment's start, ms. */
  at: number;
  voiced: number;
  energy: number;
  f0: number | null;
  f0Spread: number | null;
  /** [log f0, f0 spread (semitones), centroid (kHz), MFCC 1..12], null without enough speech. */
  print: number[] | null;
};

export type SegmentProsody = { seconds: SecondFeatures[]; pauses: number; voicedRatio: number };

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const semitones = (hz: number) => 12 * Math.log2(hz / 100);

export function analyzeSegment(x: Float32Array): SegmentProsody {
  const frames: Array<{ energy: number; f0: number | null; start: number }> = [];
  for (let s = 0; s + FRAME <= x.length; s += HOP) frames.push({ energy: rms(x, s, FRAME), f0: null, start: s });
  if (!frames.length) return { seconds: [], pauses: 0, voicedRatio: 0 };
  // Speech: frames well above the quietest tenth of the segment, or not far under its loudest, and
  // above a floor for silence (−46 dBFS).
  const energies = frames.map((f) => f.energy).sort((a, b) => a - b);
  const floor = Math.max(Math.min(energies[Math.floor(energies.length * 0.1)] * 3, energies[Math.floor(energies.length * 0.9)] * 0.3), 0.005);
  const speech = frames.map((f) => f.energy > floor);
  frames.forEach((f, i) => {
    if (speech[i]) f.f0 = yin(x, f.start);
  });

  // Pauses: runs of 30+ non-speech frames (300 ms) with speech on both sides.
  let pauses = 0;
  let run = 0;
  let seen = false;
  for (const s of speech) {
    if (s) {
      if (seen && run >= 30) pauses++;
      seen = true;
      run = 0;
    } else run++;
  }

  const perSecond = RATE / HOP;
  const seconds: SecondFeatures[] = [];
  for (let s0 = 0; s0 < frames.length; s0 += perSecond) {
    const idx = frames.slice(s0, s0 + perSecond).map((_, i) => s0 + i);
    const voicedIdx = idx.filter((i) => speech[i]);
    const f0s = voicedIdx.map((i) => frames[i].f0).filter((v): v is number => v !== null);
    const voiced = voicedIdx.length / idx.length;
    let print: number[] | null = null;
    let f0: number | null = null;
    let f0Spread: number | null = null;
    if (f0s.length >= 10) {
      f0 = median(f0s);
      const st = f0s.map(semitones).sort((a, b) => a - b);
      f0Spread = st[Math.floor(st.length * 0.9)] - st[Math.floor(st.length * 0.1)];
      // The voice print from up to ten voiced frames of the second.
      const pick = voicedIdx.filter((_, k) => k % Math.max(1, Math.floor(voicedIdx.length / 10)) === 0).slice(0, 10);
      const feats = pick.map((i) => spectralFeatures(x, frames[i].start));
      const mfcc = Array.from({ length: CEPS }, (_, c) => feats.reduce((n, f) => n + f.mfcc[c], 0) / feats.length);
      const centroid = feats.reduce((n, f) => n + f.centroid, 0) / feats.length;
      print = [Math.log(f0), f0Spread / 12, centroid / 1000, ...mfcc.map((m) => m / 10)];
    }
    seconds.push({ at: Math.round((s0 * HOP * 1000) / RATE), voiced, energy: idx.reduce((n, i) => n + frames[i].energy, 0) / idx.length, f0, f0Spread, print });
  }
  return { seconds, pauses, voicedRatio: speech.filter(Boolean).length / speech.length };
}
