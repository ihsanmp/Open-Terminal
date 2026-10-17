// Planet positions for the astro-cycle indicator.
//
// Planets: Keplerian elements and their rates from JPL's "Approximate Positions of the Planets"
// (E. M. Standish, Table 1, valid 1800 – 2050 AD; public domain): fast, and good to a few
// arcminutes for the Sun and the inner planets. For Mars and beyond they are off by up to ~0.1°,
// which for a slow planet is a day or more of its motion (Saturn changed sign a day early,
// Saturn–Neptune came 23 hours early, a heliocentric Jupiter–Neptune turn days off). So those are
// corrected to astronomy-engine's precise positions (MIT; light time and aberration included):
// the difference is worked out every 10 days and interpolated, since it changes only slowly, and
// costs a few thousand precise positions for decades of daily bars.
// Moon: the leading terms of Meeus' lunar longitude (a few tenths of a degree: under an hour of
// its motion).

import * as AE from "astronomy-engine";
//
// Longitudes are ecliptic, in degrees 0 … 360. Geocentric is the sky as seen from Earth (what
// astrology uses, retrograde loops included); heliocentric is the planets around the Sun, whose
// angles between planets turn smoothly.

export type Body = "Sun" | "Moon" | "Mercury" | "Venus" | "Earth" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";

// a (au), e, I, L, long. perihelion, long. ascending node (degrees) and their rates per Julian century.
type Elements = [number, number, number, number, number, number, number, number, number, number, number, number];
const ELEMENTS: Record<Exclude<Body, "Sun" | "Moon">, Elements> = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  Earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  Mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  Pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};

const RAD = Math.PI / 180;
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Julian centuries since J2000.0 (2000-01-01 12:00) for unix seconds. */
const centuries = (t: number) => (t / 86_400 + 2_440_587.5 - 2_451_545) / 36_525;

/** Heliocentric ecliptic x, y, z (au) of a planet. */
function helio(body: keyof typeof ELEMENTS, T: number): [number, number, number] {
  const el = ELEMENTS[body];
  const [a, e, I, L, peri, node] = el.slice(0, 6).map((v, k) => v + el[k + 6] * T);
  const w = peri - node;
  // Mean anomaly in −180 … 180, then Kepler's equation by Newton's method.
  let M = norm(L - peri);
  if (M > 180) M -= 360;
  const Mr = M * RAD;
  let E = Mr + e * Math.sin(Mr);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cO, sO, cI, sI] = [Math.cos(w * RAD), Math.sin(w * RAD), Math.cos(node * RAD), Math.sin(node * RAD), Math.cos(I * RAD), Math.sin(I * RAD)];
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** The Moon's geocentric longitude (Meeus' leading terms). */
function moonLongitude(t: number): number {
  const d = t / 86_400 + 2_440_587.5 - 2_451_545;
  const L = 218.316 + 13.176396 * d; // mean longitude
  const M = (134.963 + 13.064993 * d) * RAD; // mean anomaly
  const Ms = (357.529 + 0.98560028 * d) * RAD; // the Sun's mean anomaly
  const D = (297.85 + 12.190749 * d) * RAD; // mean elongation
  const F = (93.272 + 13.22935 * d) * RAD; // argument of latitude
  return norm(L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F));
}

/**
 * JPL's elements give longitudes from the equinox of J2000; astrology's tropical zodiac counts
 * from the equinox of the date, which precession has moved since by 1.397° a century (0.37° by
 * 2026, 9 hours of the Sun's motion: equinoxes and ingresses would come that much late, and the
 * Moon — computed of date — wouldn't line up with the Sun at new moon).
 */
const precession = (T: number) => 1.396971 * T + 0.0003086 * T * T;

/** The Moon's ecliptic latitude (leading terms). */
function moonLatitude(t: number): number {
  const d = t / 86_400 + 2_440_587.5 - 2_451_545;
  const M = (134.963 + 13.064993 * d) * RAD;
  const D = (297.85 + 12.190749 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  return 5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F);
}

/** Geocentric ecliptic longitude and latitude from the elements alone. */
function rawGeocentric(body: Exclude<Body, "Earth" | "Moon">, T: number): [number, number] {
  const [xe, ye, ze] = helio("Earth", T);
  const [x, y, z] = body === "Sun" ? [0, 0, 0] : helio(body, T);
  const [dx, dy, dz] = [x - xe, y - ye, z - ze];
  return [norm(Math.atan2(dy, dx) / RAD + precession(T)), Math.atan2(dz, Math.hypot(dx, dy)) / RAD];
}

/** Heliocentric ecliptic longitude from the elements alone. */
function rawHeliocentric(body: keyof typeof ELEMENTS, T: number): number {
  const [x, y] = helio(body, T);
  return norm(Math.atan2(y, x) / RAD + precession(T));
}

// ---- the correction to precise positions, for Mars and beyond ----

type Corrected = "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";
const CORRECTED = new Set<string>(["Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]);
const STEP = 10 * 86_400;
const wrap = (d: number) => ((d + 540) % 360) - 180;
/** Precise − approximate [longitude, latitude] at grid points, by frame and body. */
const corrections = new Map<string, Map<number, [number, number]>>();

function correctionAt(frame: "geo" | "helio", body: Corrected, k: number): [number, number] {
  const key = `${frame}:${body}`;
  const table = corrections.get(key) ?? corrections.set(key, new Map()).get(key)!;
  const hit = table.get(k);
  if (hit) return hit;
  const t = k * STEP;
  const time = AE.MakeTime(new Date(t * 1000));
  const v = frame === "geo" ? AE.GeoVector(AE.Body[body], time, true) : AE.HelioVector(AE.Body[body], time);
  const sky = AE.SphereFromVector(AE.RotateVector(AE.Rotation_EQJ_ECT(time), v));
  const T = centuries(t);
  const [lon, lat] = frame === "geo" ? rawGeocentric(body, T) : [rawHeliocentric(body, T), 0];
  const c: [number, number] = [wrap(sky.lon - lon), sky.lat - lat];
  table.set(k, c);
  return c;
}

/** The correction at time t, between the grid points around it. */
function correction(frame: "geo" | "helio", body: Corrected, t: number): [number, number] {
  const x = t / STEP;
  const k = Math.floor(x);
  const f = x - k;
  const [a, b] = [correctionAt(frame, body, k), correctionAt(frame, body, k + 1)];
  return [a[0] + wrap(b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const corrected = (body: Body): body is Corrected => CORRECTED.has(body);

/** Geocentric ecliptic longitude and latitude, and declination (degrees, north positive). */
export function geocentric(body: Exclude<Body, "Earth">, t: number): { lon: number; lat: number; dec: number } {
  const T = centuries(t);
  let lon: number;
  let lat: number;
  if (body === "Moon") {
    lon = moonLongitude(t);
    lat = moonLatitude(t);
  } else {
    [lon, lat] = rawGeocentric(body, T);
    if (corrected(body)) {
      const [dl, db] = correction("geo", body, t);
      lon = norm(lon + dl);
      lat += db;
    }
  }
  const eps = (23.43929 - 0.0130042 * T) * RAD; // obliquity of the ecliptic
  const dec = Math.asin(Math.sin(lat * RAD) * Math.cos(eps) + Math.cos(lat * RAD) * Math.sin(eps) * Math.sin(lon * RAD)) / RAD;
  return { lon, lat, dec };
}

/** The obliquity of the ecliptic: the Sun's greatest declination, beyond which a body is "out of bounds". */
export const obliquity = (t: number) => 23.43929 - 0.0130042 * centuries(t);

/** Geocentric motion in longitude over a day, degrees; negative while retrograde. */
export function dailyMotion(body: Exclude<Body, "Earth">, t: number): number {
  const d = geocentric(body, t + 43_200).lon - geocentric(body, t - 43_200).lon;
  return ((d + 540) % 360) - 180;
}

/** Ecliptic longitude of a body at unix time `t`, as seen from Earth or from the Sun. */
export function longitude(body: Body, t: number, frame: "geocentric" | "heliocentric" = "geocentric"): number {
  const T = centuries(t);
  if (body === "Moon") return moonLongitude(t);
  if (frame === "heliocentric") {
    if (body === "Sun") return NaN;
    const lon = rawHeliocentric(body, T);
    return corrected(body) ? norm(lon + correction("helio", body, t)[0]) : lon;
  }
  if (body === "Earth") return NaN;
  return geocentric(body, t).lon;
}

/** The angle from body B to body A, 0 … 360 (0 = conjunction, 180 = opposition). */
export function separation(a: Body, b: Body, t: number, frame: "geocentric" | "heliocentric" = "geocentric"): number {
  return norm(longitude(a, t, frame) - longitude(b, t, frame));
}
