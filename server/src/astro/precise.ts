// The eclipses, by Meeus' method (Astronomical Algorithms, ch. 54): whether a new or full moon is
// one, and of what kind, from the Moon's distance to the node — not from its latitude alone, which
// mistook near misses for eclipses (and a partial lunar eclipse for a penumbral one).

export type EclipseKind = "total-solar" | "annular-solar" | "hybrid-solar" | "partial-solar" | "total-lunar" | "partial-lunar" | "penumbral-lunar";

const RAD = Math.PI / 180;
const SYNODIC = 29.530588861;

/**
 * The eclipse at the new (or full) moon nearest unix time `t`, if any (Meeus ch. 54). `gamma` is the
 * least distance of the Moon's shadow axis (or the Moon) from the Earth's center (or the shadow's),
 * in Earth radii.
 */
/**
 * Meeus' magnitudes run about 0.02 low at the penumbral limit: NASA lists eclipses of penumbral
 * magnitude 0.016 (Aug 2016) and 0.001 (Jul 2027) that come out at −0.011 and −0.006. Over
 * 1990–2030 every full moon within this margin of it was an eclipse, and none outside.
 */
const PENUMBRAL_MARGIN = 0.03;

export function eclipseAt(t: number, phase: "new" | "full", margin = PENUMBRAL_MARGIN): { kind: EclipseKind; gamma: number; magnitude: number } | null {
  const jd = t / 86_400 + 2_440_587.5;
  // The lunation number: whole for a new moon, a half for a full one.
  const raw = (jd - 2_451_550.09766) / SYNODIC;
  const k = phase === "new" ? Math.round(raw) : Math.round(raw - 0.5) + 0.5;
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3) * RAD;
  if (Math.abs(Math.sin(F)) > 0.36) return null; // too far from a node
  const F1 = F - 0.02665 * RAD * Math.sin(Om);
  const P =
    0.207 * E * Math.sin(M) + 0.0024 * E * Math.sin(2 * M) - 0.0392 * Math.sin(Mp) + 0.0116 * Math.sin(2 * Mp) -
    0.0073 * E * Math.sin(Mp + M) + 0.0067 * E * Math.sin(Mp - M) + 0.0118 * Math.sin(2 * F1);
  const Q = 5.2207 - 0.0048 * E * Math.cos(M) + 0.002 * E * Math.cos(2 * M) - 0.3299 * Math.cos(Mp) - 0.006 * E * Math.cos(Mp + M) + 0.0041 * E * Math.cos(Mp - M);
  const W = Math.abs(Math.cos(F1));
  const gamma = (P * Math.cos(F1) + Q * Math.sin(F1)) * (1 - 0.0048 * W);
  const u = 0.0059 + 0.0046 * E * Math.cos(M) - 0.0182 * Math.cos(Mp) + 0.0004 * Math.cos(2 * Mp) - 0.0005 * Math.cos(M + Mp);
  const g = Math.abs(gamma);
  if (phase === "new") {
    if (g > 1.5433 + u) return null;
    if (g < 0.9972) {
      // Central: total, annular, or one then the other along the track.
      const kind = u < 0 ? "total-solar" : u > 0.0047 ? "annular-solar" : u < 0.00464 * Math.sqrt(1 - g * g) ? "hybrid-solar" : "annular-solar";
      return { kind, gamma, magnitude: 1 };
    }
    return { kind: "partial-solar", gamma, magnitude: (1.5433 + u - g) / (0.5461 + 2 * u) };
  }
  const umbral = (1.0128 - u - g) / 0.545;
  const penumbral = (1.5573 + u - g) / 0.545;
  if (umbral >= 1) return { kind: "total-lunar", gamma, magnitude: umbral };
  if (umbral > 0) return { kind: "partial-lunar", gamma, magnitude: umbral };
  if (penumbral > -margin) return { kind: "penumbral-lunar", gamma, magnitude: Math.max(0.001, penumbral) };
  return null;
}
