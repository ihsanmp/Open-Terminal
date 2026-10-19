// Fact-checking what's said on a broadcast against the official data, as it's said: a speaker's
// numbers about the US economy (inflation by its measures, the unemployment rate, payroll gains,
// GDP growth, the federal funds rate) read from the live transcript and set beside the figures
// themselves (FRED's copies of BLS, BEA and the Fed's own), with the series and the period each was
// checked against, so a reader sees where a verdict comes from instead of taking it on trust.
//
// Only statements of fact are checked: a projection, an expectation, a goal ("our 2 percent
// objective") or a hypothetical isn't. A claim whose measure can't be told ("prices rose 3 percent"
// with no index named) is checked against both inflation measures and says which it matches.

import * as fred from "./fred.js";

export type Indicator = "pce" | "core_pce" | "cpi" | "core_cpi" | "inflation" | "unemployment" | "payrolls" | "payrolls_avg" | "gdp" | "fed_funds";
export type Verdict = "match" | "close" | "differs" | "unverifiable";

export type Claim = {
  indicator: Indicator;
  /** The figure said: % (bp-free), thousands of jobs, or the funds rate's range (low, high). */
  value: number;
  high?: number;
  /** The month the claim is about (YYYY-MM), when it names one; else the latest data. */
  month: string | null;
  /** Said as an approximation ("about 2 percent", "nearly 180,000"): checked with more room. */
  approx?: boolean;
  /** The words it was read from. */
  phrase: string;
  /** Where its figure is in the text as `prepare` leaves it. */
  at: number;
};

export type Check = Claim & {
  verdict: Verdict;
  /** The official figure it was set against, the period, and where it's from. */
  official: number | null;
  officialHigh?: number;
  period: string | null;
  series: string | null;
  source: string | null;
  url: string | null;
  note: string | null;
};

export const LABEL: Record<Indicator, string> = {
  pce: "Inflasi PCE (tahunan)",
  core_pce: "Inflasi PCE inti (tahunan)",
  cpi: "Inflasi CPI (tahunan)",
  core_cpi: "Inflasi CPI inti (tahunan)",
  inflation: "Inflasi (PCE atau CPI, tahunan)",
  unemployment: "Tingkat pengangguran",
  payrolls: "Tambahan lapangan kerja (payroll) sebulan",
  payrolls_avg: "Rata-rata tambahan payroll 3 bulan",
  gdp: "Pertumbuhan GDP riil (tahunan, kuartal)",
  fed_funds: "Kisaran suku bunga acuan Fed",
};

// ---------------------------------------------------------------- reading the claims

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const FRACTION: Record<string, number> = { "1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "a quarter": 0.25, "a half": 0.5, "three quarters": 0.75 };

/**
 * A said number: "2.7", "2-1/2", "4 1/4", "4 and a quarter", "two point seven", "three". Returns the
 * value and how many characters it took, or null.
 */
export function readNumber(s: string): { value: number; length: number } | null {
  let m = /^(\d+(?:\.\d+)?)(?:(?:-| | and )(1\/4|1\/2|3\/4|a quarter|a half|three quarters))?/.exec(s);
  if (m) return { value: Number(m[1]) + (m[2] ? FRACTION[m[2]] : 0), length: m[0].length };
  m = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten)(?: point (zero|one|two|three|four|five|six|seven|eight|nine))?(?: and (a quarter|a half|three quarters))?\b/.exec(s);
  if (m) return { value: WORD_NUM[m[1]] + (m[2] ? WORD_NUM[m[2]] / 10 : 0) + (m[3] ? FRACTION[m[3]] : 0), length: m[0].length };
  return null;
}

/** Words that make a statement not one of fact: forecasts, goals, hypotheticals. */
const NOT_FACT =
  /\b(expect\w*|project\w*|forecast\w*|anticipat\w*|will|would|could|should|might|may be|if|goal|objective|target(?! range)\w*|median|longer[- ]run|next year|by the end of|outlook|scenario|assum\w*|estimate[sd]? (?:that|to)|think|believe|range of (?:possible|outcomes)|neutral|want\w*|reach\w*|achiev\w*|return\w*|bring\w*|get(?:ting)? (?:it|inflation)|keep(?:ing)? (?:it|inflation)|rais\w* inflation|until|aim\w*|seek\w*|commit\w*|consistent with|toward|u-?6|hypothetical\w*|by 20\d\d)\b/;
/** Another economy's figures ("lots of countries … inflation of 10 percent"). */
const ABROAD = /\b(?:countries|europe|euro area|eurozone|britain|united kingdom|japan|china|canada|abroad|around the world|globally|emerging markets)\b/;
/** A reading of another time than now: "last december", "in 2010", "at its peak". */
const PAST = /\b(?:last (?:year|summer|spring|fall|autumn|winter|month|quarter|time|cycle|january|february|march|april|may|june|july|august|september|october|november|december)|in (?:19|20)\d\d|peak\w*|height|before the pandemic|pre-pandemic|back (?:in|then)|at the time|a year ago|years ago|historically|at the start|when (?:it|we|the)|during the|of (?:19|20)\d\d|a time when|for (?:19|20)\d\d)\b/;
/** A figure on another basis than the twelve months' (a three-month annualized pace, a month's change). */
const OTHER_BASIS = /\b(?:three|six|3|6)[- ]month|annuali[sz]ed|month-over-month|monthly|basis|between \S+ and\s*$/;

/** The month a claim names ("12 months ending in august", "in september", "through july"). */
function monthIn(s: string): number | null {
  const m = /\b(?:ending in|ended in|through|in|for|as of)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(s);
  return m ? MONTHS.indexOf(m[1]) : null;
}

/** The year-month a named month means, said on `asOf`: the latest such month before it. */
export function monthOf(month: number, asOf: Date): string {
  const y = month < asOf.getUTCMonth() ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  return `${y}-${String(month + 1).padStart(2, "0")}`;
}

/** The measures a figure can be of, as speakers name them (the more specific first). */
const MEASURES: Array<[Indicator, RegExp]> = [
  ["core_pce", /\bcore pce(?: prices?| inflation| price index)?\b|\bcore (?:personal consumption|prices)\b|\bpce (?:prices )?excluding food and energy/g],
  // PCE as prices ("pce prices", "the price index for personal consumption expenditures"), not spending.
  ["pce", /\b(?:total|headline) pce\b|\bpce (?:prices?|inflation|price index)\b|price index for personal consumption expenditures|personal consumption expenditures (?:price|inflation)/g],
  ["core_cpi", /\bcore cpi\b|\bcore consumer price/g],
  ["cpi", /\bcpi\b|consumer price index/g],
  ["unemployment", /\bunemployment(?: rate)?\b|\bjobless rate\b/g],
  ["gdp", /\bgdp\b|\bgross domestic product\b|\breal (?:economic )?output\b/g],
  ["fed_funds", /\b(?:federal funds rate|fed funds rate|policy rate|target range)\b/g],
  ["inflation", /\binflation\b/g],
];

/** The measure named nearest before a figure (a sentence may name several). */
function indicatorOf(before: string): Indicator | null {
  let best: { ind: Indicator; end: number } | null = null;
  for (const [ind, re] of MEASURES) {
    re.lastIndex = 0;
    for (let m = re.exec(before); m; m = re.exec(before)) {
      const end = m.index + m[0].length;
      // "core pce" also reads as "pce" and as "inflation": the more specific, found first, stays.
      if (!best || end > best.end + 1) best = { ind, end };
    }
  }
  return best?.ind ?? null;
}

/** Just before a figure: a comparison or a starting point, not the level itself ("below 2 percent", "from 10 percent"). */
const COMPARED = /\b(?:below|under|above|over|toward|towards|than|exceed\w*|from|short of|beneath|beyond|within|between|percent to|going to)\s*$/;
/** Just after it: a goal, a forecast's year, another period than the latest, or another measure. */
const AFTER_NOT_FACT =
  /^\s*percent\b[^.;]{0,40}?\b(?:objective|goal|target|longer[- ]run|over time|on a symmetric|on track|this year|next year|in 20\d\d|by 20\d\d|by the end|over the next|in the next|at the height|if you|if we|last (?:year|summer|spring|fall|autumn|winter|month|quarter|january|february|march|april|may|june|july|august|september|october|november|december)|a year ago|at (?:the|its) peak|before the pandemic)\b|^\s*percent\s+(?:unemployment|inflation|productivity|growth|wage|gdp|core|rate|range|or|and \d|of|to)\b/;
const APPROX = /\b(?:about|around|roughly|nearly|almost|close to|approximately|some|near|just under|just over|a little (?:over|under))\s*$/;

/**
 * The factual claims about the US data in a stretch of transcript (lower case, "%" as "percent",
 * as fedsentiment.normalize leaves it): each figure with the measure the words before it name.
 */
/** Lower case, "¾" as 0.75, "%" as " percent", one space between words (and the same again). */
export function prepare(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d*)\s?([¼½¾])/g, (_m, whole: string, f: string) => String((whole ? Number(whole) : 0) + ({ "¼": 0.25, "½": 0.5, "¾": 0.75 } as Record<string, number>)[f]))
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s+/g, " ");
}

export function extractClaims(text: string, asOf = new Date()): Claim[] {
  const out: Claim[] = [];
  const t = prepare(text);
  // Sentence by sentence where the captions punctuate; a window of words where they don't.
  for (const part of t.matchAll(/(?:[^.?!]|[.?!](?![\s]|$))+[.?!]*/g)) {
    const sentence = part[0];
    const base = part.index ?? 0;
    if (sentence.trim().endsWith("?")) continue;
    const re = /\b(\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g;
    for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
      const at = m.index;
      const num = readNumber(sentence.slice(at));
      if (!num) continue;
      re.lastIndex = at + num.length;
      const rest = sentence.slice(at + num.length);
      const before = sentence.slice(Math.max(0, at - 140), at);
      const words = before.split(" ").slice(-16).join(" ");
      // The funds rate's range: "a range of 4 to 4-1/4 percent".
      const range = /^\s*to\s+/.exec(rest);
      if (range && /\b(?:federal funds rate|fed funds rate|policy rate|target range)\b/.test(words)) {
        const hi = readNumber(rest.slice(range[0].length));
        const after = rest.slice(range[0].length + (hi?.length ?? 0));
        if (hi && /^\s*percent\b/.test(after) && !NOT_FACT.test(words) && !AFTER_NOT_FACT.test(after) && !COMPARED.test(words)) {
          out.push({ indicator: "fed_funds", at: base + at, value: num.value, high: hi.value, month: null, phrase: `${words} ${sentence.slice(at, at + num.length + range[0].length + hi.length)} percent`.trim() });
          re.lastIndex = at + num.length + range[0].length + hi.length;
        }
        continue;
      }
      // Payroll gains: "job gains averaged 29,000 per month", "added 150 thousand jobs".
      const jobs = /^\s*(?:,\d{3}|thousand|k\b)/.exec(rest);
      if (jobs && /\b(?:payroll|job gains|jobs|employers added|added)\b/.test(`${words} ${rest.slice(0, 40)}`)) {
        if (NOT_FACT.test(words) || COMPARED.test(words) || /^[^.;]{0,40}\b(?:this year|next year|last year|in 20\d\d|a year ago)\b/.test(rest)) continue;
        const thousands = rest.startsWith(",") ? Number(`${sentence.slice(at, at + num.length)}${rest.slice(0, 4)}`.replace(/,/g, "")) / 1000 : num.value;
        // "averaged" without a span is the last three months', as the Fed's statements give it; so is
        // "a pace of … per month over the last three months".
        const near = `${words.trim().split(" ").slice(-8).join(" ")} ${rest.slice(0, 70)}`;
        const avg = /\baverag\w*\b/.test(near) || (/\b(?:per|a) month\b/.test(near) && /\b(?:three|3) months\b/.test(near));
        // The month only from the words about this figure, not an earlier clause's.
        const named = monthIn(near);
        out.push({ indicator: avg ? "payrolls_avg" : "payrolls", at: base + at, value: thousands, approx: APPROX.test(words), month: named === null ? null : monthOf(named, asOf), phrase: `${words} ${sentence.slice(at, at + num.length)}${jobs[0]}`.trim() });
        continue;
      }
      if (!/^\s*percent\b/.test(rest)) continue;
      let indicator = indicatorOf(words);
      if (!indicator) continue;
      // "Core inflation" in a sentence about PCE is core PCE (the Fed's measure); "total" is PCE.
      if (indicator === "inflation" && /\bpce\b|personal consumption/.test(sentence)) indicator = /\bcore\s+(?:pce\s+)?inflation\b[^.]*$/.test(words) ? "core_pce" : /\b(?:total|headline)\b[^.]*$/.test(words) ? "pce" : indicator;
      // Expectations of inflation, a projection, a goal, a comparison, another period: not a fact to check.
      if (NOT_FACT.test(words) || /\bexpectations\b/.test(words) || COMPARED.test(words) || AFTER_NOT_FACT.test(rest)) continue;
      if (PAST.test(words.trim().split(" ").slice(-12).join(" ")) || PAST.test(rest.slice(0, 60)) || ABROAD.test(words)) continue;
      if (indicator !== "unemployment" && indicator !== "fed_funds" && OTHER_BASIS.test(words.trim().split(" ").slice(-12).join(" "))) continue;
      // "Inflation … 2 percent" with no measure named is the Fed's aim almost every time it's said.
      if (indicator === "inflation" && num.value === 2) continue;
      // GDP only for a quarter it names (a half, a year or a forecast can't be set beside one figure).
      const quarter = /\b(first|second|third|fourth) quarter\b/.exec(`${words} ${rest.slice(0, 60)}`);
      if (indicator === "gdp" && !quarter) continue;
      // A sum since a start ("from 10 percent to 4") or a change ("rose 0.3 percent") isn't a level.
      if (/\b(?:by|percentage points?)\s*$/.test(words) || /^\s*percent\s+(?:to|from)\b/.test(rest)) continue;
      const after = rest.slice(0, 70);
      const named = monthIn(`${words} ${after}`);
      const month = indicator === "gdp" && quarter ? ["first", "second", "third", "fourth"].indexOf(quarter[1]) * 3 : named;
      // "Excluding food and energy, core PCE prices rose 2.9 percent": the period of the total just said.
      const total = out.at(-1);
      const inherited =
        month === null && total && total.month && base + at - total.at < 260 && ((indicator === "core_pce" && total.indicator === "pce") || (indicator === "core_cpi" && total.indicator === "cpi")) ? total.month : null;
      out.push({ indicator, at: base + at, value: num.value, approx: APPROX.test(words), month: inherited ?? (month === null ? null : monthOf(month, asOf)), phrase: `${words} ${sentence.slice(at, at + num.length)} percent${after.replace(/^\s*percent/, "").split(/[,.;]/)[0]}`.trim() });
    }
  }
  return out;
}

// ---------------------------------------------------------------- checking them

type Series = Array<{ date: string; value: number }>;
const SERIES: Record<string, { id: string; source: string }> = {
  pce: { id: "PCEPI", source: "BEA (via FRED)" },
  core_pce: { id: "PCEPILFE", source: "BEA (via FRED)" },
  cpi: { id: "CPIAUCSL", source: "BLS (via FRED)" },
  core_cpi: { id: "CPILFESL", source: "BLS (via FRED)" },
  unemployment: { id: "UNRATE", source: "BLS (via FRED)" },
  payrolls: { id: "PAYEMS", source: "BLS (via FRED)" },
  gdp: { id: "A191RL1Q225SBEA", source: "BEA (via FRED)" },
  fed_low: { id: "DFEDTARL", source: "Federal Reserve (via FRED)" },
  fed_high: { id: "DFEDTARU", source: "Federal Reserve (via FRED)" },
};

const cache = new Map<string, { at: number; points: Series }>();
const TTL = 6 * 3_600_000;

/** A FRED series, kept six hours (new data comes out monthly). */
export async function seriesOf(key: keyof typeof SERIES, get = fred.series): Promise<Series> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.points;
  const points = await get(SERIES[key].id, 20_000);
  cache.set(key, { at: Date.now(), points });
  return points;
}

const month = (d: string) => d.slice(0, 7);
const prevYear = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

/** Year-over-year % of an index for each month it has a year-earlier value. */
export function yoy(points: Series): Map<string, number> {
  const byMonth = new Map(points.map((p) => [month(p.date), p.value]));
  const out = new Map<string, number>();
  for (const [m, v] of byMonth) {
    const was = byMonth.get(prevYear(m));
    if (was) out.set(m, (v / was - 1) * 100);
  }
  return out;
}

/** How a said figure compares with the official one: a rounding, a revision, or a different figure. */
export function verdictOf(said: number, official: number, unit: "pct" | "jobs", approx = false): Verdict {
  const gap = Math.abs(said - official);
  if (unit === "jobs") return gap <= (approx ? 15 : 5) ? "match" : gap <= 35 ? "close" : "differs";
  return gap <= (approx ? 0.15 : 0.05) + 1e-9 ? "match" : gap <= (approx ? 0.35 : 0.2) + 1e-9 ? "close" : "differs";
}

const fredUrl = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
const ORDER: Verdict[] = ["match", "close", "differs", "unverifiable"];

/**
 * Checks a claim against the data out by `asOf`: the month it names, or else the latest data
 * (and the month before, since a speaker may still quote the previous release).
 */
export async function check(c: Claim, asOf = new Date(), get = fred.series): Promise<Check> {
  const none = (note: string): Check => ({ ...c, verdict: "unverifiable", official: null, period: null, series: null, source: null, url: null, note });
  try {
    const known = (s: Series) => s.filter((p) => Date.parse(p.date) <= asOf.getTime() - 20 * 86_400_000);
    if (c.indicator === "fed_funds") {
      const [lows, highs] = [await seriesOf("fed_low", get), await seriesOf("fed_high", get)];
      const day = (s: Series, t: number) => s.filter((p) => Date.parse(p.date) <= t).at(-1);
      const fits = (lo: { value: number }, hi: { value: number }) =>
        c.high !== undefined ? Math.abs(c.value - lo.value) < 0.01 && Math.abs(c.high - hi.value) < 0.01 : c.value >= lo.value - 0.01 && c.value <= hi.value + 0.01;
      const now = { lo: day(lows, asOf.getTime()), hi: day(highs, asOf.getTime()) };
      // On a decision day the range just announced is in the data from the next day on.
      const next = { lo: day(lows, asOf.getTime() + 86_400_000), hi: day(highs, asOf.getTime() + 86_400_000) };
      const pick = next.lo && next.hi && fits(next.lo, next.hi) ? next : now;
      const [lo, hi] = [pick.lo, pick.hi];
      if (!lo || !hi) return none("data tidak tersedia");
      const ok = fits(lo, hi);
      if (!ok && Date.now() - asOf.getTime() < 2 * 86_400_000)
        return { ...none("bisa jadi kisaran baru yang diputuskan hari ini: data resmi mencatatnya mulai besok"), official: lo.value, officialHigh: hi.value, period: lo.date };
      return { ...c, verdict: ok ? "match" : "differs", official: lo.value, officialHigh: hi.value, period: lo.date, series: "DFEDTARL/DFEDTARU", source: SERIES.fed_low.source, url: fredUrl("DFEDTARU"), note: null };
    }
    if (c.indicator === "unemployment" || c.indicator === "gdp") {
      const key = c.indicator;
      const pts = known(await seriesOf(key, get));
      const cands = c.month ? pts.filter((p) => month(p.date) === c.month) : pts.slice(-2).reverse();
      if (!cands.length) return none("periode itu belum ada datanya");
      const best = cands.map((p, k) => ({ p, k, v: verdictOf(c.value, p.value, "pct", c.approx) })).sort((a, b) => ORDER.indexOf(a.v) - ORDER.indexOf(b.v) || a.k - b.k)[0];
      return { ...c, verdict: best.v, official: Math.round(best.p.value * 100) / 100, period: month(best.p.date), series: SERIES[key].id, source: SERIES[key].source, url: fredUrl(SERIES[key].id), note: best.k > 0 ? "cocok dengan rilis sebelumnya" : null };
    }
    if (c.indicator === "payrolls" || c.indicator === "payrolls_avg") {
      const pts = known(await seriesOf("payrolls", get));
      const change = pts.slice(1).map((p, k) => ({ m: month(p.date), v: p.value - pts[k].value }));
      const at = c.month ? change.findIndex((x) => x.m === c.month) : change.length - 1;
      if (at < 0) return none("periode itu belum ada datanya");
      const cands = [at, at - 1].filter((k) => k >= (c.indicator === "payrolls_avg" ? 2 : 0)).map((k) => ({
        k,
        m: change[k].m,
        v: c.indicator === "payrolls_avg" ? (change[k].v + change[k - 1].v + change[k - 2].v) / 3 : change[k].v,
      }));
      if (c.month) cands.splice(1);
      const best = cands.map((x) => ({ ...x, verdict: verdictOf(c.value, x.v, "jobs", c.approx) })).sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict))[0];
      if (!best) return none("data tidak cukup");
      return { ...c, verdict: best.verdict, official: Math.round(best.v), period: best.m, series: "PAYEMS", source: SERIES.payrolls.source, url: fredUrl("PAYEMS"), note: best.k !== at ? "cocok dengan rilis sebelumnya" : "data payroll sering direvisi" };
    }
    // Inflation: the measure named, or both when it isn't.
    const measures: Array<keyof typeof SERIES> = c.indicator === "inflation" ? ["pce", "cpi", "core_pce", "core_cpi"] : [c.indicator];
    const tries: Array<{ key: keyof typeof SERIES; m: string; v: number; verdict: Verdict; k: number }> = [];
    for (const key of measures) {
      const rates = yoy(known(await seriesOf(key, get)));
      const months = [...rates.keys()].sort();
      const cands = c.month ? [c.month] : months.slice(-2).reverse();
      cands.forEach((m, k) => {
        const v = rates.get(m);
        if (v !== undefined) tries.push({ key, m, v, verdict: verdictOf(c.value, v, "pct", c.approx), k });
      });
    }
    if (!tries.length) return none("periode itu belum ada datanya");
    const best = tries.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.k - b.k)[0];
    const notes = [c.indicator === "inflation" ? `ukuran tidak disebut: paling cocok dengan ${LABEL[best.key as Indicator]}` : null, best.k > 0 ? "cocok dengan rilis sebelumnya" : null].filter(Boolean);
    return {
      ...c,
      verdict: best.verdict,
      official: Math.round(best.v * 100) / 100,
      period: best.m,
      series: SERIES[best.key].id,
      source: SERIES[best.key].source,
      url: fredUrl(SERIES[best.key].id),
      note: notes.length ? notes.join("; ") : null,
    };
  } catch (err) {
    return none(`data resmi gagal dibaca: ${err instanceof Error ? err.message : err}`);
  }
}

export const VERDICT_LABEL: Record<Verdict, string> = { match: "sesuai data", close: "mendekati", differs: "berbeda", unverifiable: "tak bisa diverifikasi" };

/**
 * The claims in a transcript's lines, each with the line its figure was said in. Captions cut a
 * sentence across lines, so the lines are read together.
 */
export function claimsInLines(lines: string[], asOf = new Date()): Array<Claim & { line: number }> {
  const starts: number[] = [];
  let text = "";
  for (const l of lines) {
    starts.push(text.length);
    text += `${prepare(l).trim()} `;
  }
  return extractClaims(text, asOf).map((c) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= c.at) line++;
    return { ...c, line };
  });
}
